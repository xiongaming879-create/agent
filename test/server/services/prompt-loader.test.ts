import { describe, it, expect } from 'vitest'
import { loadPrompt, renderPrompt } from '../../../server/src/services/prompt-loader'

const PATH_PROMPTS = ['chitchat', 'knowledge', 'calculation', 'search', 'complex']
const SHARED_PROMPTS = ['shared/parallel-rules', 'shared/rag-constraints']

describe('prompt 文件外部化', () => {
  it('5 个路径 prompt 文件存在且非空', () => {
    for (const name of PATH_PROMPTS) {
      const content = loadPrompt(name)
      expect(content.trim().length).toBeGreaterThan(0)
    }
  })

  it('共享 prompt 文件存在且非空', () => {
    for (const name of SHARED_PROMPTS) {
      const content = loadPrompt(name)
      expect(content.trim().length).toBeGreaterThan(0)
    }
  })

  it('prompt 文件包含模板变量占位符 {{var}}', () => {
    const search = loadPrompt('search')
    expect(search).toContain('{{toolList}}')
    expect(search).toContain('{{parallelRules}}')
    expect(search).toContain('{{ragConstraints}}')
    expect(search).toContain('{{memoryContext}}')
  })

  it('loadPrompt 缓存:同名二次加载返回同一实例', () => {
    expect(loadPrompt('chitchat')).toBe(loadPrompt('chitchat'))
  })

  it('不存在的 prompt 文件抛出错误(启动时可发现)', () => {
    expect(() => loadPrompt('no-such-prompt')).toThrow()
  })
})

describe('renderPrompt 模板渲染', () => {
  it('替换 {{name}} 变量', () => {
    expect(renderPrompt('{{name}}', { name: 'test' })).toBe('test')
  })

  it('多个变量混合文本替换', () => {
    const template = '今天是 {{dateContext}},可用工具:\n{{toolList}}'
    const result = renderPrompt(template, {
      dateContext: '2026-08-17',
      toolList: '- search - 搜索',
    })
    expect(result).toBe('今天是 2026-08-17,可用工具:\n- search - 搜索')
  })

  it('缺失变量替换为空字符串', () => {
    expect(renderPrompt('a={{a}} b={{b}}', { a: '1' })).toBe('a=1 b=')
  })

  it('未匹配的普通文本保持原样', () => {
    expect(renderPrompt('无占位符 {single} 文本', {})).toBe('无占位符 {single} 文本')
  })
})

describe('各路径渲染后的 prompt 包含工具列表和日期上下文', () => {
  const vars = {
    dateContext: '当前日期: 2026-08-17 星期一',
    knowledgeContext: '## 内置知识库\n(空)',
    parallelRules: loadPrompt('shared/parallel-rules'),
    ragConstraints: loadPrompt('shared/rag-constraints'),
    toolList: '- calculator - 数学计算\n- search - 搜索',
    systemPrompt: '',
    memoryContext: '',
    fallbackSignal: '__FALLBACK_TO_SEARCH__',
  }

  it('search 路径包含工具列表/日期/并行规则/RAG 约束', () => {
    const prompt = renderPrompt(loadPrompt('search'), vars)
    expect(prompt).toContain('- calculator - 数学计算')
    expect(prompt).toContain('当前日期: 2026-08-17 星期一')
    expect(prompt).toContain('强制轮次管控规则')
    expect(prompt).toContain('知识库检索约束')
  })

  it('calculation 路径包含工具列表,不含 RAG 约束', () => {
    const prompt = renderPrompt(loadPrompt('calculation'), vars)
    expect(prompt).toContain('- calculator - 数学计算')
    expect(prompt).not.toContain('知识库检索约束')
  })

  it('knowledge 路径包含 fallback 信号和记忆上下文占位', () => {
    const prompt = renderPrompt(loadPrompt('knowledge'), { ...vars, memoryContext: '## 用户记忆\n用户在深圳' })
    expect(prompt).toContain('__FALLBACK_TO_SEARCH__')
    expect(prompt).toContain('用户在深圳')
  })

  it('chitchat 路径不包含工具列表', () => {
    const prompt = renderPrompt(loadPrompt('chitchat'), vars)
    expect(prompt).not.toContain('Available tools')
  })

  it('complex 路径包含需求澄清和全部约束', () => {
    const prompt = renderPrompt(loadPrompt('complex'), vars)
    expect(prompt).toContain('需求澄清')
    expect(prompt).toContain('强制轮次管控规则')
    expect(prompt).toContain('知识库检索约束')
    expect(prompt).toContain('- search - 搜索')
  })
})
