// server/src/tools/localfs/audit.ts
import { logFsAudit } from '../../services/logger'
import { loadWorkspaceConfig } from './config'

export interface AuditContext {
  userId: string
  toolName: string
  inputPath: string
}

export async function audited<T>(
  ctx: AuditContext,
  realPath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const cfg = loadWorkspaceConfig()
  try {
    const result = await fn()
    if (cfg.enable_audit_log) logFsAudit({ userId: ctx.userId, toolName: ctx.toolName, inputPath: ctx.inputPath, realPath, result: 'success' })
    return result
  } catch (err) {
    if (cfg.enable_audit_log) {
      logFsAudit({
        userId: ctx.userId, toolName: ctx.toolName, inputPath: ctx.inputPath, realPath,
        result: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
}
