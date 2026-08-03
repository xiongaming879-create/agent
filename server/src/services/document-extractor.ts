/**
 * 文档文本提取:支持 MD/TXT(直接读) + PDF(pdf-parse v2,纯 JS 无 native)。
 * 按文件扩展名判断类型,不支持的类型抛错。
 * PDF 解析器可注入(setPdfParser),便于测试。
 */
import path from 'path'

type PdfParser = (buf: Buffer) => Promise<string>

let pdfParser: PdfParser | undefined

/** 测试注入:覆盖默认的 pdf-parse 加载 */
export function setPdfParser(fn: PdfParser | undefined): void {
  pdfParser = fn
}

/** pdf-parse v2 API: new PDFParse(Uint8Array) -> load() -> getText().text */
async function defaultPdfParse(buffer: Buffer): Promise<string> {
  const mod = await import('pdf-parse') as unknown as {
    PDFParse: new (buf: Uint8Array) => {
      load: () => Promise<void>
      getText: () => Promise<{ text: string }>
    }
  }
  const parser = new mod.PDFParse(new Uint8Array(buffer))
  await parser.load()
  const result = await parser.getText()
  return result.text
}

export async function extractText(buffer: Buffer, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf-8')
  }
  if (ext === '.pdf') {
    const fn = pdfParser ?? defaultPdfParse
    return fn(buffer)
  }
  throw new Error(`Unsupported file type: ${ext}, only .txt/.md/.pdf are supported`)
}

export function getDocType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.pdf') return 'pdf'
  return 'markdown'
}
