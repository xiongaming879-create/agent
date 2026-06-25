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
  let hasContent = false

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

            if (detectStuckPattern(observations)) {
              yield { type: 'thought', content: '连续多次工具执行未获得有效结果，终止循环' }
              yield { type: 'content', content: '目前无法确定' }
              yield { type: 'done' }
              return
            }
          }
        }
      }
    }

    // Fallback: tools were called but no answer produced
    if (!hasContent && observations.length > 0) {
      yield { type: 'content', content: '经过多轮工具尝试后仍无法获取有效信息，暂时无法确定。' }
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

