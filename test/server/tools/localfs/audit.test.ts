import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { audited } from '../../../../server/src/tools/localfs/audit'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'

beforeEach(() => { resetConfigCacheForTest() })
afterEach(() => { resetConfigCacheForTest() })

describe('audited', () => {
  it('成功时输出 fs_audit 日志并返回结果', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await audited({ userId: 'u1', toolName: 'fs_read_file', inputPath: 'a.txt' }, '/root/a.txt', () => 'data')
    expect(r).toBe('data')
    const entry = JSON.parse(spy.mock.calls[0][0] as string)
    expect(entry.event).toBe('fs_audit')
    expect(entry.result).toBe('success')
    expect(entry.toolName).toBe('fs_read_file')
    expect(entry.inputPath).toBe('a.txt')
    expect(entry.realPath).toBe('/root/a.txt')
    expect(entry.userId).toBe('u1')
    spy.mockRestore()
  })

  it('异常时输出 error 日志并原样上抛', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      audited({ userId: 'u1', toolName: 'fs_rm', inputPath: 'a' }, '/root/a', async () => { throw new Error('disk fail') })
    ).rejects.toThrow('disk fail')
    const entry = JSON.parse(spy.mock.calls[0][0] as string)
    expect(entry.result).toBe('error')
    expect(entry.error).toBe('disk fail')
    spy.mockRestore()
  })
})
