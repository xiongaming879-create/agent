export interface Conversation {
  id: string
  title: string
  system_prompt: string | null
  user_id: string | null
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export interface ThoughtStep {
  type: 'thought' | 'action' | 'observation' | 'plan' | 'evaluation'
  content: string
  tool_name: string | null
  timestamp: string
  call_id?: string | null
  duration_ms?: number
  success?: boolean
}

export interface Message {
  id: string
  conversation_id: string
  parent_id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  thought_steps: ThoughtStep[]
  created_at: string
}

export interface PlanStageSnapshot {
  index: number
  goal: string
  strategy: string
  status: 'pending' | 'running' | 'done' | 'skipped'
  dependsOn: number[]
  outcome?: string
}

export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'thought_delta'; content: string }
  | { type: 'action'; tool_name: string; content: string; call_id?: string }
  | { type: 'observation'; tool_name?: string; content: string; call_id?: string; duration_ms?: number; success?: boolean }
  | { type: 'content'; content: string }
  | { type: 'content_delta'; content: string }
  | { type: 'warning'; content: string }
  | { type: 'plan'; stages: PlanStageSnapshot[] }
  | { type: 'evaluation'; decision: 'continue' | 'achieved' | 'replan' | 'stuck'; reason: string }
  | { type: 'done' }

export interface User {
  id: string
  username: string
  role: 'user' | 'admin'
  avatar: string
  theme: 'light' | 'dark' | 'auto'
  font_size: number
  created_at: string
  updated_at: string
}

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: 'user' | 'admin'
  avatar: string
  theme: 'light' | 'dark' | 'auto'
  font_size: number
  created_at: string
  updated_at: string
}

export interface Tool {
  name: string
  description: string
  execute: (args: string) => Promise<string>
}
