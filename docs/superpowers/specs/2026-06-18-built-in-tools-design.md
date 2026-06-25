# Built-in Tools Design

## Problem

Agent 需要内置工具来执行网页搜索、数学计算和文件操作，且需要安全隔离防止对宿主系统的威胁。

## Design

### 网页抓取 (search)

- Agent 提供 URL，服务端抓取网页内容并解析为纯文本返回
- 实现：Node.js fetch + cheerio 解析 HTML
- 返回内容截断至 4000 字符，避免过长
- 应移除 `script`、`style`、`nav` 等标签内容
- 无效 URL 应抛出错误
- 超时 10 秒

### 代码执行 (code)

- 浏览器端模拟执行 JavaScript 代码
- 使用 `Function` 构造器在受限作用域内执行
- 支持基本数学运算、字符串处理等纯计算任务
- 不支持文件系统、网络请求等副作用操作
- `require` 和 `process` 为 `undefined`
- 执行超时 5 秒自动中断（Node.js 环境下同步 while 无法被 setTimeout 中断，已 skip）
- 无 return 语句时 result 为 `undefined`

### 文件操作 (filesystem)

- 虚拟工作区，限定在服务端 `./workspace/` 目录
- 支持操作：读取文件、写入文件、列出目录、删除文件
- 不可访问工作区之外的宿主文件系统
- 路径规范化防路径穿越（`../` 检测，绝对路径规范化到工作区内）

### 计算器 (calculator)

- DynamicStructuredTool 高等数学表达式求值
- 基础运算：加减乘除、除以零错误
- 三角函数：sin/cos/tan（弧度）、asin 反三角、角度模式 (deg)
- 对数与常数：log/log10/自定义底数/pi/e
- 矩阵运算：行列式 det、逆矩阵 inv
- 符号计算：derivative 求导、integrate 积分、solve 方程、simplify 化简、expand 展开
- 复合表达式：多函数组合、多项连加、括号与优先级、嵌套运算
- 错误处理：无效语法、未知函数、空表达式

## Acceptance Criteria

- search: 有效 HTML → 纯文本，截断 4000 字，移除 script/style/nav
- search: 无效 URL → 抛出错误
- code: 简单数学运算、字符串操作、含逻辑代码均正确执行
- code: 语法错误/运行时错误返回错误信息
- code: `require`/`process` 为 undefined
- filesystem: 路径穿越 `../` 被拒绝，绝对路径规范化
- filesystem: 写入后可读取，列出目录包含已写入文件
- filesystem: 删除后读取抛出错误，不存在文件抛出错误
- calculator: 基础运算、三角函数、对数、矩阵、符号计算正确
- calculator: 无效语法/未知函数/空表达式返回错误

## Changes by File

### `server/src/tools/search.ts`

网页抓取：fetchHtml + cheerio 提取，4000 字截断

### `server/src/tools/filesystem.ts`

虚拟工作区：路径安全 + 文件 CRUD

### `client/src/tools/codeRunner.ts`

浏览器端代码沙箱

### `server/src/tools/calculator.ts`

高等数学计算器

### `server/src/tools/index.ts`

工具注册表

## What This Enables

- Agent 可搜索网页获取实时信息
- 用户可在浏览器内安全执行代码
- Agent 可操作虚拟文件系统
- 高等数学计算能力

## What This Drops

- 代码执行超时 5 秒中断在 Node.js 环境下不可靠（已 skip 测试）
