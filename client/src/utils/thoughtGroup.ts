import type { ThoughtStep } from '../types'

export interface ThoughtRound {
  kind: 'round'
  index: number
  toolName: string
  input: string
  output: string | null
  durationMs: number | null
  success: boolean | null // null = 流式中/旧数据无标记
  thought: string | null
  streaming: boolean // action 已到,observation 未到
  callId: string | null
}

export interface ThoughtNote {
  kind: 'note'
  content: string
}

export type ThoughtItem = ThoughtRound | ThoughtNote

/**
 * 扁平 thought_steps → 时间线条目。
 * 优先按 call_id 显式配对 action/observation(并行工具调用也安全);
 * 无 call_id 的旧数据退回 FIFO 队列匹配。
 * 独立 thought 成笔记,随后的 action 吸收前一条笔记为轮内思考。
 * 孤儿 observation(配不到任何 action)若有 tool_name 仍按轮次渲染,否则作笔记。
 */
export function groupThoughtSteps(steps: ThoughtStep[]): ThoughtItem[] {
  const items: ThoughtItem[] = []
  const openRounds: ThoughtRound[] = []
  let roundCounter = 0

  for (const step of steps) {
    if (step.type === 'thought') {
      items.push({ kind: 'note', content: step.content })
    } else if (step.type === 'action') {
      roundCounter++
      const round: ThoughtRound = {
        kind: 'round',
        index: roundCounter,
        toolName: step.tool_name || 'unknown',
        input: step.content,
        output: null,
        durationMs: null,
        success: null,
        thought: null,
        streaming: true,
        callId: step.call_id ?? null,
      }
      const last = items[items.length - 1]
      if (last?.kind === 'note') {
        round.thought = last.content
        items.pop()
      }
      items.push(round)
      openRounds.push(round)
    } else if (step.type === 'observation') {
      let round: ThoughtRound | undefined
      if (step.call_id) {
        const idx = openRounds.findIndex(r => r.callId === step.call_id)
        if (idx >= 0) round = openRounds.splice(idx, 1)[0]
      } else {
        round = openRounds.shift()
      }
      if (round) {
        round.output = step.content
        round.durationMs = step.duration_ms ?? null
        round.success = step.success ?? null
        round.streaming = false
      } else if (step.tool_name) {
        roundCounter++
        items.push({
          kind: 'round', index: roundCounter, toolName: step.tool_name,
          input: '', output: step.content, durationMs: step.duration_ms ?? null,
          success: step.success ?? null, thought: null, streaming: false,
          callId: step.call_id ?? null,
        })
      } else {
        items.push({ kind: 'note', content: step.content })
      }
    }
  }

  return items
}
