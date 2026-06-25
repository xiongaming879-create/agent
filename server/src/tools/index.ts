import type { Tool } from '../types'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { searchTool } from './search'
import { readFile, writeFile, listDir, deleteFile } from './filesystem'
import { calculatorTool } from './calculator'

const builtInTools: Tool[] = [
  {
    name: 'search',
    description: 'Fetch and extract text content from a URL. Input should be a valid HTTP/HTTPS URL.',
    execute: async (url: string) => searchTool(url),
  },
  {
    name: 'filesystem_read',
    description: 'Read file content from the virtual workspace. Input should be a relative file path.',
    execute: async (filepath: string) => readFile(filepath),
  },
  {
    name: 'filesystem_write',
    description: 'Write content to a file in the virtual workspace. Input should be JSON: {"path": "filepath", "content": "file content"}',
    execute: async (input: string) => {
      const { path: filepath, content } = JSON.parse(input)
      await writeFile(filepath, content)
      return `File written: ${filepath}`
    },
  },
  {
    name: 'filesystem_list',
    description: 'List files in a directory in the virtual workspace. Input should be a relative directory path.',
    execute: async (dirpath: string) => {
      const files = await listDir(dirpath)
      return files.length > 0 ? files.join('\n') : 'Empty directory'
    },
  },
  {
    name: 'filesystem_delete',
    description: 'Delete a file or directory in the virtual workspace. Input should be a relative file path.',
    execute: async (filepath: string) => {
      await deleteFile(filepath)
      return `Deleted: ${filepath}`
    },
  },
]

// DynamicStructuredTool instances (native LangChain tools, skip adapter wrapping)
export const lcTools: DynamicStructuredTool<Record<string, unknown>>[] = [calculatorTool]

export const tools: Tool[] = [...builtInTools]

export function registerTools(newTools: Tool[]): void {
  for (const tool of newTools) {
    const idx = tools.findIndex(t => t.name === tool.name)
    if (idx !== -1) {
      console.warn(`[Tools] Tool name collision: "${tool.name}" already registered, overwriting`)
      tools[idx] = tool
    } else {
      tools.push(tool)
    }
  }
}

export function registerLcTools(newLcTools: DynamicStructuredTool<Record<string, unknown>>[]): void {
  for (const tool of newLcTools) {
    const idx = lcTools.findIndex(t => t.name === tool.name)
    if (idx !== -1) {
      console.warn(`[Tools] LC tool name collision: "${tool.name}" already registered, overwriting`)
      lcTools[idx] = tool
    } else {
      lcTools.push(tool)
    }
  }
}

export function getToolByName(name: string): Tool | undefined {
  return tools.find(t => t.name === name)
}

export function getBuiltInTools(): Tool[] {
  return [...builtInTools]
}
