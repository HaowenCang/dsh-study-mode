/**
 * Unit tests for the pure chart math (`src/client/renderers/chart/scale.ts`).
 *
 * These prove the numbers the SVG renderers emit: range resolution with model
 * overrides, endpoint mapping into the fixed plot rectangle, nice ticks, and
 * bounded polyline serialization. No React/DOM involved.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHART_DEFAULT_HEIGHT,
  CHART_DEFAULT_WIDTH,
  CHART_MARGINS,
  CHART_MIN_HEIGHT,
  CHART_MIN_WIDTH,
  axisTitleText,
  buildPolylineFromPixelPoints,
  buildPolylinePoints,
  buildTickSet,
  chartLayout,
  createChartModel,
  createLinearScale,
  decimalsForStep,
  formatCoordinate,
  formatNumber,
  formatTickLabel,
  mapSeriesPoints,
  nearestPoint,
  niceStep,
  niceTicks,
  plotExtents,
  resolveAxisRange,
  resolvePlotRanges,
} from '../../src/client/renderers/chart/scale'
import type { PlotData, PlotSeries } from '../../src/shared/index'

const SINE_SAMPLES = 33

function sinePoints(): readonly { x: number; y: number }[] {
  return Array.from({ length: SINE_SAMPLES }, (_, index) => {
    const x = (index * 2 * Math.PI) / (SINE_SAMPLES - 1)
    return { x, y: Math.sin(x) }
  })
}

function sineData(): PlotData {
  return { series: [{ name: 'sine', points: sinePoints() }] }
}

function pairs(points: string): readonly (readonly [number, number])[] {
  if (points.trim().length === 0) return []
  return points.trim().split(/\s+/).map(entry => {
    const [x, y] = entry.split(',')
    return [Number(x), Number(y)] as const
  })
}

test('layout: fixed margins produce the documented plot rectangle', () => {
  const layout = chartLayout(640, 240)
  assert.equal(layout.width, 640)
  assert.equal(layout.height, 240)
  assert.deepEqual(layout.plot, { left: 64, top: 12, width: 560, height: 184 })
  assert.equal(CHART_MARGINS.left, 64)
  assert.equal(CHART_MARGINS.right, 16)
  assert.equal(CHART_MARGINS.top, 12)
  assert.equal(CHART_MARGINS.bottom, 44)
})

test('layout: undefined and degenerate sizes fall back to sane values', () => {
  const fallback = chartLayout()
  assert.equal(fallback.width, CHART_DEFAULT_WIDTH)
  assert.equal(fallback.height, CHART_DEFAULT_HEIGHT)
  const tiny = chartLayout(10, 10)
  assert.equal(tiny.width, CHART_MIN_WIDTH)
  assert.equal(tiny.height, CHART_MIN_HEIGHT)
  assert.ok(tiny.plot.width >= 20)
  assert.ok(tiny.plot.height >= 20)
  const nan = chartLayout(Number.NaN, Number.NaN)
  assert.equal(nan.width, CHART_DEFAULT_WIDTH)
  assert.equal(nan.height, CHART_DEFAULT_HEIGHT)
})

test('extents: every finite point across series, empty series contributes nothing', () => {
  const series: PlotSeries[] = [
    { name: 'empty', points: [] },
    { name: 'one', points: [{ x: 2, y: -3 }] },
    { name: 'two', points: [{ x: -1, y: 4 }, { x: 5, y: 0 }] },
  ]
  assert.deepEqual(plotExtents(series), {
    x: { min: -1, max: 5 },
    y: { min: -3, max: 4 },
  })
  assert.deepEqual(plotExtents([]), { x: undefined, y: undefined })
  assert.deepEqual(plotExtents([{ name: 'empty', points: [] }]), { x: undefined, y: undefined })
})

test('resolveAxisRange: explicit override always wins over the data extent', () => {
  const dataExtent = { min: 0, max: 10 }
  assert.deepEqual(resolveAxisRange(dataExtent, { min: -5, max: 5 }), { min: -5, max: 5 })
  assert.deepEqual(resolveAxisRange(dataExtent, { min: 20, max: 30 }), { min: 20, max: 30 })
  assert.deepEqual(resolveAxisRange(dataExtent, { min: -2 }), { min: -2, max: 10 })
  assert.deepEqual(resolveAxisRange(dataExtent, { max: 42 }), { min: 0, max: 42 })
  assert.deepEqual(resolveAxisRange(undefined, undefined), { min: 0, max: 1 })
})

test('resolveAxisRange: degenerate all-equal data gets a symmetric pad', () => {
  const allEqual = resolveAxisRange({ min: 5, max: 5 }, undefined)
  assert.ok(allEqual.max > allEqual.min)
  assert.ok(allEqual.min < 5 && allEqual.max > 5)
  const zero = resolveAxisRange({ min: 0, max: 0 }, undefined)
  assert.deepEqual(zero, { min: -0.5, max: 0.5 })
})

test('resolveAxisRange: an override that excludes the data still yields min < max', () => {
  const above = resolveAxisRange({ min: 0, max: 10 }, { min: 100 })
  assert.ok(above.min === 100 && above.max > above.min)
  const below = resolveAxisRange({ min: 0, max: 10 }, { max: -5 })
  assert.ok(below.max === -5 && below.min < below.max)
  const invalidBoth = resolveAxisRange({ min: 0, max: 1 }, { min: 5, max: 5 })
  assert.ok(invalidBoth.max > invalidBoth.min)
})

test('resolvePlotRanges reads both axes from the payload', () => {
  const ranges = resolvePlotRanges({
    series: [{ name: 's', points: [{ x: 0, y: -1 }, { x: 2, y: 1 }] }],
    xAxis: { min: -1, unit: 's' },
    yAxis: { min: -2, max: 2 },
  })
  assert.deepEqual(ranges.x, { min: -1, max: 2 })
  assert.deepEqual(ranges.y, { min: -2, max: 2 })
})

test('linear scale: endpoints and midpoint map into the plot rectangle', () => {
  const xScale = createLinearScale({ min: 0, max: 100 }, 64, 624)
  assert.equal(xScale.map(0), 64)
  assert.equal(xScale.map(100), 624)
  assert.equal(xScale.map(50), 344)
  const yScale = createLinearScale({ min: -1, max: 1 }, 196, 12)
  assert.equal(yScale.map(-1), 196)
  assert.equal(yScale.map(1), 12)
  assert.equal(yScale.map(0), 104)
  assert.equal(yScale.invert(104), 0)
})

test('linear scale: a zero-width domain maps everything to the midpoint', () => {
  const scale = createLinearScale({ min: 5, max: 5 }, 64, 624)
  assert.equal(scale.map(5), 344)
  assert.ok(Number.isFinite(scale.map(0)))
  assert.equal(scale.map(Number.NaN), 64)
})

test('niceStep rounds to human friendly 1/2/5 steps', () => {
  assert.equal(niceStep(25), 20)
  assert.equal(niceStep(0.25), 0.2)
  assert.equal(niceStep(1.4), 1)
  assert.equal(niceStep(6.9), 5)
  assert.equal(niceStep(0), 1)
  assert.equal(niceStep(Number.NaN), 1)
  assert.equal(decimalsForStep(20), 0)
  assert.equal(decimalsForStep(0.5), 1)
  assert.equal(decimalsForStep(0.05), 2)
})

test('niceTicks: ascending, within range, bounded, no float noise', () => {
  const range = { min: 0, max: 100 }
  const ticks = niceTicks(range.min, range.max, 5)
  assert.deepEqual(ticks, [0, 20, 40, 60, 80, 100])
  for (let index = 1; index < ticks.length; index += 1) {
    assert.ok((ticks[index] as number) > (ticks[index - 1] as number))
  }
  for (const value of ticks) {
    assert.ok(value >= range.min && value <= range.max)
  }
  const fine = niceTicks(0, 0.5, 6)
  assert.deepEqual(fine, [0, 0.1, 0.2, 0.3, 0.4, 0.5])
  const labels = buildTickSet({ min: 0, max: 0.5 }, 6).ticks.map(tick => tick.label)
  assert.deepEqual(labels, ['0.0', '0.1', '0.2', '0.3', '0.4', '0.5'])
  for (const label of labels) {
    assert.ok(!label.includes('000000000000'))
  }
  const negative = buildTickSet({ min: -0.3, max: 0.3 }, 5)
  assert.ok(negative.ticks.length > 0)
  for (const tick of negative.ticks) {
    assert.ok(!tick.label.startsWith('-0.0'))
  }
})

test('niceTicks: target counts stay bounded and degenerate ranges terminate', () => {
  for (const target of [2, 3, 5, 6, 8, 12]) {
    const ticks = niceTicks(-1, 1, target)
    assert.ok(ticks.length >= 2, `target ${String(target)} produced ${String(ticks.length)} ticks`)
    assert.ok(ticks.length <= 2 * target + 2)
  }
  assert.deepEqual(niceTicks(5, 5, 5), [5])
  assert.deepEqual(niceTicks(Number.NaN, 1, 5), [])
})

test('tick label formatting: stable precision, unit suffix, never negative zero', () => {
  assert.equal(formatNumber(-0.0000001, 1), '0.0')
  assert.equal(formatNumber(-0, 0), '0')
  assert.equal(formatNumber(1 / 3, 2), '0.33')
  assert.equal(formatNumber(Number.NaN, 2), '0')
  assert.equal(formatTickLabel(1.5, 1, 'V'), '1.5 V')
  assert.equal(formatTickLabel(2, 0), '2')
  assert.equal(formatTickLabel(2, 0, ''), '2')
  assert.equal(formatTickLabel(-0.5, 1, 's'), '-0.5 s')
  assert.equal(axisTitleText('Time', 's'), 'Time (s)')
  assert.equal(axisTitleText(undefined, 'V'), 'V')
  assert.equal(axisTitleText(undefined, undefined), '')
})

test('coordinate serialization is capped at six decimals and never -0', () => {
  assert.equal(formatCoordinate(0.5), '0.5')
  assert.equal(formatCoordinate(-0.0000001), '0')
  assert.equal(formatCoordinate(1 / 3), '0.333333')
  assert.equal(formatCoordinate(Number.NaN), '0')
  assert.equal(formatCoordinate(1e7), '10000000')
  assert.ok(!formatCoordinate(1 / 7).includes('e'))
})

test('polyline builder keeps every point, including duplicate x values', () => {
  const identityX = createLinearScale({ min: 0, max: 100 }, 0, 100)
  const identityY = createLinearScale({ min: 0, max: 100 }, 100, 0)
  const duplicate = buildPolylinePoints(
    [{ x: 50, y: 25 }, { x: 50, y: 50 }, { x: 50, y: 75 }],
    identityX,
    identityY,
  )
  assert.deepEqual(pairs(duplicate), [[50, 75], [50, 50], [50, 25]])
  assert.equal(buildPolylinePoints([], identityX, identityY), '')
  assert.equal(buildPolylinePoints([{ x: 50, y: 50 }], identityX, identityY), '50,50')
  const fractional = buildPolylineFromPixelPoints([{ x: 1 / 3, y: 2 / 3 }])
  assert.equal(fractional, '0.333333,0.666667')
  assert.ok(/^\d+(?:\.\d{0,6})?,\d+(?:\.\d{0,6})?$/.test(fractional))
})

test('mapSeriesPoints drops non-finite points but keeps order', () => {
  const xScale = createLinearScale({ min: 0, max: 1 }, 0, 1)
  const yScale = createLinearScale({ min: 0, max: 1 }, 1, 0)
  const mapped = mapSeriesPoints([
    { x: 0, y: 0 },
    { x: Number.NaN, y: 1 },
    { x: 1, y: 1 },
  ], xScale, yScale)
  assert.deepEqual(mapped, [{ x: 0, y: 1 }, { x: 1, y: 0 }])
})

test('createChartModel: sine curve maps sampled values to verifiable pixels', () => {
  const model = createChartModel(sineData(), { width: 640, height: 240 })
  assert.deepEqual(model.layout.plot, { left: 64, top: 12, width: 560, height: 184 })
  assert.deepEqual(model.xRange, { min: 0, max: 2 * Math.PI })
  assert.deepEqual(model.yRange, { min: -1, max: 1 })
  assert.equal(formatCoordinate(model.xScale.map(0)), '64')
  assert.equal(formatCoordinate(model.xScale.map(Math.PI / 2)), '204')
  assert.equal(formatCoordinate(model.xScale.map(Math.PI)), '344')
  assert.equal(formatCoordinate(model.xScale.map((3 * Math.PI) / 2)), '484')
  assert.equal(formatCoordinate(model.xScale.map(2 * Math.PI)), '624')
  assert.equal(formatCoordinate(model.yScale.map(-1)), '196')
  assert.equal(formatCoordinate(model.yScale.map(-0.5)), '150')
  assert.equal(formatCoordinate(model.yScale.map(0)), '104')
  assert.equal(formatCoordinate(model.yScale.map(0.5)), '58')
  assert.equal(formatCoordinate(model.yScale.map(1)), '12')

  const sine = model.series[0]
  assert.ok(sine !== undefined)
  assert.equal(sine.marks.length, SINE_SAMPLES)
  const path = pairs(sine.polyline)
  assert.equal(path.length, SINE_SAMPLES)
  assert.deepEqual(path[0], [64, 104])
  assert.deepEqual(path[8], [204, 12])
  assert.deepEqual(path[16], [344, 104])
  assert.deepEqual(path[24], [484, 196])
  assert.deepEqual(path[32], [624, 104])
  // The curve is monotonically rising over the first quarter period.
  for (let index = 1; index <= 8; index += 1) {
    assert.ok((path[index] as readonly [number, number])[1] < (path[index - 1] as readonly [number, number])[1])
  }
  assert.equal(model.totalPoints, SINE_SAMPLES)
  assert.equal(model.hasData, true)
})

test('createChartModel: single point lands in the plot centre without NaN', () => {
  const model = createChartModel({ series: [{ name: 'one', points: [{ x: 5, y: 7 }] }] }, { width: 640, height: 240 })
  assert.ok(model.hasData)
  assert.ok(model.xRange.min < 5 && model.xRange.max > 5)
  assert.ok(model.yRange.min < 7 && model.yRange.max > 7)
  assert.equal(formatCoordinate(model.xScale.map(5)), '344')
  assert.equal(formatCoordinate(model.yScale.map(7)), '104')
  const only = model.series[0]
  assert.ok(only !== undefined)
  assert.equal(only.marks.length, 1)
  assert.ok(!only.polyline.includes('NaN'))
})

test('createChartModel: empty and mixed-empty series are handled without NaN', () => {
  const empty = createChartModel({ series: [{ name: 'a', points: [] }, { name: 'b', points: [] }] }, { width: 640 })
  assert.equal(empty.hasData, false)
  assert.equal(empty.totalPoints, 0)
  assert.deepEqual(empty.xRange, { min: 0, max: 1 })
  assert.deepEqual(empty.yRange, { min: 0, max: 1 })
  assert.deepEqual(empty.series.map(item => item.polyline), ['', ''])

  const mixed = createChartModel({
    series: [
      { name: 'empty', points: [] },
      { name: 'data', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    ],
  }, { width: 640 })
  assert.equal(mixed.hasData, true)
  assert.equal(mixed.series[0]?.marks.length, 0)
  assert.equal(mixed.series[1]?.marks.length, 2)
  assert.ok(!mixed.series[1]?.polyline.includes('NaN'))
})

test('createChartModel: axis overrides control the rendered mapping', () => {
  const data: PlotData = {
    series: [{ name: 'w', points: [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 2, y: 5 }] }],
    xAxis: { min: -1, max: 3, label: 'Time', unit: 's' },
    yAxis: { min: -2, max: 2, label: 'Voltage', unit: 'V' },
  }
  const model = createChartModel(data, { width: 640, height: 240 })
  assert.deepEqual(model.xRange, { min: -1, max: 3 })
  assert.deepEqual(model.yRange, { min: -2, max: 2 })
  assert.equal(formatCoordinate(model.xScale.map(-1)), '64')
  assert.equal(formatCoordinate(model.xScale.map(3)), '624')
  assert.equal(formatCoordinate(model.yScale.map(-2)), '196')
  assert.equal(formatCoordinate(model.yScale.map(2)), '12')
  assert.equal(model.xLabel, 'Time')
  assert.equal(model.xUnit, 's')
  assert.equal(model.yLabel, 'Voltage')
  assert.equal(model.yUnit, 'V')
})

test('nearestPoint: resolves the nearest series and the nearest point inside it', () => {
  const model = createChartModel({
    series: [
      { name: 'a', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      { name: 'b', points: [{ x: 5, y: 0 }] },
    ],
  }, { width: 640, height: 240 })
  const bPoint = model.series[1]?.marks[0]
  assert.ok(bPoint !== undefined)
  const hitB = nearestPoint(model.series, bPoint.pixel.x + 1, bPoint.pixel.y + 1)
  assert.equal(hitB?.seriesIndex, 1)
  assert.equal(hitB?.pointIndex, 0)
  const hitA = nearestPoint(model.series, 64, 196)
  assert.equal(hitA?.seriesIndex, 0)
  assert.equal(hitA?.pointIndex, 0)
  assert.equal(nearestPoint(model.series, Number.NaN, 0), undefined)
  assert.equal(nearestPoint([], 0, 0), undefined)
})
