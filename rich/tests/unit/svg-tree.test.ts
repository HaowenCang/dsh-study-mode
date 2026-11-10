/**
 * Inline rendering (plan P1/P3): the rich_svg allowlist exposes its rebuilt tree so the client can
 * build React elements directly (no innerHTML), including a tolerant partial mode for streaming.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizeSvg, sanitizeSvgTree } from '../../src/shared/svg-sanitize'
import { svgTreeToReact } from '../../src/client/inline/svg-react'

const DRAWING = '<svg viewBox="0 0 120 60" fill="currentColor" font-family="sans-serif">'
  + '<defs><marker id="ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>'
  + '<line x1="0" y1="30" x2="100" y2="30" stroke="currentColor" stroke-width="2" marker-end="url(#ah)"/>'
  + '<text x="4" y="12" font-size="10">a &lt; b &amp; "c"</text></svg>'

const render = (source: string, prefix = 'p1'): string => {
  const tree = sanitizeSvgTree(source)
  assert.ok(tree.ok, JSON.stringify(tree))
  return renderToStaticMarkup(svgTreeToReact(tree, { idPrefix: prefix, createElement }))
}

describe('sanitizeSvgTree', () => {
  it('agrees with sanitizeSvg on acceptance and issues', () => {
    for (const source of [DRAWING, '<svg viewBox="0 0 1 1"><script/></svg>', '<svg viewBox="0 0 1 1"><rect onclick="x"/></svg>', '<svg/>', '<svg viewBox="0 0 1 1"><rect fill="url(#g)"/></svg>']) {
      const string = sanitizeSvg(source)
      const tree = sanitizeSvgTree(source)
      assert.equal(tree.ok, string.ok, source)
      if (!tree.ok && !string.ok) assert.deepEqual(tree.issues, string.issues)
    }
  })

  it('keeps currentColor in the tree (the string form still pins it for files)', () => {
    const tree = sanitizeSvgTree(DRAWING)
    assert.ok(tree.ok)
    assert.equal(tree.rootPaint.get('fill'), 'currentColor')
    const string = sanitizeSvg(DRAWING)
    assert.ok(string.ok && !string.inner.includes('currentColor'))
  })

  it('partial mode drops an incomplete trailing tag and closes open elements', () => {
    const tree = sanitizeSvgTree('<svg viewBox="0 0 10 10"><g><rect x="1" y="1" width="2" height="2"/><circ', { partial: true })
    assert.ok(tree.ok, JSON.stringify(tree))
    assert.equal(tree.elements, 2)
    const markup = renderToStaticMarkup(svgTreeToReact(tree, { idPrefix: 'p', createElement }))
    assert.match(markup, /<g><rect x="1" y="1" width="2" height="2"><\/rect><\/g>/)
  })

  it('partial mode tolerates a cut inside an attribute value, a comment or text', () => {
    for (const source of ['<svg viewBox="0 0 10 10"><rect x="1', '<svg viewBox="0 0 10 10"><!-- note', '<svg viewBox="0 0 10 10"><text x="1" y="2">hal']) {
      const tree = sanitizeSvgTree(source, { partial: true })
      assert.ok(tree.ok, source + ' ' + JSON.stringify(tree))
    }
  })

  it('partial mode is not ready before the root viewBox is complete', () => {
    for (const source of ['', '<sv', '<svg viewBox="0 0 1']) {
      const tree = sanitizeSvgTree(source, { partial: true })
      assert.equal(tree.ok, false, source)
    }
  })

  it('partial mode still refuses disallowed content', () => {
    const tree = sanitizeSvgTree('<svg viewBox="0 0 10 10"><script>', { partial: true })
    assert.equal(tree.ok, false)
  })

  it('strict mode still refuses an unclosed document', () => {
    assert.equal(sanitizeSvgTree('<svg viewBox="0 0 10 10"><g>').ok, false)
  })
})

describe('svgTreeToReact', () => {
  it('rebuilds allowlisted geometry with camelCase props and escaped text', () => {
    const markup = render(DRAWING)
    assert.match(markup, /^<svg viewBox="0 0 120 60" fill="currentColor"/)
    assert.match(markup, /stroke-width="2"/)
    assert.match(markup, /font-size="10"/)
    assert.ok(markup.includes('a &lt; b &amp; &quot;c&quot;'), markup)
    assert.ok(!markup.includes('font-family'), 'root font-family is dropped like in the card')
  })

  it('prefixes marker ids and references per instance', () => {
    const a = render(DRAWING, 'fig-a')
    const b = render(DRAWING, 'fig-b')
    assert.match(a, /<marker id="fig-a-ah"/)
    assert.match(a, /marker-end="url\(#fig-a-ah\)"/)
    assert.match(b, /<marker id="fig-b-ah"/)
  })

  it('normalises an unsafe prefix', () => {
    const markup = render(DRAWING, ':r1:"><x')
    assert.match(markup, /<marker id="r1-x-ah"|<marker id="[A-Za-z][\w-]*-ah"/)
    assert.ok(!markup.includes('"><x'))
  })

  it('never emits event handlers, styles, links or foreign content', () => {
    const hostile = [
      '<svg viewBox="0 0 1 1"><rect onload="alert(1)"/></svg>',
      '<svg viewBox="0 0 1 1"><rect style="fill:red"/></svg>',
      '<svg viewBox="0 0 1 1"><a href="javascript:1"><rect/></a></svg>',
      '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
      '<svg viewBox="0 0 1 1"><image href="x.png"/></svg>',
      '<svg viewBox="0 0 1 1"><use href="#a"/></svg>',
    ]
    for (const source of hostile) assert.equal(sanitizeSvgTree(source).ok, false, source)
  })
})

describe('P9 independent review: hostile input never throws', () => {
  const head = '<svg viewBox="0 0 10 10">'
  it('R1: nesting deeper than the limit is refused, not a stack overflow (strict and partial)', () => {
    const deep = head + '<g>'.repeat(9000) + '</g>'.repeat(9000) + '</svg>'
    for (const source of [deep, head + '<g>'.repeat(21000)]) {
      for (const partial of [false, true]) {
        let result: ReturnType<typeof sanitizeSvgTree> | undefined
        assert.doesNotThrow(() => { result = sanitizeSvgTree(source, { partial }) })
        assert.ok(result !== undefined && !result.ok && result.issues.some(issue => issue.includes('nesting deeper')), JSON.stringify(result).slice(0, 200))
      }
    }
    assert.doesNotThrow(() => sanitizeSvg(deep))
  })

  it('R2: Object prototype names are never allowlisted elements, attributes or entities', () => {
    for (const source of [
      head + '<rect constructor="javascript:alert(1)" toString="z" width="1"/></svg>',
      head + '<constructor>x</constructor></svg>',
      head + '<hasOwnProperty/></svg>',
      head + '<rect __proto__="x"/></svg>',
      head + '<constructor name="x"/></svg>',
      head + '<rect __defineGetter__="x"/></svg>',
      '<svg viewBox="0 0 10 10" constructor="x"></svg>',
      head + '<text x="1" y="1">&constructor;</text></svg>',
    ]) {
      for (const partial of [false, true]) {
        let result: ReturnType<typeof sanitizeSvgTree> | undefined
        assert.doesNotThrow(() => { result = sanitizeSvgTree(source, { partial }) }, source)
        assert.equal(result?.ok, false, source)
      }
    }
    // Not entity syntax (letters only), so it stays literal text and is never decoded.
    const literal = sanitizeSvgTree(head + '<text x="1" y="1">&__proto__;</text></svg>')
    assert.ok(literal.ok)
    assert.match(renderToStaticMarkup(svgTreeToReact(literal, { idPrefix: 't', createElement })), /&amp;__proto__;/)
  })
})
