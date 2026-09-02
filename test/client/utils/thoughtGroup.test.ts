import { describe, it, expect } from 'vitest'
import { groupThoughtSteps } from '../../../client/src/utils/thoughtGroup'
import type { ThoughtStep } from '../../../client/src/types'

function thought(content: string): ThoughtStep {
  return { type: 'thought', content, tool_name: null, timestamp: 't' }
}
function action(tool: string, input: string): ThoughtStep {
  return { type: 'action', content: input, tool_name: tool, timestamp: 't' }
}
function observation(content: string, extra: Partial<ThoughtStep> = {}): ThoughtStep {
  return { type: 'observation', content, tool_name: null, timestamp: 't', ...extra }
}

describe('groupThoughtSteps', () => {
  it('thought+action+observation 归并为单轮,思考被吸收', () => {
    const items = groupThoughtSteps([
      thought('用户问量子计算'),
      action('search', '量子计算 2026'),
      observation('找到相关页面', { duration_ms: 1200, success: true }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'round', index: 1, toolName: 'search',
      thought: '用户问量子计算',
      input: '量子计算 2026',
      output: '找到相关页面',
      durationMs: 1200, success: true, streaming: false,
    })
  })

  it('独立思考(无工具)成笔记', () => {
    const items = groupThoughtSteps([thought('已获取足够信息,停止搜索')])
    expect(items).toHaveLength(1)
    expect(items[0]).toEqual({ kind: 'note', content: '已获取足够信息,停止搜索' })
  })

  it('并行 tool_calls 按 FIFO 匹配 observation', () => {
    const items = groupThoughtSteps([
      action('search', 'a'),
      action('calculator', '1+1'),
      observation('A 结果'),
      observation('2'),
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'round', toolName: 'search', output: 'A 结果' })
    expect(items[1]).toMatchObject({ kind: 'round', toolName: 'calculator', output: '2' })
  })

  it('action 未到 observation 时为流式轮次', () => {
    const items = groupThoughtSteps([action('search', 'a')])
    expect(items[0]).toMatchObject({ kind: 'round', streaming: true, output: null, success: null })
  })

  it('无主 observation 降级为笔记', () => {
    const items = groupThoughtSteps([observation('孤儿结果')])
    expect(items[0]).toEqual({ kind: 'note', content: '孤儿结果' })
  })

  it('多个轮次各自编号,轮间独立思考不被误吸', () => {
    const items = groupThoughtSteps([
      thought('t1'),
      action('search', 'q1'),
      observation('r1'),
      thought('总结'),
      action('knowledge_search', 'q2'),
      observation('r2'),
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'round', index: 1, thought: 't1', toolName: 'search' })
    expect(items[1]).toMatchObject({ kind: 'round', index: 2, thought: '总结', toolName: 'knowledge_search' })
  })
})
