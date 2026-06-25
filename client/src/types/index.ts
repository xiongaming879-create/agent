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
  type: 'thought' | 'action' | 'observation'
  content: string
  tool_name: string | null
  timestamp: string
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

export type AgentEvent =
  | { type: 'thought'; content: string }
  | { type: 'thought_delta'; content: string }
  | { type: 'action'; tool_name: string; content: string }
  | { type: 'observation'; content: string }
  | { type: 'content'; content: string }
  | { type: 'content_delta'; content: string }
  | { type: 'done' }
