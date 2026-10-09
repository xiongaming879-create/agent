import { describe, it, expect, vi, beforeEach } from 'vitest'

// LLM 兜底测试单独 mock；纯规则测试不 mock
vi.mock('../../../../server/src/services/llm-caller', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '../../../../server/src/services/llm-caller'
import { shouldUsePneByRules, shouldUsePne } from '../../../../server/src/services/pne/gate'

const callLLMMock = vi.mocked(callLLM)

describe('shouldUsePneByRules', () => {
  it('complexity=deep 直接命中', () => {
    expect(shouldUsePneByRules('你好', 'deep')).toBe(true)
  })

  it('query 长度 > 120 命中', () => {
    expect(shouldUsePneByRules('长'.repeat(121), 'medium')).toBe(true)
    expect(shouldUsePneByRules('长'.repeat(120), 'medium')).toBe(false)
  })

  it('信号词命中', () => {
    for (const word of ['对比', '分析', '方案', '规划', '步骤', '制定', '策划', '评估']) {
      expect(shouldUsePneByRules(`帮我${word}一下`, 'medium')).toBe(true)
    }
  })

  it('普通短问题不命中', () => {
    expect(shouldUsePneByRules('今天天气怎么样', 'medium')).toBe(false)
  })
})

describe('shouldUsePne', () => {
  beforeEach(() => {
    callLLMMock.mockReset()
  })

  it('规则命中时不调 LLM', async () => {
    const result = await shouldUsePne('做个对比分析', 'medium')
    expect(result).toBe(true)
    expect(callLLMMock).not.toHaveBeenCalled()
  })

  it('规则未命中时走 LLM 兜底: yes -> true', async () => {
    callLLMMock.mockResolvedValue('yes')
    expect(await shouldUsePne('量子计算的发展历程', 'medium')).toBe(true)
  })

  it('规则未命中时走 LLM 兜底: no -> false', async () => {
    callLLMMock.mockResolvedValue('no')
    expect(await shouldUsePne('量子计算的发展历程', 'medium')).toBe(false)
  })

  it('LLM 失败 -> false（走 ReAct，不冒险）', async () => {
    callLLMMock.mockRejectedValue(new Error('api error'))
    expect(await shouldUsePne('量子计算的发展历程', 'medium')).toBe(false)
  })
})