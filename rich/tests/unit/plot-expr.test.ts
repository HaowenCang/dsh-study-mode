/**
 * Inline rendering (plan P1/P5): `dsh-plot` function plots use a bounded expression evaluator,
 * never eval/Function, and produce an ordinary validated RichContentV1 line_plot.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compileExpr, PLOT_EXPR_LIMITS, sampleFunctionPlot } from '../../src/shared/plot-expr'
import { validateRichContent } from '../../src/shared/validation'

const value = (expr: string, x: number): number => {
  const compiled = compileExpr(expr)
  assert.ok(compiled.ok, expr + ' ' + JSON.stringify(compiled))
  return compiled.evaluate(x)
}

describe('compileExpr', () => {
  it('evaluates arithmetic with precedence, right-associative power and unary minus', () => {
    assert.equal(value('1 + 2 * 3', 0), 7)
    assert.equal(value('(1 + 2) * 3', 0), 9)
    assert.equal(value('2 ^ 3 ^ 2', 0), 512)
    assert.equal(value('-x ^ 2', 3), -9)
    assert.equal(value('-(x) + +2', 1), 1)
    assert.equal(value('10 / 4 - 1', 0), 1.5)
  })

  it('supports the allowed functions and constants', () => {
    assert.ok(Math.abs(value('sin(pi / 2)', 0) - 1) < 1e-12)
    assert.ok(Math.abs(value('cos(0) + exp(0) + log(e) + ln(1)', 0) - 3) < 1e-12)
    assert.equal(value('sqrt(abs(x))', -16), 4)
    assert.ok(Math.abs(value('tan(x)', 0.3) - Math.tan(0.3)) < 1e-12)
  })

  it('supports implicit multiplication after a number', () => {
    assert.equal(value('2x', 3), 6)
    assert.equal(value('3(x + 1)', 1), 6)
    assert.ok(Math.abs(value('2pi', 0) - 2 * Math.PI) < 1e-12)
    assert.ok(Math.abs(value('2sin(x)', Math.PI / 2) - 2) < 1e-12)
  })

  it('accepts scientific notation and the unicode minus and multiplication signs', () => {
    assert.equal(value('1.5e2 + 2E-1', 0), 150.2)
    assert.equal(value('2×x − 1', 3), 5)
  })

  it('refuses unknown identifiers, calls and syntax', () => {
    for (const expr of ['', 'y', 'alert(1)', 'constructor', 'x.y', 'x[0]', '1 +', '(1', '1)', 'sin x', 'sin()', 'sin(1, 2)', '2 ** 3', 'x = 1', '"a"', '`a`', 'globalThis', '__proto__', 'Math.sin(x)']) {
      assert.equal(compileExpr(expr).ok, false, expr)
    }
  })

  it('enforces the length limit', () => {
    assert.equal(compileExpr('x+'.repeat(PLOT_EXPR_LIMITS.maxExprChars) + 'x').ok, false)
  })

  it('does not use eval or Function', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile(new URL('../../src/shared/plot-expr.ts', import.meta.url), 'utf8').catch(() => '')
    if (source !== '') assert.ok(!/\beval\(|new Function|Function\(/.test(source))
  })
})

describe('sampleFunctionPlot', () => {
  it('samples functions into a valid line_plot', () => {
    const result = sampleFunctionPlot({ title: 'f', fns: [{ expr: 'sin(x)', label: 'sin' }, { expr: 'cos(x)' }], x: [0, 6.28], samples: 101 })
    assert.ok(result.ok, JSON.stringify(result))
    assert.deepEqual(validateRichContent(result.content).ok, true)
    assert.equal(result.content.type, 'line_plot')
    assert.equal(result.content.data.series.length, 2)
    assert.equal(result.content.data.series[0]?.name, 'sin')
    assert.equal(result.content.data.series[1]?.name, 'cos(x)')
    assert.equal(result.content.data.series[0]?.points.length, 101)
  })

  it('splits a series at gaps and points outside the y range', () => {
    const result = sampleFunctionPlot({ title: 'tan', fns: [{ expr: 'tan(x)' }], x: [-3, 3], y: [-5, 5], samples: 601 })
    assert.ok(result.ok, JSON.stringify(result))
    assert.ok(result.content.data.series.length >= 2 && result.content.data.series.length <= 8)
    for (const s of result.content.data.series) for (const p of s.points) assert.ok(Math.abs(p.y) <= 5)
    assert.deepEqual(result.content.data.yAxis, { min: -5, max: 5 })
    assert.ok(validateRichContent(result.content).ok)
  })

  it('drops non-finite values', () => {
    const result = sampleFunctionPlot({ title: 'log', fns: [{ expr: 'log(x)' }], x: [-1, 1], samples: 21 })
    assert.ok(result.ok)
    for (const s of result.content.data.series) for (const p of s.points) assert.ok(Number.isFinite(p.y))
  })

  it('refuses bad specs with readable issues', () => {
    for (const spec of [
      { title: 't', fns: [], x: [0, 1] },
      { title: 't', fns: [{ expr: 'q' }], x: [0, 1] },
      { title: 't', fns: [{ expr: 'x' }], x: [1, 0] },
      { title: 't', fns: [{ expr: 'x' }], x: [0, Number.NaN] },
      { title: 't', fns: Array.from({ length: 9 }, () => ({ expr: 'x' })), x: [0, 1] },
      { title: 't', fns: [{ expr: 'x' }], x: [0, 1], samples: PLOT_EXPR_LIMITS.maxSamples + 1 },
      { title: 't', fns: [{ expr: 'x' }], x: [0, 1], y: [2, 1] },
      { title: '', fns: [{ expr: 'x' }], x: [0, 1] },
      { fns: [{ expr: 'x' }], x: [0, 1] },
      null,
    ]) {
      const result = sampleFunctionPlot(spec as never)
      assert.equal(result.ok, false, JSON.stringify(spec))
      if (!result.ok) assert.ok(result.issues.length > 0)
    }
  })
})
