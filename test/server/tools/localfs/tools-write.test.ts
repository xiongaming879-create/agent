import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fsWriteFileTool, fsRmTool, fsCpTool, fsMvTool } from '../../../../server/src/tools/localfs/tools'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'
import { clearPendingForTest } from '../../../../server/src/tools/localfs/confirm'

let root: string
let cfgFile: string
let tmpDir: string
const call = (tool: { invoke: (input: unknown, cfg?: unknown) => Promise<unknown> }, input: Record<string, unknown>, confirm = false) =>
  tool.invoke({ ...input, ...(confirm ? { confirm: true } : {}) }, { configurable: { userId: 'u1' } })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-w-'))
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-wcfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root }), 'utf-8')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
  clearPendingForTest()
  fs.writeFileSync(path.join(root, 'a.txt'), 'v1')
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  clearPendingForTest()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('fs_write_file', () => {
  it('新建文件成功', async () => {
    expect(await call(fsWriteFileTool, { path: 'new.txt', content: 'hello' })).toMatch(/File written/)
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf-8')).toBe('hello')
  })

  it('覆盖已有文件被拦截(CONFIRM_REQUIRED)', async () => {
    const r = await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf-8')).toBe('v1')
  })

  it('确认后覆盖成功', async () => {
    await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' })
    expect(await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' }, true)).toMatch(/File written/)
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf-8')).toBe('v2')
  })

  it('无 pending 时 confirm=true 仍拦截', async () => {
    expect(await call(fsWriteFileTool, { path: 'a.txt', content: 'v3' }, true)).toMatch(/没有待确认/)
  })
})

describe('fs_rm', () => {
  it('删除被拦截需确认', async () => {
    const r = await call(fsRmTool, { path: 'a.txt' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true)
  })

  it('确认后删除成功', async () => {
    await call(fsRmTool, { path: 'a.txt' })
    expect(await call(fsRmTool, { path: 'a.txt' }, true)).toMatch(/Deleted/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false)
  })

  it('禁止删除沙箱根目录', async () => {
    expect(await call(fsRmTool, { path: '.' }, true)).toMatch(/根目录/)
  })

  it('非空目录批量删除默认禁止(allow_dangerous_delete=false)', async () => {
    fs.mkdirSync(path.join(root, 'd'))
    fs.writeFileSync(path.join(root, 'd', 'x.txt'), 'x')
    const r = await call(fsRmTool, { path: 'd' }, true)
    expect(r).toMatch(/批量删除/)
    expect(fs.existsSync(path.join(root, 'd'))).toBe(true)
  })

  it('allow_dangerous_delete=true 时非空目录确认后可删', async () => {
    fs.mkdirSync(path.join(root, 'd2'))
    fs.writeFileSync(path.join(root, 'd2', 'x.txt'), 'x')
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root, allow_dangerous_delete: true }), 'utf-8')
    resetConfigCacheForTest()
    await call(fsRmTool, { path: 'd2' })
    expect(await call(fsRmTool, { path: 'd2' }, true)).toMatch(/Deleted/)
    expect(fs.existsSync(path.join(root, 'd2'))).toBe(false)
  })
})

describe('fs_cp / fs_mv', () => {
  it('cp 复制文件', async () => {
    expect(await call(fsCpTool, { src: 'a.txt', dest: 'copy.txt' })).toMatch(/Copied/)
    expect(fs.readFileSync(path.join(root, 'copy.txt'), 'utf-8')).toBe('v1')
  })

  it('cp 目标已存在需确认', async () => {
    fs.writeFileSync(path.join(root, 'b.txt'), 'other')
    const r = await call(fsCpTool, { src: 'a.txt', dest: 'b.txt' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf-8')).toBe('other')
  })

  it('cp 逃逸拒绝', async () => {
    expect(await call(fsCpTool, { src: '../out.txt', dest: 'in.txt' })).toMatch(/逃逸/)
  })

  it('mv 重命名', async () => {
    expect(await call(fsMvTool, { src: 'a.txt', dest: 'renamed.txt' })).toMatch(/Moved/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'renamed.txt'), 'utf-8')).toBe('v1')
  })

  it('mv 目录含子内容整体移动', async () => {
    fs.mkdirSync(path.join(root, 'dir'))
    fs.writeFileSync(path.join(root, 'dir', 'f.txt'), 'deep')
    await call(fsMvTool, { src: 'dir', dest: 'dir2' }, true)
    expect(fs.readFileSync(path.join(root, 'dir2', 'f.txt'), 'utf-8')).toBe('deep')
  })
})
