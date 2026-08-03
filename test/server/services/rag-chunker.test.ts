import { describe, it, expect } from 'vitest'
import { chunkByType, recursiveChunk, splitOverflow } from '../../../server/src/services/rag-chunker'
import { estimateTokens } from '../../../server/src/services/embedding-client'

describe('rag-chunker', () => {
  describe('chunkByType', () => {
    it('短文本返回单 chunk', () => {
      const text = '这是一段短文本。'
      const result = chunkByType(text, 'markdown')
      expect(result).toHaveLength(1)
      expect(result[0]).toBe(text)
    })

    it('长文本按语义边界切分(多 chunk)', () => {
      const para1 = '## 标题一\n' + '内容一内容。'.repeat(200)
      const para2 = '## 标题二\n' + '内容二内容。'.repeat(200)
      const text = para1 + '\n\n' + para2
      const result = chunkByType(text, 'markdown')
      expect(result.length).toBeGreaterThan(1)
      for (const chunk of result) {
        expect(estimateTokens(chunk)).toBeLessThanOrEqual(750)
      }
    })

    it('code 类型用更小 chunkSize,切出更多块', () => {
      const text = 'function foo() {\n  return 1;\n}\n'.repeat(100)
      const markdownResult = chunkByType(text, 'markdown')
      const codeResult = chunkByType(text, 'code')
      expect(codeResult.length).toBeGreaterThanOrEqual(markdownResult.length)
    })

    it('contract 类型用最小 chunkSize', () => {
      const text = '甲方应当履行合同义务。'.repeat(100)
      const result = chunkByType(text, 'contract')
      expect(result.length).toBeGreaterThanOrEqual(2)
    })

    it('未知 docType 用默认 profile', () => {
      const result = chunkByType('测试文本。', 'unknown')
      expect(result).toHaveLength(1)
    })

    it('空字符串返回空数组', () => {
      expect(chunkByType('', 'markdown')).toEqual([])
    })
  })

  describe('recursiveChunk', () => {
    it('短文本不切分', () => {
      const result = recursiveChunk('短文本', 650, 80, ['\n\n', '\n', '。', ' '])
      expect(result).toEqual(['短文本'])
    })

    it('按段落边界切分(优先 \\n\\n)', () => {
      const para1 = 'A'.repeat(500)
      const para2 = 'B'.repeat(500)
      const text = para1 + '\n\n' + para2
      const result = recursiveChunk(text, 400, 0, ['\n\n', '\n', ' '])
      expect(result.length).toBeGreaterThanOrEqual(2)
      // 第一块不应包含第二段的 B
      expect(result[0]).not.toContain('B')
    })

    it('overlap 相邻块有重叠内容', () => {
      const para1 = 'A'.repeat(500)
      const para2 = 'B'.repeat(500)
      const text = para1 + '\n\n' + para2
      const result = recursiveChunk(text, 400, 100, ['\n\n', '\n', ' '])
      expect(result.length).toBeGreaterThanOrEqual(2)
      // 第二块开头应包含第一块尾部的重叠部分
      const tailOfFirst = result[0].slice(-150)
      expect(result[1].startsWith(tailOfFirst)).toBe(true)
    })

    it('overlap=0 时相邻块无重叠', () => {
      const para1 = 'A'.repeat(500)
      const para2 = 'B'.repeat(500)
      const text = para1 + '\n\n' + para2
      const result = recursiveChunk(text, 400, 0, ['\n\n', '\n', ' '])
      expect(result.length).toBeGreaterThanOrEqual(2)
      // 第二块不应以 A 开头(无重叠)
      expect(result[1].startsWith('A')).toBe(false)
    })

    it('按句号切分(无段落边界时)', () => {
      const text = '这是第一句话。这是第二句话。这是第三句话。'.repeat(50)
      const result = recursiveChunk(text, 200, 0, ['。', ' '])
      expect(result.length).toBeGreaterThan(1)
    })

    it('空文本返回空数组', () => {
      expect(recursiveChunk('', 650, 80, ['\n'])).toEqual([])
    })
  })

  describe('splitOverflow', () => {
    it('短文本不拆分', () => {
      const text = '短文本'
      expect(splitOverflow(text, 8000)).toEqual([text])
    })

    it('超长文本拆分为多个 <= maxTokens 的 chunk', () => {
      const text = '这是一段测试文本。'.repeat(2000) // ≈ 18000 字符 ≈ 12000 token
      const result = splitOverflow(text, 8000)
      expect(result.length).toBeGreaterThan(1)
      for (const chunk of result) {
        expect(estimateTokens(chunk)).toBeLessThanOrEqual(8000)
      }
    })

    it('maxTokens 较小时也能拆分', () => {
      const text = 'A'.repeat(3000) // 2000 token
      const result = splitOverflow(text, 500)
      expect(result.length).toBeGreaterThan(1)
      for (const chunk of result) {
        expect(estimateTokens(chunk)).toBeLessThanOrEqual(500)
      }
    })

    it('空文本返回空数组', () => {
      expect(splitOverflow('', 8000)).toEqual([])
    })
  })
})
