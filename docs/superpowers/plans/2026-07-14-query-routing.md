# 查询分类路由层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `runAgent()` 前插入查询分类路由层，根据查询意图分流到 5 条路径（CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH/COMPLEX），实现工具预选和模型路由，减少简单问题的过度处理。

**Architecture:** 规则优先 + LLM 兜底的分类器判断意图 -> 按类别选择模型 + 过滤工具 -> 分发到对应处理路径。COMPLEX 用强模型(glm-5.2)，其他用轻量模型(deepseek-v4-flash)。KNOWLEDGE 路径内置知识不足时 fallback 到 SEARCH。

**Tech Stack:** TypeScript, LangChain/Anthropic, LangGraph, Express, Vitest

## Design Decisions (已确认)

1. **分类器**：规则优先 + LLM 兜底（LLM 用 deepseek-v4-flash）
2. **KNOWLEDGE 路径**：内置知识不够时 fallback 到 SEARCH 路径
3. **前端复杂度选择器**：恢复 UI 并接通 `complexity` 参数（`fast`/`medium`/`deep`）
4. **模型路由**：COMPLEX 用 `glm-5.2`，其他路径用 `deepseek-v4-flash`

## Global Constraints

- 路由层在 `runAgent()` 入口处插入；前端恢复复杂度选择器 UI 并接通参数
- 分类只看最后一条用户消息，`messages.length > 1` 作为 `hasHistory` 信号
- 规则未命中 -> LLM 兜底分类 -> 仍不确定 -> 默认 COMPLEX
- 任何路径出错 -> fallback 到 COMPLEX 全工具路径
- `complexity` 参数覆盖分类：`fast` 强制轻量、`deep` 强制 COMPLEX、`medium` 走分类
- 模型名通过环境变量可覆盖：`AGENT_MODEL_LIGHT`（默认 deepseek-v4-flash）、`AGENT_MODEL_STRONG`（默认 glm-5.2）
- KNOWLEDGE fallback 信号：LLM 输出 `__FALLBACK_TO_SEARCH__` 时切换到 SEARCH 路径

---

## File Structure

### New files

| 文件 | 职责 |
|------|------|
| `server/src/services/query-router.ts` | `classifyQuery()` 规则+LLM分类、`filterTools()` 工具过滤、`runRoutedAgent()` 路由分发 |
| `server/src/services/llm-caller.ts` | 轻量 LLM 单次调用（流式），供 CHITCHAT/KNOWLEDGE 路径复用 |
| `test/server/services/query-router.test.ts` | 分类器 + 工具过滤 + 路由分发测试 |

### Modified files

| 文件 | 修改内容 |
|------|----------|
| `server/src/services/agent.ts` | `createLangchainAgent` 支持传入 model + tools 参数；`runAgent()` 改为调用 `runRoutedAgent()` |
| `server/src/routes/message.ts` | 接收 `complexity` 参数，传入 `AgentOptions` |
| `server/src/types.ts` | `AgentOptions` 新增 `complexity?: 'fast' \| 'medium' \| 'deep'` |
| `server/src/services/langchain-adapter.ts` | `langchainAgentRunner` 支持 maxIterations 参数覆盖（轻量路径用更少迭代） |
| `client/src/components/ChatInput.vue` | 新增复杂度选择器 UI（快速/标准/深度三档），emit 带上 complexity |
| `client/src/components/ChatArea.vue` | `handleSend` 接收 complexity 并传给 `msgStore.sendMessage` |
| `client/src/stores/message.ts` | `sendMessage` 已支持 complexity（确认）；`regenerateMessage` 新增 complexity 参数 |
| `client/src/types/index.ts` | 如有需要，导出 `Complexity` 类型 |

---

## Task 1: 模型配置 + 类型定义

**Files:**
- Modify: `server/src/services/agent.ts` - 新增 `MODEL_LIGHT` / `MODEL_STRONG` 常量
- Modify: `server/src/types.ts` - `AgentOptions` 新增 `complexity`

**Steps:**
- [ ] 在 `agent.ts` 新增模型常量：
  ```typescript
  const MODEL_LIGHT = process.env.AGENT_MODEL_LIGHT || 'deepseek-v4-flash'
  const MODEL_STRONG = process.env.AGENT_MODEL_STRONG || 'glm-5.2'
  ```
- [ ] 保留 `MODEL` 作为向后兼容（默认等于 MODEL_LIGHT）
- [ ] `types.ts` 中 `AgentOptions` 新增 `complexity?: 'fast' | 'medium' | 'deep'`
- [ ] 测试：环境变量 `AGENT_MODEL_LIGHT` / `AGENT_MODEL_STRONG` 可覆盖默认值

**Test cases:**
- [ ] 无环境变量时 `MODEL_LIGHT === 'deepseek-v4-flash'`，`MODEL_STRONG === 'glm-5.2'`
- [ ] 有环境变量时使用环境变量值

---

## Task 2: 查询分类器 - 规则层

**Files:**
- Create: `server/src/services/query-router.ts`
- Create: `test/server/services/query-router.test.ts`

**Steps:**
- [ ] 定义 `QueryCategory` 类型：`'CHITCHAT' | 'KNOWLEDGE' | 'CALCULATION' | 'SEARCH' | 'COMPLEX'`
- [ ] 实现 `classifyByRules(query: string, hasHistory: boolean): QueryCategory | null`
  - CHITCHAT：`/^(你好|嗨|hi|hello|谢谢|再见|你是谁|你叫什么)/i` 或短文本无问号
  - CALCULATION：含数学运算符/关键词且不含搜索意图词
  - KNOWLEDGE：节假日+年份、相对日期（今天/明天/后天/星期几）
  - SEARCH：搜/查/最新/新闻/机票/价格/赛程/比分/天气/航班/当前/现在
  - COMPLEX：规划/计划/安排/设计/分析/对比/步骤/方案 或 长文本(>50字)
  - 未命中返回 `null`（交给 LLM 兜底）
- [ ] 测试各类别规则匹配

**Test cases:**
- [ ] `"你好"` -> CHITCHAT
- [ ] `"根号5加根号9"` -> CALCULATION
- [ ] `"2026中秋几号"` -> KNOWLEDGE
- [ ] `"后天是星期几"` -> KNOWLEDGE
- [ ] `"后天世界杯赛程"` -> SEARCH
- [ ] `"规划13天西藏行程"` -> COMPLEX
- [ ] `"帮我查一下深圳天气"` -> SEARCH
- [ ] `"计算 x^2 的导数"` -> CALCULATION（不误判为 SEARCH，虽然含"计算"）
- [ ] 短文本无问号 `"好的"` -> CHITCHAT
- [ ] 未命中 `"分析一下这个问题的根源"` -> null（交给 LLM）

---

## Task 3: 查询分类器 - LLM 兜底层

**Files:**
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [ ] 实现 `classifyByLLM(query: string): Promise<QueryCategory>`
  - 用 `MODEL_LIGHT`（deepseek-v4-flash）单次调用
  - Prompt：输出一个类别标签（CHITCHAT/KNOWLEDGE/CALCULATION/SEARCH/COMPLEX）
  - 解析 LLM 输出，提取标签；解析失败默认 COMPLEX
- [ ] 实现 `classifyQuery(query, hasHistory): Promise<QueryCategory>`
  - 先调 `classifyByRules`，命中则返回
  - 未命中调 `classifyByLLM`
  - LLM 调用失败默认 COMPLEX
- [ ] 测试 LLM 兜底（mock fetch）

**Test cases:**
- [ ] 规则命中时不调用 LLM（mock 验证 fetch 未被调用）
- [ ] 规则未命中时调用 LLM，解析返回的标签
- [ ] LLM 返回乱码时默认 COMPLEX
- [ ] LLM 调用失败（网络错误）时默认 COMPLEX

---

## Task 4: 工具过滤

**Files:**
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [ ] 定义各类别的工具白名单：
  ```typescript
  const TOOL_FILTERS: Record<QueryCategory, string[] | null> = {
    CHITCHAT: [],           // 无工具
    KNOWLEDGE: [],          // 无工具
    CALCULATION: ['calculator'],
    SEARCH: ['search', 'fetch', 'browser_*'],
    COMPLEX: null,          // 全部
  }
  ```
- [ ] 实现 `filterTools(allLcTools, filter): DynamicStructuredTool[]`
  - `null` 返回全部
  - `[]` 返回空数组
  - `['calculator']` 精确匹配
  - `['browser_*']` 正则前缀匹配
- [ ] 测试过滤逻辑

**Test cases:**
- [ ] `null` -> 返回全部工具
- [ ] `[]` -> 返回空数组
- [ ] `['calculator']` -> 只含 calculator
- [ ] `['search', 'fetch', 'browser_*']` -> 含 search/fetch + 所有 browser_ 开头工具
- [ ] 不含无关工具（如 filesystem_read、maps_*）

---

## Task 5: 轻量 LLM 调用器

**Files:**
- Create: `server/src/services/llm-caller.ts`

**Steps:**
- [ ] 实现 `streamLLM(messages, systemPrompt, model): AsyncGenerator<AgentEvent>`
  - 复用 `streamAnthropic` 的流式解析逻辑，但支持传入 model 参数
  - 输出 `content_delta` 事件（无 thought、无工具）
  - 结束时输出 `done`
- [ ] 测试流式输出

**Test cases:**
- [ ] 流式输出 content_delta 事件
- [ ] 使用传入的 model 参数（mock 验证请求 body 含正确 model）
- [ ] API 错误时输出错误 thought + done

---

## Task 6: CHITCHAT 路径

**Files:**
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [ ] 实现 `runChitchat(messages, options): AsyncGenerator<AgentEvent>`
  - 模型：`MODEL_LIGHT`
  - 工具：无
  - Prompt：极简（语言规则 + 基本回答要求，不注入工具列表/搜索策略/知识库）
  - 调用 `streamLLM`
- [ ] 测试

**Test cases:**
- [ ] "你好" -> 流式输出回答，无 action/observation 事件
- [ ] 不注入工具列表（prompt 不含 "Available tools"）

---

## Task 7: KNOWLEDGE 路径（含 SEARCH fallback）

**Files:**
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [ ] 实现 `runKnowledge(messages, options): AsyncGenerator<AgentEvent>`
  - 模型：`MODEL_LIGHT`
  - 工具：无
  - Prompt：`buildDateContext()` + `buildKnowledgeContext()` + "用内置知识回答，不搜索"
  - 关键：prompt 指示"如果内置知识不足以回答，输出 `__FALLBACK_TO_SEARCH__`"
- [ ] 检测 fallback 信号：收集完整输出，若包含 `__FALLBACK_TO_SEARCH__` 则切换到 `runSearch()`
- [ ] fallback 时：重新走 SEARCH 路径，丢弃 KNOWLEDGE 的输出
- [ ] 测试

**Test cases:**
- [ ] "2026中秋几号" -> 直接用内置知识回答，不输出 fallback 信号
- [ ] 内置知识不足时（mock LLM 输出 `__FALLBACK_TO_SEARCH__`）-> 切换到 SEARCH 路径
- [ ] fallback 时 KNOWLEDGE 的部分输出不发给前端（或发 thought 说明切换）

---

## Task 8: CALCULATION 路径

**Files:**
- Modify: `server/src/services/query-router.ts`
- Modify: `server/src/services/agent.ts` - `createLangchainAgent` 支持参数

**Steps:**
- [ ] `agent.ts` 重构 `createLangchainAgent(options?: { model?: string; tools?: DynamicStructuredTool[]; systemPrompt?: string })`
  - 默认 model = MODEL_STRONG，tools = 全部
  - 可传入 model 和过滤后的 tools
- [ ] 实现 `runCalculation(messages, options): AsyncGenerator<AgentEvent>`
  - 模型：`MODEL_LIGHT`
  - 工具：仅 `calculator`（用 `filterTools`）
  - Prompt：计算器使用说明 + 日期/知识上下文（不含搜索策略）
  - 调用 `langchainAgentRunner`（maxIterations 用较小值如 10）
- [ ] 测试

**Test cases:**
- [ ] "根号5加根号9" -> 调用 calculator，返回计算结果
- [ ] 工具列表只含 calculator（mock 验证 createReactAgent 收到的 tools）
- [ ] 不调用 search/fetch

---

## Task 9: SEARCH 路径

**Files:**
- Modify: `server/src/services/query-router.ts`

**Steps:**
- [ ] 实现 `runSearch(messages, options): AsyncGenerator<AgentEvent>`
  - 模型：`MODEL_LIGHT`
  - 工具：`['search', 'fetch', 'browser_*']`（用 `filterTools`）
  - Prompt：现有搜索策略 prompt（含日期上下文 + 搜索策略 + 停止规则）
  - 调用 `langchainAgentRunner`（maxIterations = 50）
- [ ] 测试

**Test cases:**
- [ ] 工具列表含 search/fetch/browser_*，不含 calculator/filesystem/maps
- [ ] 使用 MODEL_LIGHT
- [ ] 复用搜索停止检测逻辑

---

## Task 10: COMPLEX 路径 + 模型路由

**Files:**
- Modify: `server/src/services/query-router.ts`
- Modify: `server/src/services/agent.ts`

**Steps:**
- [ ] 实现 `runComplex(messages, options): AsyncGenerator<AgentEvent>`
  - 模型：`MODEL_STRONG`（glm-5.2）
  - 工具：全部
  - Prompt：现有完整 prompt
  - 调用 `langchainAgentRunner`（maxIterations = 50）
  - 复用现有后置校验逻辑
- [ ] 确认这是现有 `runAgentLangchain` 的等价路径，只是明确用 MODEL_STRONG

**Test cases:**
- [ ] 使用 MODEL_STRONG（glm-5.2）
- [ ] 工具列表完整
- [ ] 复用后置校验（validateAnswer）

---

## Task 11: 路由分发器

**Files:**
- Modify: `server/src/services/query-router.ts`
- Modify: `server/src/services/agent.ts` - `runAgent()` 改为调用路由

**Steps:**
- [ ] 实现 `runRoutedAgent(messages, options): AsyncGenerator<AgentEvent>`
  - 提取最后一条 user 消息
  - 处理 `complexity` 覆盖：
    - `fast` -> 强制 CHITCHAT/KNOWLEDGE（先规则判断，不走 COMPLEX）
    - `deep` -> 强制 COMPLEX
    - `medium`（默认）-> 走分类
  - 调用 `classifyQuery` 获取类别
  - yield thought 事件：`【路由】查询类别: ${category}`
  - switch 分发到对应路径
  - 任何路径抛错 -> fallback 到 `runComplex`
- [ ] `agent.ts` 的 `runAgent()` 改为 `return runRoutedAgent(messages, options)`
- [ ] 保留后置校验在 `runAgent` 外层（对所有路径生效）
- [ ] 测试路由分发

**Test cases:**
- [ ] "你好" -> 路由到 CHITCHAT，thought 显示类别
- [ ] "2026中秋几号" -> 路由到 KNOWLEDGE
- [ ] `complexity: 'deep'` -> 强制 COMPLEX，跳过分类
- [ ] `complexity: 'fast'` -> 不走 COMPLEX
- [ ] 某路径抛错 -> fallback 到 COMPLEX

---

## Task 12: 消息路由接入

**Files:**
- Modify: `server/src/routes/message.ts`

**Steps:**
- [x] `req.body` 解构接收 `complexity`：
  ```typescript
  const { content, parent_id, complexity } = req.body || {}
  ```
- [x] 传入 `AgentOptions`：
  ```typescript
  const agentOptions: AgentOptions = {
    systemPrompt: conv?.system_prompt || undefined,
    complexity: complexity || 'medium',
  }
  ```
- [x] regenerate 路由同样接收 `complexity`
- [x] 测试

**Test cases:**
- [x] 请求带 `complexity: 'fast'` -> agentOptions.complexity === 'fast'
- [x] 请求不带 complexity -> agentOptions.complexity === 'medium'

---

## Task 13: 前端复杂度选择器 UI

**Files:**
- Modify: `client/src/components/ChatInput.vue`

**背景：** `ChatInput.vue` 当前只有 textarea + 发送按钮，emit `send: [content: string]`。需要新增三档复杂度选择器。

**Steps:**
- [x] 新增 `complexity` 响应式状态，默认 `'medium'`
- [x] 在 textarea 上方或左侧加三档选择器 UI：
  - `fast`（快速）：轻量回答，不深度推理
  - `medium`（标准）：默认，走智能分类路由
  - `deep`（深度）：强制全工具 + 强模型
  - UI 样式：与现有黑白简约风格一致，三段式按钮或下拉，选中态高亮
- [x] emit 改为 `send: [content: string, complexity: Complexity]`
- [x] 流式输出时选择器禁用（与 textarea 一起 `:disabled="disabled"`）
- [x] 测试组件渲染 + 事件

**Test cases:**
- [x] 默认选中 `medium`
- [x] 点击 `fast` -> complexity 状态变 `fast`
- [x] 点击发送 -> emit 带上当前 complexity
- [x] `disabled` 时选择器不可点

---

## Task 14: 前端接通 complexity 参数

**Files:**
- Modify: `client/src/components/ChatArea.vue`
- Modify: `client/src/stores/message.ts`

**背景：** `sendMessage` 已支持 `complexity` 参数并发送，但 `ChatArea.handleSend` 没传。`regenerateMessage` 完全没接 complexity。

**Steps:**
- [x] `ChatArea.vue` 的 `handleSend` 签名改为 `handleSend(content: string, complexity: Complexity)`
- [x] 调用 `msgStore.sendMessage(convStore.activeId!, content, undefined, complexity)`
- [x] 模板里 `<ChatInput @send="handleSend" />` 确保事件参数自动透传
- [x] `message.ts` 的 `regenerateMessage` 新增 `complexity?: Complexity` 参数
- [x] regenerate 请求 body 加 `complexity: complexity || 'medium'`
- [x] `ChatArea.vue` 的 `handleRegenerate` 传入当前 complexity（可用 ref 共享 ChatInput 的状态，或独立状态）
- [x] 测试

**Test cases:**
- [x] `handleSend("你好", "fast")` -> `sendMessage` 收到 complexity='fast'
- [x] `sendMessage` 请求 body 含 `complexity: 'fast'`
- [x] `regenerateMessage(convId, msgId, 'deep')` -> 请求 body 含 `complexity: 'deep'`
- [x] regenerate 不传 complexity -> body 含 `complexity: 'medium'`

---

## Task 15: 端到端集成测试

**Files:**
- Create or modify: `test/server/services/query-router.test.ts`

**Steps:**
- [x] 各类别端到端测试（mock LLM + 工具）
- [x] fallback 链路测试（KNOWLEDGE -> SEARCH）
- [x] complexity 覆盖测试
- [x] 错误 fallback 测试

**Test cases:**
- [x] CHITCHAT: "你好" -> 无工具调用，直接回答
- [x] KNOWLEDGE: "2026国庆几号" -> 内置知识回答，无搜索
- [x] KNOWLEDGE fallback: 内置知识不足 -> 切换 SEARCH
- [x] CALCULATION: "根号5加根号9" -> 仅 calculator
- [x] SEARCH: "后天世界杯赛程" -> 仅搜索类工具
- [x] COMPLEX: "规划13天西藏行程" -> 全部工具，用 MODEL_STRONG
- [x] `complexity: 'deep'` + "你好" -> 强制 COMPLEX
- [x] 路径出错 -> fallback COMPLEX
- [x] 前端选 `fast` 发送"规划行程" -> 请求 body complexity='fast'，后端强制轻量路径
- [x] 前端 regenerate 带 `deep` -> 请求 body complexity='deep'

---

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| 规则分类误判（如"计算一下人生"误判 CALCULATION） | 规则需同时匹配数学运算符；LLM 兜底纠正 |
| KNOWLEDGE fallback 信号被 LLM 包在回答里 | prompt 明确"只输出 `__FALLBACK_TO_SEARCH__`，不加其他内容"；检测时用 `includes` |
| 模型路由增加复杂度 | 模型名通过环境变量配置，默认值合理 |
| 路由层增加延迟 | 规则分类零延迟；LLM 兜底仅在规则未命中时触发（少数 case） |
| 前端复杂度选择器增加 UI 复杂度 | 三段式按钮，与现有黑白风格一致；流式时禁用 |
| 现有功能回归 | COMPLEX 路径 = 现有 `runAgentLangchain` 不变，只是明确模型 |
| 现有功能回归 | COMPLEX 路径 = 现有 `runAgentLangchain` 不变，只是明确模型 |
