/**
 * `rich_heatmap`: bounded numeric matrix -> deterministic colored grid.
 *
 * Covers the shared validator (canonical value, cardinality pre-scan, finite
 * numbers, explicit scale and axis rules), scale/color resolution, the durable
 * envelope reader, the Host tool, and the SVG renderer geometry.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  HEATMAP_LIMITS,
  heatmapColor,
  readHeatmapMeta,
  resolveHeatmapScale,
  validateHeatmap,
  type HeatmapContent,
} from '../../src/shared/heatmap'
import { createHeatmapTool } from '../../src/host/tools/rich-heatmap'
import { HeatmapView, HeatmapToolView } from '../../src/client/heatmap-view'
import type { ToolViewProps } from '../../src/client/contract'

const signal = new AbortController().signal

function codes(candidate: unknown): string[] {
  const result = validateHeatmap(candidate)
  return result.ok ? [] : result.issues.map(item => item.code)
}

const BASE = {
  schemaVersion: 1,
  title: 'Temperature field',
  values: [[0, 1, 2], [3, 4, 5]],
}

describe('heatmap validation', () => {
  it('normalizes a minimal payload with explicit defaults and drops unknown keys', () => {
    const result = validateHeatmap({ ...BASE, title: '  Temperature field  ', junk: '<script>' })
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepEqual(result.value, {
      schemaVersion: 1,
      title: 'Temperature field',
      values: [[0, 1, 2], [3, 4, 5]],
      origin: 'lower',
      colorScale: { palette: 'sequential' },
    })
    assert.deepEqual(JSON.parse(JSON.stringify(result.value)), result.value)
  })

  it('keeps axes, scale bounds and labels', () => {
    const result = validateHeatmap({
      ...BASE,
      subtitle: 'two rows',
      origin: 'upper',
      xAxis: { label: 'x', unit: 'm', min: 0, max: 3 },
      yAxis: { label: 'y', unit: 'm', min: -1, max: 1 },
      colorScale: { palette: 'diverging', label: 'T', unit: 'K', min: -5, max: 5 },
    })
    assert.ok(result.ok, JSON.stringify(result))
    if (!result.ok) return
    assert.equal(result.value.origin, 'upper')
    assert.deepEqual(result.value.xAxis, { label: 'x', unit: 'm', min: 0, max: 3 })
    assert.deepEqual(result.value.colorScale, { palette: 'diverging', label: 'T', unit: 'K', min: -5, max: 5 })
  })

  it('rejects wrong versions, non-objects and prototype carriers', () => {
    assert.deepEqual(codes({ ...BASE, schemaVersion: 2 }), ['UNSUPPORTED_SCHEMA_VERSION'])
    assert.deepEqual(codes([]), ['NOT_AN_OBJECT'])
    assert.deepEqual(codes(Object.create({ ...BASE })), ['NOT_AN_OBJECT'])
  })

  it('rejects empty, ragged and non-numeric matrices', () => {
    assert.deepEqual(codes({ ...BASE, values: [] }), ['INVALID_VALUES'])
    assert.deepEqual(codes({ ...BASE, values: [[]] }), ['INVALID_VALUES'])
    assert.deepEqual(codes({ ...BASE, values: [[1, 2], [3]] }), ['INVALID_VALUES'])
    assert.deepEqual(codes({ ...BASE, values: [[1, '2']] }), ['NON_FINITE_NUMBER'])
    assert.deepEqual(codes({ ...BASE, values: [[1, Number.NaN]] }), ['NON_FINITE_NUMBER'])
    assert.deepEqual(codes({ ...BASE, values: [[1, -0]] }), ['NON_FINITE_NUMBER'])
    assert.deepEqual(codes({ ...BASE, values: [[1, 2e7]] }), ['VALUE_OUT_OF_RANGE'])
  })

  it('rejects oversized matrices from lengths alone', () => {
    const tooManyRows = new Array(HEATMAP_LIMITS.maxRows + 1)
    assert.deepEqual(codes({ ...BASE, values: tooManyRows }), ['TOO_MANY_CELLS'])
    const wide = [new Array(HEATMAP_LIMITS.maxColumns + 1)]
    assert.deepEqual(codes({ ...BASE, values: wide }), ['TOO_MANY_CELLS'])
    const rows = Math.ceil((HEATMAP_LIMITS.maxCells + 1) / HEATMAP_LIMITS.maxColumns)
    const many = Array.from({ length: rows }, () => new Array(HEATMAP_LIMITS.maxColumns))
    assert.deepEqual(codes({ ...BASE, values: many }), ['TOO_MANY_CELLS'])
  })

  it('accepts the largest allowed square matrix', () => {
    const side = Math.floor(Math.sqrt(HEATMAP_LIMITS.maxCells))
    const values = Array.from({ length: side }, (_r, r) => Array.from({ length: side }, (_c, c) => r * side + c))
    assert.ok(validateHeatmap({ ...BASE, values }).ok)
  })

  it('requires both or neither bound, ordered, and values inside an explicit scale', () => {
    assert.deepEqual(codes({ ...BASE, colorScale: { palette: 'sequential', min: 0 } }), ['INVALID_SCALE'])
    assert.deepEqual(codes({ ...BASE, colorScale: { palette: 'sequential', min: 5, max: 5 } }), ['INVALID_SCALE'])
    assert.deepEqual(codes({ ...BASE, colorScale: { palette: 'rainbow' } }), ['INVALID_SCALE'])
    assert.deepEqual(codes({ ...BASE, colorScale: { palette: 'sequential', min: 0, max: 4 } }), ['VALUE_OUT_OF_SCALE'])
    assert.deepEqual(codes({ ...BASE, xAxis: { min: 0 } }), ['INVALID_AXIS'])
    assert.deepEqual(codes({ ...BASE, xAxis: { min: 2, max: 1 } }), ['INVALID_AXIS'])
    assert.deepEqual(codes({ ...BASE, origin: 'left' }), ['INVALID_ORIGIN'])
  })

  it('rejects control, line-separator and bidirectional-control characters in text fields', () => {
    for (const code of [0x07, 0x0a, 0x85, 0x2028, 0x202e, 0x2066, 0x200f]) {
      const bad = `Field ${String.fromCharCode(code)} map`
      assert.deepEqual(codes({ ...BASE, title: bad }), ['INVALID_TITLE'], `title U+${code.toString(16)}`)
      assert.deepEqual(codes({ ...BASE, subtitle: bad }), ['INVALID_SUBTITLE'], `subtitle U+${code.toString(16)}`)
      assert.deepEqual(codes({ ...BASE, xAxis: { label: bad } }), ['INVALID_AXIS'], `axis label U+${code.toString(16)}`)
      assert.deepEqual(codes({ ...BASE, colorScale: { palette: 'sequential', unit: bad } }), ['INVALID_SCALE'], `unit U+${code.toString(16)}`)
    }
  })

  it('summarizes nearly equal extremes with distinguishable numbers', async () => {
    const tool = createHeatmapTool()
    const value = await tool.execute({ content: { ...BASE, values: [[1, 1.000000001]] } }, { signal }) as { summary: string }
    assert.match(value.summary, /values 1 to 1\.000000001/)
  })

  it('bounds title and the serialized payload', () => {
    assert.deepEqual(codes({ ...BASE, title: '   ' }), ['INVALID_TITLE'])
    assert.deepEqual(codes({ ...BASE, title: 'x'.repeat(201) }), ['INVALID_TITLE'])
    assert.deepEqual(codes({ ...BASE, padding: 'x'.repeat(HEATMAP_LIMITS.maxSerializedBytes) }), ['PAYLOAD_TOO_LARGE'])
  })
})

describe('heatmap scale and colors', () => {
  function content(values: number[][], colorScale: HeatmapContent['colorScale']): HeatmapContent {
    return { schemaVersion: 1, title: 't', values, origin: 'lower', colorScale }
  }

  it('uses the data range for sequential and a symmetric range for diverging', () => {
    assert.deepEqual(resolveHeatmapScale(content([[1, 3], [2, 9]], { palette: 'sequential' })), { min: 1, max: 9, constant: false })
    assert.deepEqual(resolveHeatmapScale(content([[-2, 3]], { palette: 'diverging' })), { min: -3, max: 3, constant: false })
    assert.deepEqual(resolveHeatmapScale(content([[-2, 3]], { palette: 'diverging', min: -10, max: 4 })), { min: -10, max: 4, constant: false })
    assert.deepEqual(resolveHeatmapScale(content([[7, 7]], { palette: 'sequential' })), { min: 7, max: 7, constant: true })
    assert.deepEqual(resolveHeatmapScale(content([[0, 0]], { palette: 'diverging' })), { min: 0, max: 0, constant: true })
  })

  it('maps endpoints to the palette stops and the diverging midpoint to neutral', () => {
    const scale = { min: 0, max: 10, constant: false }
    assert.equal(heatmapColor('sequential', scale, 0), '#440154')
    assert.equal(heatmapColor('sequential', scale, 10), '#fde725')
    assert.equal(heatmapColor('diverging', scale, 0), '#2166ac')
    assert.equal(heatmapColor('diverging', scale, 5), '#f7f7f7')
    assert.equal(heatmapColor('diverging', scale, 10), '#b2182b')
    assert.equal(heatmapColor('sequential', { min: 7, max: 7, constant: true }, 7), heatmapColor('sequential', scale, 5))
  })
})

describe('heatmap envelope and tool', () => {
  it('reads only its own envelope and revalidates content', () => {
    const result = validateHeatmap(BASE)
    assert.ok(result.ok)
    if (!result.ok) return
    const envelope = { kind: 'rich-heatmap', envelopeVersion: 1, content: result.value }
    assert.deepEqual(readHeatmapMeta(envelope), envelope)
    assert.equal(readHeatmapMeta({ ...envelope, kind: 'rich-response' }), undefined)
    assert.equal(readHeatmapMeta({ ...envelope, envelopeVersion: 2 }), undefined)
    assert.equal(readHeatmapMeta({ ...envelope, content: { ...result.value, values: [[1], [2, 3]] } }), undefined)
    assert.equal(readHeatmapMeta(null), undefined)
  })

  it('validates in execute, summarizes for the model and projects the envelope', async () => {
    const tool = createHeatmapTool()
    assert.equal(tool.name, 'rich_heatmap')
    assert.equal(tool.parameters['additionalProperties'], false)
    assert.deepEqual(tool.parameters['required'], ['content'])
    const value = await tool.execute({ content: BASE }, { signal }) as { content: HeatmapContent; summary: string }
    assert.equal(value.summary, 'heatmap "Temperature field": 2x3 cells, values 0 to 5 (sequential scale 0 to 5)')
    assert.deepEqual(tool.output.render({}, value as never), [{ type: 'text', text: value.summary }])
    assert.deepEqual(tool.output.presentationMeta?.({}, value as never), { kind: 'rich-heatmap', envelopeVersion: 1, content: value.content })
    await assert.rejects(tool.execute({ content: { ...BASE, values: [[1], [2, 3]] } }, { signal }), /INVALID_VALUES/)
    await assert.rejects(tool.execute({ content: BASE, extra: 1 }, { signal }), /unexpected argument/)
  })
})

interface Cell { readonly row: number; readonly column: number; readonly y: number; readonly fill: string }

function cells(markup: string): Cell[] {
  const found: Cell[] = []
  for (const match of markup.matchAll(/<rect\b[^>]*data-dsh-rich="heatmap-cell"[^>]*>/g)) {
    const tag = match[0]
    const read = (name: string): string => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? ''
    found.push({
      row: Number(read('data-dsh-rich-row')),
      column: Number(read('data-dsh-rich-column')),
      y: Number(read(' y')),
      fill: read('fill'),
    })
  }
  return found
}

describe('heatmap renderer', () => {
  function render(content: HeatmapContent): string {
    return renderToStaticMarkup(createElement(HeatmapView, { content, width: 640 }))
  }

  it('draws one cell per value with row 0 at the bottom for origin lower', () => {
    const markup = render({ schemaVersion: 1, title: 'g', values: [[0, 1, 2], [3, 4, 5]], origin: 'lower', colorScale: { palette: 'sequential' } })
    const drawn = cells(markup)
    assert.equal(drawn.length, 6)
    const first = drawn.find(cell => cell.row === 0 && cell.column === 0)
    const top = drawn.find(cell => cell.row === 1 && cell.column === 0)
    assert.ok(first !== undefined && top !== undefined)
    assert.ok(first.y > top.y, 'origin lower puts values[0] below values[1]')
    assert.equal(first.fill, '#440154')
    assert.equal(drawn.find(cell => cell.row === 1 && cell.column === 2)?.fill, '#fde725')
  })

  it('draws row 0 at the top for origin upper', () => {
    const drawn = cells(render({ schemaVersion: 1, title: 'g', values: [[0], [1]], origin: 'upper', colorScale: { palette: 'sequential' } }))
    const first = drawn.find(cell => cell.row === 0)
    const second = drawn.find(cell => cell.row === 1)
    assert.ok(first !== undefined && second !== undefined && first.y < second.y)
  })

  function texts(markup: string, group: string): Array<{ label: string; position: number }> {
    const body = new RegExp(`<g data-dsh-rich="${group}"[^>]*>(.*?)</g>`).exec(markup)?.[1] ?? ''
    const axis = group === 'heatmap-x-axis' ? 'x' : 'y'
    return [...body.matchAll(new RegExp(`<text[^>]* ${axis}="([-0-9.]+)"[^>]*>([^<]*)</text>`, 'g'))]
      .map(match => ({ position: Number(match[1]), label: match[2] ?? '' }))
  }

  it('reports cell coordinates that agree with the y-up axis for origin upper', () => {
    const markup = render({
      schemaVersion: 1,
      title: 'g',
      values: [[0], [1]],
      origin: 'upper',
      xAxis: { min: 0, max: 2 },
      yAxis: { min: 0, max: 4 },
      colorScale: { palette: 'sequential' },
    })
    assert.match(markup, /<title>row 0, column 0 \(x=1, y=3\): 0<\/title>/)
    assert.match(markup, /<title>row 1, column 0 \(x=1, y=1\): 1<\/title>/)
    const top = texts(markup, 'heatmap-y-axis').find(tick => tick.label === '4')
    const bottom = texts(markup, 'heatmap-y-axis').find(tick => tick.label === '0')
    assert.ok(top !== undefined && bottom !== undefined && top.position < bottom.position, 'y ticks grow upward')
  })

  it('keeps axis and legend tick labels distinct and inside the plot for extreme ranges', () => {
    const cases: Array<{ values: number[][]; axis: { min: number; max: number } }> = [
      { values: [[1, 1.000000001]], axis: { min: 1, max: 1.000000001 } },
      { values: [[0, 1e-8]], axis: { min: 0, max: 1e-8 } },
      { values: [[9999990, 10000000]], axis: { min: 9999990, max: 10000000 } },
      { values: [[-10000000, -9999999.5]], axis: { min: -10000000, max: -9999999.5 } },
    ]
    for (const { values, axis } of cases) {
      const markup = render({ schemaVersion: 1, title: 'g', values, origin: 'lower', xAxis: axis, yAxis: axis, colorScale: { palette: 'sequential' } })
      for (const group of ['heatmap-x-axis', 'heatmap-y-axis', 'heatmap-legend']) {
        const ticks = texts(markup, group).filter(tick => tick.label.length > 0)
        const labels = ticks.map(tick => tick.label)
        assert.ok(labels.length >= 2, `${group} has at least two ticks for ${String(axis.min)}..${String(axis.max)}`)
        assert.equal(new Set(labels).size, labels.length, `${group} labels distinct: ${labels.join(', ')}`)
      }
      const xTicks = texts(markup, 'heatmap-x-axis')
      assert.ok(xTicks.every(tick => tick.position >= 60 - 0.001 && tick.position <= 640 - 92 + 0.001), 'x ticks inside the plot')
    }
  })

  it('labels the figure for assistive technology and escapes model text', () => {
    const markup = render({
      schemaVersion: 1,
      title: '<b>Field</b>',
      values: [[1, 2]],
      origin: 'lower',
      colorScale: { palette: 'sequential', label: 'T', unit: 'K' },
    })
    assert.ok(!markup.includes('<b>Field</b>'))
    assert.ok(markup.includes('&lt;b&gt;Field&lt;/b&gt;'))
    assert.match(markup, /role="img"/)
    assert.match(markup, /aria-label="Heatmap &lt;b&gt;Field&lt;\/b&gt;: 1 rows x 2 columns, values 1 to 2 K"/)
    assert.match(markup, /data-dsh-rich="heatmap-legend"/)
    assert.match(markup, /<title>row 0, column 1: 2 K<\/title>/)
  })

  it('renders the persisted envelope in the Tool view and a bounded alert otherwise', () => {
    const result = validateHeatmap(BASE)
    assert.ok(result.ok)
    if (!result.ok) return
    const props = (meta: unknown): ToolViewProps => ({
      sessionId: 's',
      callId: 'c',
      toolName: 'rich_heatmap',
      phase: 'result',
      block: { kind: 'tool-result', seq: 1, time: 1, callId: 'c', name: 'rich_heatmap', content: [], isError: false, meta, call: null, subCalls: [] },
    })
    const ok = renderToStaticMarkup(createElement(HeatmapToolView, props({ kind: 'rich-heatmap', envelopeVersion: 1, content: result.value })))
    assert.equal(cells(ok).length, 6)
    assert.match(ok, /导出 SVG/)
    const bad = renderToStaticMarkup(createElement(HeatmapToolView, props({ kind: 'rich-heatmap', envelopeVersion: 1, content: { ...result.value, values: [] } })))
    assert.match(bad, /role="alert"/)
    assert.equal(cells(bad).length, 0)
  })
})
