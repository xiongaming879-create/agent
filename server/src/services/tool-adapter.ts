import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Tool } from '../types'

export function wrapCustomTool(tool: Tool): DynamicStructuredTool<Record<string, unknown>> {
  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: z.object({ input: z.string().describe('Tool input as a string') }),
    func: async ({ input }: { input: string }) => tool.execute(input),
  })
}

export function wrapAllTools(
  customTools: Tool[],
  existingLcTools: DynamicStructuredTool<Record<string, unknown>>[] = []
): DynamicStructuredTool<Record<string, unknown>>[] {
  // MCP tools already have proper DynamicStructuredTool instances in existingLcTools.
  // Filter them out from customTools to avoid wrapping with a generic {input} schema
  // that would override the proper schema (e.g. fetch expects {url}, not {input}).
  const lcToolNames = new Set(existingLcTools.map(t => t.name))
  const toolsToWrap = customTools.filter(t => !lcToolNames.has(t.name))
  const wrapped = toolsToWrap.map(wrapCustomTool)
  return [...existingLcTools, ...wrapped]
}
