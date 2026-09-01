import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { loadWorkspaceConfig, type WorkspaceConfig } from './config'
import { resolveSandboxPath, SandboxError, type ResolvedPath } from './sandbox'
import { isBinaryFile } from './binary'
import { withPathLock } from './lock'
import { audited } from './audit'
import { requireConfirmation, ConfirmRequiredError } from './confirm'
import { logFsAudit } from '../../services/logger'

type LcConfig = { configurable?: { userId?: string } }

const MAX_LIST_DEPTH = 3
const MAX_LIST_ENTRIES = 500

async function runFsTool(
  toolName: string,
  inputPath: string,
  config: LcConfig | undefined,
  fn: (resolved: ResolvedPath, cfg: WorkspaceConfig) => Promise<string> | string,
): Promise<string> {
  const cfg = loadWorkspaceConfig()
  if (cfg.workspace_mode !== 'local_fs') {
    return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
  }
  const userId = config?.configurable?.userId ?? ''
  let resolved: ResolvedPath
  try {
    resolved = resolveSandboxPath(inputPath, cfg)
  } catch (err) {
    if (err instanceof SandboxError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: '', result: 'blocked', error: err.message })
      return `Error: ${err.message}`
    }
    throw err
  }
  try {
    return await audited({ userId, toolName, inputPath }, resolved.realPath, async () => fn(resolved, cfg))
  } catch (err) {
    if (err instanceof ConfirmRequiredError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: resolved.realPath, result: 'blocked', error: err.message })
      return `CONFIRM_REQUIRED: ${err.message}`
    }
    if (err instanceof SandboxError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: resolved.realPath, result: 'blocked', error: err.message })
      return `Error: ${err.message}`
    }
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

const relPath = z.string().describe('相对 sandbox_root 的相对路径,禁止绝对路径')

export const fsReadFileTool = new DynamicStructuredTool({
  name: 'fs_read_file',
  description: '读取本地文件(仅 local_fs 模式)。输入相对路径,超过 2MB 或二进制文件会被拒绝。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_read_file', p, config, (resolved, cfg) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      const st = fs.statSync(resolved.realPath)
      if (st.isDirectory()) return `Error: ${p} 是目录,请用 fs_list_dir`
      if (st.size > cfg.max_read_bytes) return `Error: 文件超过大小限制 (${st.size} > ${cfg.max_read_bytes} 字节)`
      if (isBinaryFile(resolved.realPath, st.size)) return `Error: 二进制文件,拒绝读取: ${p}`
      return fs.readFileSync(resolved.realPath, 'utf-8')
    }),
})

export const fsListDirTool = new DynamicStructuredTool({
  name: 'fs_list_dir',
  description: '列出本地目录内容(仅 local_fs 模式)。目录名带 / 后缀;recursive=true 递归(深度上限 3,最多 500 项)。',
  schema: z.object({ path: relPath, recursive: z.boolean().optional().describe('是否递归列出,默认 false') }),
  func: async ({ path: p, recursive }, _rm, config) =>
    runFsTool('fs_list_dir', p || '.', config, (resolved) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 目录不存在: ${p}`
      if (!fs.statSync(resolved.realPath).isDirectory()) return `Error: ${p} 不是目录`
      const out: string[] = []
      const walk = (dir: string, depth: number, prefix: string): boolean => {
        if (depth > MAX_LIST_DEPTH) return true
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= MAX_LIST_ENTRIES) return false
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isSymbolicLink()) {
            out.push(`${rel} (symlink)`)
          } else if (e.isDirectory()) {
            out.push(`${rel}/`)
            if (!walk(path.join(dir, e.name), depth + 1, rel)) return false
          } else {
            out.push(rel)
          }
        }
        return true
      }
      const complete = walk(resolved.realPath, 0, '')
      const lines = complete ? out : [...out, `... (超过上限 ${MAX_LIST_ENTRIES} 项,已截断)`]
      return lines.length > 0 ? lines.join('\n') : 'Empty directory'
    }),
})

export const fsMkdirTool = new DynamicStructuredTool({
  name: 'fs_mkdir',
  description: '创建目录(仅 local_fs 模式,支持多级创建)。输入相对路径。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_mkdir', p, config, (resolved) => {
      fs.mkdirSync(resolved.realPath, { recursive: true })
      return `Created: ${p}`
    }),
})

export const fsStatTool = new DynamicStructuredTool({
  name: 'fs_stat',
  description: '获取本地文件/目录信息(仅 local_fs 模式):大小、类型、创建/修改时间。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_stat', p, config, (resolved) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      const st = fs.statSync(resolved.realPath)
      return JSON.stringify({
        path: p,
        size: st.size,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        createdAt: st.birthtime.toISOString(),
        modifiedAt: st.mtime.toISOString(),
      })
    }),
})

export const fsWriteFileTool = new DynamicStructuredTool({
  name: 'fs_write_file',
  description: '写入/覆盖本地文件(仅 local_fs 模式)。覆盖已有文件属高危操作,需用户确认(confirm=true)。',
  schema: z.object({
    path: relPath,
    content: z.string().describe('要写入的文本内容'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ path: p, content, confirm }, _rm, config) =>
    runFsTool('fs_write_file', p, config, (resolved, cfg) => {
      if (fs.existsSync(resolved.realPath)) {
        requireConfirmation({ toolName: 'fs_write_file', realPath: resolved.realPath, description: `覆盖已有文件 ${p}`, config: cfg, confirm })
      }
      return withPathLock(resolved.realPath, () => {
        fs.mkdirSync(path.dirname(resolved.realPath), { recursive: true })
        fs.writeFileSync(resolved.realPath, content, 'utf-8')
        return `File written: ${p}`
      })
    }),
})

export const fsRmTool = new DynamicStructuredTool({
  name: 'fs_rm',
  description: '删除本地文件或目录(仅 local_fs 模式)。高危操作,默认需用户确认(confirm=true);非空目录批量删除另需 allow_dangerous_delete=true。',
  schema: z.object({
    path: relPath,
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ path: p, confirm }, _rm, config) =>
    runFsTool('fs_rm', p, config, (resolved, cfg) => {
      if (resolved.relativePath === '') return 'Error: 禁止删除沙箱根目录本身'
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      if (fs.statSync(resolved.realPath).isDirectory() && fs.readdirSync(resolved.realPath).length > 0 && !cfg.allow_dangerous_delete) {
        return 'Error: 批量删除非空目录被禁止(config 中 allow_dangerous_delete=true 可放开)'
      }
      requireConfirmation({ toolName: 'fs_rm', realPath: resolved.realPath, description: `删除 ${p}`, config: cfg, confirm })
      return withPathLock(resolved.realPath, () => {
        fs.rmSync(resolved.realPath, { recursive: true, force: true })
        return `Deleted: ${p}`
      })
    }),
})

export const fsCpTool = new DynamicStructuredTool({
  name: 'fs_cp',
  description: '复制本地文件/目录(仅 local_fs 模式,仅限沙箱内)。目标已存在属覆盖高危操作,需确认。',
  schema: z.object({
    src: relPath.describe('源路径'),
    dest: relPath.describe('目标路径'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ src, dest, confirm }, _rm, config) => {
    const cfg = loadWorkspaceConfig()
    if (cfg.workspace_mode !== 'local_fs') {
      return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
    }
    // src/dest 双重沙箱校验,任一逃逸即拦截
    let srcR: ResolvedPath, destR: ResolvedPath
    try {
      srcR = resolveSandboxPath(src, cfg)
      destR = resolveSandboxPath(dest, cfg)
    } catch (err) {
      if (err instanceof SandboxError) {
        if (cfg.enable_audit_log) logFsAudit({ userId: config?.configurable?.userId ?? '', toolName: 'fs_cp', inputPath: `${src} -> ${dest}`, realPath: '', result: 'blocked', error: err.message })
        return `Error: ${err.message}`
      }
      throw err
    }
    if (srcR.relativePath === '') return 'Error: 禁止复制沙箱根目录本身'
    if (!fs.existsSync(srcR.realPath)) return `Error: 源不存在: ${src}`
    try {
      return await audited({ userId: config?.configurable?.userId ?? '', toolName: 'fs_cp', inputPath: `${src} -> ${dest}` }, destR.realPath, () => {
        if (fs.existsSync(destR.realPath)) {
          requireConfirmation({ toolName: 'fs_cp', realPath: destR.realPath, description: `覆盖已有目标 ${dest}`, config: cfg, confirm })
        }
        return withPathLock(srcR.realPath, () => {
          fs.cpSync(srcR.realPath, destR.realPath, { recursive: true })
          return `Copied: ${src} -> ${dest}`
        })
      })
    } catch (err) {
      if (err instanceof ConfirmRequiredError) return `CONFIRM_REQUIRED: ${err.message}`
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const fsMvTool = new DynamicStructuredTool({
  name: 'fs_mv',
  description: '移动/重命名本地文件或目录(仅 local_fs 模式,仅限沙箱内)。目标已存在属覆盖高危操作,需确认。',
  schema: z.object({
    src: relPath.describe('源路径'),
    dest: relPath.describe('目标路径'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ src, dest, confirm }, _rm, config) => {
    const cfg = loadWorkspaceConfig()
    if (cfg.workspace_mode !== 'local_fs') {
      return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
    }
    let srcR: ResolvedPath, destR: ResolvedPath
    try {
      srcR = resolveSandboxPath(src, cfg)
      destR = resolveSandboxPath(dest, cfg)
    } catch (err) {
      if (err instanceof SandboxError) {
        if (cfg.enable_audit_log) logFsAudit({ userId: config?.configurable?.userId ?? '', toolName: 'fs_mv', inputPath: `${src} -> ${dest}`, realPath: '', result: 'blocked', error: err.message })
        return `Error: ${err.message}`
      }
      throw err
    }
    if (srcR.relativePath === '') return 'Error: 禁止移动沙箱根目录本身'
    if (!fs.existsSync(srcR.realPath)) return `Error: 源不存在: ${src}`
    try {
      return await audited({ userId: config?.configurable?.userId ?? '', toolName: 'fs_mv', inputPath: `${src} -> ${dest}` }, destR.realPath, () => {
        if (fs.existsSync(destR.realPath)) {
          requireConfirmation({ toolName: 'fs_mv', realPath: destR.realPath, description: `覆盖已有目标 ${dest}`, config: cfg, confirm })
        }
        return withPathLock(srcR.realPath, () => {
          fs.renameSync(srcR.realPath, destR.realPath)
          return `Moved: ${src} -> ${dest}`
        })
      })
    } catch (err) {
      if (err instanceof ConfirmRequiredError) return `CONFIRM_REQUIRED: ${err.message}`
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const localFsTools: DynamicStructuredTool<Record<string, unknown>>[] = [
  fsReadFileTool, fsListDirTool, fsMkdirTool, fsStatTool,
  fsWriteFileTool, fsRmTool, fsCpTool, fsMvTool,
]
