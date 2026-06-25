import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { evaluate, derivative, format as mathFormat } from 'mathjs'
import nerdamer from 'nerdamer'
import 'nerdamer/Calculus'
import 'nerdamer/Solve'
import 'nerdamer/Algebra'
import 'nerdamer/Extra'

const NERDAMER_KEYWORDS = ['integrate(', 'solve(', 'simplify(', 'expand(']

function evaluateWithNerdamer(expression: string): string {
  if (expression.startsWith('integrate(')) {
    const match = expression.match(/^integrate\(\s*'(.+?)'\s*,\s*'(.+?)'\s*\)$/)
    if (!match) return "Error: integrate format: integrate('expr', 'x')"
    return nerdamer.integrate(match[1], match[2]).text()
  }
  if (expression.startsWith('solve(')) {
    const match = expression.match(/^solve\(\s*'(.+?)'\s*,\s*'(.+?)'\s*\)$/)
    if (!match) return "Error: solve format: solve('eq', 'x')"
    return nerdamer.solve(match[1], match[2]).text()
  }
  if (expression.startsWith('simplify(')) {
    const match = expression.match(/^simplify\(\s*'(.+?)'\s*\)$/)
    if (!match) return "Error: simplify format: simplify('expr')"
    return nerdamer.simplify(match[1]).text()
  }
  if (expression.startsWith('expand(')) {
    const match = expression.match(/^expand\(\s*'(.+?)'\s*\)$/)
    if (!match) return "Error: expand format: expand('expr')"
    return nerdamer.expand(match[1]).text()
  }
  return `Error: Unknown nerdamer operation in: ${expression}`
}

function formatResult(result: unknown): string {
  if (typeof result === 'number') return String(result)
  if (typeof result === 'object' && result !== null && typeof (result as { format?: unknown }).format === 'function') {
    return (result as { format: (opts: Record<string, unknown>) => string }).format({ precision: 14 })
  }
  return mathFormat(result as number, { precision: 14 })
}

function safeEvaluate(expression: string): string {
  try {
    if (expression.startsWith('derivative(')) {
      const match = expression.match(/^derivative\(\s*'(.+?)'\s*,\s*'(.+?)'\s*\)$/)
      if (!match) return "Error: derivative format: derivative('expr', 'x')"
      const result = derivative(match[1], match[2])
      return result.toString()
    }

    for (const kw of NERDAMER_KEYWORDS) {
      if (expression.startsWith(kw)) {
        return evaluateWithNerdamer(expression)
      }
    }

    const result = evaluate(expression)
    if (typeof result === 'undefined') return 'Error: Expression returned undefined'
    if (typeof result === 'number' && !Number.isFinite(result)) {
      return `Error: Expression did not evaluate to a finite number (got ${result})`
    }
    return formatResult(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return `Error: ${message}`
  }
}

export const calculatorTool = new DynamicStructuredTool({
  name: 'calculator',
  description: `计算数学表达式，支持高等数学。白话文请先转为标准表达式再调用。
支持：四则运算、三角函数(sin/cos/tan, 加deg表示角度)、对数(log/log10)、常数(pi/e)、矩阵(det/inv)、求导(derivative('expr','x'))、积分(integrate('expr','x'))、方程求解(solve('eq','x'))、化简(simplify)、展开(expand)
示例："根号5加根号9"→sqrt(5)+sqrt(9)  "sin30度"→sin(30 deg)  "x方的导数"→derivative('x^2','x')  "x方积分"→integrate('x^2','x')  "解x方减4等于0"→solve('x^2-4','x')`,
  schema: z.object({
    expression: z.string().describe("数学表达式，如 sqrt(5)+sqrt(9)、derivative('x^2','x')、integrate('x^2','x')、solve('x^2-4','x')"),
  }),
  func: async ({ expression }) => safeEvaluate(expression),
})
