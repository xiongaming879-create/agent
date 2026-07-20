import type { CompiledStateGraph } from '@langchain/langgraph'
import { AIMessageChunk, AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentEvent } from '../types'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentRunOptions {
  maxIterations: number
  systemPrompt?: string
}

function detectStuckPattern(observations: string[], threshold: number = 3): boolean {
  if (observations.length < threshold) return false
  const recent = observations.slice(-threshold)
  return recent.every(obs =>
    obs.startsWith('Tool error:') ||
    obs.includes('not found') ||
    obs.includes('Request timeout') ||
    obs.includes('Error:') ||
    obs.length < 20
  )
}

/** Normalize a tool input string for duplicate detection (trim, lowercase, strip JSON noise). */
function normalizeToolInput(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[{"}\s]/g, '')
    .slice(0, 200)
}

/** Whether a tool is a "search-type" tool that retrieves external info. */
function isSearchTypeTool(toolName: string): boolean {
  return /^(search|fetch|browser_navigate|browser_snapshot|browser_click|browser_type|browser_fill|browser_take_screenshot)/i.test(toolName)
}

interface SearchState {
  searchCallCount: number         // 搜索类工具调用总次数
  seenInputs: Map<string, number> // 记录重复输入
}

function createSearchState(): SearchState {
  return {
    searchCallCount: 0,
    seenInputs: new Map(),
  }
}

const MAX_SEARCH_CALLS = 25  // 搜索类工具总调用上限

/**
 * 简化版停止检测：只看总次数 + 完全相同输入重复。
 * 不过度干预模型的搜索策略，让模型自己判断何时该停。
 */
function checkSearchEffectiveness(
  toolName: string,
  toolInput: string,
  _output: string,
  state: SearchState
): { shouldStop: boolean; reason: string | null } {
  if (!isSearchTypeTool(toolName)) {
    return { shouldStop: false, reason: null }
  }

  state.searchCallCount++

  // 完全相同的输入重复调用 -> 死循环，立即停止
  const inputKey = `${toolName}:${normalizeToolInput(toolInput)}`
  const inputCount = (state.seenInputs.get(inputKey) || 0) + 1
  state.seenInputs.set(inputKey, inputCount)
  if (inputCount >= 2) {
    return { shouldStop: true, reason: `重复调用 ${toolName}(${toolInput.slice(0, 50)})` }
  }

  // 总次数兜底
  if (state.searchCallCount > MAX_SEARCH_CALLS) {
    return { shouldStop: true, reason: `搜索类工具调用 ${state.searchCallCount} 次超过上限 ${MAX_SEARCH_CALLS}` }
  }

  return { shouldStop: false, reason: null }
}

interface ContentBlock {
  type?: string
  text?: string
  thinking?: string
  index?: number
  name?: string
  id?: string
}

const pendingToolCalls = new Map<string, { name: string; args: string }>()

function extractContentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content as ContentBlock[]
  return []
}

export async function* langchainAgentRunner(
  agent: CompiledStateGraph<Record<string, unknown>, Record<string, unknown>>,
  messages: ChatMessage[],
  options: AgentRunOptions
): AsyncGenerator<AgentEvent> {
  const observations: string[] = []
  const searchState = createSearchState()
  let hasContent = false
  let circularReason: string | null = null

  const inputMessages = messages.map(m => {
    if (m.role === 'user') return new HumanMessage(m.content)
    if (m.role === 'assistant') return new AIMessage(m.content)
    return new SystemMessage(m.content)
  })

  try {
    const stream = await agent.stream(
      { messages: inputMessages },
      { recursionLimit: options.maxIterations }
    )

    for await (const chunk of stream) {
      if (chunk.agent?.messages) {
        // Accumulate all text/thinking from this agent step, then decide at the end
        let stepHasToolCalls = false
        let stepThinking = ''
        let stepText = ''

        for (const msg of chunk.agent.messages) {
          if (!(msg instanceof AIMessageChunk || msg instanceof AIMessage)) continue

          if (msg.tool_calls?.length) stepHasToolCalls = true

          for (const tc of msg.tool_calls ?? []) {
            const argsStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
            pendingToolCalls.set(tc.id, { name: tc.name, args: argsStr })
          }

          const blocks = extractContentBlocks(msg.content)
          for (const block of blocks) {
            if (block.type === 'thinking' && block.thinking) {
              stepThinking += block.thinking
            } else if (block.type === 'text' && block.text) {
              stepText += block.text
            }
          }
        }

        // Now emit events based on the full step
        if (stepHasToolCalls) {
          // Intermediate turn: all text and thinking go as thoughts
          const combined = stepThinking + stepText
          if (combined) {
            yield { type: 'thought_delta', content: combined }
            yield { type: 'thought', content: combined.trim() }
          }
        } else {
          // Final turn (or no-tool turn)
          if (stepThinking.trim()) {
            yield { type: 'thought_delta', content: stepThinking }
            yield { type: 'thought', content: stepThinking.trim() }
          }
          if (stepText.trim()) {
            hasContent = true
            yield { type: 'content_delta', content: stepText }
          }
        }

        // Model put answer in thinking only (no text, no tool calls, but has observations from tools)
        if (!stepHasToolCalls && !hasContent && stepThinking.trim() && !stepText.trim() && observations.length > 0) {
          hasContent = true
          yield { type: 'content_delta', content: stepThinking.trim() }
        }
      }

      if (chunk.tools?.messages) {
        for (const msg of chunk.tools.messages) {
          if (msg instanceof ToolMessage) {
            const toolName = msg.name || 'unknown'
            const callInfo = pendingToolCalls.get(msg.tool_call_id)
            const toolInput = callInfo?.args || ''
            pendingToolCalls.delete(msg.tool_call_id)

            yield { type: 'action', tool_name: toolName, content: toolInput }

            const output = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            yield { type: 'observation', content: output }
            observations.push(output)

            // 检测连续失败
            if (detectStuckPattern(observations)) {
              yield { type: 'thought', content: '连续多次工具执行未获得有效结果，终止循环' }
              circularReason = '连续工具失败'
              break
            }

            // 搜索类工具停止检测：总次数上限 + 重复输入拦截
            const check = checkSearchEffectiveness(toolName, toolInput, output, searchState)
            if (check.shouldStop) {
              yield { type: 'thought', content: `${check.reason}，停止搜索，基于已有信息综合回答` }
              circularReason = check.reason
              break
            }
          }
        }
        if (circularReason) break
      }
    }

    // Fallback: tools were called but no answer produced — summarize what we found
    if (!hasContent && observations.length > 0) {
      const usefulObs = observations.filter(o => o.length >= 20 && !o.includes('Request timeout') && !o.includes('Error:'))
      if (usefulObs.length > 0) {
        const summary = usefulObs.slice(-3).map((o, i) => `--- 搜索结果 ${i + 1} ---\n${o.slice(0, 800)}`).join('\n\n')
        const prefix = circularReason
          ? `已执行多轮工具调用（${circularReason}），未能获取完整信息。以下是目前已获取的内容：\n\n`
          : '经过多轮工具尝试，以下是已获取的相关信息：\n\n'
        yield { type: 'content', content: prefix + summary }
      } else {
        yield { type: 'content', content: '经过多轮工具尝试后仍无法获取有效信息，暂时无法确定。' }
      }
    }

    yield { type: 'done' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[LangChain agent error]:', errMsg)
    yield { type: 'thought', content: `Agent error: ${errMsg}` }

    // If we have observations but no answer, summarize them as content
    if (!hasContent && observations.length > 0) {
      const lastObs = observations[observations.length - 1]
      yield { type: 'content', content: `工具执行已完成，但未能生成最终回答。最后一次工具结果：\n${lastObs.slice(0, 2000)}` }
    } else if (!hasContent) {
      yield { type: 'content', content: 'Agent 执行出错，未能生成回答。' }
    }

    yield { type: 'done' }
  }
}

