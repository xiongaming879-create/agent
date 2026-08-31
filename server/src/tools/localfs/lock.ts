const locks = new Map<string, Promise<unknown>>()

// ponytail: 全局内存锁,按 key 串行写/删/移操作防并发冲突;多进程部署需换文件锁
export function withPathLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, settled)
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key)
  })
  return run
}
