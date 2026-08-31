# 本地文件系统模式（local_fs）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留虚拟工作区（virtual）完全可用的前提下，新增本地真实文件系统模式（local_fs），Agent 通过 8 个 `fs_*` 工具在沙箱内安全读写本地文件，含高危确认与审计日志。

**Architecture:** 新增 `server/src/tools/localfs/` 模块层：config（模式/沙箱配置，3s 缓存实现一键切换）→ sandbox（路径逃逸/软链接校验）→ 工具实现（8 个 DynamicStructuredTool）→ 审计（结构化 JSON 日志）→ 高危确认（会话内 pending + confirm 重试）。工具在 `tools/index.ts` 注册进 `lcTools`（原生 tool-calling），执行时按配置分发，virtual 模式返回未启用提示，上层 Agent 逻辑零改动。

**Tech Stack:** Node.js fs/path、zod、@langchain/core DynamicStructuredTool、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-31-local-fs-workspace-design.md`

## Global Constraints

- 原有虚拟工作区代码（`server/src/tools/filesystem.ts` 及 4 个 `filesystem_*` 工具）**完全保留、不修改、不删除**
- 禁止支持绝对路径传入（默认强制相对路径；`allow_absolute_path` 仅放宽"必须相对"这一条，沙箱前缀校验永远生效）
- 禁止跟随软链接逃逸：逻辑层级校验 + realpath 双重校验，`allow_symbolic_link=false` 时软链接逃逸一律拦截
- 高危操作（fs_rm / 覆盖已有文件 / 非空目录批量删除）默认拦截，需会话内用户确认
- 禁止删除沙箱根目录本身
- 所有本地文件操作必须经统一中间层（localfs 模块），禁止在其他代码直接 fs 操作沙箱路径
- 每次操作落审计日志（成功/拦截/异常），复用 `logger.ts` 结构化 JSON 风格
- 服务端 ESM、禁 `any` 用 `unknown`、默认无注释（WHY 不显而易见时一行）
- Commit 格式：`【本地文件】描述`，不主动 push，不跳过 hooks
- 测试在项目根目录 `test/` 下运行（`npx vitest run <file>`），environment: node

**两处 spec 歧义的已定裁决（用户已确认）：**

1. 工具命名：全部 8 个工具按 spec §5 字面命名 `fs_read_file / fs_write_file / fs_list_dir / fs_mkdir / fs_rm / fs_cp / fs_mv / fs_stat`，旧 `filesystem_*` 仅 virtual 模式保留
2. 高危确认：对话内确认 — 首次调用被拦截并返回 `CONFIRM_REQUIRED:` 提示（同时登记 pending），LLM 转告用户；用户同意后 LLM 携带 `confirm=true` 重试放行（10 分钟内有效）。**已知上限（ponytail）：确认是 LLM 介导的，LLM 可在不等用户回复时自行重试；这是对话内确认方案的固有限制，如需强校验将来改 SSE 弹窗**

---

### Task 1: 配置模块 workspace config

**Files:**
- Create: `server/src/tools/localfs/config.ts`
- Create: `server/config/workspace.json`
- Test: `test/server/tools/localfs/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `interface WorkspaceConfig { workspace_mode: 'virtual' | 'local_fs'; sandbox_root: string; allow_absolute_path: boolean; allow_symbolic_link: boolean; allow_dangerous_delete: boolean; max_read_bytes: number; auto_confirm_high_risk: boolean; enable_audit_log: boolean }`
  - `loadWorkspaceConfig(): WorkspaceConfig`（读 `LOCAL_FS_CONFIG_PATH || server/config/workspace.json`，缺失/损坏回落默认，3s 缓存）
  - `resetConfigCacheForTest(): void`
  - `isLocalFsMode(cfg?: WorkspaceConfig): boolean`

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadWorkspaceConfig, resetConfigCacheForTest, isLocalFsMode } from '../../../../server/src/tools/localfs/config'

let tmpDir: string
let cfgFile: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-cfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('workspace config', () => {
  it('配置文件缺失时回落默认(virtual 模式)', () => {
    const cfg = loadWorkspaceConfig()
    expect(cfg.workspace_mode).toBe('virtual')
    expect(cfg.allow_absolute_path).toBe(false)
    expect(cfg.allow_symbolic_link).toBe(false)
    expect(cfg.allow_dangerous_delete).toBe(false)
    expect(cfg.max_read_bytes).toBe(2 * 1024 * 1024)
    expect(cfg.auto_confirm_high_risk).toBe(false)
    expect(cfg.enable_audit_log).toBe(true)
  })

  it('配置文件损坏(JSON 非法)时回落默认', () => {
    fs.writeFileSync(cfgFile, '{broken json', 'utf-8')
    expect(loadWorkspaceConfig().workspace_mode).toBe('virtual')
  })

  it('读取 local_fs 模式配置', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: 'C:/tmp/sandbox' }), 'utf-8')
    const cfg = loadWorkspaceConfig()
    expect(cfg.workspace_mode).toBe('local_fs')
    expect(cfg.sandbox_root).toBe('C:/tmp/sandbox')
    expect(isLocalFsMode(cfg)).toBe(true)
  })

  it('默认 virtual 模式 isLocalFsMode 为 false', () => {
    expect(isLocalFsMode()).toBe(false)
  })

  it('未知字段不覆盖默认值(部分配置合并)', () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs' }), 'utf-8')
    expect(loadWorkspaceConfig().enable_audit_log).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/config.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 config.ts**

```ts
// server/src/tools/localfs/config.ts
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface WorkspaceConfig {
  workspace_mode: 'virtual' | 'local_fs'
  sandbox_root: string
  allow_absolute_path: boolean
  allow_symbolic_link: boolean
  allow_dangerous_delete: boolean
  max_read_bytes: number
  auto_confirm_high_risk: boolean
  enable_audit_log: boolean
}

const DEFAULTS: WorkspaceConfig = {
  workspace_mode: 'virtual',
  sandbox_root: '',
  allow_absolute_path: false,
  allow_symbolic_link: false,
  allow_dangerous_delete: false,
  max_read_bytes: 2 * 1024 * 1024,
  auto_confirm_high_risk: false,
  enable_audit_log: true,
}

const CACHE_TTL_MS = 3000
let cache: { config: WorkspaceConfig; loadedAt: number } | null = null

function configPath(): string {
  return process.env.LOCAL_FS_CONFIG_PATH || path.resolve(__dirname, '../../../config/workspace.json')
}

// 3s 缓存:切换模式改配置文件即生效,无需重启(一键切换),代价是 3s 内旧配置仍生效
export function loadWorkspaceConfig(): WorkspaceConfig {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.config
  let config = { ...DEFAULTS }
  try {
    const file = configPath()
    if (fs.existsSync(file)) {
      config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf-8')) }
    }
  } catch {
    // 配置损坏回落默认 virtual,安全侧优先
  }
  cache = { config, loadedAt: now }
  return config
}

export function resetConfigCacheForTest(): void {
  cache = null
}

export function isLocalFsMode(cfg: WorkspaceConfig = loadWorkspaceConfig()): boolean {
  return cfg.workspace_mode === 'local_fs'
}
```

- [ ] **Step 4: 创建默认配置文件**

```json
// server/config/workspace.json
{
  "workspace_mode": "virtual",
  "sandbox_root": "",
  "allow_absolute_path": false,
  "allow_symbolic_link": false,
  "allow_dangerous_delete": false,
  "max_read_bytes": 2097152,
  "auto_confirm_high_risk": false,
  "enable_audit_log": true
}
```

- [ ] **Step 5: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
rtk git add server/src/tools/localfs/config.ts server/config/workspace.json test/server/tools/localfs/config.test.ts
rtk git commit -m "【本地文件】workspace 配置模块:virtual/local_fs 模式切换 + 3s 缓存热生效"
```

---

### Task 2: 沙箱路径校验 sandbox.ts

**Files:**
- Create: `server/src/tools/localfs/sandbox.ts`
- Test: `test/server/tools/localfs/sandbox.test.ts`

**Interfaces:**
- Consumes: `WorkspaceConfig`（Task 1）
- Produces:
  - `class SandboxError extends Error`, `code: 'ESCAPE' | 'ABSOLUTE' | 'SYMLINK' | 'NO_ROOT'`
  - `interface ResolvedPath { realPath: string; relativePath: string }`（relativePath 为相对 sandbox_root 的正斜杠路径；根目录本身为 `''`）
  - `resolveSandboxPath(rawPath: string, config: WorkspaceConfig): ResolvedPath` — 同步函数

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/sandbox.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveSandboxPath, SandboxError } from '../../../../server/src/tools/localfs/sandbox'
import type { WorkspaceConfig } from '../../../../server/src/tools/localfs/config'

let root: string
let cfg: WorkspaceConfig

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-'))
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(root, 'sub', 'a.txt'), 'hello')
  cfg = {
    workspace_mode: 'local_fs',
    sandbox_root: root,
    allow_absolute_path: false,
    allow_symbolic_link: false,
    allow_dangerous_delete: false,
    max_read_bytes: 2 * 1024 * 1024,
    auto_confirm_high_risk: false,
    enable_audit_log: true,
  }
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveSandboxPath', () => {
  it('正常相对路径解析到 sandbox_root 下', () => {
    const r = resolveSandboxPath('sub/a.txt', cfg)
    expect(r.realPath).toBe(fs.realpathSync(path.join(root, 'sub', 'a.txt')))
    expect(r.relativePath.replace(/\\/g, '/')).toBe('sub/a.txt')
  })

  it('../ 逃逸被拒绝(ESCAPE)', () => {
    expect(() => resolveSandboxPath('../outside.txt', cfg)).toThrow(SandboxError)
    try {
      resolveSandboxPath('../../etc', cfg)
    } catch (e) {
      expect((e as SandboxError).code).toBe('ESCAPE')
    }
  })

  it('绝对路径默认拒绝(ABSOLUTE)', () => {
    expect(() => resolveSandboxPath('C:\\Windows\\system32', cfg)).toThrow(SandboxError)
  })

  it('allow_absolute_path=true 时绝对路径仍受沙箱约束(在根内允许,根外拒绝)', () => {
    const relaxed = { ...cfg, allow_absolute_path: true }
    const inside = resolveSandboxPath(path.join(root, 'sub', 'a.txt'), relaxed)
    expect(inside.relativePath.replace(/\\/g, '/')).toBe('sub/a.txt')
    expect(() => resolveSandboxPath('C:\\Windows\\system32', relaxed)).toThrow(SandboxError)
  })

  it('软链接指向沙箱外被拒绝(SYMLINK)', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'))
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x')
    try {
      fs.symlinkSync(path.join(outside), path.join(root, 'sub', 'leak'), 'dir')
      expect(() => resolveSandboxPath('sub/leak/secret.txt', cfg)).toThrow(SandboxError)
      try {
        resolveSandboxPath('sub/leak/secret.txt', cfg)
      } catch (e) {
        expect((e as SandboxError).code).toBe('SYMLINK')
      }
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('allow_symbolic_link=true 时软链接不拦截', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside2-'))
    fs.writeFileSync(path.join(outside, 'ok.txt'), 'x')
    try {
      fs.symlinkSync(path.join(outside), path.join(root, 'sub', 'link'), 'dir')
      const r = resolveSandboxPath('sub/link/ok.txt', { ...cfg, allow_symbolic_link: true })
      expect(r.realPath).toContain('ok.txt')
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('尚不存在的深层文件路径可解析(取最近存在祖先做 realpath 校验)', () => {
    const r = resolveSandboxPath('sub/newdir/deep/new.txt', cfg)
    expect(r.realPath).toContain('new.txt')
    expect(r.relativePath.replace(/\\/g, '/')).toBe('sub/newdir/deep/new.txt')
  })

  it('根目录本身解析为 relativePath 空', () => {
    expect(resolveSandboxPath('.', cfg).relativePath).toBe('')
  })

  it('sandbox_root 未配置时拒绝(NO_ROOT)', () => {
    expect(() => resolveSandboxPath('a.txt', { ...cfg, sandbox_root: '' })).toThrow(SandboxError)
  })

  it('空路径拒绝', () => {
    expect(() => resolveSandboxPath('  ', cfg)).toThrow(SandboxError)
  })

  it('sandbox_root 不存在时自动创建', () => {
    const missing = path.join(root, 'not-yet')
    const r = resolveSandboxPath('a.txt', { ...cfg, sandbox_root: missing })
    expect(fs.existsSync(missing)).toBe(true)
    expect(r.realPath).toContain('a.txt')
  })
})
```

> 注：`../` 逃逸测试若在 Windows 遇到盘符根问题（tmpdir 已接近盘符根时 `path.resolve` 可能停在根），`../../etc` 用例断言 `ESCAPE` code；如确实发生解析到盘符根以内属于穿越成功路径，前缀校验依然会拒绝。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/sandbox.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 sandbox.ts**

```ts
// server/src/tools/localfs/sandbox.ts
import fs from 'fs'
import path from 'path'
import type { WorkspaceConfig } from './config'

export class SandboxError extends Error {
  constructor(message: string, public readonly code: 'ESCAPE' | 'ABSOLUTE' | 'SYMLINK' | 'NO_ROOT') {
    super(message)
    this.name = 'SandboxError'
  }
}

export interface ResolvedPath {
  realPath: string
  relativePath: string
}

function isPrefix(parent: string, child: string): boolean {
  const p = process.platform === 'win32' ? parent.toLowerCase() : parent
  const c = process.platform === 'win32' ? child.toLowerCase() : child
  return c === p || c.startsWith(p + path.sep)
}

function nearestExistingRealPath(full: string): string {
  let cur = full
  for (;;) {
    try {
      return fs.realpathSync(cur)
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return full
      cur = parent
    }
  }
}

export function resolveSandboxPath(rawPath: string, config: WorkspaceConfig): ResolvedPath {
  if (!config.sandbox_root) throw new SandboxError('sandbox_root 未配置,本地文件模式不可用', 'NO_ROOT')
  if (typeof rawPath !== 'string' || rawPath.trim() === '') throw new SandboxError('路径不能为空', 'ABSOLUTE')
  const trimmed = rawPath.trim()

  if (path.isAbsolute(trimmed) && !config.allow_absolute_path) {
    throw new SandboxError(`禁止绝对路径: ${trimmed}`, 'ABSOLUTE')
  }

  const root = path.resolve(config.sandbox_root)
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true })
  const realRoot = fs.realpathSync(root)

  const full = path.resolve(root, trimmed)
  if (!isPrefix(root, full)) throw new SandboxError(`路径逃逸被拦截: ${rawPath}`, 'ESCAPE')

  // 先逻辑前缀校验再真实解析:待创建路径无法直接 realpath,用最近存在祖先锚定校验
  if (!isPrefix(realRoot, nearestExistingRealPath(full))) {
    throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
  }
  if (!config.allow_symbolic_link && fs.existsSync(full)) {
    if (!isPrefix(realRoot, fs.realpathSync(full))) {
      throw new SandboxError(`软链接逃逸被拦截: ${rawPath}`, 'SYMLINK')
    }
  }

  return {
    realPath: full,
    relativePath: path.relative(root, full).replace(/\\/g, '/'),
  }
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/sandbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/tools/localfs/sandbox.ts test/server/tools/localfs/sandbox.test.ts
rtk git commit -m "【本地文件】沙箱路径校验:逃逸/绝对路径/软链接双重拦截"
```

---

### Task 3: 二进制检测 binary.ts + 路径锁 lock.ts

**Files:**
- Create: `server/src/tools/localfs/binary.ts`
- Create: `server/src/tools/localfs/lock.ts`
- Test: `test/server/tools/localfs/binary.test.ts`
- Test: `test/server/tools/localfs/lock.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `isBinaryFile(filePath: string, statSize: number): boolean`（扩展名黑名单 + 前 8KB null 字节嗅探）
  - `withPathLock<T>(key: string, fn: () => Promise<T> | T): Promise<T>`（同 key 串行、异常不阻塞后续）

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/binary.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isBinaryFile } from '../../../../server/src/tools/localfs/binary'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('isBinaryFile', () => {
  it('二进制扩展名直接判定', () => {
    const f = path.join(tmp, 'x.png')
    fs.writeFileSync(f, 'not really png')
    expect(isBinaryFile(f, 13)).toBe(true)
  })

  it('含 null 字节的文件判定为二进制', () => {
    const f = path.join(tmp, 'x.dat')
    fs.writeFileSync(f, Buffer.from([0x68, 0x65, 0x00, 0x6c]))
    expect(isBinaryFile(f, 4)).toBe(true)
  })

  it('纯文本不误判', () => {
    const f = path.join(tmp, 'a.md')
    fs.writeFileSync(f, '# 标题\n中文内容 hello'.repeat(100))
    expect(isBinaryFile(f, fs.statSync(f).size)).toBe(false)
  })
})
```

```ts
// test/server/tools/localfs/lock.test.ts
import { describe, it, expect } from 'vitest'
import { withPathLock } from '../../../../server/src/tools/localfs/lock'

describe('withPathLock', () => {
  it('同 key 串行执行', async () => {
    const order: number[] = []
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    await Promise.all([
      withPathLock('k', async () => { order.push(1); await sleep(30); order.push(2) }),
      withPathLock('k', async () => { order.push(3); order.push(4) }),
    ])
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('前一个抛错不阻塞后续,且错误正常抛给调用方', async () => {
    await expect(withPathLock('k2', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const r = await withPathLock('k2', () => 'ok')
    expect(r).toBe('ok')
  })

  it('不同 key 并行不互斥', async () => {
    const r = await Promise.all([withPathLock('a', () => 'a'), withPathLock('b', () => 'b')])
    expect(r).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/binary.test.ts test/server/tools/localfs/lock.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 binary.ts 与 lock.ts**

```ts
// server/src/tools/localfs/binary.ts
import fs from 'fs'
import path from 'path'

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flac', '.ogg', '.wav',
  '.ttf', '.otf', '.woff', '.woff2', '.class', '.jar', '.pyc',
  '.db', '.sqlite', '.wasm',
])

export function isBinaryFile(filePath: string, statSize: number): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true
  if (statSize === 0) return false
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(Math.min(8192, statSize))
    fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.includes(0)
  } finally {
    fs.closeSync(fd)
  }
}
```

```ts
// server/src/tools/localfs/lock.ts
const locks = new Map<string, Promise<unknown>>()

// ponytail: 全局内存锁,按 key 串行写/删/移操作防并发冲突;多进程部署需换文件锁
export function withPathLock<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const settled = run.then(
    () => undefined,
    () => undefined,
  )
  locks.set(key, settled)
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key)
  })
  return run
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/binary.test.ts test/server/tools/localfs/lock.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/tools/localfs/binary.ts server/src/tools/localfs/lock.ts test/server/tools/localfs/binary.test.ts test/server/tools/localfs/lock.test.ts
rtk git commit -m "【本地文件】二进制检测(扩展名+null字节嗅探) + 路径串行锁"
```

---

### Task 4: 审计日志

**Files:**
- Modify: `server/src/services/logger.ts`（文件末尾追加 `logFsAudit`）
- Create: `server/src/tools/localfs/audit.ts`
- Test: `test/server/tools/localfs/audit.test.ts`

**Interfaces:**
- Consumes: `SandboxError`（Task 2）、`ConfirmRequiredError`（Task 5，本任务先用字符串判断占位会耦合 — **调整：audit.ts 本任务只做透传包装，拦截/异常分类由 Task 5 后在 runFsTool 统一做**）
- Produces:
  - `logFsAudit(params: { userId?: string; conversationId?: string; toolName: string; inputPath: string; realPath: string; result: 'success' | 'blocked' | 'error'; error?: string }): void`（logger.ts，event=`fs_audit`）
  - `audited<T>(ctx: { userId: string; toolName: string; inputPath: string }, realPath: string, fn: () => Promise<T> | T): Promise<T>`（enable_audit_log=false 时静默直通；异常原样上抛，由调用方分类）

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/audit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { audited } from '../../../../server/src/tools/localfs/audit'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'

beforeEach(() => { resetConfigCacheForTest() })
afterEach(() => { resetConfigCacheForTest() })

describe('audited', () => {
  it('成功时输出 fs_audit 日志并返回结果', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await audited({ userId: 'u1', toolName: 'fs_read_file', inputPath: 'a.txt' }, '/root/a.txt', () => 'data')
    expect(r).toBe('data')
    const entry = JSON.parse(spy.mock.calls[0][0] as string)
    expect(entry.event).toBe('fs_audit')
    expect(entry.result).toBe('success')
    expect(entry.toolName).toBe('fs_read_file')
    expect(entry.inputPath).toBe('a.txt')
    expect(entry.realPath).toBe('/root/a.txt')
    expect(entry.userId).toBe('u1')
    spy.mockRestore()
  })

  it('异常时输出 error 日志并原样上抛', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(
      audited({ userId: 'u1', toolName: 'fs_rm', inputPath: 'a' }, '/root/a', async () => { throw new Error('disk fail') })
    ).rejects.toThrow('disk fail')
    const entry = JSON.parse(spy.mock.calls[0][0] as string)
    expect(entry.result).toBe('error')
    expect(entry.error).toBe('disk fail')
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/audit.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`logger.ts` 末尾追加：

```ts
export function logFsAudit(
  params: LogContext & {
    toolName: string
    inputPath: string
    realPath: string
    result: 'success' | 'blocked' | 'error'
    error?: string
  }
): void {
  emit({
    timestamp: now(),
    level: params.result === 'success' ? 'info' : 'warn',
    event: 'fs_audit',
    conversationId: params.conversationId,
    userId: params.userId,
    toolName: params.toolName,
    inputPath: params.inputPath,
    realPath: params.realPath,
    result: params.result,
    error: params.error,
  })
}
```

`audit.ts`：

```ts
// server/src/tools/localfs/audit.ts
import { logFsAudit } from '../../services/logger'
import { loadWorkspaceConfig } from './config'

export interface AuditContext {
  userId: string
  toolName: string
  inputPath: string
}

export async function audited<T>(
  ctx: AuditContext,
  realPath: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const cfg = loadWorkspaceConfig()
  try {
    const result = await fn()
    if (cfg.enable_audit_log) logFsAudit({ userId: ctx.userId, toolName: ctx.toolName, inputPath: ctx.inputPath, realPath, result: 'success' })
    return result
  } catch (err) {
    if (cfg.enable_audit_log) {
      logFsAudit({
        userId: ctx.userId, toolName: ctx.toolName, inputPath: ctx.inputPath, realPath,
        result: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
    throw err
  }
}
```

> 注：`result: 'blocked'` 分支由 Task 7 的 `runFsTool` 在 catch `SandboxError`/`ConfirmRequiredError` 时直接调 `logFsAudit` 记录（resolve 阶段失败没有 realPath，记 `''`）。audited 保持纯透传。

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/services/logger.ts server/src/tools/localfs/audit.ts test/server/tools/localfs/audit.test.ts
rtk git commit -m "【本地文件】fs_audit 审计日志:结构化 JSON,enable_audit_log 可关"
```

---

### Task 5: 高危操作确认机制 confirm.ts

**Files:**
- Create: `server/src/tools/localfs/confirm.ts`
- Test: `test/server/tools/localfs/confirm.test.ts`

**Interfaces:**
- Consumes: `WorkspaceConfig`（Task 1）
- Produces:
  - `class ConfirmRequiredError extends Error`, 额外字段 `opKey: string`
  - `opKeyFor(toolName: string, realPath: string): string`（`"${toolName}:${realPath}"`）
  - `requireConfirmation(params: { toolName: string; realPath: string; description: string; config: WorkspaceConfig; confirm?: boolean }): void`
    - `auto_confirm_high_risk=true` → 直接放行
    - `confirm=true` 且存在未过期 pending → 放行并清除 pending
    - 其余 → 登记 pending（10 分钟 TTL）并抛 `ConfirmRequiredError`（消息含指引：告知用户、征得同意后带 `confirm=true` 重试）
  - `clearPendingForTest(): void`

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/confirm.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  requireConfirmation, ConfirmRequiredError, opKeyFor, clearPendingForTest,
} from '../../../../server/src/tools/localfs/confirm'
import type { WorkspaceConfig } from '../../../../server/src/tools/localfs/config'

const cfg: WorkspaceConfig = {
  workspace_mode: 'local_fs', sandbox_root: '/tmp/sb',
  allow_absolute_path: false, allow_symbolic_link: false, allow_dangerous_delete: false,
  max_read_bytes: 2097152, auto_confirm_high_risk: false, enable_audit_log: true,
}

beforeEach(() => clearPendingForTest())

describe('requireConfirmation', () => {
  it('默认拦截并登记 pending', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg }))
      .toThrow(ConfirmRequiredError)
  })

  it('拦截后带 confirm=true 重试放行', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg })).toThrow()
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/a', description: '删除 a', config: cfg, confirm: true })).not.toThrow()
  })

  it('无 pending 时直接 confirm=true 仍拦截', () => {
    try {
      requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/b', description: '删除 b', config: cfg, confirm: true })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmRequiredError)
      expect((e as ConfirmRequiredError).message).toMatch(/没有待确认/)
    }
  })

  it('auto_confirm_high_risk=true 时直接放行', () => {
    expect(() => requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/c', description: '删除 c', config: { ...cfg, auto_confirm_high_risk: true } })).not.toThrow()
  })

  it('过期 pending 不放行', () => {
    requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/d', description: '删除 d', config: cfg })
    // 直接篡改过期时间模拟 TTL 到期
    const key = opKeyFor('fs_rm', '/tmp/sb/d')
    const { peekPending, setPendingForTest } = require('../../../../server/src/tools/localfs/confirm') as {
      peekPending: (k: string) => number | undefined
      setPendingForTest: (k: string, t: number) => void
    }
    setPendingForTest(key, Date.now() - 1)
    expect(peekPending(key)).toBeLessThan(Date.now())
    try {
      requireConfirmation({ toolName: 'fs_rm', realPath: '/tmp/sb/d', description: '删除 d', config: cfg, confirm: true })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ConfirmRequiredError)
    }
  })
})
```

> 注：测试里 `setPendingForTest/peekPending` 需在 confirm.ts 中导出（仅测试用）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/confirm.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 confirm.ts**

```ts
// server/src/tools/localfs/confirm.ts
import type { WorkspaceConfig } from './config'

export class ConfirmRequiredError extends Error {
  constructor(message: string, public readonly opKey: string) {
    super(message)
    this.name = 'ConfirmRequiredError'
  }
}

const CONFIRM_TTL_MS = 10 * 60 * 1000
// pending: opKey -> expiresAt。对话内确认:首次拦截登记,用户同意后 LLM 带 confirm=true 重试放行
// ponytail: 确认由 LLM 介导,LLM 可自行重试;强校验需 SSE 弹窗方案
const pending = new Map<string, number>()

export function opKeyFor(toolName: string, realPath: string): string {
  return `${toolName}:${realPath}`
}

export function requireConfirmation(params: {
  toolName: string
  realPath: string
  description: string
  config: WorkspaceConfig
  confirm?: boolean
}): void {
  if (params.config.auto_confirm_high_risk) return
  const key = opKeyFor(params.toolName, params.realPath)
  const expiresAt = pending.get(key)
  if (params.confirm === true) {
    if (expiresAt && expiresAt > Date.now()) {
      pending.delete(key)
      return
    }
    throw new ConfirmRequiredError('没有待确认的高危操作或确认已过期,请先不带 confirm 触发确认请求。', key)
  }
  if (expiresAt && expiresAt > Date.now()) {
    throw new ConfirmRequiredError(
      `高危操作已被拦截,等待用户确认: ${params.description}。请询问用户是否确认;用户明确同意后携带 confirm=true 重试本操作(10 分钟内有效)。`,
      key,
    )
  }
  pending.set(key, Date.now() + CONFIRM_TTL_MS)
  throw new ConfirmRequiredError(
    `高危操作已被拦截: ${params.description}。请询问用户是否确认;用户明确同意后携带 confirm=true 重试本操作(10 分钟内有效)。`,
    key,
  )
}

export function peekPending(key: string): number | undefined {
  return pending.get(key)
}

export function setPendingForTest(key: string, expiresAt: number): void {
  pending.set(key, expiresAt)
}

export function clearPendingForTest(): void {
  pending.clear()
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/confirm.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/tools/localfs/confirm.ts test/server/tools/localfs/confirm.test.ts
rtk git commit -m "【本地文件】高危操作确认:对话内 pending + confirm=true 重试放行(10min TTL)"
```

---

### Task 6: 本地文件工具（读侧）fs_read_file / fs_list_dir / fs_mkdir / fs_stat

**Files:**
- Create: `server/src/tools/localfs/tools.ts`（本任务先建 `runFsTool` 骨架 + 4 个读侧工具）
- Test: `test/server/tools/localfs/tools.test.ts`

**Interfaces:**
- Consumes: Task 1-5 全部导出
- Produces:
  - `async function runFsTool(toolName: string, inputPath: string, config: { configurable?: { userId?: string } } | undefined, fn: (resolved: ResolvedPath, cfg: WorkspaceConfig) => Promise<string> | string): Promise<string>` — 模式检查（virtual 返回未启用提示）→ resolve（失败记 blocked 审计）→ audited 包装 → 异常归类（SandboxError→`Error: ...`，ConfirmRequiredError→`CONFIRM_REQUIRED: ...`，其余→`Error: ...`）
  - `export const localFsTools: DynamicStructuredTool<Record<string, unknown>>[]`（本任务 4 个，Task 7 补满 8 个）

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/tools.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fsReadFileTool, fsListDirTool, fsMkdirTool, fsStatTool } from '../../../../server/src/tools/localfs/tools'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'

let root: string
let cfgFile: string
let tmpDir: string
// DynamicStructuredTool 的 func 通过 .invoke() 调用
const call = (tool: { invoke: (input: unknown) => Promise<unknown> }, input: unknown, userId = 'u1') =>
  tool.invoke({ ...input as Record<string, unknown> }, { configurable: { userId } })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-tools-'))
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-cfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root }), 'utf-8')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello world')
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'b.txt'), 'nested')
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('fs_read_file', () => {
  it('读取文本文件内容', async () => {
    expect(await call(fsReadFileTool, { path: 'a.txt' })).toBe('hello world')
  })

  it('不存在文件友好报错', async () => {
    expect(await call(fsReadFileTool, { path: 'nope.txt' })).toMatch(/文件不存在/)
  })

  it('超过 max_read_bytes 拒绝', async () => {
    fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(2 * 1024 * 1024 + 1))
    expect(await call(fsReadFileTool, { path: 'big.txt' })).toMatch(/超过大小限制/)
  })

  it('二进制文件拒绝', async () => {
    fs.writeFileSync(path.join(root, 'img.png'), Buffer.from([1, 0, 2, 0]))
    expect(await call(fsReadFileTool, { path: 'img.png' })).toMatch(/二进制/)
  })

  it('路径逃逸拒绝', async () => {
    expect(await call(fsReadFileTool, { path: '../escape.txt' })).toMatch(/逃逸/)
  })
})

describe('fs_list_dir', () => {
  it('列出目录内容,目录带 / 后缀', async () => {
    const out = await call(fsListDirTool, { path: '.' })
    expect(out).toContain('a.txt')
    expect(out).toContain('sub/')
  })

  it('recursive 遍历含子目录文件', async () => {
    const out = await call(fsListDirTool, { path: '.', recursive: true })
    expect(out).toContain(path.join('sub', 'b.txt').replace(/\\/g, '/') || 'sub/b.txt')
  })

  it('不存在目录报错', async () => {
    expect(await call(fsListDirTool, { path: 'ghost' })).toMatch(/不存在/)
  })
})

describe('fs_mkdir / fs_stat', () => {
  it('创建目录(含多级)', async () => {
    const r = await call(fsMkdirTool, { path: 'x/y/z' })
    expect(r).toMatch(/Created/)
    expect(fs.statSync(path.join(root, 'x', 'y', 'z')).isDirectory()).toBe(true)
  })

  it('stat 返回文件信息 JSON', async () => {
    const out = await call(fsStatTool, { path: 'a.txt' })
    const info = JSON.parse(out as string)
    expect(info.isFile).toBe(true)
    expect(info.size).toBe(11)
    expect(info.modifiedAt).toBeTruthy()
  })

  it('stat 目录 isDirectory=true', async () => {
    const info = JSON.parse((await call(fsStatTool, { path: 'sub' })) as string)
    expect(info.isDirectory).toBe(true)
  })
})

describe('virtual 模式', () => {
  it('virtual 模式下所有 fs_* 工具返回未启用提示', async () => {
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'virtual' }), 'utf-8')
    resetConfigCacheForTest()
    expect(await call(fsReadFileTool, { path: 'a.txt' })).toMatch(/virtual/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/tools.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 runFsTool + 4 个读侧工具**

```ts
// server/src/tools/localfs/tools.ts
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { loadWorkspaceConfig, type WorkspaceConfig } from './config'
import { resolveSandboxPath, SandboxError, type ResolvedPath } from './sandbox'
import { isBinaryFile } from './binary'
import { withPathLock } from './lock'
import { audited } from './audit'
import { requireConfirmation, ConfirmRequiredError } from './confirm'
import { logFsAudit } from '../../services/logger'

type LcConfig = { configurable?: { userId?: string } }

const MAX_LIST_DEPTH = 3
const MAX_LIST_ENTRIES = 500

async function runFsTool(
  toolName: string,
  inputPath: string,
  config: LcConfig | undefined,
  fn: (resolved: ResolvedPath, cfg: WorkspaceConfig) => Promise<string> | string,
): Promise<string> {
  const cfg = loadWorkspaceConfig()
  if (cfg.workspace_mode !== 'local_fs') {
    return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
  }
  const userId = config?.configurable?.userId ?? ''
  let resolved: ResolvedPath
  try {
    resolved = resolveSandboxPath(inputPath, cfg)
  } catch (err) {
    if (err instanceof SandboxError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: '', result: 'blocked', error: err.message })
      return `Error: ${err.message}`
    }
    throw err
  }
  try {
    return await audited({ userId, toolName, inputPath }, resolved.realPath, async () => fn(resolved, cfg))
  } catch (err) {
    if (err instanceof ConfirmRequiredError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: resolved.realPath, result: 'blocked', error: err.message })
      return `CONFIRM_REQUIRED: ${err.message}`
    }
    if (err instanceof SandboxError) {
      if (cfg.enable_audit_log) logFsAudit({ userId, toolName, inputPath, realPath: resolved.realPath, result: 'blocked', error: err.message })
      return `Error: ${err.message}`
    }
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}

const relPath = z.string().describe('相对 sandbox_root 的相对路径,禁止绝对路径')

export const fsReadFileTool = new DynamicStructuredTool({
  name: 'fs_read_file',
  description: '读取本地文件(仅 local_fs 模式)。输入相对路径,超过 2MB 或二进制文件会被拒绝。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_read_file', p, config, (resolved, cfg) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      const st = fs.statSync(resolved.realPath)
      if (st.isDirectory()) return `Error: ${p} 是目录,请用 fs_list_dir`
      if (st.size > cfg.max_read_bytes) return `Error: 文件超过大小限制 (${st.size} > ${cfg.max_read_bytes} 字节)`
      if (isBinaryFile(resolved.realPath, st.size)) return `Error: 二进制文件,拒绝读取: ${p}`
      return fs.readFileSync(resolved.realPath, 'utf-8')
    }),
})

export const fsListDirTool = new DynamicStructuredTool({
  name: 'fs_list_dir',
  description: '列出本地目录内容(仅 local_fs 模式)。目录名带 / 后缀;recursive=true 递归(深度上限 3,最多 500 项)。',
  schema: z.object({ path: relPath, recursive: z.boolean().optional().describe('是否递归列出,默认 false') }),
  func: async ({ path: p, recursive }, _rm, config) =>
    runFsTool('fs_list_dir', p || '.', config, (resolved) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 目录不存在: ${p}`
      if (!fs.statSync(resolved.realPath).isDirectory()) return `Error: ${p} 不是目录`
      const out: string[] = []
      const walk = (dir: string, depth: number, prefix: string): boolean => {
        if (depth > MAX_LIST_DEPTH) return true
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (out.length >= MAX_LIST_ENTRIES) return false
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isSymbolicLink()) {
            out.push(`${rel} (symlink)`)
          } else if (e.isDirectory()) {
            out.push(`${rel}/`)
            if (!walk(path.join(dir, e.name), depth + 1, rel)) return false
          } else {
            out.push(rel)
          }
        }
        return true
      }
      const complete = walk(resolved.realPath, 0, '')
      const lines = complete ? out : [...out, `... (超过上限 ${MAX_LIST_ENTRIES} 项,已截断)`]
      return lines.length > 0 ? lines.join('\n') : 'Empty directory'
    }),
})

export const fsMkdirTool = new DynamicStructuredTool({
  name: 'fs_mkdir',
  description: '创建目录(仅 local_fs 模式,支持多级创建)。输入相对路径。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_mkdir', p, config, (resolved) => {
      fs.mkdirSync(resolved.realPath, { recursive: true })
      return `Created: ${p}`
    }),
})

export const fsStatTool = new DynamicStructuredTool({
  name: 'fs_stat',
  description: '获取本地文件/目录信息(仅 local_fs 模式):大小、类型、创建/修改时间。',
  schema: z.object({ path: relPath }),
  func: async ({ path: p }, _rm, config) =>
    runFsTool('fs_stat', p, config, (resolved) => {
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      const st = fs.statSync(resolved.realPath)
      return JSON.stringify({
        path: p,
        size: st.size,
        isFile: st.isFile(),
        isDirectory: st.isDirectory(),
        createdAt: st.birthtime.toISOString(),
        modifiedAt: st.mtime.toISOString(),
      })
    }),
})

export const localFsTools: DynamicStructuredTool<Record<string, unknown>>[] = [
  fsReadFileTool, fsListDirTool, fsMkdirTool, fsStatTool,
]
```

> 注：`fs_list_dir` 测试中 recursive 输出分隔符在 Windows 是 `/`（代码里用 `prefix/` 拼接），测试断言直接用 `'sub/b.txt'`。

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/tools/localfs/tools.ts test/server/tools/localfs/tools.test.ts
rtk git commit -m "【本地文件】读侧工具 fs_read_file/fs_list_dir/fs_mkdir/fs_stat + runFsTool 骨架"
```

---

### Task 7: 本地文件工具（写侧）fs_write_file / fs_rm / fs_cp / fs_mv

**Files:**
- Modify: `server/src/tools/localfs/tools.ts`（追加 4 个写侧工具，补满 localFsTools）
- Test: `test/server/tools/localfs/tools-write.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `runFsTool`（同文件直接用）、Task 5 `requireConfirmation`、Task 3 `withPathLock`
- Produces: `localFsTools` 扩为 8 个；`fs_write_file`/`fs_rm`/`fs_cp`/`fs_mv` schema 均含可选 `confirm: boolean`

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/tools-write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fsWriteFileTool, fsRmTool, fsCpTool, fsMvTool } from '../../../../server/src/tools/localfs/tools'
import { resetConfigCacheForTest } from '../../../../server/src/tools/localfs/config'
import { clearPendingForTest } from '../../../../server/src/tools/localfs/confirm'

let root: string
let cfgFile: string
let tmpDir: string
const call = (tool: { invoke: (input: unknown, cfg?: unknown) => Promise<unknown> }, input: Record<string, unknown>, confirm = false) =>
  tool.invoke({ ...input, ...(confirm ? { confirm: true } : {}) }, { configurable: { userId: 'u1' } })

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-w-'))
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-wcfg-'))
  cfgFile = path.join(tmpDir, 'workspace.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root }), 'utf-8')
  process.env.LOCAL_FS_CONFIG_PATH = cfgFile
  resetConfigCacheForTest()
  clearPendingForTest()
  fs.writeFileSync(path.join(root, 'a.txt'), 'v1')
})

afterEach(() => {
  delete process.env.LOCAL_FS_CONFIG_PATH
  resetConfigCacheForTest()
  clearPendingForTest()
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('fs_write_file', () => {
  it('新建文件成功', async () => {
    expect(await call(fsWriteFileTool, { path: 'new.txt', content: 'hello' })).toMatch(/File written/)
    expect(fs.readFileSync(path.join(root, 'new.txt'), 'utf-8')).toBe('hello')
  })

  it('覆盖已有文件被拦截(CONFIRM_REQUIRED)', async () => {
    const r = await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf-8')).toBe('v1')
  })

  it('确认后覆盖成功', async () => {
    await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' })
    expect(await call(fsWriteFileTool, { path: 'a.txt', content: 'v2' }, true)).toMatch(/File written/)
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf-8')).toBe('v2')
  })

  it('无 pending 时 confirm=true 仍拦截', async () => {
    await expect(call(fsWriteFileTool, { path: 'a.txt', content: 'v3' }, true)).rejects.toThrow(/没有待确认/)
  })
})

describe('fs_rm', () => {
  it('删除被拦截需确认', async () => {
    const r = await call(fsRmTool, { path: 'a.txt' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(true)
  })

  it('确认后删除成功', async () => {
    await call(fsRmTool, { path: 'a.txt' })
    expect(await call(fsRmTool, { path: 'a.txt' }, true)).toMatch(/Deleted/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false)
  })

  it('禁止删除沙箱根目录', async () => {
    await expect(call(fsRmTool, { path: '.' }, true)).rejects.toThrow(/根目录/)
  })

  it('非空目录批量删除默认禁止(allow_dangerous_delete=false)', async () => {
    fs.mkdirSync(path.join(root, 'd'))
    fs.writeFileSync(path.join(root, 'd', 'x.txt'), 'x')
    const r = await call(fsRmTool, { path: 'd' }, true)
    expect(r).toMatch(/批量删除/)
    expect(fs.existsSync(path.join(root, 'd'))).toBe(true)
  })

  it('allow_dangerous_delete=true 时非空目录确认后可删', async () => {
    fs.mkdirSync(path.join(root, 'd2'))
    fs.writeFileSync(path.join(root, 'd2', 'x.txt'), 'x')
    fs.writeFileSync(cfgFile, JSON.stringify({ workspace_mode: 'local_fs', sandbox_root: root, allow_dangerous_delete: true }), 'utf-8')
    resetConfigCacheForTest()
    await call(fsRmTool, { path: 'd2' })
    expect(await call(fsRmTool, { path: 'd2' }, true)).toMatch(/Deleted/)
    expect(fs.existsSync(path.join(root, 'd2'))).toBe(false)
  })
})

describe('fs_cp / fs_mv', () => {
  it('cp 复制文件', async () => {
    expect(await call(fsCpTool, { src: 'a.txt', dest: 'copy.txt' })).toMatch(/Copied/)
    expect(fs.readFileSync(path.join(root, 'copy.txt'), 'utf-8')).toBe('v1')
  })

  it('cp 目标已存在需确认', async () => {
    fs.writeFileSync(path.join(root, 'b.txt'), 'other')
    const r = await call(fsCpTool, { src: 'a.txt', dest: 'b.txt' })
    expect(r).toMatch(/^CONFIRM_REQUIRED/)
    expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf-8')).toBe('other')
  })

  it('cp 逃逸拒绝', async () => {
    expect(await call(fsCpTool, { src: '../out.txt', dest: 'in.txt' })).toMatch(/逃逸/)
  })

  it('mv 重命名', async () => {
    expect(await call(fsMvTool, { src: 'a.txt', dest: 'renamed.txt' })).toMatch(/Moved/)
    expect(fs.existsSync(path.join(root, 'a.txt'))).toBe(false)
    expect(fs.readFileSync(path.join(root, 'renamed.txt'), 'utf-8')).toBe('v1')
  })

  it('mv 目录含子内容整体移动', async () => {
    fs.mkdirSync(path.join(root, 'dir'))
    fs.writeFileSync(path.join(root, 'dir', 'f.txt'), 'deep')
    await call(fsMvTool, { src: 'dir', dest: 'dir2' }, true)
    expect(fs.readFileSync(path.join(root, 'dir2', 'f.txt'), 'utf-8')).toBe('deep')
  })
})
```

> 注：`禁止删除沙箱根目录` 用例 — 根目录在确认之后才检查的话，pending 已被消耗；实现顺序必须是 **根目录保护 → 批量删除检查 → requireConfirmation → 执行**，使"根目录"与"非空目录"两条守卫在确认前直接拒绝（无需 pending）。`fs_mv` 目录移动实现走 `fs.renameSync`，同沙箱内必同盘符，不会 EXDEV。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/tools-write.test.ts`
Expected: FAIL

- [ ] **Step 3: 追加写侧工具实现（tools.ts 末尾、localFsTools 之前）**

```ts
export const fsWriteFileTool = new DynamicStructuredTool({
  name: 'fs_write_file',
  description: '写入/覆盖本地文件(仅 local_fs 模式)。覆盖已有文件属高危操作,需用户确认(confirm=true)。',
  schema: z.object({
    path: relPath,
    content: z.string().describe('要写入的文本内容'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ path: p, content, confirm }, _rm, config) =>
    runFsTool('fs_write_file', p, config, (resolved, cfg) => {
      if (fs.existsSync(resolved.realPath)) {
        requireConfirmation({ toolName: 'fs_write_file', realPath: resolved.realPath, description: `覆盖已有文件 ${p}`, config: cfg, confirm })
      }
      return withPathLock(resolved.realPath, () => {
        fs.mkdirSync(path.dirname(resolved.realPath), { recursive: true })
        fs.writeFileSync(resolved.realPath, content, 'utf-8')
        return `File written: ${p}`
      })
    }),
})

export const fsRmTool = new DynamicStructuredTool({
  name: 'fs_rm',
  description: '删除本地文件或目录(仅 local_fs 模式)。高危操作,默认需用户确认(confirm=true);非空目录批量删除另需 allow_dangerous_delete=true。',
  schema: z.object({
    path: relPath,
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ path: p, confirm }, _rm, config) =>
    runFsTool('fs_rm', p, config, (resolved, cfg) => {
      if (resolved.relativePath === '') return 'Error: 禁止删除沙箱根目录本身'
      if (!fs.existsSync(resolved.realPath)) return `Error: 文件不存在: ${p}`
      if (fs.statSync(resolved.realPath).isDirectory() && fs.readdirSync(resolved.realPath).length > 0 && !cfg.allow_dangerous_delete) {
        return 'Error: 批量删除非空目录被禁止(config 中 allow_dangerous_delete=true 可放开)'
      }
      requireConfirmation({ toolName: 'fs_rm', realPath: resolved.realPath, description: `删除 ${p}`, config: cfg, confirm })
      return withPathLock(resolved.realPath, () => {
        fs.rmSync(resolved.realPath, { recursive: true, force: true })
        return `Deleted: ${p}`
      })
    }),
})

export const fsCpTool = new DynamicStructuredTool({
  name: 'fs_cp',
  description: '复制本地文件/目录(仅 local_fs 模式,仅限沙箱内)。目标已存在属覆盖高危操作,需确认。',
  schema: z.object({
    src: relPath.describe('源路径'),
    dest: relPath.describe('目标路径'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ src, dest, confirm }, _rm, config) => {
    const cfg = loadWorkspaceConfig()
    if (cfg.workspace_mode !== 'local_fs') {
      return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
    }
    // src/dest 双重沙箱校验,任一逃逸即拦截
    let srcR: ResolvedPath, destR: ResolvedPath
    try {
      srcR = resolveSandboxPath(src, cfg)
      destR = resolveSandboxPath(dest, cfg)
    } catch (err) {
      if (err instanceof SandboxError) {
        if (cfg.enable_audit_log) logFsAudit({ userId: config?.configurable?.userId ?? '', toolName: 'fs_cp', inputPath: `${src} -> ${dest}`, realPath: '', result: 'blocked', error: err.message })
        return `Error: ${err.message}`
      }
      throw err
    }
    if (srcR.relativePath === '') return 'Error: 禁止复制沙箱根目录本身'
    if (!fs.existsSync(srcR.realPath)) return `Error: 源不存在: ${src}`
    try {
      return await audited({ userId: config?.configurable?.userId ?? '', toolName: 'fs_cp', inputPath: `${src} -> ${dest}` }, destR.realPath, () => {
        if (fs.existsSync(destR.realPath)) {
          requireConfirmation({ toolName: 'fs_cp', realPath: destR.realPath, description: `覆盖已有目标 ${dest}`, config: cfg, confirm })
        }
        return withPathLock(srcR.realPath, () => {
          fs.cpSync(srcR.realPath, destR.realPath, { recursive: true })
          return `Copied: ${src} -> ${dest}`
        })
      })
    } catch (err) {
      if (err instanceof ConfirmRequiredError) return `CONFIRM_REQUIRED: ${err.message}`
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const fsMvTool = new DynamicStructuredTool({
  name: 'fs_mv',
  description: '移动/重命名本地文件或目录(仅 local_fs 模式,仅限沙箱内)。目标已存在属覆盖高危操作,需确认。',
  schema: z.object({
    src: relPath.describe('源路径'),
    dest: relPath.describe('目标路径'),
    confirm: z.boolean().optional().describe('高危操作用户确认标记'),
  }),
  func: async ({ src, dest, confirm }, _rm, config) => {
    const cfg = loadWorkspaceConfig()
    if (cfg.workspace_mode !== 'local_fs') {
      return 'local_fs 工具未启用:当前 workspace_mode=virtual。将 server/config/workspace.json 的 workspace_mode 改为 local_fs 后重试。'
    }
    let srcR: ResolvedPath, destR: ResolvedPath
    try {
      srcR = resolveSandboxPath(src, cfg)
      destR = resolveSandboxPath(dest, cfg)
    } catch (err) {
      if (err instanceof SandboxError) {
        if (cfg.enable_audit_log) logFsAudit({ userId: config?.configurable?.userId ?? '', toolName: 'fs_mv', inputPath: `${src} -> ${dest}`, realPath: '', result: 'blocked', error: err.message })
        return `Error: ${err.message}`
      }
      throw err
    }
    if (srcR.relativePath === '') return 'Error: 禁止移动沙箱根目录本身'
    if (!fs.existsSync(srcR.realPath)) return `Error: 源不存在: ${src}`
    try {
      return await audited({ userId: config?.configurable?.userId ?? '', toolName: 'fs_mv', inputPath: `${src} -> ${dest}` }, destR.realPath, () => {
        if (fs.existsSync(destR.realPath)) {
          requireConfirmation({ toolName: 'fs_mv', realPath: destR.realPath, description: `覆盖已有目标 ${dest}`, config: cfg, confirm })
        }
        return withPathLock(srcR.realPath, () => {
          fs.renameSync(srcR.realPath, destR.realPath)
          return `Moved: ${src} -> ${dest}`
        })
      })
    } catch (err) {
      if (err instanceof ConfirmRequiredError) return `CONFIRM_REQUIRED: ${err.message}`
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const localFsTools: DynamicStructuredTool<Record<string, unknown>>[] = [
  fsReadFileTool, fsListDirTool, fsMkdirTool, fsStatTool,
  fsWriteFileTool, fsRmTool, fsCpTool, fsMvTool,
]
```

> 注：Task 6 中 `localFsTools` 数组此时替换为上面 8 元素版本。Task 6 的 `runFsTool` 骨架继续服务 read 侧 4 工具；cp/mv 因 src+dest 双路径不走 `runFsTool` 单路径签名，沙箱/审计/确认逻辑内联但复用同一批原语（resolveSandboxPath/audited/requireConfirmation/withPathLock），拦截路径语义一致。

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/tools-write.test.ts test/server/tools/localfs/tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add server/src/tools/localfs/tools.ts test/server/tools/localfs/tools-write.test.ts
rtk git commit -m "【本地文件】写侧工具 fs_write_file/fs_rm/fs_cp/fs_mv + 高危确认接入"
```

---

### Task 8: 注册工具 + 文档同步 + 全量回归

**Files:**
- Modify: `server/src/tools/index.ts:4,48`
- Modify: `CLAUDE.md`（工具表 + 环境变量表 + 项目结构 + 开发约定）
- Modify: `README.md`（同上对应章节）
- Test: `test/server/tools/localfs/registration.test.ts`

**Interfaces:**
- Consumes: Task 7 `localFsTools`（8 个 DynamicStructuredTool）
- Produces: `lcTools` 含 8 个 `fs_*` 工具；`getBuiltInTools()` / 虚拟 4 工具不变

- [ ] **Step 1: 写失败测试**

```ts
// test/server/tools/localfs/registration.test.ts
import { describe, it, expect } from 'vitest'
import { lcTools, getBuiltInTools } from '../../../../server/src/tools/index'

describe('localfs 工具注册', () => {
  const FS_NAMES = ['fs_read_file', 'fs_write_file', 'fs_list_dir', 'fs_mkdir', 'fs_rm', 'fs_cp', 'fs_mv', 'fs_stat']

  it('8 个 fs_* 工具注册进 lcTools', () => {
    const names = lcTools.map(t => t.name)
    for (const n of FS_NAMES) expect(names).toContain(n)
  })

  it('虚拟工作区 4 工具原样保留', () => {
    const names = getBuiltInTools().map(t => t.name)
    for (const n of ['filesystem_read', 'filesystem_write', 'filesystem_list', 'filesystem_delete']) {
      expect(names).toContain(n)
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run test/server/tools/localfs/registration.test.ts`
Expected: FAIL

- [ ] **Step 3: 修改 tools/index.ts**

第 4 行区域追加 import：

```ts
import { localFsTools } from './localfs/tools'
```

第 48 行 `lcTools` 改为：

```ts
export const lcTools: DynamicStructuredTool<Record<string, unknown>>[] = [calculatorTool, knowledgeSearchTool, parallelSearchTool, ...localFsTools]
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run test/server/tools/localfs/registration.test.ts`
Expected: PASS

- [ ] **Step 5: 文档同步**

`CLAUDE.md`：
- 「内置工具」表追加 8 行：`fs_read_file / fs_write_file / fs_list_dir / fs_mkdir / fs_rm / fs_cp / fs_mv / fs_stat`，说明列注明"仅 local_fs 模式，沙箱 + 高危确认 + 审计"
- 「环境变量」表追加 `LOCAL_FS_CONFIG_PATH`（默认 `server/config/workspace.json`，❌ 非必需）
- 「项目结构」`tools/` 下补 `localfs/` 目录行
- 「已知陷阱」追加：17 条后加第 18 条 — fs_* 工具仅在 `workspace_mode=local_fs` 生效，模式改动改 `server/config/workspace.json`（3s 缓存，无需重启）；高危删除/覆盖默认拦截，`auto_confirm_high_risk` 与 `allow_dangerous_delete` 慎开
- 「开发约定」通用小节追加：本地文件操作必须经 `server/src/tools/localfs/` 中间层，禁止绕过沙箱直接 fs

`README.md`：同步上述四处对应章节（工具表/环境变量/目录树/工具清单说明）。

- [ ] **Step 6: 全量回归**

Run: `npx vitest run`
Expected: 全部 PASS（含既有 filesystem 虚拟工作区测试不变）

- [ ] **Step 7: Commit**

```bash
rtk git add server/src/tools/index.ts CLAUDE.md README.md test/server/tools/localfs/registration.test.ts
rtk git commit -m "【本地文件】fs_* 工具注册进 lcTools + CLAUDE/README 文档同步"
```

---

## Self-Review 结果

- **Spec coverage**: §3 配置→Task 1；§4 沙箱→Task 2；§5 工具→Task 6/7；§6 高危→Task 5/7；§7 审计→Task 4；§8 边界（大文件/二进制/深度/并发/跨平台/友好报错）→Task 2/3/6/7；§9 向后兼容→Task 8（虚拟 4 工具原样，注册测试守护）；§10 执行顺序→任务序一致
- **Placeholder scan**: 无 TBD/TODO；所有代码步骤含完整代码
- **Type consistency**: `ResolvedPath`/`SandboxError`/`ConfirmRequiredError`/`WorkspaceConfig` 签名在消费任务与生产任务一致；`localFsTools` Task 6 建骨架、Task 7 扩满，Task 8 消费最终 8 元素版本
