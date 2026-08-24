import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  logQueryClassified,
  logToolCall,
  logStuckDetected,
  logSearchLimitHit,
  logFactCheck,
  logAgentDone,
  logAgentError,
} from '../../../server/src/services/logger'

interface CapturedEntry {
  timestamp: string
  level: string
  event: string
  [key: string]: unknown
}

let entries: CapturedEntry[] = []
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  entries = []
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    entries.push(JSON.parse(String(args[0])))
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logger 结构化日志', () => {
  it('logQueryClassified 输出 JSON 含 event=query_classified 和 category', () => {
    logQueryClassified({
      conversationId: 'conv-1',
      userId: 'user-1',
      category: 'SEARCH',
      ruleMatched: true,
      durationMs: 12,
    })

    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.event).toBe('query_classified')
    expect(entry.level).toBe('info')
    expect(entry.category).toBe('SEARCH')
    expect(entry.ruleMatched).toBe(true)
    expect(entry.durationMs).toBe(12)
    expect(entry.conversationId).toBe('conv-1')
    expect(entry.userId).toBe('user-1')
  })

  it('logToolCall 输出含 toolName/durationMs/success/outputLength', () => {
    logToolCall({
      conversationId: 'conv-1',
      step: 2,
      toolName: 'search',
      inputPreview: '2026中秋日期',
      outputLength: 1200,
      durationMs: 340,
      success: true,
    })

    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.event).toBe('tool_call')
    expect(entry.toolName).toBe('search')
    expect(entry.step).toBe(2)
    expect(entry.inputPreview).toBe('2026中秋日期')
    expect(entry.outputLength).toBe(1200)
    expect(entry.durationMs).toBe(340)
    expect(entry.success).toBe(true)
  })

  it('logToolCall 失败时 level=warn', () => {
    logToolCall({
      toolName: 'fetch',
      step: 1,
      inputPreview: 'http://x',
      outputLength: 0,
      durationMs: 100,
      success: false,
    })

    expect(entries[0].level).toBe('warn')
  })

  it('logStuckDetected 输出 reason 和 observationCount, level=warn', () => {
    logStuckDetected({ conversationId: 'conv-1', reason: '连续工具失败', observationCount: 3 })

    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('stuck_detected')
    expect(entries[0].level).toBe('warn')
    expect(entries[0].reason).toBe('连续工具失败')
    expect(entries[0].observationCount).toBe(3)
  })

  it('logSearchLimitHit 输出 toolName/callCount/limit, level=warn', () => {
    logSearchLimitHit({ conversationId: 'conv-1', toolName: 'search', callCount: 26, limit: 25 })

    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('search_limit_hit')
    expect(entries[0].level).toBe('warn')
    expect(entries[0].toolName).toBe('search')
    expect(entries[0].callCount).toBe(26)
    expect(entries[0].limit).toBe(25)
  })

  it('logFactCheck valid=true 时 level=info, valid=false 时 level=warn', () => {
    logFactCheck({ conversationId: 'conv-1', valid: true })
    logFactCheck({ conversationId: 'conv-1', valid: false, reason: '编造了数据' })

    expect(entries).toHaveLength(2)
    expect(entries[0].event).toBe('fact_check')
    expect(entries[0].level).toBe('info')
    expect(entries[1].level).toBe('warn')
    expect(entries[1].reason).toBe('编造了数据')
  })

  it('logAgentDone 输出 totalSteps/totalDurationMs/hasContent, level=info', () => {
    logAgentDone({ conversationId: 'conv-1', totalSteps: 4, totalDurationMs: 8200, hasContent: true })

    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('agent_done')
    expect(entries[0].level).toBe('info')
    expect(entries[0].totalSteps).toBe(4)
    expect(entries[0].totalDurationMs).toBe(8200)
    expect(entries[0].hasContent).toBe(true)
  })

  it('logAgentError level=error 且含 message/stack', () => {
    logAgentError({ conversationId: 'conv-1', message: 'LLM timeout', stack: 'Error: LLM timeout\n  at x' })

    expect(entries).toHaveLength(1)
    const entry = entries[0]
    expect(entry.event).toBe('agent_error')
    expect(entry.level).toBe('error')
    expect(entry.message).toBe('LLM timeout')
    expect(entry.stack).toContain('Error')
  })

  it('所有方法输出单行可解析 JSON 且带 ISO timestamp', () => {
    logQueryClassified({ category: 'CHITCHAT', ruleMatched: false, durationMs: 1 })
    logToolCall({ toolName: 't', step: 1, inputPreview: '', outputLength: 0, durationMs: 1, success: true })
    logStuckDetected({ reason: 'r', observationCount: 3 })
    logSearchLimitHit({ toolName: 't', callCount: 2, limit: 1 })
    logFactCheck({ valid: true })
    logAgentDone({ totalSteps: 0, totalDurationMs: 0, hasContent: false })
    logAgentError({ message: 'm' })

    expect(entries).toHaveLength(7)
    for (const entry of entries) {
      expect(() => new Date(entry.timestamp)).not.toThrow()
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
      expect(typeof entry.event).toBe('string')
      expect(['info', 'warn', 'error']).toContain(entry.level)
    }
  })

  it('未提供的可选字段不出现在 JSON 输出中', () => {
    logToolCall({ toolName: 'search', step: 1, inputPreview: '', outputLength: 0, durationMs: 5, success: true })

    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toHaveProperty('conversationId')
    expect(entries[0]).not.toHaveProperty('userId')
  })
})
