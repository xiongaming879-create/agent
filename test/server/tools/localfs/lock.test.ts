import { describe, it, expect } from 'vitest'
import { withPathLock } from '../../../../server/src/tools/localfs/lock'

describe('withPathLock', () => {
  it('同 key 串行执行', async () => {
    const order: number[] = []
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    await Promise.all([
      withPathLock('k', async () => { order.push(1); await sleep(30); order.push(2) }),
      withPathLock('k', async () => { order.push(3); order.push(4) }),
    ])
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('前一个抛错不阻塞后续,且错误正常抛给调用方', async () => {
    await expect(withPathLock('k2', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const r = await withPathLock('k2', () => 'ok')
    expect(r).toBe('ok')
  })

  it('不同 key 并行不互斥', async () => {
    const r = await Promise.all([withPathLock('a', () => 'a'), withPathLock('b', () => 'b')])
    expect(r).toEqual(['a', 'b'])
  })
})
