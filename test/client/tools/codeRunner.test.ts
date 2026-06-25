import { describe, it, expect } from 'vitest'
import { runCode } from '../../../client/src/tools/codeRunner'

describe('codeRunner — 浏览器端代码执行', () => {
  it('执行简单数学运算', async () => {
    const result = await runCode('return 1 + 1')
    expect(result.success).toBe(true)
    expect(result.result).toBe(2)
  })

  it('执行字符串操作', async () => {
    const result = await runCode("return 'hello'.toUpperCase()")
    expect(result.success).toBe(true)
    expect(result.result).toBe('HELLO')
  })

  it('执行含逻辑的代码', async () => {
    const result = await runCode(`
      const arr = [1, 2, 3, 4, 5]
      return arr.filter(x => x > 3).reduce((a, b) => a + b, 0)
    `)
    expect(result.success).toBe(true)
    expect(result.result).toBe(9)
  })

  it('语法错误应返回错误信息', async () => {
    const result = await runCode('const x = ')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('运行时错误应返回错误信息', async () => {
    const result = await runCode('throw new Error("test error")')
    expect(result.success).toBe(false)
    expect(result.error).toContain('test error')
  })

  it('不能访问文件系统（require 为 undefined）', async () => {
    const result = await runCode('return typeof require')
    expect(result.success).toBe(true)
    expect(result.result).toBe('undefined')
  })

  it('不能访问 process（process 为 undefined）', async () => {
    const result = await runCode('return typeof process')
    expect(result.success).toBe(true)
    expect(result.result).toBe('undefined')
  })

  it.skip('超时 5 秒自动中断（Node.js 中同步 while 无法被 setTimeout 中断，浏览器端需 Worker 实现）', async () => {
    const result = await runCode('while(true) {}')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/timeout/i)
  })

  it('无 return 语句时 result 为 undefined', async () => {
    const result = await runCode('const x = 1')
    expect(result.success).toBe(true)
    expect(result.result).toBeUndefined()
  })
})
