/**
 * Inline figure renderers (plan P5): Mermaid flowcharts, function/data plots, heatmaps and physics
 * demos drawn in the reply body from fenced blocks, through the same validators as the rich_* tools.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FigureFence } from '../../src/client/inline/figure-fence'
import type { FigureRender } from '../../src/client/inline/figure-fence'
import { createFigureRenderers, FIGURE_JSON_LIMIT, mermaidTitle, parseFigureJson } from '../../src/client/inline/figure-renderers'
import type { Primitives } from '../../src/client/inline/types'

const renderers = createFigureRenderers()
const run = (lang: string, source: string, closed = true, streaming = false): FigureRender => {
  const renderer = renderers[lang]
  assert.ok(renderer, 'renderer for ' + lang)
  return renderer({ source, closed, streaming, lang, figureKey: 's:1:0:0' })
}
const primitives: Primitives = {
  MarkdownText: ({ text }) => createElement('div', null, text),
  CodeBlock: ({ code, lang }) => createElement('pre', { 'data-code': lang ?? '' }, code),
}
const labels = { code: { copyLabel: 'c', copiedLabel: 'd', toolbarLabels: { codeLabel: 'code', wrapLabel: 'w', unwrapLabel: 'u' } }, footnotes: 'f' }
const fence = (lang: string, source: string, closed = true, streaming = false): string =>
  renderToStaticMarkup(createElement(FigureFence, { lang, source, closed, streaming, primitives, labels, renderers, figureKey: 's:1:0:0' }))
const markup = (render: FigureRender): string => {
  assert.equal(render.kind, 'figure', JSON.stringify(render))
  return renderToStaticMarkup(createElement('div', null, render.kind === 'figure' ? render.node : null))
}

const FLOW = 'flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| D[Retry]'

describe('mermaid fences', () => {
  it('compile through the rich_mermaid subset into a basic diagram', () => {
    const html = markup(run('mermaid', FLOW))
    assert.match(html, /<svg/)
    assert.match(html, /Start/)
    assert.match(html, /Check/)
  })

  it('draw the complete lines while streaming and never refuse an unfinished fence', () => {
    const partial = run('mermaid', 'flowchart LR\n  A[Start] --> B[Next]\n  B --> C[Th', false, true)
    assert.match(markup(partial), /Next/)
    assert.doesNotMatch(markup(partial), /Th</)
    assert.equal(run('mermaid', 'flowchart LR\n  A[St', false, true).kind, 'pending')
    assert.equal(run('mermaid', 'sequenceDiagram\n  A->>B: hi\n', false, true).kind, 'pending')
  })

  it('refuse unsupported diagrams with line numbers; a generic fence then shows code', () => {
    const refused = run('dsh-mermaid', 'flowchart LR\n  A --> B\n  click A callback')
    assert.equal(refused.kind, 'refused')
    if (refused.kind === 'refused') assert.ok(refused.issues.some(i => typeof i === 'object' && i.line === 3), JSON.stringify(refused.issues))
    assert.match(fence('mermaid', 'sequenceDiagram\n  A->>B: hi'), /data-dsh-figure-fallback="mermaid"/)
    assert.match(fence('dsh-mermaid', 'sequenceDiagram\n  A->>B: hi'), /data-state="refused"/)
  })

  it('take the title from a leading %% title comment', () => {
    assert.equal(mermaidTitle('%% title: Energy flow\nflowchart LR\nA-->B'), 'Energy flow')
    assert.equal(mermaidTitle('flowchart LR\nA-->B'), undefined)
  })
})

describe('dsh-plot fences', () => {
  it('sample a bounded function plot', () => {
    const html = markup(run('dsh-plot', JSON.stringify({ title: 'Damped', fns: [{ expr: 'exp(-x/4)*cos(2*x)', label: 'x(t)' }], x: [0, 10] })))
    assert.match(html, /<svg/)
    assert.match(html, /Damped/)
  })

  it('accept an ordinary RichContentV1 line or scatter plot, schemaVersion optional', () => {
    const scatter = { type: 'scatter_plot', title: 'Points', data: { series: [{ name: 's', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] }] } }
    assert.match(markup(run('dsh-plot', JSON.stringify(scatter))), /Points/)
    assert.match(markup(run('dsh-plot', JSON.stringify({ ...scatter, schemaVersion: 1 }))), /Points/)
  })

  it('wait while streaming and refuse invalid input when closed', () => {
    assert.equal(run('dsh-plot', '{"title":"x","fns":[{"expr":"sin(x', false, true).kind, 'pending')
    const bad = run('dsh-plot', JSON.stringify({ title: 't', fns: [{ expr: 'alert(1)' }], x: [0, 1] }))
    assert.equal(bad.kind, 'refused')
    assert.equal(run('dsh-plot', '{not json').kind, 'refused')
    assert.equal(run('dsh-plot', JSON.stringify({ type: 'message_card', title: 'x' })).kind, 'refused', 'only plots are drawn from dsh-plot')
  })
})

describe('dsh-heatmap and dsh-physics fences', () => {
  const HEAT = { schemaVersion: 1, title: 'Grid', values: [[0, 1], [2, 3]], colorScale: { palette: 'sequential', label: 'v' } }

  it('draw a validated heatmap and refuse an invalid one with paths', () => {
    assert.match(markup(run('dsh-heatmap', JSON.stringify(HEAT))), /Grid/)
    const bad = run('dsh-heatmap', JSON.stringify({ ...HEAT, values: [[0, 1], [2]] }))
    assert.equal(bad.kind, 'refused')
    if (bad.kind === 'refused') assert.ok(bad.issues.length > 0)
  })

  it('draw a named deterministic physics demo only', () => {
    assert.match(markup(run('dsh-physics', JSON.stringify({ demo: 'ising' }))), /Ising/)
    assert.equal(run('dsh-physics', JSON.stringify({ demo: 'ising', extra: 1 })).kind, 'refused')
    assert.equal(run('dsh-physics', JSON.stringify({ demo: 'rocket' })).kind, 'refused')
  })

  it('bound the JSON size before parsing', () => {
    const parsed = parseFigureJson(' '.repeat(FIGURE_JSON_LIMIT) + '{}')
    assert.equal(parsed.ok, false)
    assert.deepEqual(parseFigureJson('{"a":1}'), { ok: true, value: { a: 1 } })
  })
})

describe('P9 independent review: one bad figure never retires the inline renderer', () => {
  const SVG = '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000"/></svg>'
  const draw = (extra: Record<string, unknown>, lang = 'svg', source = SVG): string =>
    renderToStaticMarkup(createElement(FigureFence, { lang, source, closed: true, streaming: false, primitives, labels, renderers, figureKey: 's:1:0:0', ...extra }))

  it('R3: a throwing SVG paint step stays inside its figure', () => {
    let html = ''
    assert.doesNotThrow(() => { html = draw({ paint: () => { throw new Error('boom') } }, 'dsh-svg') })
    assert.match(html, /data-state="refused"/)
    assert.doesNotThrow(() => { html = draw({ paint: () => { throw new Error('boom') } }, 'svg') })
    assert.match(html, /data-dsh-figure-fallback="svg"/)
  })

  it('R3: a throwing renderer stays inside its figure', () => {
    let html = ''
    assert.doesNotThrow(() => { html = draw({ renderers: { 'dsh-plot': () => { throw new Error('boom') } } }, 'dsh-plot', '{}') })
    assert.match(html, /data-state="refused"/)
  })

  it('R4: marker ids differ between two figure instances even with the same React id', () => {
    const MARKED = '<svg viewBox="0 0 10 10"><defs><marker id="a" viewBox="0 0 2 2" refX="1" refY="1" markerWidth="2" markerHeight="2"><path d="M0 0 L2 1 L0 2 z"/></marker></defs><line x1="0" y1="0" x2="9" y2="9" stroke="#000" marker-end="url(#a)"/></svg>'
    const ids = [draw({}, 'svg', MARKED), draw({}, 'svg', MARKED)].map(html => /<marker[^>]* id="([^"]+)"/.exec(html)?.[1])
    assert.ok(ids[0] !== undefined && ids[1] !== undefined && ids[0] !== ids[1], JSON.stringify(ids))
  })
})
