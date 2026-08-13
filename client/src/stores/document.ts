import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authFetch } from '../utils/fetch'

interface DocItem {
  docId: string
  fileName: string
  docType: string
  uploadedAt: string
  chunkCount: number
}

const API = '/api/documents'

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocItem[]>([])
  const uploading = ref(false)
  const error = ref('')
  const success = ref(false)
  const lastUploadedName = ref('')

  async function fetchAll() {
    const res = await authFetch(API)
    if (res.ok) {
      documents.value = await res.json()
    }
  }

  async function upload(file: File) {
    uploading.value = true
    error.value = ''
    success.value = false
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await authFetch(API, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '上传失败' }))
        throw new Error(data.error || '上传失败')
      }
      await fetchAll()
      lastUploadedName.value = file.name
      success.value = true
      setTimeout(() => { success.value = false }, 3000)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '上传失败'
    } finally {
      uploading.value = false
    }
  }

  async function remove(docId: string) {
    error.value = ''
    try {
      const res = await authFetch(`${API}/${encodeURIComponent(docId)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: '删除失败' }))
        throw new Error(data.error || '删除失败')
      }
      documents.value = documents.value.filter(d => d.docId !== docId)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '删除失败'
    }
  }

  return { documents, uploading, error, success, lastUploadedName, fetchAll, upload, remove }
})
