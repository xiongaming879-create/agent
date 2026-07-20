import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Transport type: "stdio" (default) or "sse" */
  type?: 'stdio' | 'sse'
  /** URL for SSE transport */
  url?: string
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}

const CONFIG_PATH = process.env.MCP_CONFIG_PATH
  || path.resolve(__dirname, '../../../.mcp.json')

export function readMcpConfig(): McpConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`[MCP] Config file not found: ${CONFIG_PATH}`)
    return { mcpServers: {} }
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(raw) as McpConfig
  console.log(`[MCP] Loaded config from ${CONFIG_PATH} — ${Object.keys(config.mcpServers).length} servers`)
  return config
}
