import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolvePath, readFile, writeFile, listDir, deleteFile } from '../../../server/src/tools/filesystem'

describe('filesystem 工具 — 虚拟工作区', () => {
  it('路径穿越（../）应被拒绝', () => {
    expect(() => resolvePath('../../../etc/passwd')).toThrow(/path traversal/i)
  })

  it('绝对路径应被规范化到工作区内', () => {
    expect(() => resolvePath('/etc/passwd')).toThrow(/path traversal/i)
  })

  it('正常相对路径应正确解析', () => {
    const resolved = resolvePath('test.txt')
    expect(resolved).toContain('workspace')
    expect(resolved).toContain('test.txt')
  })

  it('写入文件后可读取相同内容', async () => {
    await writeFile('test-write.txt', 'hello world')
    const content = await readFile('test-write.txt')
    expect(content).toBe('hello world')
  })

  it('列出目录应包含已写入的文件', async () => {
    await writeFile('test-list.txt', 'content')
    const files = await listDir('.')
    expect(files).toContain('test-list.txt')
  })

  it('删除文件后读取应抛出错误', async () => {
    await writeFile('test-delete.txt', 'bye')
    await deleteFile('test-delete.txt')
    await expect(readFile('test-delete.txt')).rejects.toThrow(/not found/i)
  })

  it('读取不存在的文件应抛出错误', async () => {
    await expect(readFile('nonexistent-xyz.txt')).rejects.toThrow(/not found/i)
  })

  it('可在子目录中操作', async () => {
    await writeFile('subdir/nested.txt', 'nested content')
    const content = await readFile('subdir/nested.txt')
    expect(content).toBe('nested content')
  })
})
