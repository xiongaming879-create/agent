import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fsReadFileTool, fsListDirTool, fsMkdirTool, fsStatTool } from '../../../../server/src/tools/localfs/tools'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'

let root: string
let cfgFile: string
let tmpDir: string
// DynamicStructuredTool 的 func 通过 .invoke() 调用
const call = (tool: { invoke: (input: unknown) => Promise<unknown> }, input: unknown, userId = 'u1') =>
  tool.invoke({ ...input as Record<string, unknown> }, { configurable: { userId } })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tools-'))
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-cfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root }), 'utf-8')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello world')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'nested')
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('fs_read_file', () => {
  it('读取文本文件内容', async () => {
    expect(await call(fsReadFileTool, { path: 'a.txt' })).toBe('hello world')
  })

  it('不存在文件友好报错', async () => {
    expect(await call(fsReadFileTool, { path: 'nope.txt' })).toMatch(/文件不存在/)
  })

  it('超过 max_read_bytes 拒绝', async () => {
    fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(2 * 1024 * 1024 + 1))
    expect(await call(fsReadFileTool, { path: 'big.txt' })).toMatch(/超过大小限制/)
  })

  it('二进制文件拒绝', async () => {
    fs.writeFileSync(path.join(root, 'img.png'), Buffer.from([1, 0, 2, 0]))
    expect(await call(fsReadFileTool, { path: 'img.png' })).toMatch(/二进制/)
  })

  it('路径逃逸拒绝', async () => {
    expect(await call(fsReadFileTool, { path: '../escape.txt' })).toMatch(/逃逸/)
  })
})

describe('fs_list_dir', () => {
  it('列出目录内容,目录带 / 后缀', async () => {
    const out = await call(fsListDirTool, { path: '.' })
    expect(out).toContain('a.txt')
    expect(out).toContain('sub/')
  })

  it('recursive 遍历含子目录文件', async () => {
    const out = await call(fsListDirTool, { path: '.', recursive: true })
    expect(out).toContain(path.join('sub', 'b.txt').replace(/\\/g, '/') || 'sub/b.txt')
  })

  it('不存在目录报错', async () => {
    expect(await call(fsListDirTool, { path: 'ghost' })).toMatch(/不存在/)
  })
})

describe('fs_mkdir / fs_stat', () => {
  it('创建目录(含多级)', async () => {
    const r = await call(fsMkdirTool, { path: 'x/y/z' })
    expect(r).toMatch(/Created/)
    expect(fs.statSync(path.join(root, 'x', 'y', 'z')).isDirectory()).toBe(true)
  })

  it('stat 返回文件信息 JSON', async () => {
    const out = await call(fsStatTool, { path: 'a.txt' })
    const info = JSON.parse(out as string)
    expect(info.isFile).toBe(true)
    expect(info.size).toBe(11)
    expect(info.modifiedAt).toBeTruthy()
  })

  it('stat 目录 isDirectory=true', async () => {
    const info = JSON.parse((await call(fsStatTool, { path: 'sub' })) as string)
    expect(info.isDirectory).toBe(true)
  })
})

describe('virtual 模式', () => {
  it('virtual 模式下所有 fs_* 工具返回未启用提示', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'virtual' }), 'utf-8')
    resetConfigCacheForTest()
    expect(await call(fsReadFileTool, { path: 'a.txt' })).toMatch(/virtual/)
  })
})
