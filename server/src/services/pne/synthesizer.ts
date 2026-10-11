// server/src/services/pne/synthesizer.ts
import type { AgentEvent } from '../../types'
import { streamLLM } from '../llm-caller'
import { MODEL_STRONG } from '../llm-config'
import { loadPrompt, renderPrompt } from '../prompt-loader'
import { formatStageResults, type StageResult, type PneChatMessage } from './types'

/** Synthesizer：基于阶段结果流式生成最终回答（content_delta + done） */
export async function* synthesizeAnswer(
  query: string,
  stageResults: StageResult[],
  history: PneChatMessage[],
  systemPrompt?: string
): AsyncGenerator<AgentEvent> {
  const system = renderPrompt(loadPrompt('pne/synthesizer'), {
    query,
    stageResults: formatStageResults(stageResults),
    systemPrompt: systemPrompt ? `\n- 遵守用户系统提示：${systemPrompt}` : '',
  })

  const recent = history.slice(-4).map(m => ({ role: m.role, content: m.content }))
  yield* streamLLM(
    [...recent, { role: 'user' as const, content: `请基于以上阶段结果回答：${query}` }],
    system,
    MODEL_STRONG
  )
}