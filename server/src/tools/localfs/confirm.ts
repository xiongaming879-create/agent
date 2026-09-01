import type { WorkspaceConfig } from './config'

export class ConfirmRequiredError extends Error {
  constructor(message: string, public readonly opKey: string) {
    super(message)
    this.name = 'ConfirmRequiredError'
  }
}

const CONFIRM_TTL_MS = 10 * 60 * 1000
// pending: opKey -> expiresAt。对话内确认:首次拦截登记,用户同意后 LLM 带 confirm=true 重试放行
// ponytail: 确认由 LLM 介导,LLM 可自行重试;强校验需 SSE 弹窗方案
const pending = new Map<string, number>()

export function opKeyFor(toolName: string, realPath: string): string {
  return `${toolName}:${realPath}`
}

export function requireConfirmation(params: {
  toolName: string
  realPath: string
  description: string
  config: WorkspaceConfig
  confirm?: boolean
}): void {
  if (params.config.auto_confirm_high_risk) return
  const key = opKeyFor(params.toolName, params.realPath)
  const expiresAt = pending.get(key)
  if (params.confirm === true) {
    if (expiresAt && expiresAt > Date.now()) {
      pending.delete(key)
      return
    }
    throw new ConfirmRequiredError('没有待确认的高危操作或确认已过期,请先不带 confirm 触发确认请求。', key)
  }
  if (expiresAt && expiresAt > Date.now()) {
    throw new ConfirmRequiredError(
      `高危操作已被拦截,等待用户确认: ${params.description}。请询问用户是否确认;用户明确同意后携带 confirm=true 重试本操作(10 分钟内有效)。`,
      key,
    )
  }
  pending.set(key, Date.now() + CONFIRM_TTL_MS)
  throw new ConfirmRequiredError(
    `高危操作已被拦截: ${params.description}。请询问用户是否确认;用户明确同意后携带 confirm=true 重试本操作(10 分钟内有效)。`,
    key,
  )
}

export function peekPending(key: string): number | undefined {
  return pending.get(key)
}

export function setPendingForTest(key: string, expiresAt: number): void {
  pending.set(key, expiresAt)
}

export function clearPendingForTest(): void {
  pending.clear()
}
