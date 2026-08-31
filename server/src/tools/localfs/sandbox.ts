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
  if (!config.sandbox_root) throw new SandboxError('sandbox_root 未配置,本地文件模式不可用', 'NO_ROOT')
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new SandboxError('路径不能为空', 'ABSOLUTE')
  const trimmed = rawPath.trim()

  if (path.isAbsolute(trimmed) && !config.allow_absolute_path) {
    throw new SandboxError(`禁止绝对路径: ${trimmed}`, 'ABSOLUTE')
  }

  const root = path.resolve(config.sandbox_root)
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })

  const full = path.resolve(root, trimmed)
  if (!isPrefix(root, full)) throw new SandboxError(`路径逃逸被拦截: ${rawPath}`, 'ESCAPE')

  // 逻辑前缀校验后逐级查 symlink 组件(覆盖已存在与断链两类逃逸)
  if (!config.allow_symbolic_link && hasSymlinkComponent(root, full)) {
    throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
  }

  return {
    realPath: full,
    relativePath: path.relative(root, full).replace(/\\/g, '/'),
  }
}
