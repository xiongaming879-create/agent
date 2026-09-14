// server/src/tools/localfs/sandbox.ts
import fs from 'fs'
import path from 'path'
import type { WorkspaceConfig } from './config'

export class SandboxError extends Error {
  constructor(message: string, public readonly code: 'ESCAPE' | 'ABSOLUTE' | 'SYMLINK' | 'NO_ROOT') {
    super(message)
    this.name = 'SandboxError'
  }
}

export interface ResolvedPath {
  realPath: string
  relativePath: string
}

function isPrefix(parent: string, child: string): boolean {
  const p = process.platform === 'win32' ? parent.toLowerCase() : parent
  const c = process.platform === 'win32' ? child.toLowerCase() : child
  return c === p || c.startsWith(p + path.sep)
}

// 逐级 lstat 检查 root→full 间是否有 symlink 组件:lstat 不跟随终组件,断链 junction/symlink 也能识别,
// 避免 realpath 遇断链走 ENOENT 而跳过逃逸(断链指向 sandbox 外时 realpath 无法解析)
function hasSymlinkComponent(root: string, full: string): boolean {
  let cur = full
  while (cur !== root) {
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) return true
    } catch {
      // 尚不存在的组件继续向上
    }
    const parent = path.dirname(cur)
    if (parent === cur) return false
    cur = parent
  }
  return false
}

export function resolveSandboxPath(rawPath: string, config: WorkspaceConfig): ResolvedPath {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new SandboxError('路径不能为空', 'ABSOLUTE')
  const trimmed = rawPath.trim()

  // 白名单第一关:allowedDirectories 不在列表一律拒绝;为空时回落 sandbox_root(向后兼容)
  const whitelist = (config.allowedDirectories ?? []).filter(Boolean).map((r) => path.resolve(r))
  if (whitelist.length === 0 && !config.sandbox_root) {
    throw new SandboxError('sandbox_root 与 allowedDirectories 均未配置,本地文件模式不可用', 'NO_ROOT')
  }
  const dirs = whitelist.length > 0 ? whitelist : [path.resolve(config.sandbox_root)]

  const isAbs = path.isAbsolute(trimmed)
  if (isAbs && !config.allow_absolute_path) {
    throw new SandboxError(`禁止绝对路径: ${trimmed}`, 'ABSOLUTE')
  }

  // sandbox_root 只是工作基准目录:相对路径解析起点 + 默认生成位置,不参与白名单判定
  const base = path.resolve(config.sandbox_root || dirs[0])
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true })

  const full = isAbs ? path.resolve(trimmed) : path.resolve(base, trimmed)
  const root = dirs.find((r) => isPrefix(r, full))
  if (!root) throw new SandboxError(`路径不在 allowedDirectories 白名单内: ${rawPath}`, 'ESCAPE')

  // 白名单命中后逐级查 symlink 组件(覆盖已存在与断链两类逃逸)
  if (!config.allow_symbolic_link && hasSymlinkComponent(root, full)) {
    throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
  }

  return {
    realPath: full,
    relativePath: path.relative(root, full).replace(/\\/g, '/'),
  }
}
