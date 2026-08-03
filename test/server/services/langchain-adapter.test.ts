import { describe, it, expect } from 'vitest'
import {
  isSearchTypeTool,
  checkSearchEffectiveness,
  createSearchState,
} from '../../../server/src/services/langchain-adapter'

describe('langchain-adapter', () => {
  describe('isSearchTypeTool', () => {
    it('匹配 knowledge_search', () => {
      expect(isSearchTypeTool('knowledge_search')).toBe(true)
    })
    it('匹配 search', () => {
      expect(isSearchTypeTool('search')).toBe(true)
    })
    it('匹配 fetch', () => {
      expect(isSearchTypeTool('fetch')).toBe(true)
    })
    it('匹配 browser_navigate', () => {
      expect(isSearchTypeTool('browser_navigate')).toBe(true)
    })
    it('不匹配 calculator', () => {
      expect(isSearchTypeTool('calculator')).toBe(false)
    })
    it('不匹配 filesystem_read', () => {
      expect(isSearchTypeTool('filesystem_read')).toBe(false)
    })
  })

  describe('checkSearchEffectiveness', () => {
    it('非搜索类工具不停止', () => {
      const state = createSearchState()
      const result = checkSearchEffectiveness('calculator', '1+1', '2', state)
      expect(result.shouldStop).toBe(false)
      expect(state.searchCallCount).toBe(0)
      expect(state.knowledgeSearchCallCount).toBe(0)
    })

    it('knowledge_search 重复输入停止', () => {
      const state = createSearchState()
      checkSearchEffectiveness('knowledge_search', '违约金', 'result', state)
      const result = checkSearchEffectiveness('knowledge_search', '违约金', 'result', state)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('重复调用')
    })

    it('knowledge_search 超过 5 次停止', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        const result = checkSearchEffectiveness('knowledge_search', `query${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      const result = checkSearchEffectiveness('knowledge_search', 'query6', 'result', state)
      expect(result.shouldStop).toBe(true)
      expect(result.reason).toContain('超过上限')
      expect(result.reason).toContain('5')
    })

    it('search 超过 25 次停止(不受 knowledge_search 上限影响)', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        checkSearchEffectiveness('knowledge_search', `kq${i}`, 'result', state)
      }
      for (let i = 0; i < 25; i++) {
        const result = checkSearchEffectiveness('search', `q${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      const result = checkSearchEffectiveness('search', 'q26', 'result', state)
      expect(result.shouldStop).toBe(true)
    })

    it('knowledge_search 和 search 计数独立', () => {
      const state = createSearchState()
      for (let i = 0; i < 5; i++) {
        checkSearchEffectiveness('search', `q${i}`, 'result', state)
      }
      for (let i = 0; i < 5; i++) {
        const result = checkSearchEffectiveness('knowledge_search', `kq${i}`, 'result', state)
        expect(result.shouldStop).toBe(false)
      }
      expect(state.searchCallCount).toBe(5)
      expect(state.knowledgeSearchCallCount).toBe(5)
    })
  })
})
