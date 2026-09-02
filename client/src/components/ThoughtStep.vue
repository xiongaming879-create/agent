<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ThoughtItem, ThoughtRound } from '../utils/thoughtGroup'
import {
  parseSearchResults, parseKnowledgeResults, parseParallelSections,
  parseJsonKV, parseInputJson, hostOf,
} from '../utils/toolRender'
import type { ParallelSection } from '../utils/toolRender'

const props = defineProps<{
  items: ThoughtItem[]
  isStreaming: boolean
}>()

const detailOpen = ref<Record<number, boolean>>({})
const open = ref<Record<string, boolean>>({})

function toggleDetail(i: number) {
  detailOpen.value = { ...detailOpen.value, [i]: !detailOpen.value[i] }
}

function isDetailOpen(i: number): boolean {
  return !!detailOpen.value[i]
}

function toggle(key: string) {
  open.value = { ...open.value, [key]: !open.value[key] }
}

function isOpen(key: string): boolean {
  return !!open.value[key]
}

function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

const KNOWN_TOOLS = new Set(['search', 'parallel_search', 'knowledge_search', 'calculator'])

function shortInput(item: ThoughtRound): string {
  const obj = parseInputJson(item.input)
  if (obj) {
    if (Array.isArray(obj.queries)) return (obj.queries as unknown[]).join('、')
    for (const key of ['input', 'query', 'expression', 'path', 'url', 'keywords']) {
      if (obj[key]) return String(obj[key])
    }
  }
  const s = item.input.replace(/[{}\[\]"]/g, '').trim()
  return s.length > 50 ? s.slice(0, 50) + '…' : s
}

interface SectionRender {
  query: string
  cards: { title: string; link: string; content: string }[] | null
  raw: string
}

/** 每个轮次的语义化渲染数据(输出统一为 sections,search 视为单段) */
const renders = computed(() => props.items.map((item) => {
  if (item.kind !== 'round') return null
  const inputObj = parseInputJson(item.input)
  const out = item.output

  let sections: SectionRender[] | null = null
  if (out && item.toolName === 'search') {
    const cards = parseSearchResults(out)
    sections = cards ? [{ query: shortInput(item), cards, raw: out }] : null
  } else if (out && item.toolName === 'parallel_search') {
    const parsed = parseParallelSections(out)
    sections = parsed ?? null
  }

  const kv = out && !sections ? parseJsonKV(out) : null
  return {
    inputObj,
    queries: inputObj && Array.isArray(inputObj.queries) ? (inputObj.queries as unknown[]).map(String) : null,
    kvInput: inputObj && !KNOWN_TOOLS.has(item.toolName) ? parseJsonKV(item.input) : null,
    sections,
    knowledge: out && item.toolName === 'knowledge_search' ? parseKnowledgeResults(out) : null,
    kv,
  }
}))

function needsExpand(text: string, threshold: number): boolean {
  return text.length > threshold || text.includes('\n')
}
</script>

<template>
  <div class="space-y-0.5">
    <template v-for="(item, i) in props.items" :key="i">
      <!-- 思考段落 -->
      <div v-if="item.kind === 'note'" class="text-neutral-400 text-[13px] leading-relaxed break-words py-0.5">
        {{ item.content }}<svg
          v-if="i === props.items.length - 1 && props.isStreaming"
          class="inline-block w-3 h-3 ml-1 align-middle text-neutral-400 animate-spin"
          fill="none" viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>

      <!-- 工具调用 pill -->
      <div v-else>
        <button
          class="w-full flex items-center gap-2 text-left rounded-md px-1.5 py-1 hover:bg-white/5 transition-colors text-[12px]"
          @click="toggleDetail(i)"
        >
          <svg v-if="item.streaming" class="w-3 h-3 shrink-0 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span v-else-if="item.success === true" class="shrink-0 text-emerald-400 text-[11px]">✓</span>
          <span v-else-if="item.success === false" class="shrink-0 text-red-400 text-[11px]">✗</span>
          <span v-else class="shrink-0 text-neutral-600">·</span>

          <span class="text-neutral-300 font-medium shrink-0">{{ item.toolName }}</span>
          <span class="text-neutral-500 truncate">{{ shortInput(item) }}</span>

          <span class="flex-1" />
          <span v-if="item.durationMs !== null" class="text-neutral-500 text-[11px] shrink-0">{{ formatDuration(item.durationMs) }}</span>
          <svg
            class="w-3 h-3 shrink-0 text-neutral-500 transition-transform duration-200"
            :class="isDetailOpen(i) ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
          ><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>

        <div v-if="isDetailOpen(i) && renders[i]" class="ml-2 pl-3 border-l border-neutral-800 mt-1 mb-1.5 space-y-2">
          <!-- 轮内思考 -->
          <div v-if="item.thought" class="text-neutral-400 italic text-[12px] leading-relaxed break-words">{{ item.thought }}</div>

          <!-- 输入 -->
          <div class="text-[12px]">
            <span class="text-neutral-500">输入:</span>
            <div v-if="renders[i]!.queries" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="(q, qi) in renders[i]!.queries"
                :key="qi"
                class="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-300 text-[11px] break-all"
              >{{ q }}</span>
            </div>
            <span v-else-if="item.toolName === 'calculator'" class="text-neutral-300 font-mono break-all">{{ renders[i]!.inputObj?.expression }}</span>
            <span v-else-if="item.toolName === 'search' || item.toolName === 'knowledge_search'" class="text-neutral-300 break-all">「{{ renders[i]!.inputObj?.input ?? renders[i]!.inputObj?.query ?? item.input }}」</span>
            <div v-else-if="renders[i]!.kvInput" class="mt-1 space-y-0.5">
              <div v-for="row in renders[i]!.kvInput" :key="row.key" class="flex gap-2">
                <span class="text-neutral-500 shrink-0 font-mono text-[11px]">{{ row.key }}:</span>
                <span class="text-neutral-300 break-all">{{ row.value }}</span>
              </div>
            </div>
            <span v-else class="text-neutral-300 break-all">{{ item.input }}</span>
          </div>

          <!-- 输出 -->
          <div v-if="item.streaming" class="text-neutral-500 text-[12px]">执行中…</div>
          <div v-else-if="item.output !== null" class="text-[12px]">
            <span class="text-neutral-500">结果:</span>

            <!-- 搜索卡片(单条 search 或 parallel_search 分段) -->
            <div v-if="renders[i]!.sections" class="mt-1 space-y-2">
              <div v-for="(s, si) in renders[i]!.sections" :key="si">
                <div v-if="renders[i]!.sections!.length > 1" class="text-neutral-300 text-[11px] font-medium mb-1">🔍 {{ s.query }}</div>
                <div v-if="s.cards" class="space-y-1.5">
                  <a
                    v-for="(c, ci) in s.cards"
                    :key="ci"
                    :href="c.link"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block rounded-md border border-neutral-800 bg-neutral-900/60 hover:border-neutral-600 transition-colors px-2.5 py-2"
                  >
                    <div class="text-neutral-200 text-[12px] font-medium break-words">{{ c.title || hostOf(c.link) }}</div>
                    <div class="text-neutral-500 text-[11px] truncate">{{ hostOf(c.link) }}</div>
                    <div class="line-clamp-3 text-neutral-400 text-[12px] leading-relaxed mt-0.5 break-words">{{ c.content }}</div>
                  </a>
                </div>
                <div v-else class="text-neutral-400 whitespace-pre-wrap break-words" :class="!isOpen(`s${i}:${si}`) ? 'line-clamp-6' : ''">{{ s.raw }}</div>
                <button
                  v-if="!s.cards && needsExpand(s.raw, 300)"
                  class="text-white/25 hover:text-white/50 text-[11px] mt-0.5"
                  @click="toggle(`s${i}:${si}`)"
                >{{ isOpen(`s${i}:${si}`) ? '收起' : '展开' }}</button>
              </div>
            </div>

            <!-- 知识库来源卡片 -->
            <div v-else-if="renders[i]!.knowledge" class="mt-1 space-y-1.5">
              <div
                v-for="(c, ci) in renders[i]!.knowledge"
                :key="ci"
                class="rounded-md border border-neutral-800 bg-neutral-900/60 px-2.5 py-2"
              >
                <div class="mb-1">
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[11px]">
                    📄 {{ c.source }}<template v-if="c.page"> · {{ c.page }}</template>
                  </span>
                </div>
                <div class="text-neutral-400 text-[12px] leading-relaxed break-words" :class="!isOpen(`k${i}:${ci}`) ? 'line-clamp-4' : ''">{{ c.content }}</div>
                <button
                  v-if="needsExpand(c.content, 200)"
                  class="text-white/25 hover:text-white/50 text-[11px] mt-0.5"
                  @click="toggle(`k${i}:${ci}`)"
                >{{ isOpen(`k${i}:${ci}`) ? '收起' : '展开' }}</button>
              </div>
            </div>

            <!-- calculator: 算式 = 结果 -->
            <div v-else-if="item.toolName === 'calculator'" class="mt-1 font-mono text-neutral-200 bg-neutral-900/60 rounded-md px-2.5 py-2 break-all">
              {{ renders[i]!.inputObj?.expression }} <span class="text-neutral-500">=</span> {{ item.output }}
            </div>

            <!-- 其他工具 JSON 转键值 -->
            <div v-else-if="renders[i]!.kv" class="mt-1 space-y-0.5">
              <div v-for="row in renders[i]!.kv" :key="row.key" class="flex gap-2">
                <span class="text-neutral-500 shrink-0 font-mono text-[11px]">{{ row.key }}:</span>
                <span class="text-neutral-300 break-all">{{ row.value }}</span>
              </div>
            </div>

            <!-- 纯文本兜底 -->
            <template v-else>
              <div class="mt-1 text-neutral-400 whitespace-pre-wrap break-words" :class="!isOpen(`o${i}`) ? 'line-clamp-6' : ''">{{ item.output }}</div>
              <button
                v-if="needsExpand(item.output!, 300)"
                class="text-white/25 hover:text-white/50 text-[11px]"
                @click="toggle(`o${i}`)"
              >{{ isOpen(`o${i}`) ? '收起' : '展开' }}</button>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-4 {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-6 {
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
