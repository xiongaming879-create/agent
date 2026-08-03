/**
 * 文档上传/列表/删除路由。
 * multer 内存存储(不落盘),10MB 限制,authMiddleware 保护。
 */
import { Router } from 'express'
import multer from 'multer'
import { authMiddleware } from '../middleware/auth'
import { extractText, getDocType } from '../services/document-extractor'
import { indexDocument } from '../services/rag-indexer'
import { getEsClient } from '../services/es-client'

const router = Router()
const RAG_INDEX = process.env.RAG_INDEX || 'rag_index'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

router.use(authMiddleware)

interface DocBucket {
  key: string
  file_name?: { buckets: Array<{ key: string }> }
  doc_type?: { buckets: Array<{ key: string }> }
  uploaded_at?: { value_as_string?: string }
  chunk_count?: { value: number }
}

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }
  try {
    // multer originalname 默认 Latin1 编码,中文文件名需转 utf-8
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf-8')
    const text = await extractText(req.file.buffer, fileName)
    if (!text.trim()) {
      res.status(400).json({ error: 'File content is empty' })
      return
    }
    const docId = `${req.user!.userId}:${fileName}:${Date.now()}`
    const docType = getDocType(fileName)
    const result = await indexDocument({
      text,
      userId: req.user!.userId,
      sourceType: 'doc_chunk',
      sourceId: docId,
      meta: {
        docId,
        fileName,
        docType,
        uploadedAt: new Date().toISOString(),
        tags: [],
      },
    })
    res.json({
      docId,
      fileName,
      docType,
      indexed: result.indexed,
    })
  } catch (err) {
    console.error('[Document] Upload failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' })
  }
})

router.get('/', async (req, res) => {
  try {
    const client = getEsClient()
    const resp = await client.search({
      index: RAG_INDEX,
      size: 0,
      query: {
        bool: {
          filter: [
            { term: { user_id: req.user!.userId } },
            { term: { source_type: 'doc_chunk' } },
          ],
        },
      },
      aggs: {
        docs: {
          terms: { field: 'doc_id', size: 100 },
          aggs: {
            file_name: { terms: { field: 'file_name', size: 1 } },
            doc_type: { terms: { field: 'doc_type', size: 1 } },
            uploaded_at: { max: { field: 'uploaded_at' } },
            chunk_count: { value_count: { field: 'chunk_hash' } },
          },
        },
      },
    })
    const buckets = (resp as { aggregations?: { docs?: { buckets: DocBucket[] } } })
      .aggregations?.docs?.buckets ?? []
    const docs = buckets.map(b => ({
      docId: b.key,
      fileName: b.file_name?.buckets[0]?.key ?? '',
      docType: b.doc_type?.buckets[0]?.key ?? '',
      uploadedAt: b.uploaded_at?.value_as_string ?? '',
      chunkCount: b.chunk_count?.value ?? 0,
    }))
    res.json(docs)
  } catch (err) {
    console.error('[Document] List failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'List failed' })
  }
})

router.delete('/:docId', async (req, res) => {
  try {
    const client = getEsClient()
    await client.deleteByQuery({
      index: RAG_INDEX,
      conflicts: 'proceed',
      query: {
        bool: {
          filter: [
            { term: { doc_id: req.params.docId } },
            { term: { user_id: req.user!.userId } },
          ],
        },
      },
    })
    res.json({ deleted: true, docId: req.params.docId })
  } catch (err) {
    console.error('[Document] Delete failed:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' })
  }
})

export default router
