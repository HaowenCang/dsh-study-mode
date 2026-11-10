/**
 * Plan P6: on-screen figures follow the DSH light/dark tokens, downloads stay self-contained light SVG.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { adaptPaint, luminance, parseColor, SURFACE } from '../../src/client/inline/paint'
import { literalSvgColors, PHYSICS_LIVE_THEME } from '../../src/client/physics-export'
import { HeatmapView } from '../../src/client/heatmap-view'
import { sanitizeSvgTree } from '../../src/shared/svg-sanitize'
import { svgTreeToReact } from '../../src/client/inline/svg-react'

describe('adaptPaint', () => {
  it('maps near-black ink to currentColor and near-white area fills to the page surface', () => {
    for (const black of ['#000', '#000000', 'black', '#1a1a1a', 'rgb(20, 20, 20)', 'rgba(0,0,0,0.8)']) {
      assert.equal(adaptPaint('stroke', black, 'line'), 'currentColor', black)
      assert.equal(adaptPaint('fill', black, 'text'), 'currentColor', black)
    }
    assert.equal(adaptPaint('fill', '#fff', 'rect'), SURFACE)
    assert.equal(adaptPaint('fill', 'white', 'circle'), SURFACE)
  })

  it('keeps hues, white text, white strokes, group fills and non-colour values', () => {
    for (const keep of ['#4884aa', '#c95132', 'hsl(10, 50%, 50%)', 'none', 'currentColor', 'transparent']) assert.equal(adaptPaint('fill', keep, 'rect'), keep)
    assert.equal(adaptPaint('fill', '#ffffff', 'text'), '#ffffff')
    assert.equal(adaptPaint('stroke', '#ffffff', 'rect'), '#ffffff')
    assert.equal(adaptPaint('fill', '#ffffff', 'g'), '#ffffff')
    assert.equal(adaptPaint('fill', '#ffffff', 'svg'), '#ffffff')
  })

  it('parses colours conservatively', () => {
    assert.deepEqual(parseColor('#abc'), [170, 187, 204])
    assert.deepEqual(parseColor('rgb(100%, 0%, 0%)'), [255, 0, 0])
    assert.equal(parseColor('rgb(300, 0, 0)'), undefined)
    assert.equal(parseColor('url(#x)'), undefined)
    // P9 review R2: prototype names are not colours.
    for (const name of ['constructor', 'toString', 'hasOwnProperty']) { assert.equal(parseColor(name), undefined, name); assert.equal(adaptPaint('fill', name, 'rect'), name) }
    assert.ok(luminance([255, 255, 255]) > 0.99 && luminance([0, 0, 0]) === 0)
  })

  it('applies inside the rebuilt SVG without touching structure', () => {
    const tree = sanitizeSvgTree('<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/><line x1="0" y1="0" x2="9" y2="9" stroke="#000"/><text x="1" y="5" fill="#ffffff">w</text></svg>')
    assert.ok(tree.ok)
    const html = renderToStaticMarkup(svgTreeToReact(tree, { idPrefix: 't', createElement, paint: adaptPaint }))
    assert.match(html, /<rect[^>]*fill="var\(--dsw-alias-bg-base, #ffffff\)"/)
    assert.match(html, /<line[^>]*stroke="currentColor"/)
    assert.match(html, /<text[^>]*fill="#ffffff"/)
  })
})

describe('heatmap and physics colours', () => {
  it('draw with theme tokens on screen and export literal light colours', () => {
    const svg = renderToStaticMarkup(createElement(HeatmapView, { width: 640, content: { schemaVersion: 1, title: 'T', values: [[0, 1], [2, 3]], colorScale: { palette: 'sequential', label: 'v' } } as never }))
    assert.match(svg, /fill="var\(--dsw-alias-bg-base, #ffffff\)"/)
    assert.match(svg, /var\(--dsw-alias-label-primary, #182433\)/)
    const exported = literalSvgColors(svg)
    assert.doesNotMatch(exported, /var\(/)
    assert.match(exported, /fill="#ffffff"/)
    assert.match(exported, /fill="#182433"/)
    assert.equal(PHYSICS_LIVE_THEME.series.length, 3)
  })

  it('literalSvgColors keeps fallbacks that contain parentheses', () => {
    assert.equal(literalSvgColors('a var(--x-y, rgba(0, 0, 0, 0.04)) b var(--z,#fff)'), 'a rgba(0, 0, 0, 0.04) b #fff')
    assert.equal(literalSvgColors('no tokens'), 'no tokens')
  })
})
