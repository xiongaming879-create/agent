import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AIMessage } from '@langchain/core/messages'

// mock ChatOpenAI：createChatOpenAI 返回 { bindTools: () => fakeLlm }，fakeLlm.invoke 按 invoker 脚本返回
const invokeScript: AIMessage[] = []
vi.mock('../../../../server/src/services/llm-config', () => ({
  MODEL_STRONG: 'test-strong',
  createChatOpenAI: () => ({
    bindTools: () => ({
      invoke: vi.fn(async () => {
        const next = invokeScript.shift()
        if (!next) throw new Error('invokeScript exhausted')
        return next
      }),
    }),
    invoke: vi.fn(async () => {
      const next = invokeScript.shift()
      if (!next) throw new Error('invokeScript exhausted')
      return next
    }),
  }),
}))

vi.mock('../../../../server/src/services/logger', () => ({
  logToolCall: vi.fn(),
}))

import { executeStage, type ExecutorDeps } from '../../../../server/src/services/pne/executor'
import type { Stage } from '../../../../server/src/services/pne/types'
import type { ToolCall } from '@langchain/core/messages/tool'

function aiMessage(opts: { content?: string; toolCalls?: ToolCall[] }): AIMessage {
  return {
    content: opts.content ?? '',
    tool_calls: opts.toolCalls ?? [],
  } as unknown as AIMessage
}

const stage: Stage = { index: 1, goal: '查天气', strategy: 'tool', toolHint: 'search', dependsOn: [] }

function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    tools: [
      {
        name: 'search',
        description: '搜索',
        invoke: vi.fn(async () => '北京今天晴，31°C'),
      },
      {
        name: 'calculator',
        description: '计算',
        invoke: vi.fn(async () => '2'),
      },
    ] as unknown as ExecutorDeps['tools'],
    stageResults: [],
    query: '北京天气怎么样',
    ...overrides,
  }
}

describe('executeStage', () => {
  beforeEach(() => {
    invokeScript.length = 0
  })

  it('首轮无 tool_calls -> 直接返回结论文本，不发 action/observation', async () => {
    invokeScript.push(aiMessage({ content: '北京今天晴，31°C' }))
    const { events, outcome } = await executeStage(stage, makeDeps())
    expect(outcome).toBe('北京今天晴，31°C')
    expect(events.filter(e => e.type === 'action')).toHaveLength(0)
    // reasoning 内容作为 thought 事件
    expect(events.some(e => e.type === 'thought' && e.content.includes('晴'))).toBe(true)
  })

  it('有 tool_calls -> 发 action + observation，工具结果回注后下一轮收口', async () => {
    invokeScript.push(
      aiMessage({ content: '我来查天气', toolCalls: [{ id: 'c1', name: 'search', args: { input: '北京天气' }, type: 'tool_call' }] }),
      aiMessage({ content: '北京今天晴，31°C' })
    )
    const { events, outcome } = await executeStage(stage, makeDeps())
    const action = events.find(e => e.type === 'action')
    const observation = events.find(e => e.type === 'observation')
    expect(action).toMatchObject({ tool_name: 'search', call_id: 'c1' })
    expect(observation).toMatchObject({ tool_name: 'search', success: true })
    expect((observation as { content: string }).content).toContain('31°C')
    expect(outcome).toBe('北京今天晴，31°C')
  })

  it(`3 轮上限 -> 追加总结调用，outcome 为小结`, async () => {
    const toolCall: ToolCall = { id: 'c1', name: 'search', args: { input: 'q' }, type: 'tool_call' }
    invokeScript.push(
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ content: '综合结论：天气晴' })
    )
    const { events, outcome } = await executeStage(stage, makeDeps())
    expect(outcome).toContain('综合结论')
    // 3 轮各发了一对 action/observation
    expect(events.filter(e => e.type === 'action')).toHaveLength(3)
    expect(events.filter(e => e.type === 'observation')).toHaveLength(3)
  })

  it('工具执行抛错 -> observation 记 Tool error 且 success=false，连续 3 次失败提前小结', async () => {
    const deps = makeDeps()
    const searchTool = deps.tools.find(t => t.name === 'search')!
    ;(searchTool.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'))

    const toolCall: ToolCall = { id: 'c1', name: 'search', args: { input: 'q' }, type: 'tool_call' }
    invokeScript.push(
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ toolCalls: [toolCall] }),
      aiMessage({ content: '全部失败' })
    )
    const { events, outcome } = await executeStage(stage, deps)
    const obs = events.find(e => e.type === 'observation') as { success: boolean; content: string }
    expect(obs.success).toBe(false)
    expect(obs.content).toContain('Tool error')
    expect(outcome).toContain('全部失败')
  })

  it('未知工具名 -> observation 报 Tool error，不炸整个阶段', async () => {
    invokeScript.push(
      aiMessage({ toolCalls: [{ id: 'c2', name: 'no_such_tool', args: {}, type: 'tool_call' }] }),
      aiMessage({ content: '换了个思路的结论' })
    )
    const { events, outcome } = await executeStage(stage, makeDeps())
    const obs = events.find(e => e.type === 'observation') as { success: boolean; content: string }
    expect(obs.success).toBe(false)
    expect(obs.content).toContain('未知工具')
    expect(outcome).toBe('换了个思路的结论')
  })

  it('observation 截断到 4000 字符', async () => {
    const deps = makeDeps()
    const searchTool = deps.tools.find(t => t.name === 'search')!
    ;(searchTool.invoke as ReturnType<typeof vi.fn>).mockResolvedValue('x'.repeat(5000))
    invokeScript.push(
      aiMessage({ toolCalls: [{ id: 'c3', name: 'search', args: {}, type: 'tool_call' }] }),
      aiMessage({ content: 'done' })
    )
    const { events } = await executeStage(stage, deps)
    const obs = events.find(e => e.type === 'observation') as { content: string }
    expect(obs.content.length).toBeLessThanOrEqual(4000)
  })
})