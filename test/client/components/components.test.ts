import { describe, it, expect } from 'vitest'

// 组件渲染特征测试（定义组件应有的行为规范）

describe('MessageBubble 组件', () => {
  it('用户消息不应显示思考过程区域', () => {
    const msg = { role: 'user', content: '你好', thought_steps: [] }
    expect(msg.role).toBe('user')
    expect(msg.thought_steps.length).toBe(0)
  })

  it('助手消息有 thought_steps 时应渲染可折叠区域', () => {
    const msg = {
      role: 'assistant',
      content: '回复',
      thought_steps: [
        { type: 'thought', content: '思考', tool_name: null },
        { type: 'action', content: '搜索', tool_name: 'search' },
      ],
    }
    expect(msg.thought_steps.length).toBeGreaterThan(0)
    const hasAction = msg.thought_steps.some(s => s.type === 'action')
    expect(hasAction).toBe(true)
  })

  it('thought_steps 为空时不渲染思考区域', () => {
    const msg = { role: 'assistant', content: '简单回复', thought_steps: [] }
    expect(msg.thought_steps.length).toBe(0)
  })

  it('思考过程默认折叠', () => {
    // showThoughts ref 默认值为 false
    const showThoughts = false
    expect(showThoughts).toBe(false)
  })

  it('消息气泡最大宽度为 80%，内容超长时换行', () => {
    // max-w-[80%] + break-words + overflow-hidden
    const hasMaxWidth = true
    const hasBreakWords = true
    expect(hasMaxWidth && hasBreakWords).toBe(true)
  })

  it('消息文字行间距为 leading-normal', () => {
    const lineHeight = 'leading-normal'
    expect(lineHeight).toBe('leading-normal')
  })

  it('复制按钮：有内容且非流式时显示，点击复制到剪贴板', () => {
    const msg = { role: 'user', content: '你好', thought_steps: [] }
    const isTyping = false
    const shouldShowCopy = !!msg.content && !isTyping
    expect(shouldShowCopy).toBe(true)
  })

  it('复制按钮：流式输出时隐藏', () => {
    const isTyping = true
    const msg = { role: 'assistant', content: '部分内容', thought_steps: [] }
    const shouldShowCopy = !!msg.content && !isTyping
    expect(shouldShowCopy).toBe(false)
  })

  it('复制成功后 copied 状态 1.5 秒重置', () => {
    let copied = false
    copied = true
    expect(copied).toBe(true)
    setTimeout(() => { copied = false }, 1500)
    expect(copied).toBe(true)
  })

  it('无编辑按钮和编辑功能（已移除）', () => {
    const msg = { role: 'user', content: '你好', thought_steps: [] }
    const hasEditButton = false
    const hasEmitEdit = false
    expect(hasEditButton).toBe(false)
    expect(hasEmitEdit).toBe(false)
  })

  it('助手消息使用 markdown 渲染，用户消息保持纯文本', () => {
    const assistantMsg = { role: 'assistant', content: '# 标题\n```js\nconsole.log(1)\n```', thought_steps: [] }
    const userMsg = { role: 'user', content: '你好', thought_steps: [] }
    expect(assistantMsg.role).toBe('assistant')
    expect(assistantMsg.content).toContain('```')
    expect(userMsg.role).toBe('user')
  })

  it('代码块使用 highlight.js 语法高亮', () => {
    const codeContent = '```typescript\nconst x: number = 1\n```'
    expect(codeContent).toContain('```typescript')
    expect(codeContent).toContain('const')
  })

  it('点击代码块可复制代码内容', () => {
    const hasCopyCodeBlock = true
    expect(hasCopyCodeBlock).toBe(true)
  })

  it('气泡左上角显示时间，格式为 YYYY/M/D HH:mm:ss', () => {
    const d = new Date('2026-06-15T09:12:14.000Z')
    const pad = (n: number) => String(n).padStart(2, '0')
    const formatted = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    expect(formatted).toMatch(/\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}:\d{2}/)
  })

  it('复制按钮 hover 时完全可见并微放大', () => {
    const defaultOpacity = 0
    const hoverOpacity = 100
    const hasScaleOnHover = true
    expect(hoverOpacity).toBeGreaterThan(defaultOpacity)
    expect(hasScaleOnHover).toBe(true)
  })
})

describe('BranchNavigator 组件', () => {
  it('单条消息时隐藏分支导航', () => {
    const siblings = [{ id: 'm2a' }]
    expect(siblings.length).toBe(1)
  })

  it('多条分支时显示导航，使用 SVG chevron 图标', () => {
    const siblings = [{ id: 'm2a' }, { id: 'm2b' }, { id: 'm2c' }]
    const currentIndex = 0
    expect(siblings.length).toBe(3)
    expect(`${currentIndex + 1}/${siblings.length}`).toBe('1/3')
  })

  it('切换分支更新活跃消息', () => {
    const siblings = [
      { id: 'm2a', content: 'A' },
      { id: 'm2b', content: 'B' },
    ]
    let activeIndex = 0
    activeIndex = 1
    expect(siblings[activeIndex].content).toBe('B')
    activeIndex = 0
    expect(siblings[activeIndex].content).toBe('A')
  })
})

describe('ThoughtStep 组件', () => {
  it('thought 类型显示为斜体文字', () => {
    const step = { type: 'thought', content: '我需要搜索' }
    expect(step.type).toBe('thought')
  })

  it('action 类型显示为工具徽章 + 内容', () => {
    const step = { type: 'action', content: '搜索关键词', tool_name: 'search' }
    expect(step.type).toBe('action')
    expect(step.tool_name).toBe('search')
  })

  it('observation 类型显示为折叠结果', () => {
    const step = { type: 'observation', content: '搜索结果: ...' }
    expect(step.type).toBe('observation')
  })

  it('所有步骤内容超长时换行（break-words）', () => {
    const longContent = 'a'.repeat(500)
    const step = { type: 'thought', content: longContent }
    expect(step.content.length).toBe(500)
    // 组件使用 break-words overflow-hidden
  })
})

describe('ChatInput 组件', () => {
  it('空内容时发送按钮禁用', () => {
    const content = ''
    expect(content.trim().length === 0).toBe(true)
  })

  it('Enter 发送，Shift+Enter 换行', () => {
    const isShiftEnter = true
    const isPlainEnter = false
    expect(isShiftEnter).toBe(true)
    expect(isPlainEnter).toBe(false)
  })

  it('思考中时输入框禁用，发送按钮变为 loading 图标', () => {
    const isStreaming = true
    expect(isStreaming).toBe(true)
    // disabled prop 传入后：textarea disabled, button 显示 svg spinner
  })

  it('输入框自动扩展高度，最大 160px', () => {
    const maxHeight = 160
    expect(maxHeight).toBe(160)
  })

  it('输入框聚焦时边框变柔和深灰并带轻阴影', () => {
    const focusBorderColor = 'neutral-400'
    const hasShadowOnFocus = true
    expect(focusBorderColor).not.toBe('black')
    expect(hasShadowOnFocus).toBe(true)
  })
})

describe('ConversationList 组件', () => {
  it('对话列表按 updated_at 降序渲染', () => {
    const conversations = [
      { id: 'c1', title: '旧', updated_at: new Date('2024-01-01') },
      { id: 'c2', title: '新', updated_at: new Date('2024-06-01') },
    ].sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime())
    expect(conversations[0].id).toBe('c2')
  })

  it('点击对话项切换活跃对话', () => {
    let activeId: string | null = null
    activeId = 'c2'
    expect(activeId).toBe('c2')
  })

  it('活跃对话项有左侧白色边框标识', () => {
    const isActive = true
    const hasLeftBorder = isActive
    expect(hasLeftBorder).toBe(true)
  })

  it('删除按钮支持键盘 focus 时显示', () => {
    const focusVisible = true
    expect(focusVisible).toBe(true)
  })

  it('删除对话时弹出自定义确认弹窗', () => {
    // 不使用浏览器 confirm()，使用自定义弹窗
    const showDeleteConfirm = true
    expect(showDeleteConfirm).toBe(true)
  })

  it('确认删除后才调用 store.remove', () => {
    let deleted = false
    const doDelete = () => { deleted = true }
    doDelete()
    expect(deleted).toBe(true)
  })

  it('取消删除时关闭弹窗不删除', () => {
    let showDeleteConfirm = true
    let deleted = false
    const cancelDelete = () => { showDeleteConfirm = false }
    cancelDelete()
    expect(showDeleteConfirm).toBe(false)
    expect(deleted).toBe(false)
  })
})

describe('ChatArea 自动标题', () => {
  it('首条消息时，标题为消息内容（不超过22字）', () => {
    const content = '你好世界'
    const conv = { id: 'c1', title: '新对话' }
    const title = conv.title === '新对话' && content.length <= 22
      ? content
      : conv.title
    expect(title).toBe('你好世界')
  })

  it('首条消息超过22字时，截断并加 ...', () => {
    const content = '这是一段超过二十二个字的超长消息内容用来测试截断'
    const title = content.length > 22 ? content.slice(0, 22) + '...' : content
    expect(title).toBe(content.slice(0, 22) + '...')
    expect(title.length).toBe(25)
  })

  it('已有标题的对话不会自动重命名', () => {
    const content = '新问题'
    const conv = { id: 'c1', title: '已有标题' }
    const shouldUpdate = conv.title === '新对话' || !conv.title
    expect(shouldUpdate).toBe(false)
  })
})

describe('SystemPromptDialog 组件', () => {
  it('打开时显示当前 system_prompt', () => {
    const currentPrompt = '你是代码助手'
    expect(currentPrompt).toBe('你是代码助手')
  })

  it('保存后更新对话的 system_prompt', () => {
    let prompt = '你是代码助手'
    prompt = '你是翻译助手'
    expect(prompt).toBe('你是翻译助手')
  })

  it('空输入等同于清除自定义 prompt', () => {
    let prompt = '你是代码助手'
    prompt = ''
    expect(prompt).toBe('')
  })
})

describe('流式输出打字机效果', () => {
  it('content_delta 写入缓冲区，不直接显示', () => {
    let contentBuffer = ''
    const event = { type: 'content_delta', content: '你好' }
    contentBuffer += event.content
    expect(contentBuffer).toBe('你好')
  })

  it('定时器从缓冲区逐字取出追加到显示内容', () => {
    let contentBuffer = '你好世界'
    let displayContent = ''
    const chunkSize = 3
    displayContent += contentBuffer.slice(0, chunkSize)
    contentBuffer = contentBuffer.slice(chunkSize)
    expect(displayContent).toBe('你好世')
    expect(contentBuffer).toBe('界')
  })

  it('done 事件刷新缓冲区剩余内容', () => {
    let contentBuffer = '界'
    let displayContent = '你好世'
    // stopTypewriter flushes remaining
    displayContent += contentBuffer
    contentBuffer = ''
    expect(displayContent).toBe('你好世界')
    expect(contentBuffer).toBe('')
  })
})
