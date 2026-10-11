<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ThoughtItem, ThoughtRound, PlanStageView } from '../utils/thoughtGroup'
import {
  parseSearchResults, parseKnowledgeResults, parseParallelSections,
  parseJsonKV, parseInputJson, hostOf,
  isFileReadTool, isDirListTool, parseFileRead, parseDirList,
} from '../utils/toolRender'
import { renderMarkdown } from '../utils/markdown'
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

  const kvInput = inputObj && !KNOWN_TOOLS.has(item.toolName) ? parseJsonKV(item.input) : null
  const fileRead = out && isFileReadTool(item.toolName) ? parseFileRead(item.input, out) : null
  const dirRows = out && isDirListTool(item.toolName) ? parseDirList(out) : null
  const kv = out && !sections && !fileRead && !dirRows ? parseJsonKV(out) : null
  return {
    inputObj,
    queries: inputObj && Array.isArray(inputObj.queries) ? (inputObj.queries as unknown[]).map(String) : null,
    kvInput,
    sections,
    knowledge: out && item.toolName === 'knowledge_search' ? parseKnowledgeResults(out) : null,
    fileRead,
    dirRows,
    kv,
  }
}))

function needsExpand(text: string, threshold: number): boolean {
  return text.length > threshold || text.includes('\n')
}

function planStatusIcon(status: PlanStageView['status']): string {
  if (status === 'done') return '✓'
  if (status === 'running') return '⏳'
  if (status === 'skipped') return '⊘'
  return '○'
}

function planStatusClass(status: PlanStageView['status']): string {
  if (status === 'done') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'running') return 'text-amber-600 dark:text-amber-400'
  return 'text-mute'
}

const PLAN_STATUSES: readonly string[] = ['pending', 'running', 'done', 'skipped']

function validPlanStages(stages: PlanStageView[]): PlanStageView[] {
  if (!Array.isArray(stages)) return []
  return stages.filter((s) =>
    typeof s === 'object' && s !== null &&
    typeof s.index === 'number' &&
    typeof s.goal === 'string' &&
    PLAN_STATUSES.includes(s.status) &&
    Array.isArray(s.dependsOn)
  )
}

</script>

<template>
  <div class="space-y-0.5">
    <template v-for="(item, i) in props.items" :key="i">
      <!-- 思考段落 -->
      <div v-if="item.kind === 'note'" class="text-soft text-[13px] leading-relaxed break-words py-0.5 italic">
        <div class="markdown-body thought-md" v-html="renderMarkdown(item.content)" /><svg
          v-if="i === props.items.length - 1 && props.isStreaming"
          class="inline-block w-3 h-3 ml-1 align-middle text-mute animate-spin"
          fill="none" viewBox="0 0 24 24"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>

      <!-- 执行计划 todo -->
      <div
        v-else-if="item.kind === 'plan'"
        class="rounded-md border border-glass-border bg-glass-fill px-2.5 py-2 space-y-1"
      >
        <div class="text-mute text-[11px] font-medium">执行计划</div>
        <template v-if="validPlanStages(item.stages).length">
          <div
            v-for="s in validPlanStages(item.stages)"
            :key="s.index"
            class="text-[12px] leading-relaxed"
          >
            <div class="flex items-center gap-1.5">
              <span class="shrink-0 w-4 text-center text-[11px]" :class="planStatusClass(s.status)">{{ planStatusIcon(s.status) }}</span>
              <span
                class="text-soft break-all flex-1 min-w-0"
                :class="s.status === 'skipped' ? 'line-through text-mute' : ''"
              >{{ s.index }}. {{ s.goal }}</span>
              <span v-if="s.dependsOn.length" class="shrink-0 text-mute text-[11px]">依赖 {{ s.dependsOn.join(',') }}</span>
            </div>
            <div v-if="s.outcome" class="text-mute text-[11px] mt-0.5 ml-[22px]">
              <div class="flex items-baseline gap-1">
                <button
                  class="shrink-0 text-mute hover:text-soft transition-colors"
                  @click="toggle(`p${s.index}`)"
                >
                  <svg
                    class="w-3 h-3 transition-transform duration-200"
                    :class="isOpen(`p${s.index}`) ? 'rotate-90' : ''"
                    fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
                  ><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
                <div class="min-w-0 flex-1 markdown-body thought-md" :class="!isOpen(`p${s.index}`) ? 'line-clamp-1' : ''" v-html="renderMarkdown(s.outcome)" />
              </div>
            </div>
          </div>
        </template>
        <div v-else class="text-mute text-[11px] italic">(计划数据无效)</div>
      </div>

      <!-- 工具调用 pill -->
      <div v-else>
        <button
          class="w-full flex items-center gap-2 text-left rounded-md px-1.5 py-1 hover:bg-glass-fill transition-colors text-[12px]"
          @click="toggleDetail(i)"
        >
          <svg v-if="item.streaming" class="w-3 h-3 shrink-0 text-mute animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span v-else-if="item.success === true" class="shrink-0 text-emerald-600 dark:text-emerald-400 text-[11px]">✓</span>
          <span v-else-if="item.success === false" class="shrink-0 text-red-600 dark:text-red-400 text-[11px]">✗</span>
          <span v-else class="shrink-0 text-mute">·</span>

          <span class="text-main font-medium shrink-0">{{ item.toolName }}</span>
          <span class="flex-1 min-w-0 text-soft truncate">{{ shortInput(item) }}</span>

          <span v-if="item.durationMs !== null" class="text-mute text-[11px] shrink-0">{{ formatDuration(item.durationMs) }}</span>
          <svg
            class="w-3 h-3 shrink-0 text-mute transition-transform duration-200"
            :class="isDetailOpen(i) ? 'rotate-90' : ''"
            fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"
          ><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>

        <div v-if="isDetailOpen(i) && renders[i]" class="ml-2 pl-3 border-l border-glass-border mt-1 mb-1.5 space-y-2">
          <!-- 轮内思考 -->
          <div v-if="item.thought" class="text-soft text-[12px] leading-relaxed">
            <div class="markdown-body thought-md" v-html="renderMarkdown(item.thought)" />
          </div>

          <!-- 输入 -->
          <div class="text-[12px]">
            <span class="text-mute">输入:</span>
            <div v-if="renders[i]!.queries" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="(q, qi) in renders[i]!.queries"
                :key="qi"
                class="px-1.5 py-0.5 rounded bg-glass-fill border border-glass-border text-soft text-[11px] break-all"
              >{{ q }}</span>
            </div>
            <span v-else-if="item.toolName === 'calculator'" class="text-main font-mono break-all">{{ renders[i]!.inputObj?.expression }}</span>
            <span v-else-if="item.toolName === 'search' || item.toolName === 'knowledge_search'" class="text-main break-all">「{{ renders[i]!.inputObj?.input ?? renders[i]!.inputObj?.query ?? item.input }}」</span>
            <div v-else-if="renders[i]!.kvInput" class="mt-1 space-y-0.5">
              <div v-for="row in renders[i]!.kvInput" :key="row.key" class="flex gap-2">
                <span class="text-mute shrink-0 font-mono text-[11px]">{{ row.key }}:</span>
                <span class="text-soft break-all">{{ row.value }}</span>
              </div>
            </div>
            <span v-else class="text-main break-all">{{ item.input }}</span>
          </div>

          <!-- 输出 -->
          <div v-if="item.streaming" class="text-mute text-[12px]">执行中…</div>
          <div v-else-if="item.output !== null" class="text-[12px]">
            <span class="text-mute">结果:</span>

            <!-- 文件读取:路径 chip + 纯文本代码块(工具输出不渲染 markdown) -->
            <div v-if="renders[i]!.fileRead" class="mt-1 space-y-1">
              <div v-if="renders[i]!.fileRead!.fileName" class="flex items-center gap-2 min-w-0">
                <span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-glass-fill border border-glass-border text-soft text-[11px]">📄 {{ renders[i]!.fileRead!.fileName }}</span>
                <span class="text-mute text-[11px] truncate">{{ renders[i]!.fileRead!.path }}</span>
              </div>
              <pre class="file-code" :class="!isOpen(`f${i}`) ? 'line-clamp-6' : ''">{{ renders[i]!.fileRead!.content }}</pre>
              <button
                v-if="needsExpand(renders[i]!.fileRead!.content, 500)"
                class="text-mute hover:text-soft text-[11px]"
                @click="toggle(`f${i}`)"
              >{{ isOpen(`f${i}`) ? '收起' : '展开' }}</button>
            </div>

            <!-- 目录列表:文件树行 -->
            <div v-else-if="renders[i]!.dirRows" class="mt-1 space-y-0.5">
              <div :class="!isOpen(`d${i}`) && renders[i]!.dirRows!.length > 8 ? 'line-clamp-8' : ''">
                <div v-for="(row, ri) in renders[i]!.dirRows" :key="ri" class="flex items-center gap-1.5 font-mono text-[12px] text-soft">
                  <span class="shrink-0">{{ row.isDir ? '📁' : row.isSymlink ? '🔗' : '📄' }}</span>
                  <span class="break-all">{{ row.name }}<span v-if="row.isSymlink" class="text-mute"> (symlink)</span></span>
                </div>
              </div>
              <button
                v-if="renders[i]!.dirRows!.length > 8"
                class="text-mute hover:text-soft text-[11px]"
                @click="toggle(`d${i}`)"
              >{{ isOpen(`d${i}`) ? '收起' : `展开全部 ${renders[i]!.dirRows!.length} 项` }}</button>
            </div>

            <!-- 搜索卡片(单条 search 或 parallel_search 分段) -->
            <div v-else-if="renders[i]!.sections" class="mt-1 space-y-2">
              <div v-for="(s, si) in renders[i]!.sections" :key="si">
                <div v-if="renders[i]!.sections!.length > 1" class="text-soft text-[11px] font-medium mb-1">🔍 {{ s.query }}</div>
                <div v-if="s.cards" class="space-y-1.5">
                  <a
                    v-for="(c, ci) in s.cards"
                    :key="ci"
                    :href="c.link"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block rounded-md border border-glass-border bg-glass-fill hover:border-accent/40 transition-colors px-2.5 py-2"
                  >
                    <div class="text-main text-[12px] font-medium break-words">{{ c.title || hostOf(c.link) }}</div>
                    <div class="text-mute text-[11px] truncate">{{ hostOf(c.link) }}</div>
                    <div class="line-clamp-3 text-soft text-[12px] leading-relaxed mt-0.5 break-words">{{ c.content }}</div>
                  </a>
                </div>
                <div v-else class="text-soft whitespace-pre-wrap break-words" :class="!isOpen(`s${i}:${si}`) ? 'line-clamp-6' : ''">{{ s.raw }}</div>
                <button
                  v-if="!s.cards && needsExpand(s.raw, 300)"
                  class="text-mute hover:text-soft text-[11px] mt-0.5"
                  @click="toggle(`s${i}:${si}`)"
                >{{ isOpen(`s${i}:${si}`) ? '收起' : '展开' }}</button>
              </div>
            </div>

            <!-- 知识库来源卡片 -->
            <div v-else-if="renders[i]!.knowledge" class="mt-1 space-y-1.5">
              <div
                v-for="(c, ci) in renders[i]!.knowledge"
                :key="ci"
                class="rounded-md border border-glass-border bg-glass-fill px-2.5 py-2"
              >
                <div class="mb-1">
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-hover text-soft text-[11px]">
                    📄 {{ c.source }}<template v-if="c.page"> · {{ c.page }}</template>
                  </span>
                </div>
                <div class="text-soft text-[12px] leading-relaxed break-words" :class="!isOpen(`k${i}:${ci}`) ? 'line-clamp-4' : ''">{{ c.content }}</div>
                <button
                  v-if="needsExpand(c.content, 200)"
                  class="text-mute hover:text-soft text-[11px] mt-0.5"
                  @click="toggle(`k${i}:${ci}`)"
                >{{ isOpen(`k${i}:${ci}`) ? '收起' : '展开' }}</button>
              </div>
            </div>

            <!-- calculator: 算式 = 结果 -->
            <div v-else-if="item.toolName === 'calculator'" class="mt-1 font-mono text-main bg-glass-fill rounded-md px-2.5 py-2 break-all">
              {{ renders[i]!.inputObj?.expression }} <span class="text-mute">=</span> {{ item.output }}
            </div>

            <!-- 其他工具 JSON 转键值 -->
            <div v-else-if="renders[i]!.kv" class="mt-1 space-y-0.5">
              <div v-for="row in renders[i]!.kv" :key="row.key" class="flex gap-2">
                <span class="text-mute shrink-0 font-mono text-[11px]">{{ row.key }}:</span>
                <span class="text-soft break-all">{{ row.value }}</span>
              </div>
            </div>

            <!-- 纯文本兜底 -->
            <template v-else>
              <div class="mt-1 text-soft whitespace-pre-wrap break-words" :class="!isOpen(`o${i}`) ? 'line-clamp-6' : ''">{{ item.output }}</div>
              <button
                v-if="needsExpand(item.output!, 300)"
                class="text-mute hover:text-soft text-[11px]"
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
.file-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-main);
  background: var(--bg-surface);
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  padding: 8px 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
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
.line-clamp-8 {
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 思考过程的 markdown 比正文更紧凑 */
.thought-md :deep(p) {
  margin: 0.25em 0;
}
.thought-md :deep(p:first-child) {
  margin-top: 0;
}
.thought-md :deep(h1:first-child),
.thought-md :deep(h2:first-child),
.thought-md :deep(h3:first-child),
.thought-md :deep(h4:first-child) {
  margin-top: 0;
}
.thought-md :deep(p:last-child) {
  margin-bottom: 0;
}
.thought-md :deep(h1),
.thought-md :deep(h2),
.thought-md :deep(h3),
.thought-md :deep(h4) {
  font-size: 1em;
  font-weight: 600;
}
</style>
