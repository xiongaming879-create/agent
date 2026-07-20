/**
 * LLM 共享配置：模型名 + API 连接信息。
 * 独立此文件避免 agent.ts <-> query-router.ts 循环依赖。
 */

export const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || ''
export const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

/** 轻量模型：CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH 路径 + LLM 分类器 */
export const MODEL_LIGHT = process.env.AGENT_MODEL_LIGHT || 'deepseek-v4-flash'

/** 强模型：COMPLEX 路径 */
export const MODEL_STRONG = process.env.AGENT_MODEL_STRONG || 'glm-5.2'

/** 向后兼容：未配置模型路由时统一用此模型 */
export const MODEL = process.env.AGENT_MODEL || MODEL_LIGHT

export type QueryCategory = 'CHITCHAT' | 'KNOWLEDGE' | 'CALCULATION' | 'SEARCH' | 'COMPLEX'

export type Complexity = 'fast' | 'medium' | 'deep'
