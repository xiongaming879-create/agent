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
  const wrapped = customTools.map(wrapCustomTool)
  return [...existingLcTools, ...wrapped]
}
