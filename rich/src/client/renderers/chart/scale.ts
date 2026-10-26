/**
 * Pure numeric core shared by the SVG chart renderers (`line_plot`, `scatter_plot`).
 *
 * Everything in this module is deterministic and DOM-free:
 *   - data extents + model-supplied axis overrides (an explicit `min`/`max`
 *     always wins over the data extent),
 *   - linear data -> pixel mapping for a fixed plot rectangle,
 *   - human friendly ticks ("nice numbers") with stable decimal precision,
 *   - bounded polyline coordinate serialization (never more than 6 decimals),
 *   - nearest-point search used by the hover tooltip,
 *   - the single `createChartModel` entry point the renderers and the unit
 *     tests both consume, so the markup can be verified against plain math.
 *
 * All functions are total: non-finite / empty / degenerate input produces a
 * valid fallback instead of `NaN` coordinates or an infinite loop.
 */
import type { AxisSpec, PlotData, PlotPoint, PlotSeries } from '../../../shared/index'

/** One inclusive numeric axis domain. */
export interface AxisRange {
  readonly min: number
  readonly max: number
}

/** Pixel-space point. */
export interface PixelPoint {
  readonly x: number
  readonly y: number
}

/** Plot rectangle inside the SVG viewport (pixels). */
export interface PlotRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** Full chart geometry for a given width/height. */
export interface ChartLayout {
  readonly width: number
  readonly height: number
  readonly plot: PlotRect
}

/** One axis tick with its pre-formatted label. */
export interface TickMark {
  readonly value: number
  readonly label: string
}

/** Tick set: friendly step, label precision, and the tick list. */
export interface TickSet {
  readonly step: number
  readonly decimals: number
  readonly ticks: readonly TickMark[]
}

/** A linear mapping between a data domain and a pixel interval. */
export interface LinearScale {
  readonly domain: AxisRange
  /** Pixel for `domain.min`. May be larger than `pixelMax` (inverted y axis). */
  readonly pixelMin: number
  /** Pixel for `domain.max`. */
  readonly pixelMax: number
  readonly map: (value: number) => number
  readonly invert: (pixel: number) => number
}

/** One plotted mark: source point plus its pixel position. */
export interface ChartMark {
  readonly index: number
  readonly point: PlotPoint
  readonly pixel: PixelPoint
}

/** One series after colour resolution, point filtering, and mapping. */
export interface ChartSeriesModel {
  readonly index: number
  readonly name: string
  readonly color: string
  readonly marks: readonly ChartMark[]
  /** `points` attribute for `<polyline>`, already bounded to 6 decimals. */
  readonly polyline: string
}

/** Nearest hovered point, including the owning series. */
export interface NearestPoint {
  readonly seriesIndex: number
  readonly pointIndex: number
  readonly point: PlotPoint
  readonly pixel: PixelPoint
  readonly series: ChartSeriesModel
}

/** The complete deterministic chart description. */
export interface ChartModel {
  readonly layout: ChartLayout
  readonly plot: PlotRect
  readonly xRange: AxisRange
  readonly yRange: AxisRange
  readonly xScale: LinearScale
  readonly yScale: LinearScale
  readonly xTicks: TickSet
  readonly yTicks: TickSet
  readonly series: readonly ChartSeriesModel[]
  readonly totalPoints: number
  readonly hasData: boolean
  readonly xLabel: string | undefined
  readonly xUnit: string | undefined
  readonly yLabel: string | undefined
  readonly yUnit: string | undefined
}

/** Options of {@link createChartModel}. */
export interface ChartModelOptions {
  readonly width?: number | undefined
  readonly height?: number | undefined
  readonly palette?: readonly string[] | undefined
}

/** Renderer width used before a ResizeObserver measurement (and in SSR tests). */
export const CHART_DEFAULT_WIDTH = 640
/** Renderer height in CSS px; the spec asks for roughly 220-260. */
export const CHART_DEFAULT_HEIGHT = 240
/** Smallest layout width we accept, so a 0px container never yields nonsense. */
export const CHART_MIN_WIDTH = 240
/** Lower/upper bound for the chart height. */
export const CHART_MIN_HEIGHT = 220
export const CHART_MAX_HEIGHT = 260
/** Fixed plot-area margins keep pixel coordinates easy to verify. */
export const CHART_MARGINS = { top: 12, right: 16, bottom: 44, left: 64 } as const
/** Tick label font size (px) used by the renderer. */
export const TICK_FONT_SIZE = 10
/** Desired tick counts; actual counts stay bounded near these values. */
export const X_TICK_TARGET = 6
export const Y_TICK_TARGET = 5
/** Hard cap on generated ticks; a defensive stop for pathological input. */
export const MAX_TICKS = 24
/** Maximum decimals emitted for any coordinate in the SVG. */
export const MAX_COORDINATE_DECIMALS = 6

/** Palette used when neither the payload nor the theme supplies a colour. */
export const FALLBACK_SERIES_PALETTE: readonly string[] = [
  '#d94f2b',
  '#247bbf',
  '#1a7f37',
  '#8e44ad',
  '#c98a00',
  '#0f766e',
  '#b0355b',
  '#475569',
]

/** Fallback domain when there is no data and no explicit axis bound. */
export const DEFAULT_AXIS_RANGE: AxisRange = { min: 0, max: 1 }

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Clamp a number into `[low, high]`; non-finite values fall back to `low`. */
export function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  if (value < low) return low
  if (value > high) return high
  return value
}

/** Normalize a renderer width: finite, at least {@link CHART_MIN_WIDTH}. */
export function normalizeChartWidth(width: number | undefined): number {
  if (width === undefined || !Number.isFinite(width) || width <= 0) return CHART_DEFAULT_WIDTH
  return Math.max(CHART_MIN_WIDTH, Math.round(width))
}

/** Normalize a renderer height into the supported 220..260 CSS px band. */
export function normalizeChartHeight(height: number | undefined): number {
  if (height === undefined || !Number.isFinite(height) || height <= 0) return CHART_DEFAULT_HEIGHT
  return Math.round(clamp(height, CHART_MIN_HEIGHT, CHART_MAX_HEIGHT))
}

/** Compute the fixed-margin plot rectangle for a chart size. */
export function chartLayout(width?: number, height?: number): ChartLayout {
  const normalizedWidth = normalizeChartWidth(width)
  const normalizedHeight = normalizeChartHeight(height)
  const plot: PlotRect = {
    left: CHART_MARGINS.left,
    top: CHART_MARGINS.top,
    width: Math.max(20, normalizedWidth - CHART_MARGINS.left - CHART_MARGINS.right),
    height: Math.max(20, normalizedHeight - CHART_MARGINS.top - CHART_MARGINS.bottom),
  }
  return { width: normalizedWidth, height: normalizedHeight, plot }
}

/** Extent of every finite point in the given series. */
export function plotExtents(series: readonly PlotSeries[]): { readonly x: AxisRange | undefined; readonly y: AxisRange | undefined } {
  let xMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  let seen = false
  for (const item of Array.isArray(series) ? series : []) {
    if (item === null || typeof item !== 'object') continue
    const points = Array.isArray(item.points) ? item.points : []
    for (const point of points) {
      if (point === null || typeof point !== 'object') continue
      const { x, y } = point
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue
      seen = true
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }
  if (!seen) return { x: undefined, y: undefined }
  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } }
}

/**
 * Resolve one axis domain.
 *
 * An explicit model bound always wins. If an override leaves the domain empty
 * (for example `min` above the data maximum) the other end is expanded just
 * enough to stay strictly increasing; a degenerate all-equal data extent is
 * padded symmetrically so the mapping never divides by zero.
 */
export function resolveAxisRange(
  extent: AxisRange | undefined,
  spec: AxisSpec | undefined,
  fallback: AxisRange = DEFAULT_AXIS_RANGE,
): AxisRange {
  const specMin = spec !== undefined && isFiniteNumber(spec.min) ? spec.min : undefined
  const specMax = spec !== undefined && isFiniteNumber(spec.max) ? spec.max : undefined

  let min = specMin ?? (extent !== undefined ? extent.min : fallback.min)
  let max = specMax ?? (extent !== undefined ? extent.max : fallback.max)
  if (!Number.isFinite(min)) min = fallback.min
  if (!Number.isFinite(max)) max = fallback.max

  if (max > min) return { min, max }

  const explicitMin = specMin !== undefined
  const explicitMax = specMax !== undefined
  if (explicitMin && explicitMax) {
    // Upstream validation rejects this; keep the function total regardless.
    return { min, max: min + Math.max(Math.abs(min) * 0.05, 0.5) }
  }
  if (explicitMin && !explicitMax) {
    return { min, max: min + Math.max(Math.abs(min) * 0.05, 0.5) }
  }
  if (explicitMax && !explicitMin) {
    return { min: max - Math.max(Math.abs(max) * 0.05, 0.5), max }
  }
  const pad = Math.max(Math.abs(min) * 0.05, 0.5)
  return { min: min - pad, max: max + pad }
}

/** Resolve both axes of a plot payload. */
export function resolvePlotRanges(data: PlotData): { readonly x: AxisRange; readonly y: AxisRange } {
  const source: readonly PlotSeries[] = data !== null && typeof data === 'object' && Array.isArray(data.series) ? data.series : []
  const extents = plotExtents(source)
  return {
    x: resolveAxisRange(extents.x, data?.xAxis),
    y: resolveAxisRange(extents.y, data?.yAxis),
  }
}

/** Round to a fixed number of decimals and normalize `-0` to `0`. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const digits = Math.trunc(clamp(decimals, 0, 12))
  const factor = 10 ** digits
  if (!Number.isFinite(factor) || factor === 0) return value
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * "Nice" step for a raw interval: round to the nearest 1/2/5 x 10^n.
 * Never returns a non-positive or non-finite value.
 */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const exponent = Math.floor(Math.log10(raw))
  const power = 10 ** exponent
  const fraction = raw / power
  let niceFraction: number
  if (fraction < 1.5) niceFraction = 1
  else if (fraction < 3) niceFraction = 2
  else if (fraction < 7) niceFraction = 5
  else niceFraction = 10
  const step = niceFraction * power
  return Number.isFinite(step) && step > 0 ? step : 1
}

/** Decimal places needed to print every multiple of `step` without noise. */
export function decimalsForStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const exponent = Math.floor(Math.log10(step))
  const decimals = clamp(-exponent, 0, MAX_COORDINATE_DECIMALS)
  return Object.is(decimals, -0) ? 0 : decimals
}

/** Numeric label with a stable decimal count; never prints "-0". */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '0'
  const digits = Math.trunc(clamp(decimals, 0, MAX_COORDINATE_DECIMALS))
  const rounded = roundTo(value, digits)
  const text = rounded.toFixed(digits)
  if (/^-0(?:\.0+)?$/.test(text)) return text.slice(1)
  return text
}

/** Numeric tick label, optionally suffixed with the axis unit ("1.5 V"). */
export function formatTickLabel(value: number, decimals: number, unit?: string): string {
  const number = formatNumber(value, decimals)
  if (unit === undefined) return number
  const trimmed = unit.trim()
  return trimmed.length === 0 ? number : `${number} ${trimmed}`
}

/**
 * Ticks at nice numbers strictly inside `[min, max]`, ascending, bounded in
 * count. Degenerate ranges yield a single tick and never loop forever.
 */
export function niceTicks(min: number, max: number, targetCount: number): readonly number[] {
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) return []
  const low = Math.min(min, max)
  const high = Math.max(min, max)
  const target = isFiniteNumber(targetCount) && targetCount >= 2 ? Math.floor(Math.min(targetCount, 12)) : 5
  if (high === low) return [roundTo(low, 6)]
  const span = high - low
  if (!(span > 0) || !Number.isFinite(span)) return [roundTo(low, 6)]
  const step = niceStep(span / (target - 1))
  const decimals = decimalsForStep(step)
  const first = Math.ceil(low / step - 1e-9) * step
  const values: number[] = []
  // Defensive bound: the arithmetic already stops at `high`, but the loop can
  // never run away even for absurd inputs.
  const hardLimit = Math.min(MAX_TICKS, target * 3 + 4)
  for (let index = 0; index < hardLimit; index += 1) {
    const value = first + index * step
    if (!Number.isFinite(value) || value > high + step * 1e-6) break
    const rounded = roundTo(value, decimals)
    if (rounded < low - step * 1e-6) continue
    values.push(rounded)
  }
  if (values.length < 2) {
    // A small target can produce a step that skips the range end; fall back to
    // the two domain bounds so an axis is never reduced to a single tick.
    const fallback = [roundTo(low, decimals), roundTo(high, decimals)]
    if (fallback[0] !== fallback[1]) return fallback
    return values.length === 1 ? values : [fallback[0] as number]
  }
  return values
}

/** Ticks plus their shared step and precision. */
export function buildTickSet(range: AxisRange, targetCount: number, unit?: string): TickSet {
  const target = isFiniteNumber(targetCount) && targetCount >= 2 ? Math.floor(Math.min(targetCount, 12)) : 5
  const span = (isFiniteNumber(range.max) ? range.max : 0) - (isFiniteNumber(range.min) ? range.min : 0)
  const step = span > 0 && Number.isFinite(span) ? niceStep(span / (target - 1)) : 0
  const decimals = decimalsForStep(step)
  const ticks = niceTicks(range.min, range.max, target).map(value => ({
    value,
    label: formatTickLabel(value, decimals, unit),
  }))
  return { step, decimals, ticks }
}

/** Build a linear data -> pixel scale. Never produces `NaN`. */
export function createLinearScale(domain: AxisRange, pixelMin: number, pixelMax: number): LinearScale {
  const span = domain.max - domain.min
  const pixelSpan = pixelMax - pixelMin
  const validSpan = Number.isFinite(span) && span !== 0
  const validPixelSpan = Number.isFinite(pixelSpan) && pixelSpan !== 0
  const map = (value: number): number => {
    if (!Number.isFinite(value)) return pixelMin
    if (!validSpan) return (pixelMin + pixelMax) / 2
    return pixelMin + ((value - domain.min) / span) * pixelSpan
  }
  const invert = (pixel: number): number => {
    if (!Number.isFinite(pixel) || !validPixelSpan) return domain.min
    return domain.min + ((pixel - pixelMin) / pixelSpan) * span
  }
  return { domain, pixelMin, pixelMax, map, invert }
}

/** Serialize one pixel coordinate with at most 6 decimals, no `-0`. */
export function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = roundTo(value, MAX_COORDINATE_DECIMALS)
  if (rounded === 0) return '0'
  return String(rounded)
}

/** Map data points to pixels; non-finite points are dropped, order is kept. */
export function mapSeriesPoints(
  points: readonly PlotPoint[],
  xScale: LinearScale,
  yScale: LinearScale,
): readonly PixelPoint[] {
  const mapped: PixelPoint[] = []
  for (const point of points) {
    if (point === null || typeof point !== 'object') continue
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue
    mapped.push({ x: xScale.map(point.x), y: yScale.map(point.y) })
  }
  return mapped
}

/**
 * Build the `points` attribute of an SVG polyline from pixel points.
 * Every point is kept, in input order (duplicate x values included); an empty
 * or all-invalid list yields an empty string.
 */
export function buildPolylineFromPixelPoints(points: readonly PixelPoint[]): string {
  const parts: string[] = []
  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue
    parts.push(`${formatCoordinate(point.x)},${formatCoordinate(point.y)}`)
  }
  return parts.join(' ')
}

/** Build a polyline `points` attribute directly from data points. */
export function buildPolylinePoints(
  points: readonly PlotPoint[],
  xScale: LinearScale,
  yScale: LinearScale,
): string {
  return buildPolylineFromPixelPoints(mapSeriesPoints(points, xScale, yScale))
}

/**
 * Find the nearest plotted point for a hover position.
 * The nearest series is chosen first (smallest distance to any of its points),
 * then the nearest point inside it; exact ties keep the earlier series/point.
 */
export function nearestPoint(
  series: readonly ChartSeriesModel[],
  pixelX: number,
  pixelY: number,
): NearestPoint | undefined {
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return undefined
  let bestSeries: NearestPoint | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of series) {
    let seriesPoint: ChartMark | undefined
    let seriesDistance = Number.POSITIVE_INFINITY
    for (const mark of item.marks) {
      const dx = mark.pixel.x - pixelX
      const dy = mark.pixel.y - pixelY
      const distance = dx * dx + dy * dy
      if (distance < seriesDistance) {
        seriesDistance = distance
        seriesPoint = mark
      }
    }
    if (seriesPoint !== undefined && seriesDistance < bestDistance) {
      bestDistance = seriesDistance
      bestSeries = {
        seriesIndex: item.index,
        pointIndex: seriesPoint.index,
        point: seriesPoint.point,
        pixel: seriesPoint.pixel,
        series: item,
      }
    }
  }
  return bestSeries
}

/** Resolve the colour of one series (payload hex wins over the theme palette). */
function seriesColor(series: PlotSeries, index: number, palette: readonly string[]): string {
  if (typeof series.color === 'string' && HEX_COLOR.test(series.color)) return series.color
  const fromPalette = palette[index % palette.length]
  if (typeof fromPalette === 'string' && fromPalette.length > 0) return fromPalette
  return FALLBACK_SERIES_PALETTE[index % FALLBACK_SERIES_PALETTE.length] as string
}

/**
 * Build the complete chart model consumed by both renderers and the tests.
 * Deterministic for a given `(data, width, height, palette)`.
 */
export function createChartModel(data: PlotData, options: ChartModelOptions = {}): ChartModel {
  const layout = chartLayout(options.width, options.height)
  const palette = options.palette !== undefined && options.palette.length > 0 ? options.palette : FALLBACK_SERIES_PALETTE
  const rawSeries: readonly PlotSeries[] = data !== null && typeof data === 'object' && Array.isArray(data.series) ? data.series : []
  const extents = plotExtents(rawSeries)
  const xRange = resolveAxisRange(extents.x, data?.xAxis)
  const yRange = resolveAxisRange(extents.y, data?.yAxis)
  const xTicks = buildTickSet(xRange, X_TICK_TARGET)
  const yTicks = buildTickSet(yRange, Y_TICK_TARGET)

  const xScale = createLinearScale(xRange, layout.plot.left, layout.plot.left + layout.plot.width)
  const yScale = createLinearScale(yRange, layout.plot.top + layout.plot.height, layout.plot.top)

  const series: ChartSeriesModel[] = rawSeries.map((item, index) => {
    const sourcePoints = item !== null && typeof item === 'object' && Array.isArray(item.points) ? item.points : []
    const marks: ChartMark[] = []
    for (const point of sourcePoints) {
      if (point === null || typeof point !== 'object') continue
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue
      marks.push({ index: marks.length, point, pixel: { x: xScale.map(point.x), y: yScale.map(point.y) } })
    }
    return {
      index,
      name: typeof item.name === 'string' ? item.name : `series ${String(index + 1)}`,
      color: seriesColor(item, index, palette),
      marks,
      polyline: buildPolylineFromPixelPoints(marks.map(mark => mark.pixel)),
    }
  })

  const totalPoints = series.reduce((sum, item) => sum + item.marks.length, 0)
  const xAxis = data?.xAxis
  const yAxis = data?.yAxis
  return {
    layout,
    plot: layout.plot,
    xRange,
    yRange,
    xScale,
    yScale,
    xTicks,
    yTicks,
    series,
    totalPoints,
    hasData: totalPoints > 0,
    xLabel: typeof xAxis?.label === 'string' ? xAxis.label : undefined,
    xUnit: typeof xAxis?.unit === 'string' ? xAxis.unit : undefined,
    yLabel: typeof yAxis?.label === 'string' ? yAxis.label : undefined,
    yUnit: typeof yAxis?.unit === 'string' ? yAxis.unit : undefined,
  }
}

/** Display text for an axis title, folding the optional unit into it. */
export function axisTitleText(label: string | undefined, unit: string | undefined): string {
  const name = label?.trim() ?? ''
  const suffix = unit?.trim() ?? ''
  if (name.length > 0 && suffix.length > 0) return `${name} (${suffix})`
  if (name.length > 0) return name
  return suffix
}
