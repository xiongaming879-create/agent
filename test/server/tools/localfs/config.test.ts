import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadWorkspaceConfig, resetConfigCacheForTest, isLocalFsMode } from '../../../../server/src/tools/localfs/config'

let tmpDir: string
let cfgFile: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('workspace config', () => {
  it('配置文件缺失时回落默认(virtual 模式)', () => {
    const cfg = loadWorkspaceConfig()
    expect(cfg.workspace_mode).toBe('virtual')
    expect(cfg.allow_absolute_path).toBe(false)
    expect(cfg.allow_symbolic_link).toBe(false)
    expect(cfg.allow_dangerous_delete).toBe(false)
    expect(cfg.max_read_bytes).toBe(2 * 1024 * 1024)
    expect(cfg.auto_confirm_high_risk).toBe(false)
    expect(cfg.enable_audit_log).toBe(true)
  })

  it('配置文件损坏(JSON 非法)时回落默认', () => {
    fs.writeFileSync(cfgFile, '{broken json', 'utf-8')
    expect(loadWorkspaceConfig().workspace_mode).toBe('virtual')
  })

  it('读取 local_fs 模式配置', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: 'C:/tmp/sandbox' }), 'utf-8')
    const cfg = loadWorkspaceConfig()
    expect(cfg.workspace_mode).toBe('local_fs')
    expect(cfg.sandbox_root).toBe('C:/tmp/sandbox')
    expect(isLocalFsMode(cfg)).toBe(true)
  })

  it('默认 virtual 模式 isLocalFsMode 为 false', () => {
    expect(isLocalFsMode()).toBe(false)
  })

  it('未知字段不覆盖默认值(部分配置合并)', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs' }), 'utf-8')
    expect(loadWorkspaceConfig().enable_audit_log).toBe(true)
  })
})
