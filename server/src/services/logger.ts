/**
 * 结构化日志模块
 * - JSON 输出到 stdout,便于采集与检索
 * - 语义化方法封装,埋点处不感知日志格式
 * - 未提供的可选字段不写入(JSON.stringify 会丢弃 undefined)
 */

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  event: string
  conversationId?: string
  userId?: string
  [key: string]: unknown
}

function emit(entry: LogEntry): void {
  console.log(JSON.stringify(entry))
}

function now(): string {
  return new Date().toISOString()
}

interface LogContext {
  conversationId?: string
  userId?: string
}

export function logQueryClassified(
  params: LogContext & { category: string; ruleMatched: boolean | null; durationMs: number }
): void {
  emit({
    timestamp: now(),
    level: 'info',
    event: 'query_classified',
    conversationId: params.conversationId,
    userId: params.userId,
    category: params.category,
    ruleMatched: params.ruleMatched,
    durationMs: params.durationMs,
  })
}

export function logToolCall(
  params: LogContext & {
    step: number
    toolName: string
    inputPreview: string
    outputLength: number
    durationMs: number
    success: boolean
  }
): void {
  emit({
    timestamp: now(),
    level: params.success ? 'info' : 'warn',
    event: 'tool_call',
    conversationId: params.conversationId,
    userId: params.userId,
    step: params.step,
    toolName: params.toolName,
    inputPreview: params.inputPreview,
    outputLength: params.outputLength,
    durationMs: params.durationMs,
    success: params.success,
  })
}

export function logStuckDetected(
  params: LogContext & { reason: string; observationCount: number }
): void {
  emit({
    timestamp: now(),
    level: 'warn',
    event: 'stuck_detected',
    conversationId: params.conversationId,
    userId: params.userId,
    reason: params.reason,
    observationCount: params.observationCount,
  })
}

export function logSearchLimitHit(
  params: LogContext & { toolName: string; callCount: number; limit: number }
): void {
  emit({
    timestamp: now(),
    level: 'warn',
    event: 'search_limit_hit',
    conversationId: params.conversationId,
    userId: params.userId,
    toolName: params.toolName,
    callCount: params.callCount,
    limit: params.limit,
  })
}

export function logFactCheck(
  params: LogContext & { valid: boolean; reason?: string }
): void {
  emit({
    timestamp: now(),
    level: params.valid ? 'info' : 'warn',
    event: 'fact_check',
    conversationId: params.conversationId,
    userId: params.userId,
    valid: params.valid,
    reason: params.reason,
  })
}

export function logAgentDone(
  params: LogContext & { totalSteps: number; totalDurationMs: number; hasContent: boolean }
): void {
  emit({
    timestamp: now(),
    level: 'info',
    event: 'agent_done',
    conversationId: params.conversationId,
    userId: params.userId,
    totalSteps: params.totalSteps,
    totalDurationMs: params.totalDurationMs,
    hasContent: params.hasContent,
  })
}

export function logAgentError(
  params: LogContext & { message: string; stack?: string }
): void {
  emit({
    timestamp: now(),
    level: 'error',
    event: 'agent_error',
    conversationId: params.conversationId,
    userId: params.userId,
    message: params.message,
    stack: params.stack,
  })
}
