import { describe, it, expect } from 'vitest'
import { calculatorTool } from '../../../server/src/tools/calculator'

async function evalExpr(expr: string): Promise<string> {
  return calculatorTool.func({ expression: expr })
}

describe('Calculator — basic arithmetic', () => {
  it('addition', () => expect(evalExpr('3 + 5')).resolves.toBe('8'))
  it('subtraction', () => expect(evalExpr('10 - 4')).resolves.toBe('6'))
  it('multiplication', () => expect(evalExpr('6 * 7')).resolves.toBe('42'))
  it('division', () => expect(evalExpr('15 / 3')).resolves.toBe('5'))
  it('division by zero', () => expect(evalExpr('5 / 0')).resolves.toMatch(/^Error:/))
})

describe('Calculator — trigonometry', () => {
  it('sin(pi/6) approx 0.5', () => expect(evalExpr('sin(pi/6)')).resolves.toMatch(/^0\.4?9/))
  it('cos(0)', () => expect(evalExpr('cos(0)')).resolves.toBe('1'))
  it('tan(pi/4) approx 1', () => expect(evalExpr('tan(pi/4)')).resolves.toMatch(/^0\.9/))
  it('asin(0.5) approx pi/6', () => expect(evalExpr('asin(0.5)')).resolves.toMatch(/^0\.5235/))
  it('sin in degrees approx 0.5', () => expect(evalExpr('sin(30 deg)')).resolves.toMatch(/^0\.4?9/))
})

describe('Calculator — logarithm and constants', () => {
  it('log(e)', () => expect(evalExpr('log(e)')).resolves.toBe('1'))
  it('log10(100)', () => expect(evalExpr('log10(100)')).resolves.toBe('2'))
  it('log(100, 10)', () => expect(evalExpr('log(100, 10)')).resolves.toBe('2'))
  it('pi constant approx', () => expect(evalExpr('2 * pi')).resolves.toMatch(/^6\.283/))
  it('e constant approx', () => expect(evalExpr('e ^ 2')).resolves.toMatch(/^7\.389/))
})

describe('Calculator — matrix', () => {
  it('determinant', () => expect(evalExpr('det([1, 2; 3, 4])')).resolves.toBe('-2'))
  it('inverse', () => expect(evalExpr('inv([1, 2; 3, 4])')).resolves.toBe('[[-2, 1], [1.5, -0.5]]'))
})

describe('Calculator — derivative', () => {
  it('derivative of x^2', () => expect(evalExpr("derivative('x^2', 'x')")).resolves.toBe('2 * x'))
  it('derivative of sin(x)', () => expect(evalExpr("derivative('sin(x)', 'x')")).resolves.toBe('cos(x)'))
})

describe('Calculator — nerdamer operations', () => {
  it('integrate x^2', () => expect(evalExpr("integrate('x^2', 'x')")).resolves.toBe('0.3333333333333333*x^3'))
  it('solve x^2-4', () => expect(evalExpr("solve('x^2-4', 'x')")).resolves.toBe('[2,-2]'))
  it('simplify x^2*x^3', () => expect(evalExpr("simplify('x^2*x^3')")).resolves.toBe('x^5'))
  it('expand (x+1)^3', () => expect(evalExpr("expand('(x+1)^3')")).resolves.toBe('1+3*x+3*x^2+x^3'))
})

describe('Calculator — compound expressions', () => {
  it('sqrt(5) + sqrt(9)', () => expect(evalExpr('sqrt(5) + sqrt(9)')).resolves.toMatch(/^5\.236/))
  it('multi-term addition', () => expect(evalExpr('1 + 3 + 5 + 6')).resolves.toBe('15'))
  it('parentheses and precedence', () => expect(evalExpr('(2 + 3) * 4')).resolves.toBe('20'))
  it('nested operations', () => expect(evalExpr('sqrt(3 ^ 2 + 4 ^ 2)')).resolves.toBe('5'))
  it('decimal arithmetic', () => expect(evalExpr('0.1 + 0.2')).resolves.toBe('0.30000000000000004'))
})

describe('Calculator — error handling', () => {
  it('invalid syntax', () => expect(evalExpr('1 * / 2')).resolves.toMatch(/^Error:/))
  it('unknown function', () => expect(evalExpr('foo(5)')).resolves.toMatch(/^Error:/))
  it('empty expression', () => expect(evalExpr('')).resolves.toMatch(/^Error:/))
})
