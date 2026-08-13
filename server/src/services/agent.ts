import type { AgentEvent, Tool } from '../types'
import { LLM_API_KEY, LLM_BASE_URL, MODEL } from './llm-config'
import { runRoutedAgent } from './query-router'

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentOptions {
  systemPrompt?: string
  complexity?: 'fast' | 'medium' | 'deep'
  userId?: string
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
    const url = `${LLM_BASE_URL}/v1/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0,
        messages: [
          { role: 'system', content: judgePrompt },
          { role: 'user', content: '请判断' },
        ],
      }),
    })
    if (!res.ok) return { valid: true }

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> }
    const text = data.choices?.[0]?.message?.content || ''
    const firstLine = text.trim().split('\n')[0].trim()
    const isValid = firstLine === '是'
    const reason = !isValid ? text.replace(/^否\s*\n?/, '').trim() : undefined
    return { valid: isValid, reason }
  } catch {
    return { valid: true }
  }
}

// Public API - routes through query-router
export async function* runAgent(
  messages: ChatMessage[],
  _tools: Tool[],
  thirdArg?: string | AgentOptions
): AsyncGenerator<AgentEvent> {
  const options = typeof thirdArg === 'string' ? { systemPrompt: thirdArg } as AgentOptions : thirdArg

  const inner = runRoutedAgent(messages, options || {})

  let allContent = ''
  const allObservations: string[] = []

  for await (const event of inner) {
    if (event.type === 'done') {
      break
    }
    if (event.type === 'observation') {
      allObservations.push(event.content)
    }
    if (event.type === 'content_delta' || event.type === 'content') {
      allContent += event.content
    }
    yield event
  }

  // 后置校验：检查回答是否编造了未基于工具结果的内容。
  // Agent 会使用内置知识库回答（节假日、常识等），这些内容不在 observations 中，
  // 校验器无法区分"内置知识"和"编造"，容易误判。因此校验失败只记日志，不覆盖/追加回答。
  // "暂无相关信息" 仅由 Agent 自身在确实查不到结果时输出。
  if (allContent.trim() && allObservations.length > 0) {
    const result = await validateAnswer(allContent, allObservations)
    if (!result.valid) {
      console.warn(`[Agent] Fact-check failed: ${result.reason}`)
      yield { type: 'warning', content: result.reason || '回答可能包含未经验证的信息' }
    }
  }

  yield { type: 'done' }
}
