/**
 * Bounded function-plot expressions for `dsh-plot` fences (inline rendering, plan P5).
 *
 * A hand-written tokenizer and shunting-yard parser compile an expression in `x` to RPN; the
 * evaluator is a small stack machine. Allowed: numbers, `x`, `pi`, `e`, `+ - * / ^` (also the
 * unicode minus and multiplication signs), parentheses, unary signs, implicit multiplication after a
 * number (`2x`, `3(x+1)`, `2sin(x)`), and the one-argument functions below. No eval, no Function, no
 * property access: identifiers are looked up in fixed tables only.
 */
import type { LinePlotContent, PlotSeries } from './protocol'
import { RICH_LIMITS } from './protocol'
import { validateRichContent } from './validation'

export const PLOT_EXPR_LIMITS = { maxExprChars: 200, maxFunctions: 8, maxSamples: 2048, defaultSamples: 400, maxAbsRange: 1e6 } as const

const FUNCTIONS: Readonly<Record<string, (v: number) => number>> = Object.freeze({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs,
})
const CONSTANTS: Readonly<Record<string, number>> = Object.freeze({ pi: Math.PI, e: Math.E })
const has = (table: object, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key)

type Token =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'x' }
  | { readonly t: 'fn'; readonly name: string }
  | { readonly t: 'op'; readonly op: '+' | '-' | '*' | '/' | '^' }
  | { readonly t: '(' } | { readonly t: ')' }

type Rpn = { readonly k: 'num'; readonly v: number } | { readonly k: 'x' } | { readonly k: 'fn'; readonly f: (v: number) => number }
  | { readonly k: 'bin'; readonly op: '+' | '-' | '*' | '/' | '^' } | { readonly k: 'neg' }

export type CompileResult = { readonly ok: true; readonly evaluate: (x: number) => number } | { readonly ok: false; readonly issue: string }

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/

function tokenize(expr: string): Token[] | string {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i] as string
    if (ch === ' ' || ch === '\t') { i += 1; continue }
    const num = NUMBER.exec(expr.slice(i, i + 64))
    if (num !== null) { tokens.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(expr.slice(i, i + 16))?.[0] ?? ''
      i += word.length
      if (word === 'x') tokens.push({ t: 'x' })
      else if (has(CONSTANTS, word)) tokens.push({ t: 'num', v: CONSTANTS[word] as number })
      else if (has(FUNCTIONS, word)) tokens.push({ t: 'fn', name: word })
      else return `unknown name "${word.slice(0, 16)}"`
      continue
    }
    if (ch === '(' || ch === ')') { tokens.push({ t: ch }); i += 1; continue }
    const op = ch === '−' ? '-' : ch === '×' || ch === '⋅' || ch === '·' ? '*' : ch
    if (op === '+' || op === '-' || op === '*' || op === '/' || op === '^') {
      if (op === '*' && expr[i + 1] === '*') return 'use ^ for powers'
      tokens.push({ t: 'op', op }); i += 1; continue
    }
    return `unexpected character "${ch}"`
  }
  return tokens
}

const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, neg: 3, '^': 4 } as const

/** Compile an expression in `x`. */
export function compileExpr(expr: string): CompileResult {
  if (typeof expr !== 'string' || expr.trim().length === 0) return { ok: false, issue: 'expression is empty' }
  if (expr.length > PLOT_EXPR_LIMITS.maxExprChars) return { ok: false, issue: `expression exceeds ${String(PLOT_EXPR_LIMITS.maxExprChars)} characters` }
  const raw = tokenize(expr)
  if (typeof raw === 'string') return { ok: false, issue: raw }
  // Implicit multiplication after a number: 2x, 2(…), 2sin(…), 2pi.
  const tokens: Token[] = []
  for (const token of raw) {
    const prev = tokens.at(-1)
    if (prev?.t === 'num' && (token.t === 'x' || token.t === '(' || token.t === 'fn' || token.t === 'num')) tokens.push({ t: 'op', op: '*' })
    tokens.push(token)
  }
  const out: Rpn[] = []
  const stack: Array<{ k: 'op'; op: '+' | '-' | '*' | '/' | '^' } | { k: 'neg' } | { k: '(' } | { k: 'fn'; name: string }> = []
  let expectOperand = true
  const precOf = (e: (typeof stack)[number]): number => e.k === 'neg' ? PRECEDENCE.neg : e.k === 'op' ? PRECEDENCE[e.op] : -1
  const pop = (): void => {
    const top = stack.pop()
    if (top === undefined || top.k === '(') return
    if (top.k === 'neg') out.push({ k: 'neg' })
    else if (top.k === 'op') out.push({ k: 'bin', op: top.op })
    else out.push({ k: 'fn', f: FUNCTIONS[top.name] as (v: number) => number })
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token
    if (token.t === 'num' || token.t === 'x') {
      if (!expectOperand) return { ok: false, issue: 'missing operator' }
      out.push(token.t === 'num' ? { k: 'num', v: token.v } : { k: 'x' }); expectOperand = false; continue
    }
    if (token.t === 'fn') {
      if (!expectOperand) return { ok: false, issue: 'missing operator' }
      if (tokens[i + 1]?.t !== '(') return { ok: false, issue: `${token.name} needs parentheses` }
      stack.push({ k: 'fn', name: token.name }); continue
    }
    if (token.t === '(') {
      if (!expectOperand) return { ok: false, issue: 'missing operator' }
      stack.push({ k: '(' }); continue
    }
    if (token.t === ')') {
      if (expectOperand) return { ok: false, issue: 'empty or incomplete parentheses' }
      while (stack.length > 0 && stack.at(-1)?.k !== '(') pop()
      if (stack.at(-1)?.k !== '(') return { ok: false, issue: 'unbalanced parentheses' }
      stack.pop()
      if (stack.at(-1)?.k === 'fn') pop()
      continue
    }
    // Operator.
    if (expectOperand) {
      if (token.op === '-') { stack.push({ k: 'neg' }); continue }
      if (token.op === '+') continue
      return { ok: false, issue: `operator ${token.op} needs a left operand` }
    }
    const prec = PRECEDENCE[token.op]
    const rightAssoc = token.op === '^'
    while (stack.length > 0) {
      const top = stack.at(-1) as (typeof stack)[number]
      if (top.k === '(' || top.k === 'fn') break
      const topPrec = precOf(top)
      if (topPrec > prec || (topPrec === prec && !rightAssoc)) pop(); else break
    }
    stack.push({ k: 'op', op: token.op }); expectOperand = true
  }
  if (expectOperand) return { ok: false, issue: 'expression ends with an operator' }
  while (stack.length > 0) {
    if (stack.at(-1)?.k === '(') return { ok: false, issue: 'unbalanced parentheses' }
    pop()
  }
  // Arity check: the program must leave exactly one value.
  let depth = 0
  for (const op of out) { depth += op.k === 'num' || op.k === 'x' ? 1 : op.k === 'bin' ? -1 : 0; if (depth < 1) return { ok: false, issue: 'malformed expression' } }
  if (depth !== 1) return { ok: false, issue: 'malformed expression' }
  const program = Object.freeze(out)
  const evaluate = (x: number): number => {
    const values: number[] = []
    for (const op of program) {
      switch (op.k) {
        case 'num': values.push(op.v); break
        case 'x': values.push(x); break
        case 'neg': values.push(-(values.pop() as number)); break
        case 'fn': values.push(op.f(values.pop() as number)); break
        case 'bin': {
          const b = values.pop() as number, a = values.pop() as number
          values.push(op.op === '+' ? a + b : op.op === '-' ? a - b : op.op === '*' ? a * b : op.op === '/' ? a / b : a ** b)
        }
      }
    }
    return values[0] as number
  }
  return { ok: true, evaluate }
}

export interface FunctionPlotSpec {
  readonly title: string
  readonly subtitle?: string
  readonly fns: ReadonlyArray<{ readonly expr: string; readonly label?: string }>
  readonly x: readonly [number, number]
  readonly y?: readonly [number, number]
  readonly samples?: number
  readonly xLabel?: string
  readonly yLabel?: string
}

export type FunctionPlotResult = { readonly ok: true; readonly content: LinePlotContent } | { readonly ok: false; readonly issues: readonly string[] }

const finiteRange = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PLOT_EXPR_LIMITS.maxAbsRange) && (r[0] as number) < (r[1] as number)

/** Sample bounded functions into an ordinary, validated RichContentV1 line plot. */
export function sampleFunctionPlot(spec: FunctionPlotSpec): FunctionPlotResult {
  const issues: string[] = []
  if (spec === null || typeof spec !== 'object') return { ok: false, issues: ['plot spec must be an object'] }
  if (typeof spec.title !== 'string' || spec.title.trim().length === 0 || spec.title.length > RICH_LIMITS.maxTitleLength) issues.push('title must be a non-empty string')
  if (!Array.isArray(spec.fns) || spec.fns.length === 0) issues.push('fns must list at least one function')
  else if (spec.fns.length > PLOT_EXPR_LIMITS.maxFunctions) issues.push(`at most ${String(PLOT_EXPR_LIMITS.maxFunctions)} functions`)
  if (!finiteRange(spec.x)) issues.push('x must be [min, max] with min < max')
  if (spec.y !== undefined && !finiteRange(spec.y)) issues.push('y must be [min, max] with min < max')
  const samples = spec.samples ?? PLOT_EXPR_LIMITS.defaultSamples
  if (!Number.isInteger(samples) || samples < 2 || samples > PLOT_EXPR_LIMITS.maxSamples) issues.push(`samples must be an integer from 2 to ${String(PLOT_EXPR_LIMITS.maxSamples)}`)
  if (issues.length > 0) return { ok: false, issues }
  const compiled = spec.fns.map((fn, index) => {
    const result = typeof fn?.expr === 'string' ? compileExpr(fn.expr) : { ok: false as const, issue: 'expr must be a string' }
    if (!result.ok) issues.push(`fns[${String(index)}]: ${result.issue}`)
    return result
  })
  if (issues.length > 0) return { ok: false, issues }
  const [x0, x1] = spec.x
  const yLimit = spec.y
  const budget = RICH_LIMITS.maxSeries
  const series: PlotSeries[] = []
  spec.fns.forEach((fn, index) => {
    const evaluate = (compiled[index] as Extract<CompileResult, { ok: true }>).evaluate
    const name = (typeof fn.label === 'string' && fn.label.trim().length > 0 ? fn.label : fn.expr).slice(0, 80)
    const runs: Array<{ x: number; y: number }[]> = [[]]
    for (let i = 0; i < samples; i++) {
      const x = x0 + (x1 - x0) * i / (samples - 1)
      const y = evaluate(x)
      const inside = Number.isFinite(y) && Math.abs(y) <= RICH_LIMITS.maxAbsCoordinate && (yLimit === undefined || (y >= yLimit[0] && y <= yLimit[1]))
      if (inside) (runs.at(-1) as { x: number; y: number }[]).push({ x, y })
      else if ((runs.at(-1) as unknown[]).length > 0) runs.push([])
    }
    const nonEmpty = runs.filter(run => run.length > 0)
    // Each gap starts a new series while the series budget lasts; later runs join the last one.
    const remaining = budget - series.length - (spec.fns.length - index - 1)
    const keep = Math.max(1, remaining)
    nonEmpty.slice(0, keep - 1).forEach(run => series.push({ name, points: run }))
    const rest = nonEmpty.slice(keep - 1).flat()
    if (rest.length > 0 || nonEmpty.length === 0) series.push({ name, points: rest })
  })
  const content: LinePlotContent = {
    schemaVersion: 1, type: 'line_plot', title: spec.title,
    ...typeof spec.subtitle === 'string' ? { subtitle: spec.subtitle } : {},
    data: {
      series,
      xAxis: { ...typeof spec.xLabel === 'string' ? { label: spec.xLabel } : {}, min: x0, max: x1 },
      ...yLimit !== undefined || typeof spec.yLabel === 'string'
        ? { yAxis: { ...typeof spec.yLabel === 'string' ? { label: spec.yLabel } : {}, ...yLimit !== undefined ? { min: yLimit[0], max: yLimit[1] } : {} } }
        : {},
    },
  }
  const valid = validateRichContent(content)
  if (!valid.ok) return { ok: false, issues: ['sampled plot did not validate'] }
  return { ok: true, content }
}
