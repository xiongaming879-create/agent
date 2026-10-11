/**
 * LLM 共享配置：模型名 + API 连接信息（硅基流动 OpenAI 兼容接口）。
 * 独立此文件避免 agent.ts <-> query-router.ts 循环依赖。
 */

import { ChatOpenAI } from '@langchain/openai'

export const LLM_API_KEY = process.env.SILICONFLOW_API_KEY
  || process.env.SILICONFLOW_DEEPSEEK_V4_FLASH
  || process.env.SILICONFLOW_GLM_52
  || process.env.ANTHROPIC_API_KEY
  || process.env.ANTHROPIC_AUTH_TOKEN
  || ''
export const LLM_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn'

/** 轻量模型：CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH 路径 + LLM 分类器 */
export const MODEL_LIGHT = process.env.AGENT_MODEL_LIGHT || 'deepseek-ai/DeepSeek-V4-Flash'

/** 强模型：COMPLEX 路径 */
export const MODEL_STRONG = process.env.AGENT_MODEL_STRONG || 'zai-org/GLM-5.2'

/** 向后兼容：未配置模型路由时统一用此模型 */
export const MODEL = process.env.AGENT_MODEL || MODEL_LIGHT

export type QueryCategory = 'CHITCHAT' | 'KNOWLEDGE' | 'CALCULATION' | 'SEARCH' | 'COMPLEX'

export type Complexity = 'fast' | 'medium' | 'deep'

/** 统一构造 ChatOpenAI（与 query-router createAgent 同款配置），供 PnE Executor 直接 tool-calling */
export function createChatOpenAI(model: string): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey: LLM_API_KEY,
    configuration: { baseURL: `${LLM_BASE_URL}/v1` },
    temperature: 0,
    maxTokens: 4096,
  })
}
