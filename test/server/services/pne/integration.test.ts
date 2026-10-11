// test/server/services/pne/integration.test.ts
import { describe, it, expect } from 'vitest'

// 集成测试：需后端运行（cd server && npm run dev）+ 有效 SILICONFLOW_API_KEY。
// 执行方式：去掉 describe.skip 后运行。
describe.skip('PnE 集成（需后端运行）', () => {
  const BASE = 'http://localhost:3001'

  async function login(): Promise<string> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || '',
      }),
    })
    const data = await res.json() as { token: string }
    return data.token
  }

  async function createConversation(token: string): Promise<string> {
    const convRes = await fetch(`${BASE}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    })
    const conv = await convRes.json() as { id: string }
    return conv.id
  }

  it('deep 复杂度走 PnE，事件含 plan/evaluation/content_delta', async () => {
    const token = await login()
    const convId = await createConversation(token)

    const res = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        content: '对比 React、Vue、Svelte 三个框架的状态管理方案，给出选型建议',
        complexity: 'deep',
      }),
    })

    const text = await res.text()
    expect(text).toContain('event: plan')
    expect(text).toContain('event: evaluation')
    expect(text).toContain('event: content_delta')
    expect(text).toContain('event: done')
  })

  it('简单问题分流到 ReAct，不出现 plan 事件', async () => {
    const token = await login()
    const convId = await createConversation(token)

    const res = await fetch(`${BASE}/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: '你好', complexity: 'medium' }),
    })
    const text = await res.text()
    expect(text).not.toContain('event: plan')
  })
})
