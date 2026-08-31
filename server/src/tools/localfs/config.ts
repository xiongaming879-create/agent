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
