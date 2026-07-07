import type { AgentEvent, Tool } from '../types'
import { tools as allTools, lcTools } from '../tools'
import { ChatAnthropic } from '@langchain/anthropic'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { wrapAllTools } from './tool-adapter'
import { langchainAgentRunner } from './langchain-adapter'
import { buildMemoryContext } from './memory-recall'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || ''
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
const MODEL = process.env.AGENT_MODEL || 'deepseek-v4-flash'
const USE_LANGCHAIN = process.env.USE_LANGCHAIN !== 'false'

const MAX_ITERATIONS = 25

const KNOWN_TOOL_FORMATS: Record<string, string> = {
  search: 'search(<url>) — Fetch and extract text from a URL',
  filesystem_read: 'filesystem_read(<filepath>) — Read a file from the virtual workspace',
  filesystem_write: 'filesystem_write(<json with path and content>) — Write a file to the virtual workspace',
  filesystem_list: 'filesystem_list(<dirpath>) — List files in a directory',
  filesystem_delete: 'filesystem_delete(<filepath>) — Delete a file from the virtual workspace',
  calculator: 'calculator({ expression }) — 高等数学计算器，支持四则/三角/对数/矩阵/求导/积分/方程求解。白话文请转为标准表达式再调用，如"根号5加根号9"→sqrt(5)+sqrt(9)，"x方的导数"→derivative(\'x^2\',\'x\')',
}

export interface AgentOptions {
  systemPrompt?: string
}

/** Infer the most likely parameter name for a tool based on its name. */
function inferToolParam(toolName: string): string {
  const paramByPattern: Array<[RegExp, string]> = [
    [/^fetch|^browser_navigate/i, 'url'],
    [/^read|^write|^delete|^move|^copy|^edit|^create|^list|^search/i, 'path'],
    [/^search|^query|^find|^lookup|^text_search|^around_search/i, 'query'],
    [/^browser_click|^browser_type|^browser_hover|^browser_drag|^browser_drop/i, 'selector'],
    [/^browser_press|^browser_select/i, 'selector'],
    [/^browser_fill/i, 'form_data'],
    [/^browser_screenshot/i, ''],
    [/^maps_geo|^maps_regeocode|^maps_ip_location|^maps_weather/i, 'location'],
    [/^maps_direction|^maps_distance|^maps_bicycling/i, 'origin_destination'],
    [/^maps_search_detail/i, 'id'],
    [/^read_query|^write_query/i, 'sql'],
    [/^create_table|^list_tables|^describe_table/i, 'table'],
  ]
  for (const [pattern, param] of paramByPattern) {
    if (pattern.test(toolName)) return param
  }
  return 'input'
}

function buildToolListText(): string {
  return allTools.map(t => {
    if (KNOWN_TOOL_FORMATS[t.name]) return `- ${KNOWN_TOOL_FORMATS[t.name]}`
    const param = inferToolParam(t.name)
    if (param) {
      return `- ${t.name}(<${param}>) — ${t.description}`
    }
    return `- ${t.name}() — ${t.description}`
  }).join('\n')
}


function createLangchainAgent(systemPrompt?: string) {
  const llm = new ChatAnthropic({
    modelName: MODEL,
    anthropicApiUrl: ANTHROPIC_BASE_URL,
    anthropicApiKey: ANTHROPIC_AUTH_TOKEN,
    temperature: 0,
    streaming: true,
    maxTokens: 4096,
  })

  const lcAllTools = wrapAllTools(allTools, lcTools)

  const toolList = buildToolListText()
  const systemContent = `你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。

## 语言
- 始终使用与用户提问相同的语言回复。用户用中文则用中文回复，用英文则用英文回复。

## 需求澄清（优先于工具调用）
在执行任何操作前，先分析用户需求：
1. 检查关键信息是否缺失、需求是否模糊、是否存在二义性
2. 若信息不足，直接向用户提问，不要调用工具，等待用户补充
3. 下一轮对话会带上历史上下文，结合补充信息再执行任务

澄清规则：
- 需求宽泛或多步骤任务时，引导用户拆分：列出需要确认的关键点，逐一请用户明确
- 用户前后回答矛盾时，主动指出冲突并请求确认："你之前提到A，现在又提到B，请问以哪个为准？"
- 连续3次追问仍信息不全时，停止追问，基于已有信息给出可选方案供用户选择

## 工具使用
- 需要获取外部信息、执行计算、浏览网页等操作时，调用对应工具
- 不需要工具就能回答的问题，直接回答
- 每次只调用一个工具，等待结果后再决定下一步
- 工具调用失败时，尝试替代方案，不要轻易放弃
- 经过多次尝试仍无法获取有效信息时，如实告知用户

## 浏览器工具使用策略
- 浏览网页时：先 browser_navigate 打开页面，再 browser_snapshot 获取页面内容
- 需要交互时：browser_click 点击元素，browser_fill_form 填写表单
- 截图查看页面：browser_take_screenshot
- 网页可能使用 JS 渲染时，优先使用浏览器工具而非 search

## 数学计算
- 遇到中文/白话文数学题时，先在思考中将题目转为标准数学表达式，再调用 calculator
- 例如："根号5加根号9" → sqrt(5)+sqrt(9)，"x²的导数" → derivative('x^2','x')

## 回答要求
- 回答应准确、清晰、有条理
- 适当使用 markdown 格式：标题、列表、代码块、粗体等
- 代码使用带语言标识的代码块（如 \`\`\`python）
- 基于工具返回内容组织回答，不要编造
- 无法确定时明确说明，不要猜测
- 只基于提供的知识库、工具返回结果、上下文信息回答，**严禁编造任何未提及的信息**。
- 不知道、不确定、没有相关信息时，直接回答「暂无相关信息」，**不许猜测、不许编数据、不许编例子**。
- 所有事实性内容必须标注来源：【来源：xxx】，无来源则不输出。
- 禁止虚构人名、地名、时间、数据、文件、链接、政策、代码逻辑。
- 如果问题超出知识库范围，拒绝回答，不做延伸联想。

## 思考过程
- 简洁聚焦：分析问题 → 判断信息是否充分 → 选择工具 → 解读结果
- 避免重复已有信息，避免冗长推理

Available tools:
${toolList}
${systemPrompt ? `\n${systemPrompt}` : ''}
${buildMemoryContext()}`

  return createReactAgent({ llm, tools: lcAllTools, prompt: systemContent })
}

// LangChain implementation
async function* runAgentLangchain(
  messages: ChatMessage[],
  options?: AgentOptions
): AsyncGenerator<AgentEvent> {
  const agent = createLangchainAgent(options?.systemPrompt)
  yield* langchainAgentRunner(agent, messages, {
    maxIterations: MAX_ITERATIONS,
    systemPrompt: options?.systemPrompt,
  })
}

// --- Legacy implementation (preserved for rollback) ---
import { getToolByName } from '../tools'

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
}

function parseReActOutput(fullText: string) {
  let action: { name: string; input: string } | null = null
  let answer: string | null = null
  const cleaned = stripMarkdown(fullText)
  const actionMatch = cleaned.match(/Action:\s*(\w+)\s*\(([\s\S]*?)\)/)
  if (actionMatch) {
    action = { name: actionMatch[1], input: actionMatch[2].trim() }
  }
  const answerMatch = cleaned.match(/Answer:\s*([\s\S]+?)$/i)
  if (answerMatch && !action) {
    answer = answerMatch[1].trim()
  }
  return { action, answer }
}

function containsToolIntent(text: string): boolean {
  const cleaned = stripMarkdown(text)
  for (const tool of allTools) {
    if (new RegExp(`\\b${tool.name}\\s*\\(`, 'i').test(cleaned)) return true
  }
  return false
}

function detectStuckPattern(observations: string[], threshold: number = 3): boolean {
  if (observations.length < threshold) return false
  const recent = observations.slice(-threshold)
  return recent.every(obs =>
    obs.startsWith('Tool error:') || obs.includes('not found') || obs.includes('Request timeout') || obs.includes('Error:') || obs.length < 20
  )
}

interface StreamChunk { blockType: 'thinking' | 'text'; text: string }

async function* streamAnthropic(messages: ChatMessage[], systemPrompt: string): AsyncGenerator<StreamChunk> {
  const url = `${ANTHROPIC_BASE_URL}/v1/messages`
  const body: Record<string, unknown> = {
    model: MODEL, max_tokens: 4096, temperature: 0, stream: true, messages, system: systemPrompt,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_AUTH_TOKEN,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${errText}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let currentBlockType: 'thinking' | 'text' = 'text'
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (!data || data === '[DONE]') continue
      try {
        const event = JSON.parse(data)
        if (event.type === 'content_block_start') {
          currentBlockType = event.content_block?.type === 'thinking' ? 'thinking' : 'text'
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            yield { blockType: 'thinking', text: delta.thinking }
          } else if (delta?.type === 'text_delta' && delta.text) {
            yield { blockType: 'text', text: delta.text }
          }
        }
      } catch { /* skip */ }
    }
  }
}

function buildLegacySystemPrompt(): string {
  const toolList = buildToolListText()
  return `你是一个智能 AI 助手，能够通过思考和使用工具来回答用户问题。

## 语言
- 始终使用与用户提问相同的语言回复。用户用中文则用中文回复，用英文则用英文回复。

## 输出格式
当需要使用工具时，必须严格按以下格式输出：
Thought: <你的推理过程>
Action: <tool_name>(<input>)

当得出最终答案时，必须严格按以下格式输出：
Thought: <你的推理过程>
Answer: <最终答案>

重要：需要向用户提问时，直接用自然语言输出，不要生成 Action。

## 需求澄清（优先于工具调用）
在执行任何操作前，先分析用户需求：
1. 检查关键信息是否缺失、需求是否模糊、是否存在二义性
2. 若信息不足，直接向用户提问，不要调用工具，等待用户补充
3. 下一轮对话会带上历史上下文，结合补充信息再执行任务

澄清规则：
- 需求宽泛或多步骤任务时，引导用户拆分：列出需要确认的关键点，逐一请用户明确
- 用户前后回答矛盾时，主动指出冲突并请求确认："你之前提到A，现在又提到B，请问以哪个为准？"
- 连续3次追问仍信息不全时，停止追问，基于已有信息给出可选方案供用户选择

## 工具使用
- 需要获取外部信息、执行计算、浏览网页等操作时，调用对应工具
- 不需要工具就能回答的问题，直接输出 Answer
- 每次只调用一个工具，等待 Observation 后再决定下一步
- 工具调用失败时，尝试替代方案，不要轻易放弃
- 经过多次尝试仍无法获取有效信息时，输出：Answer: 目前无法确定

## 浏览器工具使用策略
- 浏览网页时：先 browser_navigate 打开页面，再 browser_snapshot 获取页面内容
- 需要交互时：browser_click 点击元素，browser_fill_form 填写表单
- 截图查看页面：browser_take_screenshot
- 网页可能使用 JS 渲染时，优先使用浏览器工具而非 search

## 数学计算
- 遇到中文/白话文数学题时，先在Thought中将题目转为标准数学表达式，再调用calculator
- 例如："根号5加根号9" → sqrt(5)+sqrt(9)，"x²的导数" → derivative('x^2','x')

## 回答要求
- 回答应准确、清晰、有条理
- 适当使用 markdown 格式：标题、列表、代码块、粗体等
- 代码使用带语言标识的代码块（如 \`\`\`python）
- 基于工具返回内容组织回答，不要编造
- 无法确定时明确说明，不要猜测

## 思考过程
- 简洁聚焦：分析问题 → 判断信息是否充分 → 选择工具 → 解读结果
- 避免重复已有信息，避免冗长推理

Available tools:
${toolList}
${buildMemoryContext()}`
}

async function* runAgentLegacy(
  messages: ChatMessage[],
  _tools: Tool[],
  thirdArg?: string | AgentOptions
): AsyncGenerator<AgentEvent> {
  let maxTurns = MAX_ITERATIONS
  let systemPrompt: string | undefined
  if (typeof thirdArg === 'string') {
    systemPrompt = thirdArg
  } else if (thirdArg && typeof thirdArg === 'object') {
    systemPrompt = thirdArg.systemPrompt
  }
  const apiMessages: ChatMessage[] = [...messages]
  const fullSystemPrompt = [buildLegacySystemPrompt(), systemPrompt || ''].filter(Boolean).join('\n\n')
  let turns = 0
  const observations: string[] = []

  while (turns < maxTurns) {
    turns++
    let thinkingText = ''
    let responseText = ''
    let fullText = ''
    let answerStarted = false
    let answerBuffer = ''

    for await (const chunk of streamAnthropic(apiMessages, fullSystemPrompt)) {
      fullText += chunk.text
      if (chunk.blockType === 'thinking') {
        thinkingText += chunk.text
        yield { type: 'thought_delta', content: chunk.text }
      } else {
        responseText += chunk.text
        if (!answerStarted) {
          answerBuffer += chunk.text
          const answerIdx = answerBuffer.lastIndexOf('Answer:')
          if (answerIdx !== -1) {
            answerStarted = true
            const afterAnswer = answerBuffer.slice(answerIdx + 7)
            if (afterAnswer) yield { type: 'content_delta', content: afterAnswer }
            answerBuffer = ''
          }
        } else {
          yield { type: 'content_delta', content: chunk.text }
        }
      }
    }

    if (thinkingText.trim()) yield { type: 'thought', content: thinkingText.trim() }

    const parsed = parseReActOutput(fullText)
    const isIntermediateTurn = !!(parsed.action || (!parsed.answer && containsToolIntent(responseText)))

    if (isIntermediateTurn) {
      const cleanedResponse = responseText.replace(/Answer:\s*[\s\S]*/g, '').replace(/Thought:\s*/g, '').replace(/Action:\s*\w+\s*\([\s\S]*?\)/g, '').trim()
      if (cleanedResponse) yield { type: 'thought', content: cleanedResponse }
      if (parsed.action) {
        yield { type: 'action', tool_name: parsed.action.name, content: parsed.action.input }
        const tool = getToolByName(parsed.action.name)
        let observation: string
        try {
          observation = tool ? await tool.execute(parsed.action.input) : `Unknown tool: ${parsed.action.name}`
        } catch (err: unknown) {
          observation = `Tool error: ${err instanceof Error ? err.message : String(err)}`
        }
        const isPoorResult = !observation || observation.length < 20 || observation.includes('not found')
        if (isPoorResult) {
          const alternatives = allTools.filter(t => t.name !== parsed.action!.name).slice(0, 3).map(t => t.name)
          if (alternatives.length > 0) observation += `\n提示：该工具未能获取有效内容，你可以尝试其他工具，如 ${alternatives.join('、')}。`
        }
        yield { type: 'observation', content: observation }
        observations.push(observation)
        if (detectStuckPattern(observations)) {
          yield { type: 'thought', content: '连续多次工具执行未获得有效结果，终止循环' }
          yield { type: 'content', content: '目前无法确定' }
          yield { type: 'done' }
          return
        }
        apiMessages.push({ role: 'assistant', content: fullText })
        apiMessages.push({ role: 'user', content: `Observation: ${observation}` })
      } else {
        apiMessages.push({ role: 'assistant', content: fullText })
        apiMessages.push({ role: 'user', content: '请使用正确的格式重新调用工具：Thought: ...\nAction: tool_name(input)' })
      }
    } else if (parsed.answer) {
      yield { type: 'done' }
      return
    } else if (answerStarted) {
      yield { type: 'done' }
      return
    } else {
      const contentToEmit = responseText.trim() || fullText.trim()
      if (contentToEmit) yield { type: 'content_delta', content: contentToEmit }
      yield { type: 'done' }
      return
    }
  }
  yield { type: 'thought', content: `已达到最大循环次数 ${maxTurns} 次，无法继续获取更多信息` }
  yield { type: 'content', content: '目前无法确定' }
  yield { type: 'done' }
}

// --- Fact-check validation ---

interface ValidationResult {
  valid: boolean
  reason?: string
}

async function validateAnswer(answer: string, observations: string[]): Promise<ValidationResult> {
  if (!answer.trim() || observations.length === 0) return { valid: true }

  const judgePrompt = `你是一个严格的事实核查员。判断以下 AI 回答是否完全基于提供的工具执行结果。

## 工具执行结果（观察数据）
${observations.map((o, i) => `--- 观察 ${i + 1} ---\n${o.slice(0, 800)}`).join('\n\n')}

## AI 回答
${answer}

## 核查要求
1. 回答中的每个事实性断言是否都能在观察数据中找到依据？
2. 回答是否引用了未在观察数据中出现的来源、网址、文件名、数据？
3. 回答是否编造了具体数字、人名、地名、文件路径？
4. 回答是否对数据做了超出范围的延伸？

## 输出格式
如果回答完全基于观察数据，输出：是
如果存在编造或无法被观察数据支持的内容，输出：否，并在下一行简要说明问题`

  try {
    const url = `${ANTHROPIC_BASE_URL}/v1/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_AUTH_TOKEN,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0,
        messages: [{ role: 'user', content: judgePrompt }],
      }),
    })
    if (!res.ok) return { valid: true } // 校验失败时放行，避免阻断正常回答

    const data = (await res.json()) as { content: Array<{ type: string; text: string }> }
    const text = data.content?.map(c => c.text).join('') || ''
    const firstLine = text.trim().split('\n')[0].trim()
    const isValid = firstLine === '是'
    const reason = !isValid ? text.replace(/^否\s*\n?/, '').trim() : undefined
    return { valid: isValid, reason }
  } catch {
    return { valid: true }
  }
}

// Public API — switches between LangChain and legacy
export async function* runAgent(
  messages: ChatMessage[],
  _tools: Tool[],
  thirdArg?: string | AgentOptions
): AsyncGenerator<AgentEvent> {
  const options = typeof thirdArg === 'string' ? { systemPrompt: thirdArg } as AgentOptions : thirdArg
  console.log(`[Agent] Using ${USE_LANGCHAIN ? 'LangChain' : 'legacy'} implementation`)

  const inner = USE_LANGCHAIN
    ? runAgentLangchain(messages, options)
    : runAgentLegacy(messages, _tools, thirdArg)

  let allContent = ''
  const allObservations: string[] = []

  for await (const event of inner) {
    if (event.type === 'done') {
      break // 先不 yield done，等校验完
    }
    if (event.type === 'observation') {
      allObservations.push(event.content)
    }
    if (event.type === 'content_delta' || event.type === 'content') {
      allContent += event.content
    }
    yield event
  }

  // 后置校验：检查回答是否编造了未基于工具结果的内容
  if (allContent.trim() && allObservations.length > 0) {
    const result = await validateAnswer(allContent, allObservations)
    if (!result.valid) {
      console.warn(`[Agent] Fact-check failed: ${result.reason}`)
      yield { type: 'thought', content: `【事实核查】回答中存在未基于工具结果的内容：${result.reason || '编造事实'}` }
      yield { type: 'content', content: '暂无相关信息' }
    }
  }

  yield { type: 'done' }
}
