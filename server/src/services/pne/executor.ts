import type { AgentEvent } from '../../types'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { AIMessage, SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { ToolCall } from '@langchain/core/messages/tool'
import { createChatOpenAI, MODEL_STRONG } from '../llm-config'
import { loadPrompt, renderPrompt } from '../prompt-loader'
import { buildDateContext, buildKnowledgeContext } from '../knowledge'
import { logToolCall } from '../logger'
import { formatStageResults, type Stage, type StageResult } from './types'

const MAX_TOOL_ROUNDS = 3
const MAX_CONSECUTIVE_FAILURES = 3
const OBSERVATION_TRUNCATE = 4000

export interface ExecutorDeps {
  tools: DynamicStructuredTool<Record<string, unknown>>[]
  stageResults: StageResult[]
  query: string
  userId?: string
  conversationId?: string
}

function isToolFailure(output: string): boolean {
  return output.startsWith('Tool error:')
}

/**
 * Executor：单阶段 mini 循环（不经过 langchain-adapter，无 pendingToolCalls 串扰）。
 * LLM 发 tool_calls 就执行工具并回注，最多 MAX_TOOL_ROUNDS 轮；
 * 不发 tool_calls 即阶段完成。轮次耗尽/连续失败时追加一次总结调用。
 */
export async function executeStage(
  stage: Stage,
  deps: ExecutorDeps
): Promise<{ events: AgentEvent[]; outcome: string }> {
  const events: AgentEvent[] = []
  const toolMap = new Map(deps.tools.map(t => [t.name, t]))
  const toolList = deps.tools.map(t => `- ${t.name} - ${t.description}`).join('\n')

  const system = renderPrompt(loadPrompt('pne/executor'), {
    stageGoal: stage.goal,
    strategy: stage.strategy,
    toolHint: stage.toolHint ?? '无',
    toolArgs: stage.toolArgs ?? '无',
    toolList: toolList || '（无可用工具）',
    stageResults: formatStageResults(deps.stageResults),
    dateContext: buildDateContext(),
    knowledgeContext: buildKnowledgeContext(),
    query: deps.query,
    highRiskRules: loadPrompt('shared/high-risk-rules'),
  })

  const llm = createChatOpenAI(MODEL_STRONG).bindTools(deps.tools)
  const history: BaseMessage[] = [new SystemMessage(system), new HumanMessage(`请完成阶段目标：${stage.goal}`)]
  let consecutiveFailures = 0
  let logStep = 0

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const resp = await llm.invoke(history)
    const reasoning = typeof resp.content === 'string' ? resp.content : ''
    if (reasoning.trim()) {
      events.push({ type: 'thought', content: reasoning.trim() })
    }

    if (!resp.tool_calls?.length) {
      return { events, outcome: reasoning.trim() || '阶段完成' }
    }

    history.push(resp)
    for (const tc of resp.tool_calls as ToolCall[]) {
      const tool = toolMap.get(tc.name)
      const argsStr = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
      events.push({ type: 'action', tool_name: tc.name, content: argsStr, call_id: tc.id })

      let output: string
      const start = Date.now()
      if (!tool) {
        output = `Tool error: 未知工具 ${tc.name}`
      } else {
        try {
          const result = await tool.invoke(tc.args as Record<string, unknown>)
          output = typeof result === 'string' ? result : JSON.stringify(result)
        } catch (err) {
          output = `Tool error: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      const success = !isToolFailure(output)
      const durationMs = Date.now() - start
      const truncated = output.slice(0, OBSERVATION_TRUNCATE)

      logStep++
      logToolCall({
        conversationId: deps.conversationId,
        userId: deps.userId,
        step: logStep,
        toolName: tc.name,
        inputPreview: argsStr.slice(0, 100),
        outputLength: output.length,
        durationMs,
        success,
      })
      events.push({
        type: 'observation', tool_name: tc.name, content: truncated,
        call_id: tc.id, duration_ms: durationMs, success,
      })
      history.push(new ToolMessage({ content: truncated, tool_call_id: tc.id ?? '' }))
      consecutiveFailures = success ? 0 : consecutiveFailures + 1
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break
  }

  // 轮次上限 / 连续失败：基于已有观察小结一次
  const summaryLlm = createChatOpenAI(MODEL_STRONG)
  const summary = await summaryLlm.invoke([
    ...history,
    new HumanMessage('已达到工具调用轮次上限，请基于以上观察输出本阶段结论（具体的事实与数据，不要复述过程）。'),
  ])
  const summaryText = typeof summary.content === 'string' ? summary.content.trim() : ''
  return { events, outcome: summaryText || '未能获得有效结论' }
}