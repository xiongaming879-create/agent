import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Tool } from '../types'
import type { McpServerConfig, McpConfig } from './config'

interface ManagedClient {
  name: string
  client: Client
  tools: Tool[]
  connected: boolean
}

const clients: ManagedClient[] = []

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || schema.type !== 'object') {
    return z.object({ input: z.string().describe('Tool input as a string') })
  }
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties) {
    return z.object({ input: z.string().describe('Tool input as a string') })
  }
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const required = (schema.required as string[])?.includes(key) ?? false
    let field: z.ZodTypeAny
    switch (prop.type) {
      case 'number':
      case 'integer':
        field = z.number()
        break
      case 'boolean':
        field = z.boolean()
        break
      case 'array':
        field = z.array(z.unknown())
        break
      default:
        field = z.string()
    }
    if (prop.description) field = field.describe(prop.description as string)
    if (!required) field = field.optional()
    shape[key] = field
  }
  return z.object(shape)
}

/**
 * Map a plain string input to the first suitable parameter of a tool's schema.
 * Priority: required → common keys → first property → { input } fallback.
 */
function mapStringInputToSchema(input: string, schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || schema.type !== 'object') return { input }

  const properties = schema.properties as Record<string, unknown> | undefined
  if (!properties) return { input }

  const required = (schema.required as string[]) ?? []
  const propertyKeys = Object.keys(properties)

  // Prefer the single required property
  if (required.length === 1) return { [required[0]]: input }

  // Prefer common key names that accept plain text/URL input
  const commonKeys = ['url', 'query', 'text', 'path', 'content', 'message', 'input']
  for (const key of commonKeys) {
    if (propertyKeys.includes(key)) return { [key]: input }
  }

  // Fall back to the first property
  return { [propertyKeys[0]]: input }
}

export async function connectMcpServer(
  name: string,
  config: McpServerConfig
): Promise<{ tools: Tool[]; lcTools: DynamicStructuredTool<Record<string, unknown>>[] }> {
  console.log(`[MCP] Connecting to "${name}"...`)

  try {
    const transportType = config.type || 'stdio'

    let transport: StdioClientTransport | SSEClientTransport
    if (transportType === 'sse') {
      if (!config.url) {
        throw new Error(`SSE transport requires a "url" field`)
      }
      transport = new SSEClientTransport(new URL(config.url))
    } else {
      if (!config.command) {
        throw new Error(`Stdio transport requires a "command" field`)
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env
          ? { ...process.env as Record<string, string>, ...config.env }
          : undefined,
      })
    }

    const client = new Client({
      name: 'agent-server',
      version: '1.0.0',
    }, {
      capabilities: {},
    })

    await client.connect(transport)

    const result = await client.listTools()
    const mcpTools: Tool[] = []
    const mcpLcTools: DynamicStructuredTool<Record<string, unknown>>[] = []

    for (const tool of result.tools) {
      const toolName = tool.name
      const toolDesc = tool.description || `MCP tool: ${toolName}`

      // Fallback Tool (string input) for legacy mode
      const inputSchema = tool.inputSchema as Record<string, unknown> | undefined
      mcpTools.push({
        name: toolName,
        description: toolDesc,
        execute: async (args: string) => {
          let parsedArgs: Record<string, unknown>
          try {
            parsedArgs = JSON.parse(args)
            // If agent used `input` key but schema expects something else (e.g. `url`), remap
            if (parsedArgs.input !== undefined && inputSchema?.type === 'object') {
              const properties = inputSchema.properties as Record<string, unknown> | undefined
              const propertyKeys = Object.keys(properties ?? {})
              if (!propertyKeys.includes('input') && propertyKeys.length > 0) {
                const preferred = ['url', 'query', 'text', 'path', 'content', 'message']
                  .find(k => propertyKeys.includes(k))
                if (preferred) {
                  parsedArgs = { [preferred]: parsedArgs.input }
                }
              }
            }
          } catch {
            // Plain string input — map to the first required parameter of the tool's schema
            parsedArgs = mapStringInputToSchema(args, inputSchema)
          }
          const callResult = await client.callTool({ name: toolName, arguments: parsedArgs })
          if (typeof callResult.content === 'string') return callResult.content
          if (Array.isArray(callResult.content)) {
            return callResult.content
              .map((c: { type: string; text?: string }) => c.text || JSON.stringify(c))
              .join('\n')
          }
          return JSON.stringify(callResult.content)
        },
      })

      // DynamicStructuredTool with proper schema for LangChain mode
      const zodSchema = jsonSchemaToZod(tool.inputSchema as Record<string, unknown>)
      mcpLcTools.push(
        new DynamicStructuredTool({
          name: toolName,
          description: toolDesc,
          schema: zodSchema,
          func: async (args: Record<string, unknown>) => {
            const callResult = await client.callTool({ name: toolName, arguments: args })
            if (typeof callResult.content === 'string') return callResult.content
            if (Array.isArray(callResult.content)) {
              return callResult.content
                .map((c: { type: string; text?: string }) => c.text || JSON.stringify(c))
                .join('\n')
            }
            return JSON.stringify(callResult.content)
          },
        })
      )
    }

    clients.push({ name, client, tools: mcpTools, connected: true })
    console.log(`[MCP] Connected to "${name}" — ${mcpTools.length} tools: ${mcpTools.map(t => t.name).join(', ')}`)
    return { tools: mcpTools, lcTools: mcpLcTools }
  } catch (err) {
    console.warn(`[MCP] Failed to connect to "${name}": ${err instanceof Error ? err.message : String(err)}`)
    clients.push({ name, client: null as unknown as Client, tools: [], connected: false })
    return { tools: [], lcTools: [] }
  }
}

export async function initMcpClients(config: McpConfig): Promise<{ tools: Tool[]; lcTools: DynamicStructuredTool<Record<string, unknown>>[] }> {
  const allMcpTools: Tool[] = []
  const allMcpLcTools: DynamicStructuredTool<Record<string, unknown>>[] = []
  const serverNames = Object.keys(config.mcpServers)

  for (const name of serverNames) {
    const serverConfig = config.mcpServers[name]
    const result = await connectMcpServer(name, serverConfig)
    allMcpTools.push(...result.tools)
    allMcpLcTools.push(...result.lcTools)
  }

  console.log(`[MCP] Initialization complete — ${allMcpTools.length} total MCP tools from ${serverNames.length} servers`)
  return { tools: allMcpTools, lcTools: allMcpLcTools }
}

export async function closeAllMcpClients(): Promise<void> {
  for (const managed of clients) {
    if (!managed.connected) continue
    try {
      await managed.client.close()
      console.log(`[MCP] Closed connection to "${managed.name}"`)
    } catch (err) {
      console.warn(`[MCP] Error closing "${managed.name}": ${err}`)
    }
  }
  clients.length = 0
}

export function getMcpStatus(): Array<{ name: string; connected: boolean; toolCount: number }> {
  return clients.map(c => ({
    name: c.name,
    connected: c.connected,
    toolCount: c.tools.length,
  }))
}
