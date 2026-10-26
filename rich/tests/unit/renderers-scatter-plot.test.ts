/**
 * Unit tests for the `scatter_plot` SVG renderer: one circle per point,
 * duplicate x values preserved (no merging, no key collisions), degenerate
 * single-point input, empty state, and escaped model text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScatterPlotView } from '../../src/client/renderers/scatter-plot'
import type { RendererTheme } from '../../src/client/renderers/types'
import type { ScatterPlotContent } from '../../src/shared/index'

const theme: RendererTheme = {
  text: '#1b1f24',
  muted: '#6b7280',
  border: '#d9dee7',
  surface: '#f6f7f9',
  accent: '#247bbf',
  series: ['#d94f2b', '#247bbf', '#1a7f37'],
}

function render(content: ScatterPlotContent): string {
  return renderToStaticMarkup(createElement(ScatterPlotView, { content, theme, width: 640 }))
}

interface RenderedCircle {
  readonly index: string
  readonly cx: number
  readonly cy: number
  readonly fill: string
}

function circles(markup: string): readonly RenderedCircle[] {
  const found: RenderedCircle[] = []
  const tagPattern = /<circle\b[^>]*>/g
  for (const match of markup.matchAll(tagPattern)) {
    const tag = match[0]
    if (!tag.includes('data-dsh-rich="point"')) continue
    const attribute = (name: string): string => {
      const value = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
      return value?.[1] ?? ''
    }
    found.push({
      index: attribute('data-dsh-rich-point-index'),
      cx: Number(attribute('cx')),
      cy: Number(attribute('cy')),
      fill: attribute('fill'),
    })
  }
  return found
}

const duplicateX: ScatterPlotContent = {
  schemaVersion: 1,
  type: 'scatter_plot',
  title: 'duplicates',
  data: {
    series: [{
      name: 'points',
      points: [
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
        { x: 2, y: 1 },
      ],
    }],
    xAxis: { label: 'Time', unit: 's' },
    yAxis: { label: 'Voltage', unit: 'V' },
  },
}

test('scatter plot: N points produce N circles at the expected coordinates', () => {
  const markups = render(duplicateX)
  const rendered = circles(markups)
  assert.equal(rendered.length, 4)
  assert.deepEqual(rendered.map(item => [item.cx, item.cy]), [
    [64, 196],
    [64, 104],
    [64, 12],
    [624, 196],
  ])
  assert.deepEqual(rendered.map(item => item.index), ['0', '1', '2', '3'])
  assert.match(markups, /data-dsh-rich-series="0"/)
  assert.match(markups, /data-dsh-rich-series-name="points"/)
  assert.match(markups, /role="img"/)
})

test('scatter plot: duplicate x values are preserved, not merged', () => {
  const rendered = circles(render(duplicateX))
  const duplicateColumn = rendered.filter(item => item.cx === 64)
  assert.equal(duplicateColumn.length, 3)
  assert.deepEqual(duplicateColumn.map(item => item.cy), [196, 104, 12])
})

test('scatter plot: explicit axis overrides control the mapping', () => {
  const content: ScatterPlotContent = {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: 'overrides',
    data: {
      series: [{ name: 'p', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      xAxis: { min: -1, max: 3 },
      yAxis: { min: -2, max: 2 },
    },
  }
  const rendered = circles(render(content))
  // x: (0-(-1))/4 * 560 + 64 = 204, (1-(-1))/4 * 560 + 64 = 344
  // y: 196 - (0-(-2))/4 * 184 = 104, 196 - (1-(-2))/4 * 184 = 58
  assert.deepEqual(rendered.map(item => [item.cx, item.cy]), [[204, 104], [344, 58]])
})

test('scatter plot: single point lands in the plot centre without NaN', () => {
  const content: ScatterPlotContent = {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: 'single',
    data: { series: [{ name: 'one', points: [{ x: 5, y: 7 }] }] },
  }
  const markup = render(content)
  const rendered = circles(markup)
  assert.equal(rendered.length, 1)
  assert.deepEqual([rendered[0]?.cx, rendered[0]?.cy], [344, 104])
  assert.ok(!markup.includes('NaN'))
})

test('scatter plot: empty data renders the explanatory state without NaN', () => {
  const content: ScatterPlotContent = {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: 'empty',
    data: { series: [{ name: 'none', points: [] }] },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="empty"/)
  assert.match(markup, /No data points to plot\./)
  assert.ok(!markup.includes('NaN'))
  assert.ok(!markup.includes('<circle'))
})

test('scatter plot: series colour comes from the payload or the theme palette', () => {
  const content: ScatterPlotContent = {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: 'colours',
    data: {
      series: [
        { name: 'theme', points: [{ x: 0, y: 0 }] },
        { name: 'custom', color: '#123456', points: [{ x: 1, y: 1 }] },
      ],
    },
  }
  const rendered = circles(render(content))
  assert.equal(rendered[0]?.fill, '#d94f2b')
  assert.equal(rendered[1]?.fill, '#123456')
})

test('scatter plot: units and point counts are exposed to assistive tech', () => {
  const markup = render(duplicateX)
  const aria = /aria-label="([^"]*)"/.exec(markup)
  assert.ok(aria !== null)
  assert.match(aria[1] as string, /Scatter plot duplicates/)
  assert.match(aria[1] as string, /1 series, 4 points/)
  assert.match(aria[1] as string, /x unit s/)
  assert.match(aria[1] as string, /y unit V/)
  assert.match(markup, />1\.0 V<\/text>/)
  assert.match(markup, /data-dsh-rich="axis-title" data-dsh-rich-axis="x"[^>]*>Time \(s\)<\/text>/)
})

test('scatter plot: model text containing markup is escaped', () => {
  const content: ScatterPlotContent = {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: '<script>alert(1)</script>',
    data: { series: [{ name: '<img src=x onerror=alert(2)>', points: [{ x: 0, y: 0 }] }] },
  }
  const markup = render(content)
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(markup.includes('&lt;img'))
})
