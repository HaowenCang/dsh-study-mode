/**
 * Adversarial validation tests for RichContentV1.
 *
 * Everything here feeds the *shared* validator, which runs both host-side
 * (before persistence) and client-side (before React). It must accept exactly
 * the bounded protocol, normalize accepted payloads, and reject anything else
 * with a stable code + bounded path instead of throwing.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RICH_LIMITS,
  validateRichContent,
  type RichContentV1,
  type RichValidationCode,
  type RichValidationIssue,
} from '../../src/shared/index'

function describeIssues(issues: readonly RichValidationIssue[]): string {
  return issues.map(item => `${item.code}@${item.path}: ${item.detail}`).join(' | ')
}

function expectValid(value: unknown): RichContentV1 {
  const result = validateRichContent(value)
  if (!result.ok) assert.fail(`expected payload to pass validation, got: ${describeIssues(result.issues)}`)
  return result.value
}

function expectInvalid(value: unknown, code: RichValidationCode, path?: string): readonly RichValidationIssue[] {
  const result = validateRichContent(value)
  if (result.ok) {
    assert.fail(`expected ${code}, but payload passed validation: ${JSON.stringify(result.value).slice(0, 240)}`)
  }
  const codes = result.issues.map(item => item.code)
  assert.ok(codes.includes(code), `expected ${code}, got: ${describeIssues(result.issues)}`)
  if (path !== undefined) {
    assert.ok(
      result.issues.some(item => item.code === code && item.path === path),
      `expected ${code}@${path}, got: ${describeIssues(result.issues)}`,
    )
  }
  return result.issues
}

/** Candidate that is valid unless a test mutates it. */
function lineCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'Sine wave',
    data: {
      series: [
        { name: 'sin(x)', points: [{ x: 0, y: 0 }, { x: 1.570796, y: 1 }, { x: 3.141593, y: 0 }] },
      ],
    },
  }
}

function scatterCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'scatter_plot',
    title: 'Samples',
    data: {
      series: [{ name: 'a', points: [{ x: 0, y: 1 }, { x: 0, y: 2 }] }],
    },
  }
}

function diagramCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'basic_diagram',
    title: 'Flow',
    data: {
      nodes: [
        { id: 'a', label: 'A', x: 0, y: 0 },
        { id: 'b', label: 'B', x: 100, y: 100 },
      ],
      edges: [{ from: 'a', to: 'b', label: 'next' }],
    },
  }
}

function cardCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'message_card',
    title: 'Continue?',
    body: 'Pick one.',
    actions: [{ id: 'yes', label: 'Yes', submitText: 'Yes please.' }],
  }
}

/** Deep-freeze a candidate so any accidental write during validation throws. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

function replacementSeriesWithColor(color: unknown): Record<string, unknown> {
  const candidate = lineCandidate()
  const data = candidate['data'] as Record<string, unknown>
  const series = data['series'] as Record<string, unknown>[]
  series[0] = { ...series[0], color }
  return candidate
}

function diagramWithEdges(edges: unknown[]): Record<string, unknown> {
  const candidate = diagramCandidate()
  ;(candidate['data'] as Record<string, unknown>)['edges'] = edges
  return candidate
}

function diagramWithNodes(nodes: unknown[]): Record<string, unknown> {
  const candidate = diagramCandidate()
  ;(candidate['data'] as Record<string, unknown>)['nodes'] = nodes
  return candidate
}

function cardWithActions(actions: unknown[]): Record<string, unknown> {
  const candidate = cardCandidate()
  candidate['actions'] = actions
  return candidate
}

// ---------------------------------------------------------------------------
// Accepted payloads are normalized.
// ---------------------------------------------------------------------------

describe('valid payloads are normalized', () => {
  it('accepts and normalizes a sine line plot (trimmed strings, canonical object)', () => {
    const candidate = {
      schemaVersion: 1,
      type: 'line_plot',
      title: '  Sine wave  ',
      subtitle: ' y = sin(x) ',
      data: {
        series: [
          {
            name: '  sin(x) ',
            color: '#247bbf',
            points: [
              { x: 0, y: 0 },
              { x: 1.570796, y: 1 },
              { x: 3.141593, y: 0 },
            ],
          },
        ],
        xAxis: { label: ' x ', unit: ' rad ' },
        yAxis: { label: 'sin(x)', min: -1, max: 1 },
      },
      // Unknown extras are dropped from the canonical value.
      padding: { ignored: true },
      extra: 'ignored',
    }
    assert.deepEqual(expectValid(candidate), {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'Sine wave',
      subtitle: 'y = sin(x)',
      data: {
        series: [
          {
            name: 'sin(x)',
            color: '#247bbf',
            points: [
              { x: 0, y: 0 },
              { x: 1.570796, y: 1 },
              { x: 3.141593, y: 0 },
            ],
          },
        ],
        xAxis: { label: 'x', unit: 'rad' },
        yAxis: { label: 'sin(x)', min: -1, max: 1 },
      },
    })
  })

  it('accepts a quadratic curve and a normalized wave as two line series', () => {
    const wave = [0.5, 0.75, 1, 0.75, 0.5]
    const candidate = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'Quadratic growth and normalized wave',
      data: {
        series: [
          { name: 'x^2', points: [0, 1, 2, 3, 4].map(x => ({ x, y: x * x })) },
          { name: 'normalized wave', points: wave.map((y, x) => ({ x, y })) },
        ],
        xAxis: { label: 'step', unit: 's' },
        yAxis: { label: 'value' },
      },
    }
    const value = expectValid(candidate)
    assert.equal(value.type, 'line_plot')
    if (value.type !== 'line_plot') return
    assert.equal(value.data.series.length, 2)
    assert.equal(value.data.series[0]?.name, 'x^2')
    assert.deepEqual(value.data.series[0]?.points, [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 4 },
      { x: 3, y: 9 },
      { x: 4, y: 16 },
    ])
    assert.equal(value.data.series[1]?.points.length, 5)
  })

  it('accepts scatter plots with multiple series and duplicate x values', () => {
    const candidate = {
      schemaVersion: 1,
      type: 'scatter_plot',
      title: 'Latency samples',
      data: {
        series: [
          { name: 'baseline', points: [{ x: 1, y: 12 }, { x: 2, y: 9 }, { x: 2, y: 11 }] },
          { name: 'optimized', color: '#8e44ad', points: [{ x: 1, y: 8 }, { x: 3, y: 9 }] },
        ],
        xAxis: { label: 'run' },
        yAxis: { label: 'ms' },
      },
    }
    const value = expectValid(candidate)
    if (value.type !== 'scatter_plot') assert.fail('expected scatter_plot')
    assert.deepEqual(value.data.series[0]?.points, [{ x: 1, y: 12 }, { x: 2, y: 9 }, { x: 2, y: 11 }])
    assert.equal(value.data.series[1]?.color, '#8e44ad')
  })

  it('accepts a diagram and defaults a missing edges array to []', () => {
    const candidate = diagramCandidate()
    delete (candidate['data'] as Record<string, unknown>)['edges']
    ;(candidate['data'] as Record<string, unknown>)['nodes'] = [
      { id: 'a', label: ' Start ', x: 0, y: 0, shape: 'rounded', tone: 'accent' },
      { id: 'b', label: 'End', x: 1000, y: 1000 },
    ]
    assert.deepEqual(expectValid(candidate), {
      schemaVersion: 1,
      type: 'basic_diagram',
      title: 'Flow',
      data: {
        nodes: [
          { id: 'a', label: 'Start', x: 0, y: 0, shape: 'rounded', tone: 'accent' },
          { id: 'b', label: 'End', x: 1000, y: 1000 },
        ],
        edges: [],
      },
    })
  })

  it('preserves edge labels/dashed flags and drops unknown node keys', () => {
    const candidate = diagramCandidate()
    const data = candidate['data'] as Record<string, unknown>
    data['nodes'] = [
      { id: 'a', label: 'A', x: 0, y: 0, extra: 'ignored' },
      { id: 'b', label: 'B', x: 100, y: 100, shape: 'circle' },
    ]
    data['edges'] = [{ from: 'a', to: 'b', label: ' dashed ', dashed: true, extra: 1 }]
    const value = expectValid(candidate)
    if (value.type !== 'basic_diagram') assert.fail('expected basic_diagram')
    assert.deepEqual(value.data.edges, [{ from: 'a', to: 'b', label: 'dashed', dashed: true }])
    assert.deepEqual(value.data.nodes[0], { id: 'a', label: 'A', x: 0, y: 0 })
  })

  it('accepts a message card and normalizes body/action text', () => {
    const candidate = {
      schemaVersion: 1,
      type: 'message_card',
      title: ' Deploy to staging? ',
      subtitle: ' Phase 1 ',
      questionId: 'deploy-staging-1',
      body: ' The build passed all unit tests. ',
      actions: [
        { id: 'approve', label: ' Approve ', submitText: ' Approved: deploy. ' },
        { id: 'hold', label: 'Hold', submitText: 'Hold and show failing checks.' },
      ],
    }
    assert.deepEqual(expectValid(candidate), {
      schemaVersion: 1,
      type: 'message_card',
      title: 'Deploy to staging?',
      subtitle: 'Phase 1',
      questionId: 'deploy-staging-1',
      body: 'The build passed all unit tests.',
      actions: [
        { id: 'approve', label: 'Approve', submitText: 'Approved: deploy.' },
        { id: 'hold', label: 'Hold', submitText: 'Hold and show failing checks.' },
      ],
    })
  })

  it('accepts a message card without actions or questionId', () => {
    const candidate = cardCandidate()
    delete candidate['actions']
    assert.deepEqual(expectValid(candidate), {
      schemaVersion: 1,
      type: 'message_card',
      title: 'Continue?',
      body: 'Pick one.',
    })
  })

  it('accepts a deeply frozen payload without writing to it', () => {
    const candidate = deepFreeze(lineCandidate())
    const before = JSON.stringify(candidate)
    expectValid(candidate)
    assert.equal(JSON.stringify(candidate), before)
  })

  it('accepts coordinate boundaries and the maximum number of series', () => {
    const candidate = lineCandidate()
    const data = candidate['data'] as Record<string, unknown>
    data['series'] = Array.from({ length: RICH_LIMITS.maxSeries }, (_, index) => ({
      name: `s${String(index)}`,
      points: [{ x: RICH_LIMITS.maxAbsCoordinate, y: -RICH_LIMITS.maxAbsCoordinate }],
    }))
    expectValid(candidate)
  })

  it('accepts exactly maxPointsPerSeries points in one series', () => {
    const candidate = lineCandidate()
    const data = candidate['data'] as Record<string, unknown>
    data['series'] = [{
      name: 'max',
      points: Array.from({ length: RICH_LIMITS.maxPointsPerSeries }, (_, index) => ({ x: index, y: 0 })),
    }]
    const value = expectValid(candidate)
    if (value.type !== 'line_plot') assert.fail('expected line_plot')
    assert.equal(value.data.series[0]?.points.length, RICH_LIMITS.maxPointsPerSeries)
  })
})

// ---------------------------------------------------------------------------
// Rejections: object/shape/version/type/title.
// ---------------------------------------------------------------------------

describe('invalid top-level shapes are rejected with stable codes', () => {
  it('rejects non-objects with NOT_AN_OBJECT', () => {
    for (const candidate of [null, undefined, 42, 'payload', true, Symbol('x')] as unknown[]) {
      expectInvalid(candidate, 'NOT_AN_OBJECT', '')
    }
  })

  it('rejects arrays with NOT_AN_OBJECT', () => {
    const issues = expectInvalid([lineCandidate()], 'NOT_AN_OBJECT', '')
    assert.match(issues[0]?.detail ?? '', /JSON object/)
  })

  it('rejects a missing schemaVersion', () => {
    const candidate = lineCandidate()
    delete candidate['schemaVersion']
    expectInvalid(candidate, 'UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion')
  })

  it('rejects schemaVersion 2 with UNSUPPORTED_SCHEMA_VERSION', () => {
    const candidate = lineCandidate()
    candidate['schemaVersion'] = 2
    expectInvalid(candidate, 'UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion')
  })

  it('rejects a string schemaVersion', () => {
    const candidate = lineCandidate()
    candidate['schemaVersion'] = '1'
    expectInvalid(candidate, 'UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion')
  })

  it('rejects an unknown type with UNKNOWN_TYPE', () => {
    for (const type of ['bar_chart', 'line-plot', '', 'LINE_PLOT'] as unknown[]) {
      const candidate = lineCandidate()
      candidate['type'] = type
      expectInvalid(candidate, 'UNKNOWN_TYPE', 'type')
    }
  })

  it('rejects a missing type with UNKNOWN_TYPE', () => {
    const candidate = lineCandidate()
    delete candidate['type']
    expectInvalid(candidate, 'UNKNOWN_TYPE', 'type')
  })

  it('rejects empty and whitespace-only titles', () => {
    for (const title of ['', '   ', '\t\n'] as unknown[]) {
      const candidate = lineCandidate()
      candidate['title'] = title
      expectInvalid(candidate, 'INVALID_TITLE', 'title')
    }
  })

  it('rejects a non-string title', () => {
    for (const title of [5, null, {}, []] as unknown[]) {
      const candidate = lineCandidate()
      candidate['title'] = title
      expectInvalid(candidate, 'INVALID_TITLE', 'title')
    }
  })

  it('rejects overlong titles and subtitles', () => {
    const title = lineCandidate()
    title['title'] = 'x'.repeat(RICH_LIMITS.maxTitleLength + 1)
    expectInvalid(title, 'INVALID_TITLE', 'title')

    const subtitle = lineCandidate()
    subtitle['subtitle'] = 'x'.repeat(RICH_LIMITS.maxSubtitleLength + 1)
    expectInvalid(subtitle, 'INVALID_SUBTITLE', 'subtitle')

    const body = cardCandidate()
    body['body'] = 'x'.repeat(RICH_LIMITS.maxCardBodyLength + 1)
    expectInvalid(body, 'INVALID_BODY', 'body')
  })
})

// ---------------------------------------------------------------------------
// Plot numbers, axes, series, colors.
// ---------------------------------------------------------------------------

describe('plot numeric and axis validation', () => {
  function pointCandidate(x: unknown, y: unknown): Record<string, unknown> {
    const candidate = lineCandidate()
    const data = candidate['data'] as Record<string, unknown>
    data['series'] = [{ name: 's', points: [{ x, y }] }]
    return candidate
  }

  it('rejects NaN, +Infinity and -Infinity coordinates', () => {
    expectInvalid(pointCandidate(Number.NaN, 0), 'NON_FINITE_NUMBER', 'data.series[0].points[0].x')
    expectInvalid(pointCandidate(0, Number.POSITIVE_INFINITY), 'NON_FINITE_NUMBER', 'data.series[0].points[0].y')
    expectInvalid(pointCandidate(Number.NEGATIVE_INFINITY, 0), 'NON_FINITE_NUMBER', 'data.series[0].points[0].x')
  })

  it('rejects negative zero coordinates (not canonical JSON)', () => {
    expectInvalid(pointCandidate(-0, 0), 'NON_FINITE_NUMBER', 'data.series[0].points[0].x')
    expectInvalid(pointCandidate(0, -0), 'NON_FINITE_NUMBER', 'data.series[0].points[0].y')
  })

  it('rejects huge coordinates with COORDINATE_OUT_OF_RANGE', () => {
    expectInvalid(pointCandidate(RICH_LIMITS.maxAbsCoordinate + 1, 0), 'COORDINATE_OUT_OF_RANGE', 'data.series[0].points[0].x')
    expectInvalid(pointCandidate(0, -(RICH_LIMITS.maxAbsCoordinate + 1)), 'COORDINATE_OUT_OF_RANGE', 'data.series[0].points[0].y')
  })

  it('rejects string coordinates with NON_FINITE_NUMBER', () => {
    expectInvalid(pointCandidate('1', 0), 'NON_FINITE_NUMBER', 'data.series[0].points[0].x')
  })

  it('rejects empty series arrays and non-object series', () => {
    const empty = lineCandidate()
    ;(empty['data'] as Record<string, unknown>)['series'] = []
    expectInvalid(empty, 'INVALID_SERIES', 'data.series')

    const notObject = lineCandidate()
    ;(notObject['data'] as Record<string, unknown>)['series'] = [42]
    expectInvalid(notObject, 'INVALID_SERIES', 'data.series[0]')

    const missing = lineCandidate()
    delete (missing['data'] as Record<string, unknown>)['series']
    expectInvalid(missing, 'INVALID_SERIES', 'data.series')
  })

  it('rejects non-array points and non-object points', () => {
    const noPoints = lineCandidate()
    ;(noPoints['data'] as Record<string, unknown>)['series'] = [{ name: 's', points: 'nope' }]
    expectInvalid(noPoints, 'INVALID_POINT', 'data.series[0].points')

    const badPoint = lineCandidate()
    ;(badPoint['data'] as Record<string, unknown>)['series'] = [{ name: 's', points: [42] }]
    expectInvalid(badPoint, 'INVALID_POINT', 'data.series[0].points[0]')
  })

  it('rejects more than maxSeries series', () => {
    const candidate = lineCandidate()
    ;(candidate['data'] as Record<string, unknown>)['series'] = Array.from(
      { length: RICH_LIMITS.maxSeries + 1 },
      (_, index) => ({ name: `s${String(index)}`, points: [{ x: 0, y: 0 }] }),
    )
    expectInvalid(candidate, 'TOO_MANY_SERIES', 'data.series')
  })

  it('rejects more than maxPointsPerSeries points', () => {
    const candidate = lineCandidate()
    ;(candidate['data'] as Record<string, unknown>)['series'] = [{
      name: 'too many',
      points: Array.from({ length: RICH_LIMITS.maxPointsPerSeries + 1 }, () => ({ x: 0, y: 0 })),
    }]
    expectInvalid(candidate, 'TOO_MANY_POINTS', 'data.series[0].points')
  })

  it('rejects more than maxTotalPoints across series', () => {
    const perSeries = 1100 // under maxPointsPerSeries, so only the total trips
    const seriesCount = Math.ceil((RICH_LIMITS.maxTotalPoints + 1) / perSeries)
    const candidate = lineCandidate()
    ;(candidate['data'] as Record<string, unknown>)['series'] = Array.from({ length: seriesCount }, (_, s) => ({
      name: `s${String(s)}`,
      points: Array.from({ length: perSeries }, () => ({ x: 0, y: 0 })),
    }))
    assert.ok(seriesCount <= RICH_LIMITS.maxSeries)
    expectInvalid(candidate, 'TOO_MANY_TOTAL_POINTS', 'data.series')
  })

  it('rejects markup/URL injection attempts in colors', () => {
    const injections = [
      'url(javascript:alert(1))',
      'red;background:url(javascript:alert(1))',
      'url(https://evil.example/x)',
      'javascript:alert(1)',
      '#12345',
      '#gggggg',
      'rgb(0,0,0)',
      'red',
      42,
      null,
      { toString: () => '#fff' },
    ] as unknown[]
    for (const color of injections) {
      expectInvalid(replacementSeriesWithColor(color), 'INVALID_COLOR', 'data.series[0].color')
    }
  })

  it('accepts both #rgb and #rrggbb colors', () => {
    for (const color of ['#fff', '#FFFFFF', '#0a0B0c']) {
      const value = expectValid(replacementSeriesWithColor(color))
      if (value.type !== 'line_plot') assert.fail('expected line_plot')
      assert.equal(value.data.series[0]?.color, color)
    }
  })

  it('rejects invalid axis ranges and non-finite axis bounds', () => {
    const noRange = lineCandidate()
    ;(noRange['data'] as Record<string, unknown>)['xAxis'] = { min: 5, max: 5 }
    expectInvalid(noRange, 'INVALID_AXIS_RANGE', 'data.xAxis')

    const reversed = lineCandidate()
    ;(reversed['data'] as Record<string, unknown>)['yAxis'] = { min: 10, max: -10 }
    expectInvalid(reversed, 'INVALID_AXIS_RANGE', 'data.yAxis')

    const nanAxis = lineCandidate()
    ;(nanAxis['data'] as Record<string, unknown>)['xAxis'] = { min: Number.NaN }
    expectInvalid(nanAxis, 'NON_FINITE_NUMBER', 'data.xAxis.min')

    const notObject = lineCandidate()
    ;(notObject['data'] as Record<string, unknown>)['xAxis'] = 'x'
    expectInvalid(notObject, 'INVALID_AXIS', 'data.xAxis')
  })

  it('rejects an overlong axis label', () => {
    const candidate = lineCandidate()
    ;(candidate['data'] as Record<string, unknown>)['xAxis'] = { label: 'x'.repeat(RICH_LIMITS.maxAxisLabelLength + 1) }
    expectInvalid(candidate, 'INVALID_AXIS', 'data.xAxis.label')
  })
})

// ---------------------------------------------------------------------------
// Diagram validation.
// ---------------------------------------------------------------------------

describe('diagram validation', () => {
  it('rejects an empty node array', () => {
    expectInvalid(diagramWithNodes([]), 'INVALID_NODE', 'data.nodes')
  })

  it('rejects non-object nodes and edges', () => {
    expectInvalid(diagramWithNodes([42]), 'INVALID_NODE', 'data.nodes[0]')
    expectInvalid(diagramWithEdges([42]), 'INVALID_EDGE', 'data.edges[0]')
  })

  it('rejects duplicate node ids', () => {
    const candidate = diagramWithNodes([
      { id: 'a', label: 'A', x: 0, y: 0 },
      { id: 'a', label: 'A2', x: 10, y: 10 },
    ])
    expectInvalid(candidate, 'DUPLICATE_NODE_ID', 'data.nodes[1].id')
  })

  it('rejects node ids outside the safe charset', () => {
    for (const id of ['bad id', 'a/b', '<script>', 'x'.repeat(RICH_LIMITS.maxNodeIdLength + 1)] as unknown[]) {
      const candidate = diagramWithNodes([{ id, label: 'A', x: 0, y: 0 }])
      expectInvalid(candidate, 'INVALID_NODE', 'data.nodes[0].id')
    }
  })

  it('rejects non-integer and out-of-grid coordinates', () => {
    for (const [x, y] of [[1.5, 0], [0, 1.5], [-1, 0], [1001, 0], [0, 1001]] as [number, number][]) {
      const candidate = diagramWithNodes([{ id: 'a', label: 'A', x, y }])
      expectInvalid(candidate, 'INVALID_NODE', 'data.nodes[0]')
    }
  })

  it('rejects unknown shapes and tones', () => {
    const shape = diagramWithNodes([{ id: 'a', label: 'A', x: 0, y: 0, shape: 'hexagon' }])
    expectInvalid(shape, 'INVALID_SHAPE', 'data.nodes[0].shape')

    const tone = diagramWithNodes([{ id: 'a', label: 'A', x: 0, y: 0, tone: 'danger' }])
    expectInvalid(tone, 'INVALID_SHAPE', 'data.nodes[0].tone')
  })

  it('rejects edges that reference unknown nodes', () => {
    expectInvalid(diagramWithEdges([{ from: 'a', to: 'ghost' }]), 'UNKNOWN_EDGE_REF', 'data.edges[0]')
    expectInvalid(diagramWithEdges([{ from: 'ghost', to: 'b' }]), 'UNKNOWN_EDGE_REF', 'data.edges[0]')
  })

  it('rejects self edges', () => {
    expectInvalid(diagramWithEdges([{ from: 'a', to: 'a' }]), 'INVALID_EDGE', 'data.edges[0]')
  })

  it('rejects too many nodes and edges', () => {
    const manyNodes = Array.from({ length: RICH_LIMITS.maxDiagramNodes + 1 }, (_, index) => ({
      id: `n${String(index)}`,
      label: `N${String(index)}`,
      x: index,
      y: 0,
    }))
    expectInvalid(diagramWithNodes(manyNodes), 'TOO_MANY_NODES', 'data.nodes')

    const edges = Array.from({ length: RICH_LIMITS.maxDiagramEdges + 1 }, () => ({ from: 'a', to: 'b' }))
    expectInvalid(diagramWithEdges(edges), 'TOO_MANY_EDGES', 'data.edges')
  })

  it('rejects a non-array edges field', () => {
    const candidate = diagramCandidate()
    ;(candidate['data'] as Record<string, unknown>)['edges'] = 'nope'
    expectInvalid(candidate, 'INVALID_EDGE', 'data.edges')
  })
})

// ---------------------------------------------------------------------------
// Message-card validation.
// ---------------------------------------------------------------------------

describe('message card validation', () => {
  it('rejects duplicate action ids', () => {
    const candidate = cardWithActions([
      { id: 'yes', label: 'Yes', submitText: 'Yes.' },
      { id: 'yes', label: 'Yes again', submitText: 'Yes again.' },
    ])
    expectInvalid(candidate, 'INVALID_ACTION', 'actions[1].id')
  })

  it('rejects unsafe action ids', () => {
    for (const id of ['bad id', 'a/b', '<b>', 'x'.repeat(RICH_LIMITS.maxActionIdLength + 1)] as unknown[]) {
      expectInvalid(cardWithActions([{ id, label: 'L', submitText: 'S' }]), 'INVALID_ACTION', 'actions[0].id')
    }
  })

  it('rejects overlong submitText and labels', () => {
    const longText = 'x'.repeat(RICH_LIMITS.maxSubmitTextLength + 1)
    expectInvalid(cardWithActions([{ id: 'a', label: 'L', submitText: longText }]), 'INVALID_ACTION', 'actions[0].submitText')

    const longLabel = 'x'.repeat(RICH_LIMITS.maxActionLabelLength + 1)
    expectInvalid(cardWithActions([{ id: 'a', label: longLabel, submitText: 'S' }]), 'INVALID_ACTION', 'actions[0].label')
  })

  it('rejects empty action arrays, too many actions and non-object actions', () => {
    expectInvalid(cardWithActions([]), 'INVALID_ACTION', 'actions')

    expectInvalid(
      cardWithActions(Array.from({ length: RICH_LIMITS.maxCardActions + 1 }, (_, index) => ({
        id: `a${String(index)}`,
        label: 'L',
        submitText: 'S',
      }))),
      'TOO_MANY_ACTIONS',
      'actions',
    )

    expectInvalid(cardWithActions([42]), 'INVALID_ACTION', 'actions[0]')
  })

  it('rejects unsafe question ids', () => {
    for (const questionId of ['bad id', 'a#b', 'x'.repeat(RICH_LIMITS.maxQuestionIdLength + 1)] as unknown[]) {
      const candidate = cardCandidate()
      candidate['questionId'] = questionId
      expectInvalid(candidate, 'INVALID_QUESTION_ID', 'questionId')
    }
  })

  it('rejects a missing body', () => {
    const candidate = cardCandidate()
    delete candidate['body']
    expectInvalid(candidate, 'INVALID_BODY', 'body')
  })

  it('rejects an overlong question id and overlong body', () => {
    const question = cardCandidate()
    question['questionId'] = 'q'.repeat(RICH_LIMITS.maxQuestionIdLength + 1)
    expectInvalid(question, 'INVALID_QUESTION_ID', 'questionId')
  })
})

// ---------------------------------------------------------------------------
// Whole-payload size.
// ---------------------------------------------------------------------------

describe('payload size limit', () => {
  it('rejects a structurally valid payload over maxSerializedBytes with PAYLOAD_TOO_LARGE', () => {
    const candidate = lineCandidate()
    candidate['padding'] = 'x'.repeat(RICH_LIMITS.maxSerializedBytes)
    const issues = expectInvalid(candidate, 'PAYLOAD_TOO_LARGE', '')
    assert.match(issues[0]?.detail ?? '', new RegExp(String(RICH_LIMITS.maxSerializedBytes)))
  })

  it('rejects an oversized multibyte payload (UTF-8 bytes, not UTF-16 units)', () => {
    const candidate = cardCandidate()
    // 'é' is 2 UTF-8 bytes but 1 UTF-16 unit, so char count alone would pass.
    candidate['padding'] = 'é'.repeat(RICH_LIMITS.maxSerializedBytes / 2 + 1024)
    expectInvalid(candidate, 'PAYLOAD_TOO_LARGE', '')
  })
})

// ---------------------------------------------------------------------------
// Hostile JavaScript values: never throw, never mutate.
// ---------------------------------------------------------------------------

describe('hostile JavaScript input never throws and never mutates globals', () => {
  it('rejects a cyclic payload as PAYLOAD_TOO_LARGE without throwing', () => {
    const candidate = lineCandidate() as Record<string, unknown>
    candidate['self'] = candidate
    expectInvalid(candidate, 'PAYLOAD_TOO_LARGE', '')
  })

  it('rejects a BigInt-bearing payload without throwing', () => {
    const candidate = lineCandidate() as Record<string, unknown>
    candidate['big'] = 10n
    expectInvalid(candidate, 'PAYLOAD_TOO_LARGE', '')
  })

  it('rejects a payload with a throwing schemaVersion accessor without throwing', () => {
    const candidate: Record<string, unknown> = {}
    Object.defineProperty(candidate, 'schemaVersion', {
      enumerable: true,
      get() { throw new Error('boom') },
    })
    expectInvalid(candidate, 'NOT_AN_OBJECT', '')
  })

  it('rejects a proxy that throws on property reads without throwing', () => {
    const proxy = new Proxy({ schemaVersion: 1, type: 'message_card' }, {
      get() { throw new Error('trap') },
    })
    expectInvalid(proxy, 'NOT_AN_OBJECT', '')
  })

  it('rejects exotic non-plain candidates instead of reading inherited fields', () => {
    class Payload {
      schemaVersion = 1
      type = 'message_card'
      title = 'Inherited'
      body = 'Inherited body'
    }
    expectInvalid(new Payload(), 'NOT_AN_OBJECT', '')

    // An object-literal `__proto__` carrier serializes as {} but would expose
    // inherited fields to a naive validator. It must be rejected.
    const prototypeCarrier = { __proto__: lineCandidate() } as unknown
    assert.equal(JSON.stringify(prototypeCarrier), '{}')
    expectInvalid(prototypeCarrier, 'NOT_AN_OBJECT', '')
  })

  it('does not emit prototype-pollution side effects from __proto__/constructor keys', () => {
    const parsed: unknown = JSON.parse(
      '{"schemaVersion":1,"type":"message_card","title":"t","body":"b","__proto__":{"polluted":true},'
      + '"constructor":{"prototype":{"polluted":true}}}',
    )
    const value = expectValid(parsed)
    assert.equal(value.type, 'message_card')
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined)
    assert.equal((Object.prototype as unknown as Record<string, unknown>)['polluted'], undefined)
    assert.equal(Object.hasOwn(parsed as object, '__proto__'), true)
    assert.equal(Object.hasOwn(value, '__proto__'), false)
    assert.equal(Object.hasOwn(value, 'constructor'), false)
  })

  it('returns a result (never throws) for a corpus of odd values', () => {
    const corpus: unknown[] = [
      undefined,
      null,
      0,
      -1,
      Number.NaN,
      true,
      'string',
      Symbol('sym'),
      10n,
      () => undefined,
      [],
      [lineCandidate()],
      new Map(),
      new Set(),
      new Date(),
      /regex/,
      new Uint8Array([1, 2, 3]),
      Object.create(null),
      { get schemaVersion() { throw new Error('x') } },
    ]
    for (const candidate of corpus) {
      assert.doesNotThrow(() => {
        const result = validateRichContent(candidate)
        assert.equal(typeof result.ok, 'boolean')
        if (!result.ok) assert.ok(Array.isArray(result.issues))
      })
    }
  })
})
