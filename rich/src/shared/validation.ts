/**
 * RichContentV1 validation.
 *
 * The same implementation runs in the Host (before a tool result is persisted)
 * and in the Client (before anything model-supplied reaches React). It never
 * throws on model input: every rejection is a bounded, structured issue list.
 */
import {
  RICH_CONTENT_SCHEMA_VERSION,
  RICH_LIMITS,
  RICH_META_ENVELOPE_VERSION,
  RICH_META_KIND,
  type AxisSpec,
  type BasicDiagramContent,
  type DiagramEdge,
  type DiagramNode,
  type DiagramNodeShape,
  type DiagramNodeTone,
  type LinePlotContent,
  type MessageCardContent,
  type RichContentType,
  type RichContentV1,
  type RichMetaEnvelopeV1,
  type RichValidationCode,
  type RichValidationIssue,
  type ScatterPlotContent,
} from './protocol'

/** Successful validation. */
export interface RichContentValid {
  readonly ok: true
  readonly value: RichContentV1
}

/** Failed validation with one or more bounded issues. */
export interface RichContentInvalid {
  readonly ok: false
  readonly issues: readonly RichValidationIssue[]
}

/** Result of validating one candidate payload. */
export type RichContentValidationResult = RichContentValid | RichContentInvalid

const CONTENT_TYPES: readonly string[] = ['line_plot', 'scatter_plot', 'basic_diagram', 'message_card']
const NODE_SHAPES: readonly string[] = ['box', 'rounded', 'diamond', 'circle']
const NODE_TONES: readonly string[] = ['default', 'accent', 'muted']
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/

function issue(code: RichValidationCode, path: string, detail: string): RichValidationIssue {
  return { code, path, detail }
}

/**
 * True only for objects that behave like parsed JSON plain objects.
 *
 * Model input always arrives through `JSON.parse`, so a real candidate has
 * either `Object.prototype` or a null prototype. Rejecting class instances and
 * object-literal `__proto__` carriers stops validation from reading *inherited*
 * fields that JSON serialization would never produce (such a payload would
 * otherwise serialize as `{}` while validating as a complete card).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value) as unknown
    return prototype === Object.prototype || prototype === null
  } catch {
    // Exotic objects (for example a revoked proxy) are not JSON candidates.
    return false
  }
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  code: RichValidationCode,
  required: true,
): { ok: true; value: string } | { ok: false; issue: RichValidationIssue }
function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  code: RichValidationCode,
  required: false,
): { ok: true; value: string | undefined } | { ok: false; issue: RichValidationIssue }
function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  code: RichValidationCode,
  required: boolean,
): { ok: true; value: string | undefined } | { ok: false; issue: RichValidationIssue } {
  if (value === undefined || value === null) {
    if (!required) return { ok: true, value: undefined }
    return { ok: false, issue: issue(code, path, 'is required') }
  }
  if (typeof value !== 'string') return { ok: false, issue: issue(code, path, 'must be a string') }
  const trimmed = value.trim()
  if (trimmed.length === 0) return { ok: false, issue: issue(code, path, 'must not be empty') }
  if (trimmed.length > maxLength) {
    return { ok: false, issue: issue(code, path, `must be at most ${String(maxLength)} characters`) }
  }
  return { ok: true, value: trimmed }
}

function finiteNumber(value: unknown, path: string): { ok: true; value: number } | { ok: false; issue: RichValidationIssue } {
  // `-0` is finite, but it is not canonical JSON: `JSON.stringify(-0)` is
  // `"0"`. Accepting it would make the persisted payload differ from the
  // validated value, so the protocol rejects it.
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    return {
      ok: false,
      issue: issue('NON_FINITE_NUMBER', path, 'must be a finite, canonical JSON number (NaN, +/-Infinity and -0 are rejected)'),
    }
  }
  return { ok: true, value }
}

function boundedCoordinate(value: unknown, path: string): { ok: true; value: number } | { ok: false; issue: RichValidationIssue } {
  const read = finiteNumber(value, path)
  if (!read.ok) return read
  if (Math.abs(read.value) > RICH_LIMITS.maxAbsCoordinate) {
    return {
      ok: false,
      issue: issue('COORDINATE_OUT_OF_RANGE', path, `must satisfy |value| <= ${String(RICH_LIMITS.maxAbsCoordinate)}`),
    }
  }
  return read
}

/** UTF-8 byte length of a value's JSON serialization (Infinity when not JSON). */
export function serializedByteSize(value: unknown): number {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    // Cyclic graphs and BigInt reach `JSON.stringify` as a TypeError; a value
    // that cannot be serialized can never be a persisted payload, so it is
    // reported as unboundedly large rather than thrown at the caller.
    return Number.POSITIVE_INFINITY
  }
  if (typeof text !== 'string') return Number.POSITIVE_INFINITY
  if (typeof TextEncoder === 'undefined') return text.length
  return new TextEncoder().encode(text).length
}

/** Read the declared schema version without trusting the rest of the payload. */
export function readSchemaVersion(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const raw = value['schemaVersion']
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function validateAxis(raw: unknown, path: string, issues: RichValidationIssue[]): AxisSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) {
    issues.push(issue('INVALID_AXIS', path, 'must be an object'))
    return undefined
  }
  const axis: { label?: string; unit?: string; min?: number; max?: number } = {}
  const label = boundedString(raw['label'], `${path}.label`, RICH_LIMITS.maxAxisLabelLength, 'INVALID_AXIS', false)
  if (!label.ok) issues.push(label.issue)
  else if (label.value !== undefined) axis.label = label.value
  const unit = boundedString(raw['unit'], `${path}.unit`, RICH_LIMITS.maxAxisLabelLength, 'INVALID_AXIS', false)
  if (!unit.ok) issues.push(unit.issue)
  else if (unit.value !== undefined) axis.unit = unit.value
  for (const key of ['min', 'max'] as const) {
    if (raw[key] === undefined) continue
    const read = finiteNumber(raw[key], `${path}.${key}`)
    if (!read.ok) issues.push(read.issue)
    else axis[key] = read.value
  }
  if (axis.min !== undefined && axis.max !== undefined && axis.min >= axis.max) {
    issues.push(issue('INVALID_AXIS_RANGE', path, 'min must be strictly below max'))
  }
  return axis
}

function validateSeriesList(raw: unknown, path: string, issues: RichValidationIssue[]): readonly {
  name: string
  points: readonly { x: number; y: number }[]
  color?: string
}[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(issue('INVALID_SERIES', path, 'must be a non-empty array of series'))
    return []
  }
  if (raw.length > RICH_LIMITS.maxSeries) {
    issues.push(issue('TOO_MANY_SERIES', path, `at most ${String(RICH_LIMITS.maxSeries)} series are allowed`))
    return []
  }
  const series: { name: string; points: readonly { x: number; y: number }[]; color?: string }[] = []
  let total = 0
  raw.forEach((candidate, seriesIndex) => {
    const at = `${path}[${String(seriesIndex)}]`
    if (!isRecord(candidate)) {
      issues.push(issue('INVALID_SERIES', at, 'must be an object'))
      return
    }
    const name = boundedString(candidate['name'], `${at}.name`, RICH_LIMITS.maxAxisLabelLength, 'INVALID_SERIES', true)
    if (!name.ok) {
      issues.push(name.issue)
      return
    }
    let color: string | undefined
    if (candidate['color'] !== undefined) {
      if (typeof candidate['color'] !== 'string' || !HEX_COLOR.test(candidate['color'])) {
        issues.push(issue('INVALID_COLOR', `${at}.color`, 'must be a #rgb or #rrggbb literal'))
      } else color = candidate['color']
    }
    const rawPoints = candidate['points']
    if (!Array.isArray(rawPoints)) {
      issues.push(issue('INVALID_POINT', `${at}.points`, 'must be an array'))
      return
    }
    if (rawPoints.length > RICH_LIMITS.maxPointsPerSeries) {
      issues.push(issue(
        'TOO_MANY_POINTS',
        `${at}.points`,
        `at most ${String(RICH_LIMITS.maxPointsPerSeries)} points per series are allowed`,
      ))
      return
    }
    total += rawPoints.length
    const points: { x: number; y: number }[] = []
    for (let pointIndex = 0; pointIndex < rawPoints.length; pointIndex += 1) {
      const pointPath = `${at}.points[${String(pointIndex)}]`
      const point = rawPoints[pointIndex]
      if (!isRecord(point)) {
        issues.push(issue('INVALID_POINT', pointPath, 'must be an object with finite x and y'))
        continue
      }
      const x = boundedCoordinate(point['x'], `${pointPath}.x`)
      const y = boundedCoordinate(point['y'], `${pointPath}.y`)
      if (x.ok && y.ok) points.push({ x: x.value, y: y.value })
      else {
        if (!x.ok) issues.push(x.issue)
        if (!y.ok) issues.push(y.issue)
      }
    }
    series.push(color === undefined ? { name: name.value, points } : { name: name.value, points, color })
  })
  if (total > RICH_LIMITS.maxTotalPoints) {
    issues.push(issue(
      'TOO_MANY_TOTAL_POINTS',
      path,
      `at most ${String(RICH_LIMITS.maxTotalPoints)} points across all series are allowed`,
    ))
  }
  return series
}

function validateDiagram(raw: unknown, issues: RichValidationIssue[]): {
  nodes: readonly DiagramNode[]
  edges: readonly DiagramEdge[]
} {
  const empty = { nodes: [], edges: [] } as const
  if (!isRecord(raw)) {
    issues.push(issue('INVALID_NODE', 'data', 'must be an object with nodes and edges'))
    return empty
  }
  const rawNodes = raw['nodes']
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    issues.push(issue('INVALID_NODE', 'data.nodes', 'must be a non-empty array'))
    return empty
  }
  if (rawNodes.length > RICH_LIMITS.maxDiagramNodes) {
    issues.push(issue('TOO_MANY_NODES', 'data.nodes', `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`))
    return empty
  }
  const nodes: DiagramNode[] = []
  const ids = new Set<string>()
  rawNodes.forEach((candidate, index) => {
    const at = `data.nodes[${String(index)}]`
    if (!isRecord(candidate)) {
      issues.push(issue('INVALID_NODE', at, 'must be an object'))
      return
    }
    const id = boundedString(candidate['id'], `${at}.id`, RICH_LIMITS.maxNodeIdLength, 'INVALID_NODE', true)
    if (!id.ok) {
      issues.push(id.issue)
      return
    }
    if (!SAFE_ID.test(id.value)) {
      issues.push(issue('INVALID_NODE', `${at}.id`, 'must match [A-Za-z0-9._:-]{1,64}'))
      return
    }
    if (ids.has(id.value)) {
      issues.push(issue('DUPLICATE_NODE_ID', `${at}.id`, 'node ids must be unique'))
      return
    }
    const label = boundedString(candidate['label'], `${at}.label`, RICH_LIMITS.maxNodeLabelLength, 'INVALID_NODE', true)
    if (!label.ok) {
      issues.push(label.issue)
      return
    }
    const x = finiteNumber(candidate['x'], `${at}.x`)
    const y = finiteNumber(candidate['y'], `${at}.y`)
    if (!x.ok || !y.ok) {
      if (!x.ok) issues.push(x.issue)
      if (!y.ok) issues.push(y.issue)
      return
    }
    if (!Number.isInteger(x.value) || x.value < 0 || x.value > 1000 || !Number.isInteger(y.value) || y.value < 0 || y.value > 1000) {
      issues.push(issue('INVALID_NODE', at, 'x and y must be integers in [0, 1000]'))
      return
    }
    const node: {
      id: string
      label: string
      x: number
      y: number
      shape?: DiagramNodeShape
      tone?: DiagramNodeTone
    } = { id: id.value, label: label.value, x: x.value, y: y.value }
    if (candidate['shape'] !== undefined) {
      if (typeof candidate['shape'] !== 'string' || !NODE_SHAPES.includes(candidate['shape'])) {
        issues.push(issue('INVALID_SHAPE', `${at}.shape`, 'must be one of box, rounded, diamond, circle'))
      } else node.shape = candidate['shape'] as DiagramNodeShape
    }
    if (candidate['tone'] !== undefined) {
      if (typeof candidate['tone'] !== 'string' || !NODE_TONES.includes(candidate['tone'])) {
        issues.push(issue('INVALID_SHAPE', `${at}.tone`, 'must be one of default, accent, muted'))
      } else node.tone = candidate['tone'] as DiagramNodeTone
    }
    ids.add(id.value)
    nodes.push(node)
  })
  const rawEdges = raw['edges'] === undefined ? [] : raw['edges']
  if (!Array.isArray(rawEdges)) {
    issues.push(issue('INVALID_EDGE', 'data.edges', 'must be an array'))
    return { nodes, edges: [] }
  }
  if (rawEdges.length > RICH_LIMITS.maxDiagramEdges) {
    issues.push(issue('TOO_MANY_EDGES', 'data.edges', `at most ${String(RICH_LIMITS.maxDiagramEdges)} edges are allowed`))
    return { nodes, edges: [] }
  }
  const edges: DiagramEdge[] = []
  rawEdges.forEach((candidate, index) => {
    const at = `data.edges[${String(index)}]`
    if (!isRecord(candidate)) {
      issues.push(issue('INVALID_EDGE', at, 'must be an object'))
      return
    }
    const from = boundedString(candidate['from'], `${at}.from`, RICH_LIMITS.maxNodeIdLength, 'INVALID_EDGE', true)
    const to = boundedString(candidate['to'], `${at}.to`, RICH_LIMITS.maxNodeIdLength, 'INVALID_EDGE', true)
    if (!from.ok) {
      issues.push(from.issue)
      return
    }
    if (!to.ok) {
      issues.push(to.issue)
      return
    }
    if (!ids.has(from.value) || !ids.has(to.value)) {
      issues.push(issue('UNKNOWN_EDGE_REF', at, 'from and to must name declared nodes'))
      return
    }
    if (from.value === to.value) {
      issues.push(issue('INVALID_EDGE', at, 'self edges are not supported'))
      return
    }
    const edge: { from: string; to: string; label?: string; dashed?: boolean } = { from: from.value, to: to.value }
    if (candidate['label'] !== undefined) {
      const label = boundedString(candidate['label'], `${at}.label`, RICH_LIMITS.maxEdgeLabelLength, 'INVALID_EDGE', false)
      if (!label.ok) issues.push(label.issue)
      else if (label.value !== undefined) edge.label = label.value
    }
    if (candidate['dashed'] !== undefined) {
      if (typeof candidate['dashed'] !== 'boolean') issues.push(issue('INVALID_EDGE', `${at}.dashed`, 'must be a boolean'))
      else edge.dashed = candidate['dashed']
    }
    edges.push(edge)
  })
  return { nodes, edges }
}

/**
 * Cheap cardinality gate: reads only container lengths.
 *
 * An enormous `points` / `nodes` / `edges` / `actions` array is rejected from
 * its length alone, before the whole-payload serialization check and before
 * any per-element validation work. This is what keeps a 100k-point payload
 * bounded (array length is O(1)); the byte cap still applies to everything
 * that survives this gate.
 */
function preScanCardinality(type: string, value: Record<string, unknown>): RichValidationIssue | undefined {
  if (type === 'line_plot' || type === 'scatter_plot') {
    const data = value['data']
    if (!isRecord(data)) return undefined
    const rawSeries = data['series']
    if (!Array.isArray(rawSeries)) return undefined
    if (rawSeries.length > RICH_LIMITS.maxSeries) {
      return issue('TOO_MANY_SERIES', 'data.series', `at most ${String(RICH_LIMITS.maxSeries)} series are allowed`)
    }
    let total = 0
    for (let index = 0; index < rawSeries.length; index += 1) {
      const candidate: unknown = rawSeries[index]
      if (!isRecord(candidate)) continue
      const points = candidate['points']
      if (!Array.isArray(points)) continue
      if (points.length > RICH_LIMITS.maxPointsPerSeries) {
        return issue(
          'TOO_MANY_POINTS',
          `data.series[${String(index)}].points`,
          `at most ${String(RICH_LIMITS.maxPointsPerSeries)} points per series are allowed`,
        )
      }
      total += points.length
    }
    if (total > RICH_LIMITS.maxTotalPoints) {
      return issue(
        'TOO_MANY_TOTAL_POINTS',
        'data.series',
        `at most ${String(RICH_LIMITS.maxTotalPoints)} points across all series are allowed`,
      )
    }
    return undefined
  }
  if (type === 'basic_diagram') {
    const data = value['data']
    if (!isRecord(data)) return undefined
    const nodes = data['nodes']
    if (Array.isArray(nodes) && nodes.length > RICH_LIMITS.maxDiagramNodes) {
      return issue('TOO_MANY_NODES', 'data.nodes', `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`)
    }
    const edges = data['edges']
    if (Array.isArray(edges) && edges.length > RICH_LIMITS.maxDiagramEdges) {
      return issue('TOO_MANY_EDGES', 'data.edges', `at most ${String(RICH_LIMITS.maxDiagramEdges)} edges are allowed`)
    }
    return undefined
  }
  const actions = value['actions']
  if (Array.isArray(actions) && actions.length > RICH_LIMITS.maxCardActions) {
    return issue('TOO_MANY_ACTIONS', 'actions', `at most ${String(RICH_LIMITS.maxCardActions)} actions are allowed`)
  }
  return undefined
}

/** Validate one untrusted candidate and return either the normalized payload or bounded issues. */
function validateRichContentUnsafe(value: unknown): RichContentValidationResult {
  const issues: RichValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [issue('NOT_AN_OBJECT', '', 'payload must be a JSON object')] }
  }
  if (readSchemaVersion(value) !== RICH_CONTENT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [issue('UNSUPPORTED_SCHEMA_VERSION', 'schemaVersion', `only schemaVersion ${String(RICH_CONTENT_SCHEMA_VERSION)} is supported`)],
    }
  }
  const type = value['type']
  if (typeof type !== 'string' || !CONTENT_TYPES.includes(type)) {
    return { ok: false, issues: [issue('UNKNOWN_TYPE', 'type', 'unsupported content type')] }
  }
  const oversized = preScanCardinality(type, value)
  if (oversized !== undefined) return { ok: false, issues: [oversized] }
  const size = serializedByteSize(value)
  if (size > RICH_LIMITS.maxSerializedBytes) {
    return {
      ok: false,
      issues: [issue(
        'PAYLOAD_TOO_LARGE',
        '',
        `serialized payload is ${String(size)} bytes (limit ${String(RICH_LIMITS.maxSerializedBytes)})`,
      )],
    }
  }
  const title = boundedString(value['title'], 'title', RICH_LIMITS.maxTitleLength, 'INVALID_TITLE', true)
  if (!title.ok) return { ok: false, issues: [title.issue] }
  const subtitle = boundedString(value['subtitle'], 'subtitle', RICH_LIMITS.maxSubtitleLength, 'INVALID_SUBTITLE', false)
  if (!subtitle.ok) issues.push(subtitle.issue)
  const subtitleValue = subtitle.ok ? subtitle.value : undefined

  if (type === 'line_plot' || type === 'scatter_plot') {
    const data = value['data']
    if (!isRecord(data)) {
      issues.push(issue('INVALID_SERIES', 'data', 'must be an object with a series array'))
      return { ok: false, issues }
    }
    const series = validateSeriesList(data['series'], 'data.series', issues)
    const xAxis = validateAxis(data['xAxis'], 'data.xAxis', issues)
    const yAxis = validateAxis(data['yAxis'], 'data.yAxis', issues)
    if (issues.length > 0) return { ok: false, issues }
    const value_: LinePlotContent | ScatterPlotContent = {
      schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
      type: type as 'line_plot' | 'scatter_plot',
      title: title.value as string,
      ...subtitleValue === undefined ? {} : { subtitle: subtitleValue },
      data: {
        series,
        ...xAxis === undefined ? {} : { xAxis },
        ...yAxis === undefined ? {} : { yAxis },
      },
    }
    return { ok: true, value: value_ }
  }

  if (type === 'basic_diagram') {
    const { nodes, edges } = validateDiagram(value['data'], issues)
    if (issues.length > 0) return { ok: false, issues }
    const value_: BasicDiagramContent = {
      schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
      type: 'basic_diagram',
      title: title.value as string,
      ...subtitleValue === undefined ? {} : { subtitle: subtitleValue },
      data: { nodes, edges },
    }
    return { ok: true, value: value_ }
  }

  // message_card
  const body = boundedString(value['body'], 'body', RICH_LIMITS.maxCardBodyLength, 'INVALID_BODY', true)
  if (!body.ok) issues.push(body.issue)
  const bodyText = body.ok ? body.value : ''
  let questionId: string | undefined
  if (value['questionId'] !== undefined) {
    if (typeof value['questionId'] !== 'string' || !SAFE_ID.test(value['questionId'])) {
      issues.push(issue('INVALID_QUESTION_ID', 'questionId', 'must match [A-Za-z0-9._:-]{1,64}'))
    } else questionId = value['questionId']
  }
  const actions: { id: string; label: string; submitText: string }[] = []
  if (value['actions'] !== undefined) {
    const rawActions = value['actions']
    if (!Array.isArray(rawActions) || rawActions.length === 0) {
      issues.push(issue('INVALID_ACTION', 'actions', 'must be a non-empty array when present'))
    } else if (rawActions.length > RICH_LIMITS.maxCardActions) {
      issues.push(issue('TOO_MANY_ACTIONS', 'actions', `at most ${String(RICH_LIMITS.maxCardActions)} actions are allowed`))
    } else {
      const ids = new Set<string>()
      rawActions.forEach((candidate, index) => {
        const at = `actions[${String(index)}]`
        if (!isRecord(candidate)) {
          issues.push(issue('INVALID_ACTION', at, 'must be an object'))
          return
        }
        if (typeof candidate['id'] !== 'string' || !SAFE_ID.test(candidate['id'])) {
          issues.push(issue('INVALID_ACTION', `${at}.id`, 'must match [A-Za-z0-9._:-]{1,64}'))
          return
        }
        if (ids.has(candidate['id'])) {
          issues.push(issue('INVALID_ACTION', `${at}.id`, 'action ids must be unique'))
          return
        }
        const label = boundedString(candidate['label'], `${at}.label`, RICH_LIMITS.maxActionLabelLength, 'INVALID_ACTION', true)
        if (!label.ok) {
          issues.push(label.issue)
          return
        }
        const submitText = boundedString(candidate['submitText'], `${at}.submitText`, RICH_LIMITS.maxSubmitTextLength, 'INVALID_ACTION', true)
        if (!submitText.ok) {
          issues.push(submitText.issue)
          return
        }
        ids.add(candidate['id'])
        actions.push({ id: candidate['id'], label: label.value, submitText: submitText.value })
      })
    }
  }
  if (issues.length > 0) return { ok: false, issues }
  const card: MessageCardContent = {
    schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
    type: 'message_card',
    title: title.value as string,
    ...subtitleValue === undefined ? {} : { subtitle: subtitleValue },
    ...questionId === undefined ? {} : { questionId },
    body: bodyText,
    ...actions.length === 0 ? {} : { actions },
  }
  return { ok: true, value: card }
}

/**
 * Validate one untrusted candidate.
 *
 * Total by construction: JSON input is always a plain object graph, but the
 * exported function accepts arbitrary JavaScript values, including objects
 * whose accessors or proxies throw. Those are rejected as unreadable instead
 * of escaping as an exception, because validation is the trust boundary.
 */
export function validateRichContent(value: unknown): RichContentValidationResult {
  try {
    return validateRichContentUnsafe(value)
  } catch {
    return { ok: false, issues: [issue('NOT_AN_OBJECT', '', 'payload could not be read as a JSON object')] }
  }
}

/** Narrowing type guard over a candidate payload. */
export function isRichContentV1(value: unknown): value is RichContentV1 {
  return validateRichContent(value).ok
}

/** Validate one persisted meta envelope. */
export function isRichMetaEnvelopeV1(value: unknown): value is RichMetaEnvelopeV1 {
  try {
    if (!isRecord(value)) return false
    return value['kind'] === RICH_META_KIND
      && value['envelopeVersion'] === RICH_META_ENVELOPE_VERSION
      && isRichContentV1(value['content'])
  } catch {
    return false
  }
}

/**
 * Read our envelope out of an arbitrary persisted `meta` value.
 * Returns `undefined` for foreign or malformed meta; the caller falls back to
 * the generic tool card instead of throwing.
 */
export function readRichMeta(value: unknown): RichMetaEnvelopeV1 | undefined {
  try {
    if (!isRecord(value)) return undefined
    if (value['kind'] !== RICH_META_KIND) return undefined
    if (value['envelopeVersion'] !== RICH_META_ENVELOPE_VERSION) return undefined
    const result = validateRichContent(value['content'])
    if (!result.ok) return undefined
    return { kind: RICH_META_KIND, envelopeVersion: RICH_META_ENVELOPE_VERSION, content: result.value }
  } catch {
    return undefined
  }
}

/** Compact model-facing / diagnostic description of a validated payload. */
export function summarizeRichContent(value: RichContentV1): string {
  switch (value.type) {
    case 'line_plot':
    case 'scatter_plot': {
      const count = value.data.series.reduce((sum, series) => sum + series.points.length, 0)
      return `${value.type} "${value.title}": ${String(value.data.series.length)} series, ${String(count)} points`
    }
    case 'basic_diagram':
      return `basic_diagram "${value.title}": ${String(value.data.nodes.length)} nodes, ${String(value.data.edges.length)} edges`
    case 'message_card':
      return `message_card "${value.title}": ${String(value.actions?.length ?? 0)} actions`
  }
}

/** Render issues into one bounded single-line diagnostic string. */
export function formatValidationIssues(issues: readonly RichValidationIssue[]): string {
  const head = issues.slice(0, 8).map(item => `${item.code}@${item.path || '<root>'}: ${item.detail}`)
  const suffix = issues.length > head.length ? ` (+${String(issues.length - head.length)} more)` : ''
  return head.join('; ') + suffix
}
