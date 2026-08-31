// test/server/tools/localfs/sandbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveSandboxPath, SandboxError } from '../../../../server/src/tools/localfs/sandbox'
import type { WorkspaceConfig } from '../../../../server/src/tools/localfs/config'

let root: string
let cfg: WorkspaceConfig
// Windows 上目录符号链接('dir')需开发者模式/管理员,用 junction 等价替代(realpath 行为一致)
const linkType: fs.symlink.Type = process.platform === 'win32' ? 'junction' : 'dir'

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'))
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'hello')
  cfg = {
    workspace_mode: 'local_fs',
    sandbox_root: root,
    allow_absolute_path: false,
    allow_symbolic_link: false,
    allow_dangerous_delete: false,
    max_read_bytes: 2 * 1024 * 1024,
    auto_confirm_high_risk: false,
    enable_audit_log: true,
  }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveSandboxPath', () => {
  it('正常相对路径解析到 sandbox_root 下', () => {
    const r = resolveSandboxPath('sub/a.txt', cfg)
    expect(r.realPath).toBe(fs.realpathSync(path.join(root, 'sub', 'a.txt')))
    expect(r.relativePath.replace(/\\/g, '/')).toBe('sub/a.txt')
  })

  it('../ 逃逸被拒绝(ESCAPE)', () => {
    expect(() => resolveSandboxPath('../outside.txt', cfg)).toThrow(SandboxError)
    try {
      resolveSandboxPath('../../etc', cfg)
    } catch (e) {
      expect((e as SandboxError).code).toBe('ESCAPE')
    }
  })

  it('绝对路径默认拒绝(ABSOLUTE)', () => {
    expect(() => resolveSandboxPath('C:\\Windows\\system32', cfg)).toThrow(SandboxError)
  })

  it('allow_absolute_path=true 时绝对路径仍受沙箱约束(在根内允许,根外拒绝)', () => {
    const relaxed = { ...cfg, allow_absolute_path: true }
    const inside = resolveSandboxPath(path.join(root, 'sub', 'a.txt'), relaxed)
    expect(inside.relativePath.replace(/\\/g, '/')).toBe('sub/a.txt')
    expect(() => resolveSandboxPath('C:\\Windows\\system32', relaxed)).toThrow(SandboxError)
  })

  it('软链接指向沙箱外被拒绝(SYMLINK)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
    try {
      fs.symlinkSync(path.join(outside), path.join(root, 'sub', 'leak'), linkType)
      expect(() => resolveSandboxPath('sub/leak/secret.txt', cfg)).toThrow(SandboxError)
      try {
        resolveSandboxPath('sub/leak/secret.txt', cfg)
      } catch (e) {
        expect((e as SandboxError).code).toBe('SYMLINK')
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('allow_symbolic_link=true 时软链接不拦截', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside2-'))
    fs.writeFileSync(path.join(outside, 'ok.txt'), 'x')
    try {
      fs.symlinkSync(path.join(outside), path.join(root, 'sub', 'link'), linkType)
      const r = resolveSandboxPath('sub/link/ok.txt', { ...cfg, allow_symbolic_link: true })
      expect(r.realPath).toContain('ok.txt')
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('断链软链接(指向不存在的外部目录)被拒绝(SYMLINK)', () => {
    const missing = path.join(os.tmpdir(), `outside-missing-${Date.now()}`)
    try {
      fs.symlinkSync(missing, path.join(root, 'sub', 'leak'), linkType)
      expect(() => resolveSandboxPath('sub/leak/x', cfg)).toThrow(SandboxError)
      try {
        resolveSandboxPath('sub/leak/x', cfg)
      } catch (e) {
        expect((e as SandboxError).code).toBe('SYMLINK')
      }
    } finally {
      fs.rmSync(missing, { recursive: true, force: true })
    }
  })

  it('allow_symbolic_link=true 时断链软链接不拦截', () => {
    const missing = path.join(os.tmpdir(), `outside-missing-${Date.now()}`)
    try {
      fs.symlinkSync(missing, path.join(root, 'sub', 'leak'), linkType)
      const r = resolveSandboxPath('sub/leak/x', { ...cfg, allow_symbolic_link: true })
      expect(r.realPath).toContain('x')
    } finally {
      fs.rmSync(missing, { recursive: true, force: true })
    }
  })

  it('尚不存在的深层文件路径可解析(取最近存在祖先做 realpath 校验)', () => {
    const r = resolveSandboxPath('sub/newdir/deep/new.txt', cfg)
    expect(r.realPath).toContain('new.txt')
    expect(r.relativePath.replace(/\\/g, '/')).toBe('sub/newdir/deep/new.txt')
  })

  it('根目录本身解析为 relativePath 空', () => {
    expect(resolveSandboxPath('.', cfg).relativePath).toBe('')
  })

  it('sandbox_root 未配置时拒绝(NO_ROOT)', () => {
    expect(() => resolveSandboxPath('a.txt', { ...cfg, sandbox_root: '' })).toThrow(SandboxError)
  })

  it('空路径拒绝', () => {
    expect(() => resolveSandboxPath('  ', cfg)).toThrow(SandboxError)
  })

  it('sandbox_root 不存在时自动创建', () => {
    const missing = path.join(root, 'not-yet')
    const r = resolveSandboxPath('a.txt', { ...cfg, sandbox_root: missing })
    expect(fs.existsSync(missing)).toBe(true)
    expect(r.realPath).toContain('a.txt')
  })
})
