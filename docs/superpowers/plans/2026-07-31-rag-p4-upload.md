# RAG P4 文档上传 + 优化实现计划

> 对应 spec: `docs/superpowers/specs/2026-07-30-rag-tool-design.md`
> 前置: P1(ES+embedding) + P2(索引管道) + P3(检索+工具化)已完成

## Goal

实现文档上传 API(MD/TXT/PDF -> indexDocument)+ 前端文档管理 UI + score 阈值过滤 + 磁盘水位定时监控 + 历史对话全量回填脚本,完成 RAG 全链路闭环。

## Architecture

```
用户上传文档(MD/TXT/PDF)
  ↓
POST /api/documents (multer 接收)
  ↓
提取文本(MD/TXT: fs.readFile; PDF: pdf-parse)
  ↓
indexDocument(text, userId, sourceType=doc_chunk, meta={docId, fileName, docType})
  ↓
ES rag_index(可被 knowledge_search 检索)

前端: ConversationList 底部"文档管理"入口 -> DocumentManager 弹窗(上传+列表+删除)
后端: GET /api/documents(列表) / DELETE /api/documents/:docId(删除)
```

## Tech Stack

- `multer` ^2.2.0(已装)- 文件上传
- `pdf-parse`(新依赖,纯 JS 无 native)- PDF 文本提取
- `@elastic/elasticsearch` v8 - aggregation(文档列表) + delete_by_query(删除)
- Vue 3 + Pinia - 前端 UI
- Vitest - 测试

## Design Decisions

1. **PDF 提取用 pdf-parse**(纯 JS,无 native 编译,符合项目少 native 依赖原则)
2. **docId 用 `${userId}:${fileName}:${timestamp}`**,保证唯一
3. **文档列表用 ES aggregation**:按 doc_id 聚合,返回 doc_id + file_name + doc_type + chunk_count + uploaded_at
4. **score 阈值默认 0**(不过滤),可通过 `RAG_SCORE_THRESHOLD` 环境变量配置。rerank score 低于阈值过滤
5. **磁盘水位监控每 5 分钟定时检查**,低于 10GB console.warn(P1 的 checkDiskWatermark 复用)
6. **历史对话回填脚本手动运行**(不自动启动),避免服务启动慢
7. **前端 UI 独立 DocumentManager 组件**,从 ConversationList 底部入口打开

## File Structure

```
server/src/
├── routes/
│   └── document.ts          ← 新: 上传/列表/删除
├── services/
│   ├── rag-search.ts        ← 改: score 阈值过滤
│   ├── es-client.ts         ← P1(复用 checkDiskWatermark)
│   └── document-extractor.ts ← 新: MD/TXT/PDF 文本提取
├── index.ts                 ← 改: 注册 documentRouter + 定时磁盘监控
└── scripts/
    └── rag-backfill.ts      ← 新: 历史对话全量回填

client/src/
├── components/
│   └── DocumentManager.vue  ← 新: 上传+列表+删除
├── stores/
│   └── document.ts          ← 新: API 调用
└── components/
    └── ConversationList.vue ← 改: 底部加"文档管理"入口

test/server/
├── routes/document.test.ts  ← 新
└── services/document-extractor.test.ts ← 新
```

## Tasks

### Task 1: 文档上传 API + 文本提取

**Steps**:
1. 装 `pdf-parse`(纯 JS PDF 文本提取)
2. `document-extractor.ts`: `extractText(filePath, mimeType)` -> text
   - MD/TXT: `fs.readFile`
   - PDF: `pdf-parse`
   - 其他: 抛错(不支持的类型)
3. `routes/document.ts`:
   - `POST /api/documents`:multer 单文件 -> extractText -> indexDocument(doc_chunk)
   - `GET /api/documents`:ES aggregation 按 doc_id 聚合,返回文档列表
   - `DELETE /api/documents/:docId`:delete_by_query(doc_id + user_id)
   - authMiddleware 保护
4. `index.ts`: `app.use('/api/documents', documentRouter)`
5. 文件大小限制 10MB,multer 内存存储(不落盘)

**Test cases**:
- extractText: MD/TXT 返回文本
- extractText: PDF 返回文本(mock pdf-parse)
- extractText: 不支持的类型抛错
- POST /api/documents: 上传 -> indexDocument 被调用
- GET /api/documents: 返回聚合列表
- DELETE /api/documents/:docId: delete_by_query 被调用

### Task 2: score 阈值过滤

**Steps**:
1. `rag-search.ts`: `SearchOptions` 加 `scoreThreshold?: number`
2. `hybridSearch`: rerank 后过滤 `score < scoreThreshold` 的 hit
3. 默认从 `process.env.RAG_SCORE_THRESHOLD` 读取(默认 0)
4. 测试: scoreThreshold 过滤低分 hit

### Task 3: 磁盘水位定时监控

**Steps**:
1. `index.ts`: 启动时调 `checkDiskWatermark`(P1 已实现),低于阈值 warn
2. `setInterval` 每 5 分钟检查一次
3. SIGINT/SIGTERM 时 clearInterval

### Task 4: 历史对话全量回填脚本

**Steps**:
1. `server/scripts/rag-backfill.ts`:
   - 遍历所有 conversations
   - 对每个 conversation 调 `indexConversationMessages(convId, userId)`
   - 进度输出 + 错误跳过(不阻断)
   - 完成后输出统计

### Task 5: 前端文档管理 UI

**Steps**:
1. `stores/document.ts`: fetchDocuments / uploadDocument / deleteDocument(API 调用)
2. `DocumentManager.vue`:
   - 文件选择 + 上传按钮
   - 文档列表(file_name + doc_type + chunk_count + uploaded_at)
   - 删除按钮(delete_by_query)
   - 上传中 loading 状态
3. `ConversationList.vue` 底部加"📄 文档管理"按钮,点击打开 DocumentManager 弹窗

### Task 6: 集成验收

**Steps**:
1. `server/scripts/rag-p4-smoke.ts`:
   - 上传一段合同文本(模拟 extractText)
   - indexDocument -> hybridSearch -> 返回带来源
   - 文档列表 API -> 返回上传的文档
   - 删除文档 -> ES 无残留
   - score 阈值过滤验证
2. 端到端:前端上传 -> 检索 -> 返回

**DoD**:
- [x] 文档上传 API(MD/TXT/PDF) + 测试全绿(8 passed)
- [x] score 阈值过滤 + 测试全绿(9 passed)
- [x] 磁盘水位定时监控(5min interval)
- [x] 历史对话回填脚本(rag-backfill.ts)
- [x] 前端文档管理 UI(上传+列表+删除)
- [x] smoke: 上传 -> 检索 -> 删除全链路(score 阈值过滤验证通过)
- [x] 全量测试不回归(412 passed + 18 skipped)
- [x] 无 `any`,ESM

## Risk & Mitigation

| 风险 | 缓解 |
|------|------|
| pdf-parse 安装/兼容问题 | 纯 JS 无 native;如装不上 fallback 只支持 MD/TXT |
| 大文件上传内存溢出 | multer limits 10MB;内存存储 |
| ES aggregation 性能 | 单分片 + user_id filter,数据量小 |
| 前端 UI 样式不协调 | 复用现有黑白主题 Tailwind 类 |
| 回填脚本跑太久 | 逐 conversation 处理,进度输出,错误跳过 |

## 进度

| Task | 状态 | 备注 |
|------|------|------|
| Task 1 上传API+提取 | ✅ | 8 测试全绿(pdf-parse CJS interop 用依赖注入解决) |
| Task 2 score阈值 | ✅ | 9 测试全绿(含阈值过滤) |
| Task 3 磁盘监控 | ✅ | index.ts 定时 5min checkDiskWatermark |
| Task 4 回填脚本 | ✅ | rag-backfill.ts |
| Task 5 前端UI | ✅ | DocumentManager.vue + document store + ConversationList 入口 |
| Task 6 集成验收 | ✅ | smoke:提取+索引+检索+阈值+列表+删除全链路 |
