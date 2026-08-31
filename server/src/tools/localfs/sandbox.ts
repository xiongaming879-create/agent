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

function nearestExistingRealPath(full: string): string {
  let cur = full
  for (;;) {
    try {
      return fs.realpathSync(cur)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return full
      cur = parent
    }
  }
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
  const realRoot = fs.realpathSync(root)

  const full = path.resolve(root, trimmed)
  if (!isPrefix(root, full)) throw new SandboxError(`路径逃逸被拦截: ${rawPath}`, 'ESCAPE')

  // 先逻辑前缀校验再真实解析:待创建路径无法直接 realpath,用最近存在祖先锚定校验
  if (!config.allow_symbolic_link && !isPrefix(realRoot, nearestExistingRealPath(full))) {
    throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
  }
  if (!config.allow_symbolic_link && fs.existsSync(full)) {
    if (!isPrefix(realRoot, fs.realpathSync(full))) {
      throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
    }
  }

  return {
    realPath: full,
    relativePath: path.relative(root, full).replace(/\\/g, '/'),
  }
}
