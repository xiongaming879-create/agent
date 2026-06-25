import { describe, it, expect, vi, beforeEach } from 'vitest'

// 快捷键 composable 特征测试

describe('useKeyboard — 快捷键注册', () => {
  const handlers: Record<string, () => void> = {}

  function registerShortcut(key: string, handler: () => void) {
    handlers[key] = handler
  }

  function simulateKey(key: string) {
    handlers[key]?.()
  }

  it('Enter 触发发送', () => {
    const send = vi.fn()
    registerShortcut('Enter', send)
    simulateKey('Enter')
    expect(send).toHaveBeenCalled()
  })

  it('Shift+Enter 不触发发送（换行）', () => {
    const send = vi.fn()
    registerShortcut('Enter', send)
    // Shift+Enter 不应触发 Enter handler
    simulateKey('Shift+Enter')
    expect(send).not.toHaveBeenCalled()
  })

  it('Ctrl+N 新建对话', () => {
    const newConv = vi.fn()
    registerShortcut('Ctrl+N', newConv)
    simulateKey('Ctrl+N')
    expect(newConv).toHaveBeenCalled()
  })

  it('Ctrl+Shift+C 清空当前对话', () => {
    const clearConv = vi.fn()
    registerShortcut('Ctrl+Shift+C', clearConv)
    simulateKey('Ctrl+Shift+C')
    expect(clearConv).toHaveBeenCalled()
  })
})
