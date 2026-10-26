/**
 * Unit tests for the `line_plot` SVG renderer.
 *
 * Every coordinate assertion is derived from the documented plot rectangle
 * (left 64, top 12, width 560, height 184 for the default 640x240 frame), so a
 * regression in the renderer or in the shared scale module fails loudly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LinePlotView } from '../../src/client/renderers/line-plot'
import type { RendererTheme } from '../../src/client/renderers/types'
import type { LinePlotContent } from '../../src/shared/index'

const theme: RendererTheme = {
  text: '#1b1f24',
  muted: '#6b7280',
  border: '#d9dee7',
  surface: '#f6f7f9',
  accent: '#247bbf',
  series: ['#d94f2b', '#247bbf', '#1a7f37'],
}

const SINE_SAMPLES = 33

function render(content: LinePlotContent): string {
  return renderToStaticMarkup(createElement(LinePlotView, { content, theme, width: 640 }))
}

function pairs(points: string): readonly (readonly [number, number])[] {
  if (points.trim().length === 0) return []
  return points.trim().split(/\s+/).map(entry => {
    const [x, y] = entry.split(',')
    return [Number(x), Number(y)] as const
  })
}

function polyline(markup: string): readonly (readonly [number, number])[] {
  const match = /<polyline\b[^>]*data-dsh-rich="line"[^>]*points="([^"]*)"/.exec(markup)
  assert.ok(match !== null, 'expected one rendered polyline')
  return pairs(match[1] as string)
}

function countOccurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

function sineContent(): LinePlotContent {
  const points = Array.from({ length: SINE_SAMPLES }, (_, index) => {
    const x = (index * 2 * Math.PI) / (SINE_SAMPLES - 1)
    return { x, y: Math.sin(x) }
  })
  return {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'Sine wave',
    subtitle: 'one period',
    data: {
      series: [{ name: 'sin(x)', points }],
      xAxis: { label: 'Time', unit: 's' },
      yAxis: { label: 'Voltage', unit: 'V' },
    },
  }
}

test('line plot: renders the accessible SVG shell and clipped plot area', () => {
  const markup = render(sineContent())
  assert.match(markup, /data-dsh-rich="line-plot"/)
  assert.match(markup, /<svg [^>]*role="img"/)
  assert.match(markup, /data-dsh-rich-chart="line-plot"/)
  const aria = /aria-label="([^"]*)"/.exec(markup)
  assert.ok(aria !== null)
  assert.match(aria[1] as string, /Line plot Sine wave/)
  assert.match(aria[1] as string, /1 series, 33 points/)
  assert.match(aria[1] as string, /x unit s/)
  assert.match(aria[1] as string, /y unit V/)
  assert.match(markup, /data-dsh-rich="plot-area" clip-path="url\(#/)
  assert.match(markup, /<clipPath id="[^"]+"><rect x="64" y="12" width="560" height="184">/)
  assert.match(markup, /width="640" height="240" viewBox="0 0 640 240"/)
})

test('line plot: sine samples map monotonically to the expected pixel path', () => {
  const markup = render(sineContent())
  const path = polyline(markup)
  assert.equal(path.length, SINE_SAMPLES)
  // x: 0 -> 64, pi/2 -> 204, pi -> 344, 3pi/2 -> 484, 2pi -> 624
  // y: -1 -> 196, -0.5 -> 150, 0 -> 104, 0.5 -> 58, 1 -> 12
  assert.deepEqual(path[0], [64, 104])
  assert.deepEqual(path[8], [204, 12])
  assert.deepEqual(path[16], [344, 104])
  assert.deepEqual(path[24], [484, 196])
  assert.deepEqual(path[32], [624, 104])
  for (let index = 1; index <= 8; index += 1) {
    assert.ok((path[index] as readonly [number, number])[1] < (path[index - 1] as readonly [number, number])[1])
  }
  for (let index = 16; index <= 24; index += 1) {
    assert.ok((path[index] as readonly [number, number])[1] > (path[index - 1] as readonly [number, number])[1])
  }
  assert.match(markup, /data-dsh-rich-series="0"/)
  assert.match(markup, /data-dsh-rich-series-name="sin\(x\)"/)
  assert.equal(countOccurrences(markup, 'data-dsh-rich="point-hit"'), SINE_SAMPLES)
  assert.match(markup, /data-dsh-rich-point-index="0"/)
  assert.match(markup, /data-dsh-rich-point-index="32"/)
})

test('line plot: axes expose unit labels and a bounded number of ticks', () => {
  const markup = render(sineContent())
  assert.match(markup, /data-dsh-rich="axis-title" data-dsh-rich-axis="x"[^>]*>Time \(s\)<\/text>/)
  assert.match(markup, /data-dsh-rich="axis-title" data-dsh-rich-axis="y"[^>]*>Voltage \(V\)<\/text>/)
  assert.match(markup, />0\.0 V<\/text>/)
  assert.match(markup, />1\.0 V<\/text>/)
  const xTicks = countOccurrences(markup, 'data-dsh-rich="tick" data-dsh-rich-axis="x"')
  const yTicks = countOccurrences(markup, 'data-dsh-rich="tick" data-dsh-rich-axis="y"')
  assert.ok(xTicks >= 2 && xTicks <= 12, `x tick count was ${String(xTicks)}`)
  assert.ok(yTicks >= 2 && yTicks <= 12, `y tick count was ${String(yTicks)}`)
  assert.ok(countOccurrences(markup, 'data-dsh-rich="grid-line"') >= 2)
  assert.match(markup, /data-dsh-rich="axis-line" data-dsh-rich-axis="x"/)
  assert.match(markup, /data-dsh-rich="axis-line" data-dsh-rich-axis="y"/)
})

test('line plot: quadratic curve with explicit axes maps endpoints exactly', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'quadratic',
    data: {
      series: [{
        name: 'x^2',
        points: [-2, -1, 0, 1, 2].map(x => ({ x, y: x * x })),
      }],
      xAxis: { min: -2, max: 2, label: 'x' },
      yAxis: { min: 0, max: 4, label: 'y' },
    },
  }
  const markup = render(content)
  assert.deepEqual(polyline(markup), [
    [64, 12],
    [204, 150],
    [344, 196],
    [484, 150],
    [624, 12],
  ])
})

test('line plot: normalized wave with explicit 0..1 y axis maps to the plot edges', () => {
  const sampleAt = (x: number): { x: number; y: number } => ({ x, y: (Math.sin(x) + 1) / 2 })
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'normalized wave',
    data: {
      series: [{
        name: 'wave',
        points: [sampleAt(0), sampleAt(Math.PI / 2), sampleAt(Math.PI), sampleAt((3 * Math.PI) / 2), sampleAt(2 * Math.PI)],
      }],
      xAxis: { min: 0, max: 2 * Math.PI },
      yAxis: { min: 0, max: 1 },
    },
  }
  const path = polyline(render(content))
  assert.deepEqual(path, [
    [64, 104],
    [204, 12],
    [344, 104],
    [484, 196],
    [624, 104],
  ])
})

test('line plot: empty data renders the explanatory state without NaN', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'nothing',
    data: { series: [{ name: 'empty', points: [] }] },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="empty"/)
  assert.match(markup, /No data points to plot\./)
  assert.ok(!markup.includes('NaN'))
  assert.ok(!markup.includes('<polyline'))
  assert.ok(!markup.includes('<svg'))
})

test('line plot: all series empty still yields the explanatory state', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'nothing at all',
    data: { series: [{ name: 'a', points: [] }, { name: 'b', points: [] }] },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="empty"/)
  assert.ok(!markup.includes('NaN'))
})

test('line plot: one empty series plus one populated series still draws the curve', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'mixed',
    data: {
      series: [
        { name: 'empty', points: [] },
        { name: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      ],
    },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="line-plot"/)
  assert.equal(countOccurrences(markup, '<polyline'), 1)
  assert.ok(!markup.includes('NaN'))
})

test('line plot: a single point renders one marker in the plot centre', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'single',
    data: { series: [{ name: 'one', points: [{ x: 5, y: 7 }] }] },
  }
  const markup = render(content)
  assert.ok(!markup.includes('NaN'))
  assert.match(markup, /data-dsh-rich="point" data-dsh-rich-series-index="0" data-dsh-rich-point-index="0" cx="344" cy="104"/)
  assert.equal(countOccurrences(markup, '<polyline'), 0)
  assert.match(markup, /data-dsh-rich-point-index="0"/)
})

test('line plot: legend appears only for multiple series and uses theme colours', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'two series',
    data: {
      series: [
        { name: 'first', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        { name: 'second', color: '#123456', points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
      ],
    },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="legend"/)
  assert.match(markup, /data-dsh-rich-series-name="first"/)
  assert.match(markup, /data-dsh-rich-series-name="second"/)
  assert.match(markup, /stroke="#d94f2b"/)
  assert.match(markup, /stroke="#123456"/)
})

test('line plot: model text containing markup is escaped, never executed', () => {
  const content: LinePlotContent = {
    schemaVersion: 1,
    type: 'line_plot',
    title: '<script>alert(1)</script>',
    subtitle: '<img src=x onerror=alert(2)>',
    data: {
      series: [{ name: '<img src=x onerror=alert(3)>', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    },
  }
  const markup = render(content)
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(markup.includes('&lt;img'))
})
