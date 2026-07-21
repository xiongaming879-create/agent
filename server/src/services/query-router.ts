/**
 * 查询分类路由层
 * - classifyQuery(): 规则优先 + LLM 兜底分类
 * - filterTools(): 按类别过滤工具
 * - runRoutedAgent(): 路由分发到 5 条路径
 */
import type { AgentEvent } from '../types'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'
import { ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, MODEL_LIGHT, MODEL_STRONG } from './llm-config'
import type { QueryCategory, Complexity } from './llm-config'
import { callLLM, streamLLM } from './llm-caller'
import { buildDateContext, buildKnowledgeContext } from './knowledge'
import { buildMemoryContext } from './memory-recall'
import { wrapAllTools } from './tool-adapter'
import { langchainAgentRunner } from './langchain-adapter'
import { tools as allTools, lcTools } from '../tools'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface AgentOptions {
  systemPrompt?: string
  complexity?: Complexity
  userId?: string
}

// ============================================================================
// Task 2: 规则分类器
// ============================================================================

/**
 * 规则分类：用正则/关键词快速判断查询类别。
 * 返回 null 表示未命中，交给 LLM 兜底。
 */
export function classifyByRules(query: string, hasHistory: boolean): QueryCategory | null {
  const q = query.trim()
  if (!q) return null

  // CHITCHAT: 问候/闲聊/纯观点/极短文本无问号
  if (/^(你好|嗨|hi|hello|hey|谢谢|感谢|再见|拜拜|晚安|早上好|下午好|晚上好|你是谁|你叫什么|你能做什么)/i.test(q)) {
    return 'CHITCHAT'
  }
  if (q.length < 4 && !/[?？]/.test(q)) return 'CHITCHAT'

  // CALCULATION: 含数学运算符/关键词，且不含搜索意图词
  const hasMathSignal = /(根号|平方|立方|导数|积分|方程|矩阵|行列式|sin|cos|tan|sqrt|log|\d+\s*[+\-*/×÷]\s*\d+)/.test(q)
  const hasSearchIntent = /(搜|搜索|查|查询|查找|最新|新闻|价格|赛程|比分|天气)/.test(q)
  if (hasMathSignal && !hasSearchIntent) return 'CALCULATION'

  // KNOWLEDGE: 节假日+年份、相对日期
  if (/(中秋|国庆|春节|端午|清明|劳动节|元旦|除夕|元宵|重阳|腊八)/.test(q)
      && /(2025|2026|2027|几号|日期|放假|哪天)/.test(q)) {
    return 'KNOWLEDGE'
  }
  if (/(今天|明天|后天|昨天|大后天|星期几|周几|几月几号)/.test(q) && !hasSearchIntent) {
    return 'KNOWLEDGE'
  }

  // SEARCH: 明确需要联网的信号词
  if (/(搜|搜索|查一下|查询|查找|最新|新闻|机票|价格|赛程|比分|天气|航班|当前|现在|今天.*发生|近期|最近)/.test(q)) {
    return 'SEARCH'
  }

  // COMPLEX: 多步骤/规划类（"分析"/"比较"过泛，交给 LLM 兜底）
  if (/(规划|计划|安排|设计|对比|步骤|方案|制定|策划)/.test(q)) return 'COMPLEX'
  if (q.length > 50) return 'COMPLEX'

  // 有历史上下文默认 COMPLEX，否则 CHITCHAT
  return null
}

// ============================================================================
// Task 3: LLM 兜底分类器
// ============================================================================

const CLASSIFY_PROMPT = `判断用户查询的意图类别，只输出一个标签，不要输出其他内容：
- CHITCHAT: 闲聊/问候/简单问答，不需要工具或搜索
- KNOWLEDGE: 节假日/日期/常识，内置知识可答
- CALCULATION: 数学计算
- SEARCH: 需要联网获取实时信息
- COMPLEX: 多步骤复杂任务，需要多种工具配合`

/**
 * LLM 兜底分类：规则未命中时调用轻量模型分类。
 * 失败时默认 COMPLEX（保守，不丢能力）。
 */
export async function classifyByLLM(query: string): Promise<QueryCategory> {
  const validCategories: QueryCategory[] = ['CHITCHAT', 'KNOWLEDGE', 'CALCULATION', 'SEARCH', 'COMPLEX']
  try {
    const result = await callLLM(
      [{ role: 'user', content: `用户查询: "${query}"` }],
      CLASSIFY_PROMPT,
      MODEL_LIGHT,
      20
    )
    const trimmed = result.trim().toUpperCase()
    // 提取第一个匹配的类别标签
    for (const cat of validCategories) {
      if (trimmed.includes(cat)) return cat
    }
    return 'COMPLEX'
  } catch {
    return 'COMPLEX'
  }
}

/**
 * 完整分类：规则优先 -> LLM 兜底 -> 默认 COMPLEX
 */
export async function classifyQuery(query: string, hasHistory: boolean): Promise<QueryCategory> {
  const ruleResult = classifyByRules(query, hasHistory)
  if (ruleResult) return ruleResult

  // 规则未命中时的默认：有历史走 COMPLEX，无历史走 LLM 兜底
  if (hasHistory) return 'COMPLEX'
  return classifyByLLM(query)
}

// ============================================================================
// Task 4: 工具过滤
// ============================================================================

/** 各类别的工具白名单：null=全部，[]=无工具，['browser_*']=正则前缀匹配 */
const TOOL_FILTERS: Record<QueryCategory, string[] | null> = {
  CHITCHAT: [],
  KNOWLEDGE: [],
  CALCULATION: ['calculator'],
  SEARCH: ['search', 'fetch', 'browser_*'],
  COMPLEX: null,
}

/**
 * 按白名单过滤工具。
 * - null: 返回全部
 * - []: 返回空数组
 * - ['calculator']: 精确匹配
 * - ['browser_*']: 正则前缀匹配
 */
export function filterTools(
  allTools: DynamicStructuredTool<Record<string, unknown>>[],
  filter: string[] | null
): DynamicStructuredTool<Record<string, unknown>>[] {
  if (filter === null) return allTools
  if (filter.length === 0) return []
  return allTools.filter(tool => {
    return filter.some(pattern => {
      if (pattern.endsWith('_*')) {
        const prefix = pattern.slice(0, -2)
        return new RegExp('^' + prefix, 'i').test(tool.name)
      }
      return tool.name === pattern
    })
  })
}

/** 获取某类别的工具过滤配置 */
export function getToolFilter(category: QueryCategory): string[] | null {
  return TOOL_FILTERS[category]
}

// ============================================================================
// Helpers: LangChain agent 创建 + 工具列表文本
// ============================================================================

const MAX_ITERATIONS_FULL = 50
const MAX_ITERATIONS_LIGHT = 10

function createAgent(model: string, tools: DynamicStructuredTool<Record<string, unknown>>[], systemContent: string) {
  const llm = new ChatAnthropic({
    modelName: model,
    anthropicApiUrl: ANTHROPIC_BASE_URL,
    anthropicApiKey: ANTHROPIC_AUTH_TOKEN,
    temperature: 0,
    streaming: true,
    maxTokens: 4096,
  })
  return createReactAgent({ llm, tools, prompt: systemContent })
}

/** 从 DynamicStructuredTool[] 构建工具列表文本（用于 system prompt） */
function buildToolListFromLcTools(tools: DynamicStructuredTool<Record<string, unknown>>[]): string {
  return tools.map(t => `- ${t.name} - ${t.description}`).join('\n')
}

/** 获取全部 LangChain 工具（内置 + MCP） */
function getAllLcTools(): DynamicStructuredTool<Record<string, unknown>>[] {
  return wrapAllTools(allTools, lcTools)
}

// ============================================================================
// Task 6: CHITCHAT 路径
// ============================================================================

async function* runChitchat(messages: ChatMessage[], options: AgentOptions): AsyncGenerator<AgentEvent> {
  const prompt = `${buildDateContext()}

你是一个智能 AI 助手。用与用户相同的语言回复。
- 简洁友好地回答
- 不需要使用任何工具
- 适当使用 markdown 格式
${options.systemPrompt ? `\n${options.systemPrompt}` : ''}
${buildMemoryContext(options.userId)}`

  yield* streamLLM(messages, prompt, MODEL_LIGHT)
}

// ============================================================================
// Task 7: KNOWLEDGE 路径（含 SEARCH fallback）
// ============================================================================

const FALLBACK_SIGNAL = '__FALLBACK_TO_SEARCH__'

async function* runKnowledge(messages: ChatMessage[], options: AgentOptions): AsyncGenerator<AgentEvent> {
  const prompt = `${buildDateContext()}

${buildKnowledgeContext()}

你是一个智能 AI 助手。用与用户相同的语言回复。

## 回答规则
- 优先使用上方内置知识库回答，不要调用任何工具，不要搜索
- 如果内置知识完全覆盖了用户问题，直接给出准确回答
- **如果内置知识不足以回答**，只输出 ${FALLBACK_SIGNAL}（不要加其他内容）
- 回答简洁清晰，适当使用 markdown
- 事实性内容标注来源：【来源：内置知识库】
${options.systemPrompt ? `\n${options.systemPrompt}` : ''}
${buildMemoryContext(options.userId)}`

  // 缓冲完整输出，检测 fallback 信号
  let fullOutput = ''
  for await (const event of streamLLM(messages, prompt, MODEL_LIGHT)) {
    if (event.type === 'content_delta') {
      fullOutput += event.content
    } else if (event.type === 'done') {
      // 不 yield done，等检测完再决定
    } else {
      yield event // thought 等事件直接透传
    }
  }

  // 检测 fallback 信号
  if (fullOutput.includes(FALLBACK_SIGNAL)) {
    yield { type: 'thought', content: '内置知识不足以回答此问题，切换到搜索路径' }
    yield* runSearch(messages, options)
    return
  }

  // 无 fallback，输出缓存的回答
  if (fullOutput.trim()) {
    yield { type: 'content', content: fullOutput }
  }
  yield { type: 'done' }
}

// ============================================================================
// Task 8: CALCULATION 路径
// ============================================================================

async function* runCalculation(messages: ChatMessage[], options: AgentOptions): AsyncGenerator<AgentEvent> {
  const allLcTools = getAllLcTools()
  const filteredTools = filterTools(allLcTools, ['calculator'])
  const toolList = buildToolListFromLcTools(filteredTools)

  const prompt = `${buildDateContext()}

你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。用与用户相同的语言回复。

## 数学计算
- 遇到中文/白话文数学题时，先在思考中将题目转为标准数学表达式，再调用 calculator
- 例如："根号5加根号9" -> sqrt(5)+sqrt(9)，"x²的导数" -> derivative('x^2','x')

## 回答要求
- 基于计算结果组织回答
- 适当使用 markdown 格式
- 简洁清晰

Available tools:
${toolList}
${options.systemPrompt ? `\n${options.systemPrompt}` : ''}
${buildMemoryContext(options.userId)}`

  const agent = createAgent(MODEL_LIGHT, filteredTools, prompt)
  yield* langchainAgentRunner(agent, messages, { maxIterations: MAX_ITERATIONS_LIGHT })
}

// ============================================================================
// Task 9: SEARCH 路径
// ============================================================================

async function* runSearch(messages: ChatMessage[], options: AgentOptions): AsyncGenerator<AgentEvent> {
  const allLcTools = getAllLcTools()
  const filteredTools = filterTools(allLcTools, ['search', 'fetch', 'browser_*'])
  const toolList = buildToolListFromLcTools(filteredTools)

  const prompt = `${buildDateContext()}

${buildKnowledgeContext()}

你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。用与用户相同的语言回复。

## 工具使用策略
- **按需搜索**：仅当需要实时信息才调用 search/fetch
- **并行调用**：多个独立的搜索/抓取可以同一轮并行调用
- **适时停止**：
  - 获取到足够信息后立即综合回答，不要再多搜
  - 不要用相同关键词反复搜索
  - 搜索类工具总调用不超过 25 次，重复相同输入会被强制拦截
- **搜索容错**：
  - search 超时 -> 简化关键词重试 -> 再失败用已有信息继续
- **工具选择优先级**：
  1. search：搜索关键词，获取结果 + URL
  2. fetch：只在 search 返回具体 URL 后抓取详情，不要猜测 URL
  3. browser_*：仅当页面需要 JS 渲染时才用

## 回答要求
- 基于工具返回内容组织回答，不要编造
- 无法确定时明确说明
- 事实性内容标注来源：【来源：xxx】
- 适当使用 markdown 格式

Available tools:
${toolList}
${options.systemPrompt ? `\n${options.systemPrompt}` : ''}
${buildMemoryContext(options.userId)}`

  const agent = createAgent(MODEL_LIGHT, filteredTools, prompt)
  yield* langchainAgentRunner(agent, messages, { maxIterations: MAX_ITERATIONS_FULL })
}

// ============================================================================
// Task 10: COMPLEX 路径（强模型 + 全工具）
// ============================================================================

async function* runComplex(messages: ChatMessage[], options: AgentOptions): AsyncGenerator<AgentEvent> {
  const allLcTools = getAllLcTools()
  const toolList = buildToolListFromLcTools(allLcTools)

  const prompt = `${buildDateContext()}

${buildKnowledgeContext()}

你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。用与用户相同的语言回复。

## 需求澄清（优先于工具调用）
- 检查关键信息是否缺失、需求是否模糊
- 若信息不足，直接向用户提问，不要调用工具

## 工具使用策略
- **知识优先**：节假日、日期、常识性信息直接用内置知识，不要搜索
- **按需搜索**：仅当需要实时信息才调用 search/fetch
- **并行调用**：多个独立的搜索/抓取可以同一轮并行调用
- **适时停止**：获取到足够信息后立即综合回答，不要用相同关键词反复搜索
- **搜索容错**：search 超时 -> 简化关键词重试 -> 再失败用已有信息继续
- **工具选择优先级**：search 搜关键词 -> fetch 抓 URL -> browser_ 仅用于 JS 渲染页面

## 数学计算
- 遇到中文/白话文数学题时，先转为标准数学表达式，再调用 calculator

## 回答要求
- 回答应准确、清晰、有条理
- 适当使用 markdown 格式
- 基于工具返回内容和内置知识组织回答，不要编造
- 事实性内容标注来源
- 无法确定时明确说明

Available tools:
${toolList}
${options.systemPrompt ? `\n${options.systemPrompt}` : ''}
${buildMemoryContext(options.userId)}`

  const agent = createAgent(MODEL_STRONG, allLcTools, prompt)
  yield* langchainAgentRunner(agent, messages, { maxIterations: MAX_ITERATIONS_FULL })
}

// ============================================================================
// Task 11: 路由分发器
// ============================================================================

/**
 * 查询路由分发器：分类 -> 选模型/工具 -> 分发到对应路径。
 * complexity 覆盖分类：fast 强制轻量、deep 强制 COMPLEX、medium 走分类。
 */
export async function* runRoutedAgent(
  messages: ChatMessage[],
  options: AgentOptions
): AsyncGenerator<AgentEvent> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  const query = lastUserMsg?.content || ''
  const hasHistory = messages.length > 1
  const complexity = options.complexity || 'medium'

  let category: QueryCategory

  // complexity 覆盖
  if (complexity === 'deep') {
    category = 'COMPLEX'
  } else if (complexity === 'fast') {
    // fast: 强制轻量，不走 COMPLEX。规则判断走 CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH
    const ruleResult = classifyByRules(query, hasHistory)
    category = ruleResult && ruleResult !== 'COMPLEX' ? ruleResult : 'KNOWLEDGE'
  } else {
    // medium: 走分类
    category = await classifyQuery(query, hasHistory)
  }

  yield { type: 'thought', content: `【路由】查询类别: ${category}（模型: ${category === 'COMPLEX' ? MODEL_STRONG : MODEL_LIGHT}）` }

  try {
    switch (category) {
      case 'CHITCHAT':
        yield* runChitchat(messages, options)
        return
      case 'KNOWLEDGE':
        yield* runKnowledge(messages, options)
        return
      case 'CALCULATION':
        yield* runCalculation(messages, options)
        return
      case 'SEARCH':
        yield* runSearch(messages, options)
        return
      case 'COMPLEX':
        yield* runComplex(messages, options)
        return
    }
  } catch (err) {
    // 任何路径出错 -> fallback 到 COMPLEX
    const errMsg = err instanceof Error ? err.message : String(err)
    yield { type: 'thought', content: `【路由】${category} 路径出错（${errMsg}），回退到 COMPLEX` }
    yield* runComplex(messages, options)
  }
}
