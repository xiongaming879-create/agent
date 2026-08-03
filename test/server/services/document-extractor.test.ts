import { describe, it, expect, afterEach } from 'vitest'
import { extractText, getDocType, setPdfParser } from '../../../server/src/services/document-extractor'

describe('document-extractor', () => {
  afterEach(() => setPdfParser(undefined))

  describe('extractText', () => {
    it('TXT 文件:返回 utf-8 文本', async () => {
      const buffer = Buffer.from('hello world', 'utf-8')
      const text = await extractText(buffer, 'test.txt')
      expect(text).toBe('hello world')
    })

    it('MD 文件:返回 utf-8 文本', async () => {
      const buffer = Buffer.from('# Title\n\ncontent', 'utf-8')
      const text = await extractText(buffer, 'test.md')
      expect(text).toContain('# Title')
    })

    it('PDF 文件:调 pdf-parse 提取文本', async () => {
      setPdfParser(async () => 'PDF extracted content')
      const buffer = Buffer.from('fake pdf', 'utf-8')
      const text = await extractText(buffer, 'test.pdf')
      expect(text).toBe('PDF extracted content')
    })

    it('不支持的扩展名:抛错', async () => {
      const buffer = Buffer.from('data', 'utf-8')
      await expect(extractText(buffer, 'test.docx')).rejects.toThrow('Unsupported file type')
    })

    it('大写扩展名也能识别', async () => {
      const buffer = Buffer.from('HELLO', 'utf-8')
      const text = await extractText(buffer, 'TEST.TXT')
      expect(text).toBe('HELLO')
    })
  })

  describe('getDocType', () => {
    it('PDF -> pdf', () => {
      expect(getDocType('contract.pdf')).toBe('pdf')
    })
    it('MD -> markdown', () => {
      expect(getDocType('notes.md')).toBe('markdown')
    })
    it('TXT -> markdown', () => {
      expect(getDocType('readme.txt')).toBe('markdown')
    })
  })
})
