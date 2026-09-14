# MinerU 接入设计：扫描版 PDF OCR + 图片解析（RAG）

日期：2026-09-03
状态：已确认

## 背景与目标

当前 RAG 文档解析（`server/src/services/document-extractor.ts`）只支持 `.txt/.md` 直读和 `.pdf` 文本层提取（pdf-parse）。扫描版 PDF（图片型）解析结果为空文本，图片（png/jpg）完全不支持上传。

目标：接入 MinerU 官方托管 API（mineru.net），为扫描版 PDF 和图片提供 OCR/版面解析能力，结果进现有 RAG 索引管线。

## 已确认决策

| 决策点 | 结论 |
|--------|------|
| 部署方式 | MinerU 官方托管 API（token 认证，不上传到自建服务，但有免费额度限制） |
| 触发策略 | 仅扫描版 PDF（pdf-parse 文本层 < 50 字符）和图片走 MinerU；文本层 PDF 原链路不动 |
| 上传模式 | 异步任务 + 前端状态轮询（MinerU 解析分钟级，同步会超时） |
| 图片支持 | 支持 `.png/.jpg/.jpeg` 直接上传，统一走 MinerU |

## 架构

```
上传 POST /api/documents
  ├─ .txt/.md                    → extractText → indexDocument（原同步链路，不动）
  ├─ .pdf 且文本层 ≥ 50 字符      → 原同步链路，不动
  └─ .pdf 扫描版 / .png/.jpg/.jpeg
       → 创建任务 {taskId, status: 'pending'}，立即返回
       → 后台 fire-and-forget：mineru-client（upload → 轮询 → 解 zip 取 full.md）
         → indexDocument（markdown 切块）
       → 状态 pending → done / failed

前端轮询 GET /api/documents/tasks/:taskId → 更新文档列表占位条目
```

## 组件设计

### 1. `server/src/services/mineru-client.ts`（新增）

封装 mineru.net 托管 API：
- `parseFile(fileName: string, buffer: Buffer): Promise<string>` — 上传文件（batch 接口）→ 轮询解析状态 → 下载结果 zip → 解出 `full.md` 返回
- 轮询间隔 5s，总超时 10 分钟，超时/失败抛错
- API token 从环境变量 `MINERU_API_TOKEN` 读取；未配置时 `parseFile` 直接抛错（调用方转任务失败，不阻断其他功能）

### 2. `server/src/services/document-extractor.ts`（修改）

- PDF 分支：pdf-parse 结果 trim 后 < 50 字符 → 抛 `ScannedPdfError`（自定义 Error 子类，路由据此分流）
- 扩展名白名单加 `.png/.jpg/.jpeg`：图片不走 extractText 文本提取，直接由路由分流到 MinerU（新增 `isImageFile(fileName)` 判断）

### 3. `server/src/routes/document.ts`（修改）

- multer 白名单加图片 MIME/扩展名
- 上传逻辑分流：
  - 原同步链路不变（txt/md/文本层 pdf）
  - 捕获 `ScannedPdfError` 或图片文件 → 创建异步任务，立即返回 `{taskId, status: 'pending', fileName}`
- 异步任务：
  - 内存任务表 `Map<taskId, {status: 'pending'|'done'|'failed', userId, fileName, createdAt}>`（ponytail: 不入库，服务重启丢 pending 任务，列表显示失败；升级路径：落主库）
  - 任务 id 用现有 `uuid()` 兼容函数
  - 后台执行：`parseFile` → `indexDocument`（docType：pdf 扫描版沿用 `pdf`，图片为 `image`）→ 更新状态
  - 任务完成/失败后保留 1 小时再清（避免前端轮询拿不到终态）
- 新增 `GET /api/documents/tasks/:taskId` — 校验 userId 归属，返回状态
- `GET /api/documents`（列表）— 合并内存中属于当前用户的非 done 任务条目，使"解析中/失败"可见可删

### 4. 前端 `client/src/stores/document.ts`（修改）

- 上传响应含 `taskId` 时：插入占位条目（status=pending），启动轮询（5s 间隔）
- 终态处理：done → 刷新文档列表；failed → 条目标记失败，提供删除

### 5. 前端 `client/src/components/DocumentManager.vue`（修改）

- 占位条目显示"解析中…"（loading 态）/"解析失败"（红色 + 删除按钮）

## 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| MINERU_API_TOKEN | ❌ | mineru.net 托管 API token；未配置时扫描版/图片上传返回任务失败 |

## 错误处理

- MinerU 失败/超时 → 任务 `failed`，前端可见，不影响已同步链路
- 无 `MINERU_API_TOKEN` → 上传扫描版/图片立即返回任务并直接置 `failed`（错误信息注明缺 token）
- zip 中无 `full.md` → `failed`
- 解析结果空文本 → `failed`（不索引空文档）

## 测试（Vitest，test/ 目录）

1. `mineru-client.test.ts` — mock fetch：上传/轮询/解 zip 成功流；轮询超时；API 失败
2. `document-extractor` 扩展测试 — 扫描版判定（<50 字符抛 `ScannedPdfError`）；`isImageFile` 各扩展名
3. `routes/document` 扩展测试 — 扫描版上传返回 pending + 任务状态流转（mock mineru-client）；图片白名单；列表合并任务条目

## 范围外（YAGNI）

- 任务状态持久化（重启恢复 pending 任务）— 内存 Map 足够，需要时再落库
- MinerU 结果中的图片提取/索引 — 只取 `full.md` 文本
- 版面元素结构化（表格/公式单独索引）— markdown 原文进现有 chunker
- 本地 MinerU 部署 — 托管 API 额度不够时再评估
