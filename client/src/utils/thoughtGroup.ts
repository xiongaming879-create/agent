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
}

export interface ThoughtNote {
  kind: 'note'
  content: string
}

export type ThoughtItem = ThoughtRound | ThoughtNote

/**
 * 扁平 thought_steps → 时间线条目。
 * action 开头成轮,FIFO 队列匹配 observation(并行 tool_calls 顺序一致)。
 * 独立 thought 成笔记,随后的 action 吸收前一条笔记为轮内思考。
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
      }
      const last = items[items.length - 1]
      if (last?.kind === 'note') {
        round.thought = last.content
        items.pop()
      }
      items.push(round)
      openRounds.push(round)
    } else if (step.type === 'observation') {
      const round = openRounds.shift()
      if (round) {
        round.output = step.content
        round.durationMs = step.duration_ms ?? null
        round.success = step.success ?? null
        round.streaming = false
      } else {
        items.push({ kind: 'note', content: step.content })
      }
    }
  }

  return items
}
