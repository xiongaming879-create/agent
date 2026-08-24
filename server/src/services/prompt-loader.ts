/**
 * Prompt 模板加载器
 * - 启动后首次访问时读入并缓存,不做热加载(改 prompt 重启可接受)
 * - 模板变量用 {{var}} 占位,renderPrompt 缺失变量替换为空字符串
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const cache = new Map<string, string>()

export function loadPrompt(name: string): string {
  if (!cache.has(name)) {
    const path = new URL(`../prompts/${name}.txt`, import.meta.url)
    cache.set(name, readFileSync(fileURLToPath(path), 'utf-8'))
  }
  return cache.get(name)!
}

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}
