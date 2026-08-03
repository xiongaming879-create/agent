<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useDocumentStore } from '../stores/document'

defineEmits<{ close: [] }>()

const store = useDocumentStore()
const fileInput = ref<HTMLInputElement | null>(null)

onMounted(() => store.fetchAll())

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files?.length) {
    store.upload(target.files[0])
  }
  if (fileInput.value) fileInput.value.value = ''
}

async function handleDelete(docId: string) {
  await store.remove(docId)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <h3 class="text-[14px] font-medium text-white">文档管理</h3>
      <button
        class="text-white/30 hover:text-white/60 text-[18px] leading-none transition-colors"
        @click="$emit('close')"
      >×</button>
    </div>

    <div class="px-4 py-3">
      <input
        ref="fileInput"
        type="file"
        accept=".txt,.md,.pdf"
        class="hidden"
        @change="handleFileSelect"
      />
      <button
        class="w-full px-3 py-2 bg-white/5 hover:bg-white/10 ring-1 ring-white/10 text-[13px] text-white/70 rounded-lg transition-all disabled:opacity-50"
        :disabled="store.uploading"
        @click="fileInput?.click()"
      >
        {{ store.uploading ? '上传中...' : '📄 上传文档' }}
      </button>
      <p class="text-[11px] text-white/30 mt-1.5">支持 .txt .md .pdf,最大 10MB</p>
      <p v-if="store.error" class="text-[12px] text-red-400 mt-2">{{ store.error }}</p>
      <p v-if="store.success" class="text-[12px] text-emerald-400 mt-2">✅ {{ store.lastUploadedName }} 上传成功</p>
    </div>

    <div class="flex-1 overflow-y-auto px-2">
      <div
        v-for="doc in store.documents"
        :key="doc.docId"
        class="px-3 py-2 hover:bg-white/5 rounded-lg group"
      >
        <div class="flex items-center justify-between">
          <div class="min-w-0 flex-1">
            <div class="text-[13px] text-white/70 truncate">{{ doc.fileName }}</div>
            <div class="text-[11px] text-white/30 mt-0.5">
              {{ doc.docType }} · {{ doc.chunkCount }} 块 · {{ doc.uploadedAt?.slice(0, 10) }}
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 text-[12px] text-white/30 hover:text-red-400 ml-2 transition-all"
            @click="handleDelete(doc.docId)"
          >删除</button>
        </div>
      </div>
      <div v-if="store.documents.length === 0" class="text-center text-[12px] text-white/30 py-8">
        暂无文档
      </div>
    </div>
  </div>
</template>
