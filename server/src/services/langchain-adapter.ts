import type { CompiledStateGraph } from '@langchain/langgraph'
import { AIMessageChunk, AIMessage, ToolMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentEvent } from '../types'
import { logToolCall, logStuckDetected, logSearchLimitHit, logAgentDone, logAgentError } from './logger'
import { callLLM } from './llm-caller'
import { MODEL_LIGHT } from './llm-config'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentRunOptions {
  maxIterations: number
  systemPrompt?: string
  userId?: string
  conversationId?: string
}

function detectStuckPattern(observations: string[], threshold: number = 3): boolean {
  if (observations.length < threshold) return false
  const recent = observations.slice(-threshold)
  return recent.every(obs =>
    isToolOutputFailure(obs) ||
    obs.includes('not found') ||
    obs.length < 20
  )
}

/** 工具输出是否为失败结果（含 playwright MCP 的 <error> 标签格式） */
export function isToolOutputFailure(output: string): boolean {
  return output.startsWith('Tool error:')
    || output.includes('Request timeout')
    || output.includes('Error:')
    || /<error[\s>]/i.test(output)
}

/** Normalize a tool input string for duplicate detection (trim, lowercase, strip JSON noise). */
function normalizeToolInput(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[{"}\s]/g, '')
    .slice(0, 200)
}

/** Whether a tool is a "search-type" tool that retrieves external info. */
export function isSearchTypeTool(toolName: string): boolean {
  return /^(search|parallel_search|knowledge_search|fetch|browser_)/i.test(toolName)
}

/** 把输入拆成关键词（用于近似重复检测：换序/换措辞但无新信息） */
function extractKeywords(input: string): string[] {
  return input.toLowerCase()
    .split(/[\s,，。;；、/\\|"'`\[\]{}()（）]+/)
    .filter(t => t.length >= 2)
}

export interface SearchState {
  searchCallCount: number         // 搜索类工具调用总次数
  knowledgeSearchCallCount: number // knowledge_search 单独计数(本地检索不该反复调)
  seenInputs: Map<string, number> // 记录重复输入
  seenKeywords: Set<string>       // 出现过的搜索关键词并集
  noNewKeywordStreak: number      // 连续未引入新关键词的搜索次数
}

export function createSearchState(): SearchState {
  return {
    searchCallCount: 0,
    knowledgeSearchCallCount: 0,
    seenInputs: new Map(),
    seenKeywords: new Set(),
    noNewKeywordStreak: 0,
  }
}

export const MAX_SEARCH_CALLS = 25  // 搜索类工具总调用上限
const MAX_KNOWLEDGE_SEARCH_CALLS = 5  // 本地知识库检索上限(本地检索不该反复调)
const MAX_NO_NEW_KEYWORD_CALLS = 3  // 连续无新关键词搜索上限(近似重复兜底)

/** 从 parallel_search 的 toolInput 解析批内查询条数;解析失败按 1 计 */
function parseParallelQueryCount(toolInput: string): number {
  try {
    const parsed = JSON.parse(toolInput) as { queries?: unknown }
    if (Array.isArray(parsed.queries)) return Math.max(1, parsed.queries.length)
  } catch { /* 非 JSON 输入 */ }
  return 1
}

/**
 * 简化版停止检测：只看总次数 + 完全相同输入重复。
 * 不过度干预模型的搜索策略，让模型自己判断何时该停。
 */
export function checkSearchEffectiveness(
  toolName: string,
  toolInput: string,
  _output: string,
  state: SearchState
): { shouldStop: boolean; reason: string | null } {
  if (!isSearchTypeTool(toolName)) {
    return { shouldStop: false, reason: null }
  }

  const isKnowledge = toolName === 'knowledge_search'
  if (isKnowledge) {
    state.knowledgeSearchCallCount++
  } else if (toolName === 'parallel_search') {
    // 按批内条数计数(含被额度截断未执行的:尝试了就计入,防反复试探绕过上限)
    state.searchCallCount += parseParallelQueryCount(toolInput)
  } else {
    state.searchCallCount++
  }

  // 完全相同的输入重复调用 -> 死循环，立即停止
  const inputKey = `${toolName}:${normalizeToolInput(toolInput)}`
  const inputCount = (state.seenInputs.get(inputKey) || 0) + 1
  state.seenInputs.set(inputKey, inputCount)
  if (inputCount >= 2) {
    return { shouldStop: true, reason: `重复调用 ${toolName}(${toolInput.slice(0, 50)})` }
  }

  // 近似重复：换措辞/换语序但没引入任何新关键词 -> 反复搜同一主题
  const keywords = extractKeywords(toolInput)
  if (keywords.some(k => !state.seenKeywords.has(k))) {
    state.noNewKeywordStreak = 0
    for (const k of keywords) state.seenKeywords.add(k)
  } else {
    state.noNewKeywordStreak++
    if (state.noNewKeywordStreak >= MAX_NO_NEW_KEYWORD_CALLS) {
      return { shouldStop: true, reason: `连续 ${state.noNewKeywordStreak} 次搜索未引入新关键词` }
    }
  }

  // 总次数兜底:knowledge_search 用更小上限
  const count = isKnowledge ? state.knowledgeSearchCallCount : state.searchCallCount
  const limit = isKnowledge ? MAX_KNOWLEDGE_SEARCH_CALLS : MAX_SEARCH_CALLS
  if (count > limit) {
    return { shouldStop: true, reason: `${toolName} 调用 ${count} 次超过上限 ${limit}` }
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

const pendingToolCalls = new Map<string, { name: string; args: string; startedAt: number }>()

/**
 * 循环停止/异常后基于已有 observations 让 LLM 综合回答（而非倾倒原始结果）。
 * 无有效结果或 LLM 失败时返回 null，调用方退回原始摘要。
 */
export async function synthesizeFromObservations(
  messages: ChatMessage[],
  observations: string[],
  stopReason: string | null
): Promise<string | null> {
  const usefulObs = observations.filter(o => o.length >= 20 && !isToolOutputFailure(o))
  if (usefulObs.length === 0) return null

  const summary = usefulObs.slice(-5)
    .map((o, i) => `--- 搜索结果 ${i + 1} ---\n${o.slice(0, 1500)}`)
    .join('\n\n')
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || ''

  const systemPrompt = [
    `用户问题：${lastUserMsg}`,
    '',
    `已为该问题执行了多轮搜索后停止（原因：${stopReason || '未能生成最终回答'}）。以下是收集到的搜索结果，可能不完整或重复：`,
    '',
    summary,
    '',
    '请基于以上信息直接回答用户问题：',
    '- 信息足够时给出明确回答，标注来源',
    '- 搜索结果显示事件尚未发生或结果尚未公布时，明确告知用户当前状态，并给出已知的背景信息',
    '- 信息不足时说明缺什么，不要编造',
    '用与用户相同的语言回复。',
  ].join('\n')

  try {
    const answer = await callLLM([{ role: 'user', content: lastUserMsg }], systemPrompt, MODEL_LIGHT, 2000)
    return answer.trim() || null
  } catch {
    return null
  }
}

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
  const runStart = Date.now()
  let stepCount = 0
  const logCtx = { conversationId: options.conversationId, userId: options.userId }

  const inputMessages = messages.map(m => {
    if (m.role === 'user') return new HumanMessage(m.content)
    if (m.role === 'assistant') return new AIMessage(m.content)
    return new SystemMessage(m.content)
  })

  try {
    const stream = await agent.stream(
      { messages: inputMessages },
      { recursionLimit: options.maxIterations * 2, configurable: { userId: options.userId, searchState } }
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
            pendingToolCalls.set(tc.id, { name: tc.name, args: argsStr, startedAt: Date.now() })
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
            stepCount++
            const success = !isToolOutputFailure(output)
            logToolCall({
              ...logCtx,
              step: stepCount,
              toolName,
              inputPreview: toolInput.slice(0, 100),
              outputLength: output.length,
              durationMs: callInfo ? Date.now() - callInfo.startedAt : 0,
              success,
            })
            yield { type: 'observation', content: output }
            observations.push(output)

            // 检测连续失败
            if (detectStuckPattern(observations)) {
              logStuckDetected({ ...logCtx, reason: '连续工具失败', observationCount: observations.length })
              yield { type: 'thought', content: '连续多次工具执行未获得有效结果，终止循环' }
              circularReason = '连续工具失败'
              break
            }

            // 搜索类工具停止检测：总次数上限 + 重复输入拦截
            const check = checkSearchEffectiveness(toolName, toolInput, output, searchState)
            if (check.shouldStop) {
              const isKnowledge = toolName === 'knowledge_search'
              logSearchLimitHit({
                ...logCtx,
                toolName,
                callCount: isKnowledge ? searchState.knowledgeSearchCallCount : searchState.searchCallCount,
                limit: isKnowledge ? MAX_KNOWLEDGE_SEARCH_CALLS : MAX_SEARCH_CALLS,
              })
              yield { type: 'thought', content: `${check.reason}，停止搜索，基于已有信息综合回答` }
              circularReason = check.reason
              break
            }
          }
        }
        if (circularReason) break
      }
    }

    // Fallback: tools were called but no answer produced - synthesize via LLM, dump raw results only if that fails
    if (!hasContent && observations.length > 0) {
      const answer = await synthesizeFromObservations(messages, observations, circularReason)
      if (answer) {
        hasContent = true
        yield { type: 'content', content: answer }
      } else {
        const usefulObs = observations.filter(o => o.length >= 20 && !isToolOutputFailure(o))
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
    }

    logAgentDone({ ...logCtx, totalSteps: stepCount, totalDurationMs: Date.now() - runStart, hasContent })
    yield { type: 'done' }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logAgentError({
      ...logCtx,
      message: errMsg,
      stack: err instanceof Error ? err.stack : undefined,
    })
    yield { type: 'thought', content: `Agent error: ${errMsg}` }

    // If we have observations but no answer, synthesize via LLM, fall back to raw dump
    if (!hasContent && observations.length > 0) {
      const answer = await synthesizeFromObservations(messages, observations, null)
      if (answer) {
        yield { type: 'content', content: answer }
      } else {
        const lastObs = observations[observations.length - 1]
        yield { type: 'content', content: `工具执行已完成，但未能生成最终回答。最后一次工具结果：\n${lastObs.slice(0, 2000)}` }
      }
    } else if (!hasContent) {
      yield { type: 'content', content: 'Agent 执行出错，未能生成回答。' }
    }

    yield { type: 'done' }
  }
}

