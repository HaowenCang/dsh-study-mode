/**
 * HeatmapV1 - a bounded numeric matrix drawn as a colored grid.
 *
 * Separate from RichContentV1, whose types are frozen: `rich_heatmap` persists
 * its own `rich-heatmap` envelope, and a client without this reader shows the
 * generic tool row. Every value is untrusted model output, so only finite
 * canonical numbers, bounded plain text and closed literals are admitted; the
 * renderer chooses every color from the fixed palettes below.
 */
import { isPlainText } from './plain-text'
import { isRecord, serializedByteSize } from './validation'

export const HEATMAP_SCHEMA_VERSION = 1 as const
export const HEATMAP_META_KIND = 'rich-heatmap' as const
export const HEATMAP_ENVELOPE_VERSION = 1 as const

export const HEATMAP_LIMITS = {
  maxSerializedBytes: 256 * 1024,
  maxTitleLength: 200,
  maxSubtitleLength: 500,
  maxLabelLength: 80,
  maxRows: 128,
  maxColumns: 128,
  maxCells: 4096,
  /** Largest absolute cell value, axis bound or scale bound. */
  maxAbsValue: 1e7,
} as const

/** `sequential` is viridis (low -> high); `diverging` is blue -> neutral -> red around the scale midpoint. */
export type HeatmapPalette = 'sequential' | 'diverging'

/** `lower`: values[0] is the bottom row (y grows upward); `upper`: values[0] is the top row (matrix order). */
export type HeatmapOrigin = 'lower' | 'upper'

/** Axis decoration; `min`/`max` are the coordinates of the grid's outer edges, given together or not at all. */
export interface HeatmapAxis {
  readonly label?: string
  readonly unit?: string
  readonly min?: number
  readonly max?: number
}

/** Color scale; an explicit range must contain every value. */
export interface HeatmapColorScale {
  readonly palette: HeatmapPalette
  readonly label?: string
  readonly unit?: string
  readonly min?: number
  readonly max?: number
}

/** The canonical, validated heatmap payload. */
export interface HeatmapContent {
  readonly schemaVersion: typeof HEATMAP_SCHEMA_VERSION
  readonly title: string
  readonly subtitle?: string
  /** Row-major rectangular matrix: values[row][column]. */
  readonly values: readonly (readonly number[])[]
  readonly origin: HeatmapOrigin
  readonly xAxis?: HeatmapAxis
  readonly yAxis?: HeatmapAxis
  readonly colorScale: HeatmapColorScale
}

/** Durable envelope persisted through the tool result `meta`. */
export interface HeatmapEnvelope {
  readonly kind: typeof HEATMAP_META_KIND
  readonly envelopeVersion: typeof HEATMAP_ENVELOPE_VERSION
  readonly content: HeatmapContent
}

export type HeatmapIssueCode =
  | 'NOT_AN_OBJECT'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'TOO_MANY_CELLS'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_TITLE'
  | 'INVALID_SUBTITLE'
  | 'INVALID_VALUES'
  | 'NON_FINITE_NUMBER'
  | 'VALUE_OUT_OF_RANGE'
  | 'INVALID_ORIGIN'
  | 'INVALID_AXIS'
  | 'INVALID_SCALE'
  | 'VALUE_OUT_OF_SCALE'

export interface HeatmapIssue {
  readonly code: HeatmapIssueCode
  readonly path: string
  readonly detail: string
}

export type HeatmapValidationResult =
  | { readonly ok: true; readonly value: HeatmapContent }
  | { readonly ok: false; readonly issues: readonly HeatmapIssue[] }

/** Resolved color range; `constant` marks a degenerate range drawn with the palette midpoint. */
export interface HeatmapScale {
  readonly min: number
  readonly max: number
  readonly constant: boolean
}

const SEQUENTIAL_STOPS = ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725']
const DIVERGING_STOPS = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b']

function issue(code: HeatmapIssueCode, path: string, detail: string): HeatmapIssue {
  return { code, path, detail }
}

function isCanonicalFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function text(
  raw: unknown,
  path: string,
  maxLength: number,
  code: HeatmapIssueCode,
  required: boolean,
  issues: HeatmapIssue[],
): string | undefined {
  if (raw === undefined || raw === null) {
    if (required) issues.push(issue(code, path, 'is required'))
    return undefined
  }
  if (typeof raw !== 'string') {
    issues.push(issue(code, path, 'must be a string'))
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    issues.push(issue(code, path, `must be 1..${String(maxLength)} characters after trimming`))
    return undefined
  }
  if (!isPlainText(trimmed)) {
    issues.push(issue(code, path, 'must be one line of plain text without control or bidirectional-control characters'))
    return undefined
  }
  return trimmed
}

/** Read an optional `{min, max}` pair: both or neither, finite, bounded, strictly ordered. */
function bounds(
  raw: Record<string, unknown>,
  path: string,
  code: HeatmapIssueCode,
  issues: HeatmapIssue[],
): { min: number; max: number } | undefined {
  const min = raw['min']
  const max = raw['max']
  if (min === undefined && max === undefined) return undefined
  if (!isCanonicalFinite(min) || !isCanonicalFinite(max)) {
    issues.push(issue(code, path, 'min and max must both be finite canonical numbers when either is given'))
    return undefined
  }
  if (Math.abs(min) > HEATMAP_LIMITS.maxAbsValue || Math.abs(max) > HEATMAP_LIMITS.maxAbsValue) {
    issues.push(issue(code, path, `bounds must satisfy |value| <= ${String(HEATMAP_LIMITS.maxAbsValue)}`))
    return undefined
  }
  if (min >= max) {
    issues.push(issue(code, path, 'min must be strictly below max'))
    return undefined
  }
  return { min, max }
}

function validateAxis(raw: unknown, path: string, issues: HeatmapIssue[]): HeatmapAxis | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) {
    issues.push(issue('INVALID_AXIS', path, 'must be an object'))
    return undefined
  }
  const label = text(raw['label'], `${path}.label`, HEATMAP_LIMITS.maxLabelLength, 'INVALID_AXIS', false, issues)
  const unit = text(raw['unit'], `${path}.unit`, HEATMAP_LIMITS.maxLabelLength, 'INVALID_AXIS', false, issues)
  const range = bounds(raw, path, 'INVALID_AXIS', issues)
  return {
    ...label === undefined ? {} : { label },
    ...unit === undefined ? {} : { unit },
    ...range ?? {},
  }
}

function validateScale(raw: unknown, issues: HeatmapIssue[]): HeatmapColorScale {
  if (raw === undefined || raw === null) return { palette: 'sequential' }
  if (!isRecord(raw)) {
    issues.push(issue('INVALID_SCALE', 'colorScale', 'must be an object'))
    return { palette: 'sequential' }
  }
  let palette: HeatmapPalette = 'sequential'
  const rawPalette = raw['palette']
  if (rawPalette === 'sequential' || rawPalette === 'diverging') palette = rawPalette
  else if (rawPalette !== undefined) issues.push(issue('INVALID_SCALE', 'colorScale.palette', 'must be sequential or diverging'))
  const label = text(raw['label'], 'colorScale.label', HEATMAP_LIMITS.maxLabelLength, 'INVALID_SCALE', false, issues)
  const unit = text(raw['unit'], 'colorScale.unit', HEATMAP_LIMITS.maxLabelLength, 'INVALID_SCALE', false, issues)
  const range = bounds(raw, 'colorScale', 'INVALID_SCALE', issues)
  return {
    palette,
    ...label === undefined ? {} : { label },
    ...unit === undefined ? {} : { unit },
    ...range ?? {},
  }
}

/** Reject oversized matrices from container lengths before touching any element. */
function preScan(values: unknown): HeatmapIssue | undefined {
  if (!Array.isArray(values)) return undefined
  if (values.length > HEATMAP_LIMITS.maxRows) {
    return issue('TOO_MANY_CELLS', 'values', `at most ${String(HEATMAP_LIMITS.maxRows)} rows are allowed`)
  }
  let total = 0
  for (let row = 0; row < values.length; row += 1) {
    const candidate: unknown = values[row]
    if (!Array.isArray(candidate)) continue
    if (candidate.length > HEATMAP_LIMITS.maxColumns) {
      return issue('TOO_MANY_CELLS', `values[${String(row)}]`, `at most ${String(HEATMAP_LIMITS.maxColumns)} columns are allowed`)
    }
    total += candidate.length
  }
  if (total > HEATMAP_LIMITS.maxCells) {
    return issue('TOO_MANY_CELLS', 'values', `at most ${String(HEATMAP_LIMITS.maxCells)} cells are allowed`)
  }
  return undefined
}

function validateValues(raw: unknown, issues: HeatmapIssue[]): number[][] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(issue('INVALID_VALUES', 'values', 'must be a non-empty array of rows'))
    return []
  }
  const first: unknown = raw[0]
  const columns = Array.isArray(first) ? first.length : 0
  if (columns === 0) {
    issues.push(issue('INVALID_VALUES', 'values[0]', 'must be a non-empty array of numbers'))
    return []
  }
  const rows: number[][] = []
  for (let r = 0; r < raw.length; r += 1) {
    const candidate: unknown = raw[r]
    if (!Array.isArray(candidate) || candidate.length !== columns) {
      issues.push(issue('INVALID_VALUES', `values[${String(r)}]`, `every row must be an array of ${String(columns)} numbers`))
      return []
    }
    const row: number[] = []
    for (let c = 0; c < columns; c += 1) {
      const value: unknown = candidate[c]
      const path = `values[${String(r)}][${String(c)}]`
      if (!isCanonicalFinite(value)) issues.push(issue('NON_FINITE_NUMBER', path, 'must be a finite, canonical JSON number (NaN, +/-Infinity and -0 are rejected)'))
      else if (Math.abs(value) > HEATMAP_LIMITS.maxAbsValue) issues.push(issue('VALUE_OUT_OF_RANGE', path, `must satisfy |value| <= ${String(HEATMAP_LIMITS.maxAbsValue)}`))
      else row.push(value)
    }
    rows.push(row)
  }
  return rows
}

function validateUnsafe(value: unknown): HeatmapValidationResult {
  if (!isRecord(value)) return { ok: false, issues: [issue('NOT_AN_OBJECT', '', 'payload must be a JSON object')] }
  if (value['schemaVersion'] !== HEATMAP_SCHEMA_VERSION) {
    return { ok: false, issues: [issue('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion', `only schemaVersion ${String(HEATMAP_SCHEMA_VERSION)} is supported`)] }
  }
  const oversized = preScan(value['values'])
  if (oversized !== undefined) return { ok: false, issues: [oversized] }
  const size = serializedByteSize(value)
  if (size > HEATMAP_LIMITS.maxSerializedBytes) {
    return { ok: false, issues: [issue('PAYLOAD_TOO_LARGE', '', `serialized payload is ${String(size)} bytes (limit ${String(HEATMAP_LIMITS.maxSerializedBytes)})`)] }
  }
  const issues: HeatmapIssue[] = []
  const title = text(value['title'], 'title', HEATMAP_LIMITS.maxTitleLength, 'INVALID_TITLE', true, issues)
  const subtitle = text(value['subtitle'], 'subtitle', HEATMAP_LIMITS.maxSubtitleLength, 'INVALID_SUBTITLE', false, issues)
  const values = validateValues(value['values'], issues)
  let origin: HeatmapOrigin = 'lower'
  const rawOrigin = value['origin']
  if (rawOrigin === 'lower' || rawOrigin === 'upper') origin = rawOrigin
  else if (rawOrigin !== undefined) issues.push(issue('INVALID_ORIGIN', 'origin', 'must be lower or upper'))
  const xAxis = validateAxis(value['xAxis'], 'xAxis', issues)
  const yAxis = validateAxis(value['yAxis'], 'yAxis', issues)
  const colorScale = validateScale(value['colorScale'], issues)
  if (issues.length === 0 && colorScale.min !== undefined && colorScale.max !== undefined) {
    const { min, max } = colorScale
    values.forEach((row, r) => row.forEach((cell, c) => {
      if (cell < min || cell > max) {
        issues.push(issue('VALUE_OUT_OF_SCALE', `values[${String(r)}][${String(c)}]`, 'must lie inside the explicit colorScale range'))
      }
    }))
  }
  if (issues.length > 0 || title === undefined) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion: HEATMAP_SCHEMA_VERSION,
      title,
      ...subtitle === undefined ? {} : { subtitle },
      values,
      origin,
      ...xAxis === undefined ? {} : { xAxis },
      ...yAxis === undefined ? {} : { yAxis },
      colorScale,
    },
  }
}

/**
 * Validate one untrusted heatmap candidate. Total: exotic objects whose
 * accessors throw are reported as unreadable instead of escaping.
 * @param value - the candidate payload.
 * @returns the canonical payload or bounded issues.
 */
export function validateHeatmap(value: unknown): HeatmapValidationResult {
  try {
    return validateUnsafe(value)
  } catch {
    return { ok: false, issues: [issue('NOT_AN_OBJECT', '', 'payload could not be read as a JSON object')] }
  }
}

/**
 * Read the heatmap envelope out of persisted `meta`, revalidating its content.
 * @param value - arbitrary persisted meta.
 * @returns the envelope, or undefined for foreign, unsupported or invalid meta.
 */
export function readHeatmapMeta(value: unknown): HeatmapEnvelope | undefined {
  try {
    if (!isRecord(value)) return undefined
    if (value['kind'] !== HEATMAP_META_KIND || value['envelopeVersion'] !== HEATMAP_ENVELOPE_VERSION) return undefined
    const result = validateHeatmap(value['content'])
    if (!result.ok) return undefined
    return { kind: HEATMAP_META_KIND, envelopeVersion: HEATMAP_ENVELOPE_VERSION, content: result.value }
  } catch {
    return undefined
  }
}

/** Smallest and largest cell value of a validated payload. */
export function heatmapExtent(content: HeatmapContent): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const row of content.values) {
    for (const value of row) {
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return { min, max }
}

/**
 * Resolve the color range: the explicit range, else the data range
 * (sequential) or a range symmetric around zero (diverging).
 * @param content - a validated payload.
 * @returns the range used for colors and the legend.
 */
export function resolveHeatmapScale(content: HeatmapContent): HeatmapScale {
  const { colorScale } = content
  if (colorScale.min !== undefined && colorScale.max !== undefined) {
    return { min: colorScale.min, max: colorScale.max, constant: false }
  }
  const extent = heatmapExtent(content)
  if (colorScale.palette === 'diverging') {
    const bound = Math.max(Math.abs(extent.min), Math.abs(extent.max))
    return bound === 0 ? { min: 0, max: 0, constant: true } : { min: -bound, max: bound, constant: false }
  }
  return { min: extent.min, max: extent.max, constant: extent.min === extent.max }
}

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

/**
 * Map one value to a palette color by linear interpolation between stops.
 * @param palette - the palette name.
 * @param scale - the resolved range; a constant range maps to the midpoint.
 * @param value - the cell value (clamped into the range).
 * @returns a `#rrggbb` color.
 */
export function heatmapColor(palette: HeatmapPalette, scale: HeatmapScale, value: number): string {
  const stops = palette === 'diverging' ? DIVERGING_STOPS : SEQUENTIAL_STOPS
  const t = scale.constant ? 0.5 : Math.min(1, Math.max(0, (value - scale.min) / (scale.max - scale.min)))
  const position = t * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(position))
  const fraction = position - index
  const low = stops[index] as string
  const high = stops[index + 1] as string
  let color = '#'
  for (const offset of [1, 3, 5]) {
    const mixed = Math.round(channel(low, offset) + (channel(high, offset) - channel(low, offset)) * fraction)
    color += mixed.toString(16).padStart(2, '0')
  }
  return color
}

/** Compact number text used by summaries, labels and tooltips. */
export function formatHeatmapNumber(value: number): string {
  return String(Number(value.toPrecision(6)))
}

/**
 * Number texts for values shown together (range ends, ticks): the fewest
 * significant digits from 6 to 15 at which different values get different texts.
 * @param values - finite numbers.
 * @returns one text per value, in order.
 */
export function formatHeatmapNumbers(values: readonly number[]): string[] {
  for (let precision = 6; ; precision += 1) {
    const labels = values.map(value => String(Number(value.toPrecision(precision))))
    const seen = new Map<string, number>()
    const distinct = labels.every((label, index) => {
      const value = values[index] ?? 0
      const prior = seen.get(label)
      seen.set(label, value)
      return prior === undefined || prior === value
    })
    if (distinct || precision >= 15) return labels
  }
}

/**
 * Model-facing summary of a validated payload.
 * @param content - a validated payload.
 * @returns one line naming the grid size, data range and color range.
 */
export function summarizeHeatmap(content: HeatmapContent): string {
  const extent = heatmapExtent(content)
  const scale = resolveHeatmapScale(content)
  const unit = content.colorScale.unit === undefined ? '' : ` ${content.colorScale.unit}`
  const rows = content.values.length
  const columns = content.values[0]?.length ?? 0
  const [low, high] = formatHeatmapNumbers([extent.min, extent.max])
  const [scaleLow, scaleHigh] = formatHeatmapNumbers([scale.min, scale.max])
  return `heatmap "${content.title}": ${String(rows)}x${String(columns)} cells, values ${String(low)} to ${String(high)}${unit}`
    + ` (${content.colorScale.palette} scale ${String(scaleLow)} to ${String(scaleHigh)}${scale.constant ? ', constant' : ''})`
}

/** Render issues into one bounded single-line diagnostic string. */
export function formatHeatmapIssues(issues: readonly HeatmapIssue[]): string {
  const head = issues.slice(0, 8).map(item => `${item.code}@${item.path || '<root>'}: ${item.detail}`)
  const suffix = issues.length > head.length ? ` (+${String(issues.length - head.length)} more)` : ''
  return head.join('; ') + suffix
}
