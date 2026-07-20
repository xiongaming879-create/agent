# Query Classification Routing Design

## Problem

当前 Agent 是单路径架构：所有用户查询走同一条管道 `runAgent() -> createReactAgent()`，用同一个模型、同一套工具、同一个 system prompt。这导致几个问题：

1. **简单问题过度处理**：闲聊/常识/日期计算等不需要工具的问题，也走完整 ReAct 循环，浪费工具调用次数和 token
2. **工具选择靠模型盲猜**：模型每次都要从 57 个工具里自己判断该用哪个，弱模型容易选错（如该用内置知识时去搜索、该用 calculator 时去搜索）
3. **无法按复杂度选模型**：简单问题用大模型浪费成本，复杂问题用小模型质量不够
4. **`complexity` 参数是死代码**：前端发送但后端从未接收使用

## Current Architecture

```
用户输入
  ↓
POST /api/conversations/:id/messages
  ↓
runAgent()                              ← 唯一入口
  ↓
createReactAgent(llm, allTools, prompt) ← LangGraph ReAct，LLM 自主选工具
  ↓
单一模型 (AGENT_MODEL) + 全部 57 个工具 + 统一 system prompt
```

**没有路由层**：无查询分类、无模型路由、无工具预选。`complexity` 参数从前端发出但后端 `req.body` 未解构接收。

## Design

### 整体架构

在 `runAgent()` 之前插入一个**查询分类路由层**，根据查询意图分流到不同处理路径：

```
用户输入
  ↓
[QueryRouter] classify(query, history)  ← 新增：分类 + 路由
  ↓
  ├── CHITCHAT     -> 直接 LLM 回答（无工具，轻量 prompt）
  ├── KNOWLEDGE    -> 直接用内置知识回答（无工具，无 LLM 推理循环）
  ├── CALCULATION  -> Agent + 仅 calculator 工具
  ├── SEARCH       -> Agent + 搜索类工具（search/fetch/browser）
  └── COMPLEX      -> Agent + 全部工具（当前主路径）
```

### 分类类别

| 类别 | 意图 | 典型问题 | 路由到 |
|------|------|---------|--------|
| `CHITCHAT` | 闲聊/问候/简单问答 | "你好"、"你是谁"、"谢谢" | 轻量 LLM，无工具 |
| `KNOWLEDGE` | 内置知识可答 | "2026中秋几号"、"国庆放假安排" | 轻量 LLM + 内置知识 prompt，无工具 |
| `CALCULATION` | 数学计算 | "根号5加根号9"、"x²的导数" | Agent + 仅 calculator |
| `SEARCH` | 需要联网搜索 | "后天世界杯赛程"、"深圳到拉萨机票" | Agent + 搜索类工具 |
| `COMPLEX` | 多步骤/复杂推理 | "规划13天西藏行程并预算" | Agent + 全部工具（现有主路径） |

### 分类器实现

两种方案，推荐方案 B：

#### 方案 A：LLM 分类（准确但有延迟）

用一个极短 prompt 让 LLM 输出类别标签：

```typescript
const classifyPrompt = `判断用户查询的意图类别，只输出一个标签：
- CHITCHAT: 闲聊/问候/简单问答，不需要工具或搜索
- KNOWLEDGE: 节假日/日期/常识，内置知识可答
- CALCULATION: 数学计算
- SEARCH: 需要联网获取实时信息
- COMPLEX: 多步骤复杂任务，需要多种工具配合

用户查询: "${query}"
类别:`
```

- 优点：准确，能理解上下文
- 缺点：每次请求多一次 LLM 调用（~200ms），增加延迟
- 适合：弱模型（规则分类不准时）

#### 方案 B：规则 + 关键词分类（推荐，零延迟）

用正则/关键词规则做快速分类，零 LLM 调用：

```typescript
function classifyQuery(query: string, hasHistory: boolean): QueryCategory {
  const q = query.trim()

  // 1. CHITCHAT: 问候/闲聊/纯观点
  if (/^(你好|嗨|hi|hello|谢谢|再见|你是谁|你叫什么)/i.test(q)) return 'CHITCHAT'
  if (q.length < 8 && !/[?？]/.test(q)) return 'CHITCHAT'

  // 2. CALCULATION: 数学表达式
  if (/(根号|平方|导数|积分|计算|等于|加|减|乘|除|sin|cos|sqrt|\d+\s*[+\-*/]\s*\d+)/.test(q)
      && !/搜索|查询|搜一下/.test(q)) return 'CALCULATION'

  // 3. KNOWLEDGE: 节假日/日期（内置知识覆盖）
  if (/(中秋|国庆|春节|端午|清明|劳动节|放假|几号|日期).*(2025|2026|2027)/.test(q)
      || /(今天|明天|后天|昨天|星期几|周几)/.test(q)) return 'KNOWLEDGE'

  // 4. SEARCH: 明确需要联网的信号词
  if (/(搜|搜索|查|查询|最新|新闻|机票|价格|赛程|比分|天气|航班|当前|现在)/.test(q)) return 'SEARCH'

  // 5. COMPLEX: 多步骤/规划类
  if (/(规划|计划|安排|设计|分析|对比|步骤|方案)/.test(q) || q.length > 50) return 'COMPLEX'

  // 6. 默认：有历史上下文走 COMPLEX，否则走 CHITCHAT
  return hasHistory ? 'COMPLEX' : 'CHITCHAT'
}
```

- 优点：零延迟、零成本、可预测
- 缺点：规则有覆盖不到的边界 case
- 适合：大部分场景，可叠加方案 A 兜底

### 路由处理逻辑

```typescript
async function* runRoutedAgent(
  messages: ChatMessage[],
  options: AgentOptions
): AsyncGenerator<AgentEvent> {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  const category = classifyQuery(lastUserMsg?.content || '', messages.length > 1)

  yield { type: 'thought', content: `【路由】查询类别: ${category}` }

  switch (category) {
    case 'CHITCHAT':
      yield* runChitchat(messages, options)        // 轻量 LLM，无工具
      return
    case 'KNOWLEDGE':
      yield* runKnowledge(messages, options)        // LLM + 内置知识 prompt，无工具
      return
    case 'CALCULATION':
      yield* runAgentWithTools(messages, options, ['calculator'])  // 仅 calculator
      return
    case 'SEARCH':
      yield* runAgentWithTools(messages, options, ['search', 'fetch', 'browser_*'])  // 搜索类
      return
    case 'COMPLEX':
      yield* runAgentWithTools(messages, options, null)  // 全部工具（现有主路径）
      return
  }
}
```

### 各路径详细设计

#### CHITCHAT 路径
- **模型**：同 AGENT_MODEL（或可选轻量模型 `AGENT_MODEL_LIGHT`）
- **工具**：无
- **Prompt**：极简，不注入工具列表、不注入搜索策略，只保留语言规则 + 基本回答要求
- **流程**：单次 LLM 调用，流式输出，无 ReAct 循环
- **优点**：闲聊不浪费工具调用次数

#### KNOWLEDGE 路径
- **模型**：同 AGENT_MODEL
- **工具**：无
- **Prompt**：注入 `buildDateContext()` + `buildKnowledgeContext()`，明确"用内置知识回答，不搜索"
- **流程**：单次 LLM 调用，流式输出
- **优点**：日期/节假日问题不触发搜索报错

#### CALCULATION 路径
- **模型**：同 AGENT_MODEL
- **工具**：仅 `calculator`
- **Prompt**：注入计算器使用说明，不注入搜索策略
- **流程**：Agent ReAct 循环，但工具列表只有 calculator
- **优点**：模型不会误调 search

#### SEARCH 路径
- **模型**：同 AGENT_MODEL
- **工具**：search + fetch + browser_*（过滤掉 calculator/filesystem/sqlite/maps 等无关工具）
- **Prompt**：现有搜索策略 prompt
- **流程**：Agent ReAct 循环，复用现有停止检测逻辑
- **优点**：工具列表缩小，模型选择更精准

#### COMPLEX 路径
- **模型**：同 AGENT_MODEL
- **工具**：全部（现有行为）
- **Prompt**：现有完整 prompt
- **流程**：现有 `runAgentLangchain()` 不变
- **优点**：复杂任务不受影响

### 工具过滤机制

`runAgentWithTools` 按白名单/正则过滤工具：

```typescript
function filterTools(
  allLcTools: DynamicStructuredTool[],
  filter: string[] | null  // null = 全部，['calculator'] = 仅这些，['browser_*'] = 正则匹配
): DynamicStructuredTool[] {
  if (!filter) return allLcTools
  return allLcTools.filter(t => {
    return filter.some(pattern => {
      if (pattern.endsWith('_*')) {
        return new RegExp('^' + pattern.slice(0, -2), 'i').test(t.name)
      }
      return t.name === pattern
    })
  })
}
```

### 复杂度参数接通

将前端已有的 `complexity` 参数与路由层结合：

- 前端发送 `complexity: 'fast' | 'medium' | 'deep'`
- 后端接收后：
  - `fast`：强制走 CHITCHAT/KNOWLEDGE 路径，即使用户问复杂问题也用轻量处理
  - `medium`（默认）：走分类路由
  - `deep`：强制走 COMPLEX 路径，跳过分类

```typescript
// message.ts
const { content, parent_id, complexity } = req.body || {}
// ...
const agentOptions: AgentOptions = {
  systemPrompt: conv?.system_prompt || undefined,
  complexity: complexity || 'medium',  // 新增
}
```

### 文件改动

| 文件 | 改动 |
|------|------|
| `server/src/services/query-router.ts` | **新增**：`classifyQuery()` + `runRoutedAgent()` + `filterTools()` |
| `server/src/services/agent.ts` | `runAgent()` 入口改为调用 `runRoutedAgent()`；导出各路径处理函数 |
| `server/src/routes/message.ts` | 接收 `complexity` 参数，传入 `AgentOptions` |
| `server/src/types.ts` | `AgentOptions` 新增 `complexity?: 'fast' \| 'medium' \| 'deep'` |
| `client/src/components/ChatArea.vue` | 恢复复杂度选择器 UI（如果需要） |

### 边界处理

1. **分类不确定**：规则未命中时默认走 COMPLEX（保守，不丢能力）
2. **多轮上下文**：分类只看最后一条用户消息，但 `hasHistory` 作为信号（有历史默认 COMPLEX）
3. **KNOWLEDGE 兜底**：内置知识覆盖不到时，KNOWLEDGE 路径的 LLM 可能编造。prompt 里加"内置知识不足时回答'暂无相关信息'，不要编造"
4. **CALCULATION 误判**：如"帮我算一下人生"不是数学题。规则里要求同时匹配数学运算符才判定
5. **分类可降级**：任何路径执行出错时，fallback 到 COMPLEX 全工具路径

## Acceptance Criteria

- "你好" -> CHITCHAT，不调用任何工具，单次 LLM 回答
- "2026中秋几号" -> KNOWLEDGE，用内置知识回答，不搜索
- "根号5加根号9" -> CALCULATION，仅调用 calculator 工具
- "后天世界杯赛程" -> SEARCH，仅调用 search/fetch/browser 类工具
- "规划13天西藏行程" -> COMPLEX，全部工具可用
- `complexity: 'fast'` -> 强制轻量路径，即使查询复杂
- `complexity: 'deep'` -> 强制 COMPLEX 路径
- 分类规则未命中 -> 默认 COMPLEX，不丢能力
- 任何路径出错 -> fallback 到 COMPLEX

## Trade-offs

| 维度 | 收益 | 代价 |
|------|------|------|
| **延迟** | CHITCHAT/KNOWLEDGE 路径省去 ReAct 循环，响应更快 | 规则分类本身零延迟（方案 B） |
| **成本** | 简单问题不调工具、不用大 prompt，省 token | 分类 LLM 调用（仅方案 A） |
| **准确性** | 工具列表缩小，弱模型选错概率降低 | 规则分类有边界 case |
| **复杂度** | 路径分离，每条路径可独立优化 | 代码量增加，需维护分类规则 |
| **可扩展** | 新增类别只需加 case | 分类规则需要持续维护 |

## Open Questions

1. **分类器用规则还是 LLM？** 推荐规则优先（方案 B），覆盖不到的再用 LLM 兜底（方案 A）。还是直接用 LLM 分类更省心？
2. **KNOWLEDGE 路径要不要完全无工具？** 如果内置知识不够，是直接说"暂无相关信息"，还是 fallback 到 SEARCH？
3. **复杂度选择器 UI 要不要恢复？** 前端曾有设计但没接通，现在恢复还是去掉？
4. **模型路由要不要做？** 当前所有路径用同一模型。要不要 CHITCHAT 用轻量模型、COMPLEX 用强模型？
