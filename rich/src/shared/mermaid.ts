/**
 * Bounded Mermaid flowchart subset -> `basic_diagram` compiler.
 *
 * RC.3's official Markdown leaves ```mermaid fences as literal code and offers
 * no fence-renderer seam, so this plugin does not execute Mermaid at all.
 * Instead a strict, linear-time scanner accepts a small flowchart subset and
 * lays it out deterministically onto the existing restricted diagram grid:
 *
 *   header      flowchart|graph  [TD|TB|BT|LR|RL]
 *   comments    %% ...            (directives `%%{...}%%` are refused)
 *   nodes       id  id[box]  id(rounded)  id([stadium, drawn rounded])  id{diamond}  id((circle))
 *               labels may be "quoted" to include brackets; text is plain and literal
 *   links       -->  -.->  with |label|, or  -- label -->  /  -. label .->
 *   statements  separated by newlines or `;`; chains `A --> B --> C`
 *
 * Everything else (subgraph, click, style/classDef, other diagram types,
 * other link or shape forms, `&`, HTML/entity/markdown label markup, parallel
 * links) is refused with a line-numbered issue rather than approximated. A
 * layout is accepted only when, in the renderer's own geometry, no link runs
 * through another node, no link label is hidden and every arrow is visible.
 * No model text ever becomes markup or an SVG name.
 */
import {
  buildDiagramGeometry,
  DIAGRAM_EDGE_LABEL_UNITS,
  DIAGRAM_VIEW,
  truncateLabel,
  type DiagramGeometry,
  type DiagramNodeGeometry,
} from './diagram-geometry'
import { RICH_CONTENT_SCHEMA_VERSION, RICH_LIMITS, type BasicDiagramContent, type DiagramEdge, type DiagramNode, type DiagramNodeShape } from './protocol'
import { displayWidth } from './text-width'
import { formatValidationIssues, validateRichContent } from './validation'

export const MERMAID_LIMITS = {
  maxSourceBytes: 8 * 1024,
  maxLines: 200,
  maxLineLength: 400,
  maxLayers: 5,
} as const

export type MermaidDirection = 'TD' | 'BT' | 'LR' | 'RL'

export type MermaidIssueCode =
  | 'INVALID_SOURCE'
  | 'SOURCE_TOO_LARGE'
  | 'TOO_MANY_LINES'
  | 'LINE_TOO_LONG'
  | 'CONTROL_CHARACTER'
  | 'MISSING_HEADER'
  | 'UNSUPPORTED_DIRECTION'
  | 'UNSUPPORTED_STATEMENT'
  | 'UNSUPPORTED_LINK'
  | 'UNSUPPORTED_SHAPE'
  | 'INVALID_LABEL'
  | 'INVALID_ID'
  | 'INCOMPLETE_LINK'
  | 'CONFLICTING_NODE'
  | 'SELF_LINK'
  | 'PARALLEL_LINK'
  | 'EMPTY_DIAGRAM'
  | 'TOO_MANY_NODES'
  | 'TOO_MANY_EDGES'
  | 'LAYOUT_TOO_DEEP'
  | 'LAYOUT_OVERCROWDED'
  | 'LAYOUT_OCCLUDED'
  | 'INVALID_CONTENT'

/** One refusal; `line` is 1-based, 0 for whole-source limits. */
export interface MermaidIssue {
  readonly code: MermaidIssueCode
  readonly line: number
  readonly message: string
}

export type MermaidCompileResult =
  | { readonly ok: true; readonly content: BasicDiagramContent; readonly direction: MermaidDirection; readonly layers: number }
  | { readonly ok: false; readonly issues: readonly MermaidIssue[] }

export interface MermaidCompileInput {
  readonly title: string
  readonly subtitle?: string
  readonly source: string
}

const KEYWORDS = new Set(['subgraph', 'end', 'classDef', 'class', 'style', 'linkStyle', 'click', 'direction', 'callback', 'graph', 'flowchart'])
const DIRECTIONS: ReadonlyMap<string, MermaidDirection> = new Map([['TD', 'TD'], ['TB', 'TD'], ['BT', 'BT'], ['LR', 'LR'], ['RL', 'RL']])
// C0/C1 controls except tab, lone CR, DEL, soft hyphen, bidi marks/overrides/isolates, zero-width,
// invisible operators, line/paragraph separators, fillers, BOM and tag characters.
const FORBIDDEN_CHAR = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\p{Cf}\p{Zl}\p{Zp}\u034F\u115F\u1160\u17B4\u17B5\u2065\u3164\uFFA0\u{E0000}-\u{E007F}]/u
const LABEL_FORBIDDEN = /[[\](){}"|]/
// Text Mermaid would interpret (known HTML tags, HTML/Mermaid entity codes, markdown strings) but this subset draws literally.
// Physics angle brackets such as <E> or <x^2> are not tags and stay plain text.
const LABEL_MARKUP = /<\/?(?:a|abbr|b|big|blockquote|br|center|code|del|div|em|font|h[1-6]|hr|i|iframe|img|ins|li|mark|math|ol|p|pre|q|s|script|small|span|strike|strong|style|sub|sup|svg|table|td|th|tr|u|ul)(?=[\s/>])[^<>]*>|&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);|#(?:\d+|[A-Za-z][A-Za-z0-9]*);|^`/i
const INLINE_LINK_TEXT = /--|-\.|\.-|==|-$/
const ID_CHAR = /[A-Za-z0-9_]/
const LINK_CHAR = /[-.=<>~]/

/** Shape openers, longest first; `null` marks a recognised but unsupported form. */
const OPENERS: readonly (readonly [string, string, DiagramNodeShape | null])[] = [
  ['(((', ')))', null],
  ['((', '))', 'circle'],
  ['([', '])', 'rounded'],
  ['[[', ']]', null],
  ['[(', ')]', null],
  ['[/', '/]', null],
  ['[\\', '\\]', null],
  ['{{', '}}', null],
  ['(', ')', 'rounded'],
  ['[', ']', 'box'],
  ['{', '}', 'diamond'],
  ['>', ']', null],
]

class LineError extends Error {
  constructor(readonly code: MermaidIssueCode, message: string) {
    super(message)
  }
}

interface ParsedNode {
  readonly id: string
  label?: string
  shape?: DiagramNodeShape
}

interface ParsedLink {
  readonly dashed: boolean
  readonly label?: string
}

/** Cursor over one physical line; every method advances monotonically. */
class Cursor {
  index = 0
  constructor(readonly text: string) {}
  get done(): boolean { return this.index >= this.text.length }
  peek(offset = 0): string { return this.text[this.index + offset] ?? '' }
  startsWith(token: string): boolean { return this.text.startsWith(token, this.index) }
  skipSpace(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.index += 1
  }
}

function checkLabel(raw: string, maxLength: number): string {
  const label = raw.trim()
  if (label.length === 0) throw new LineError('INVALID_LABEL', 'labels must not be empty')
  if (label.length > maxLength) throw new LineError('INVALID_LABEL', `labels are limited to ${String(maxLength)} characters`)
  if (LABEL_MARKUP.test(label)) {
    throw new LineError('INVALID_LABEL', 'labels are plain text: HTML tags such as <br> or <p>, entity codes such as &amp; or #quot; and `markdown` strings are not supported; write averages as \u27E8p\u27E9')
  }
  return label
}

function readId(cursor: Cursor): string {
  const start = cursor.index
  while (ID_CHAR.test(cursor.peek())) cursor.index += 1
  const id = cursor.text.slice(start, cursor.index)
  if (id.length === 0) throw new LineError('UNSUPPORTED_STATEMENT', 'expected a node id ([A-Za-z0-9_])')
  if (id.length > RICH_LIMITS.maxNodeIdLength) {
    throw new LineError('INVALID_ID', `node ids are limited to ${String(RICH_LIMITS.maxNodeIdLength)} characters`)
  }
  return id
}

function readShape(cursor: Cursor): { label: string; shape: DiagramNodeShape } | undefined {
  const opener = OPENERS.find(([open]) => cursor.startsWith(open))
  if (opener === undefined) {
    let ahead = cursor.index
    while (cursor.text[ahead] === ' ' || cursor.text[ahead] === '\t') ahead += 1
    if (ahead > cursor.index && '[({'.includes(cursor.text[ahead] ?? '-')) {
      throw new LineError('UNSUPPORTED_SHAPE', 'a shape must follow its node id without a space, e.g. A[label]')
    }
    return undefined
  }
  const [open, close, shape] = opener
  if (shape === null) throw new LineError('UNSUPPORTED_SHAPE', `shape "${open}...${close}" is not supported; use [ ], ( ), ([ ]), { } or (( ))`)
  cursor.index += open.length
  let raw: string
  if (cursor.peek() === '"') {
    const end = cursor.text.indexOf('"', cursor.index + 1)
    if (end < 0) throw new LineError('INVALID_LABEL', 'unterminated quoted label')
    raw = cursor.text.slice(cursor.index + 1, end)
    cursor.index = end + 1
    if (!cursor.startsWith(close)) throw new LineError('INVALID_LABEL', `expected "${close}" right after the quoted label`)
  } else {
    const end = cursor.text.indexOf(close, cursor.index)
    if (end < 0) throw new LineError('INVALID_LABEL', `unclosed label; expected "${close}"`)
    raw = cursor.text.slice(cursor.index, end)
    if (LABEL_FORBIDDEN.test(raw)) throw new LineError('INVALID_LABEL', 'unquoted labels must not contain brackets, braces, quotes or |; quote the label')
    cursor.index = end
  }
  cursor.index += close.length
  return { label: checkLabel(raw, RICH_LIMITS.maxNodeLabelLength), shape }
}

function readPipeLabel(cursor: Cursor): string | undefined {
  cursor.skipSpace()
  if (cursor.peek() !== '|') return undefined
  const end = cursor.text.indexOf('|', cursor.index + 1)
  if (end < 0) throw new LineError('INVALID_LABEL', 'unclosed |link label|')
  let raw = cursor.text.slice(cursor.index + 1, end).trim()
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1)
  if (raw.includes('"')) throw new LineError('INVALID_LABEL', 'link labels must not contain quotes')
  cursor.index = end + 1
  return checkLabel(raw, RICH_LIMITS.maxEdgeLabelLength)
}

const UNSUPPORTED_LINK_MESSAGE = 'supported links are -->, -.->, -->|label|, -- label --> and -. label .->'

function readLink(cursor: Cursor): ParsedLink {
  const start = cursor.index
  while (LINK_CHAR.test(cursor.peek())) cursor.index += 1
  const token = cursor.text.slice(start, cursor.index)
  if (token === '-->' || token === '-.->') {
    const label = readPipeLabel(cursor)
    return { dashed: token === '-.->', ...label === undefined ? {} : { label } }
  }
  if ((token === '--' || token === '-.') && (cursor.peek() === ' ' || cursor.peek() === '\t')) {
    const closer = token === '--' ? '-->' : '.->'
    const end = cursor.text.indexOf(closer, cursor.index)
    if (end < 0) throw new LineError('UNSUPPORTED_LINK', UNSUPPORTED_LINK_MESSAGE)
    const raw = cursor.text.slice(cursor.index, end)
    if (LABEL_FORBIDDEN.test(raw) || INLINE_LINK_TEXT.test(raw.trim())) throw new LineError('INVALID_LABEL', 'inline link labels must be plain text without link characters')
    cursor.index = end + closer.length
    cursor.skipSpace()
    if (cursor.peek() === '|') throw new LineError('INVALID_LABEL', 'a link takes either an inline label or a |label|, not both')
    return { dashed: token === '-.', label: checkLabel(raw, RICH_LIMITS.maxEdgeLabelLength) }
  }
  throw new LineError('UNSUPPORTED_LINK', UNSUPPORTED_LINK_MESSAGE)
}

function atStatementEnd(cursor: Cursor): boolean {
  cursor.skipSpace()
  return cursor.done || cursor.peek() === ';' || cursor.startsWith('%%')
}

interface Graph {
  readonly nodes: Map<string, ParsedNode>
  readonly order: string[]
  readonly edges: DiagramEdge[]
}

function useNode(graph: Graph, id: string, shape: { label: string; shape: DiagramNodeShape } | undefined): void {
  const existing = graph.nodes.get(id)
  if (existing === undefined) {
    graph.nodes.set(id, shape === undefined ? { id } : { id, label: shape.label, shape: shape.shape })
    graph.order.push(id)
    return
  }
  if (shape === undefined) return
  if (existing.label === undefined) {
    existing.label = shape.label
    existing.shape = shape.shape
    return
  }
  if (existing.label !== shape.label || existing.shape !== shape.shape) {
    throw new LineError('CONFLICTING_NODE', `node "${id}" is already defined with a different label or shape`)
  }
}

function parseStatement(cursor: Cursor, graph: Graph): void {
  const first = readId(cursor)
  if (KEYWORDS.has(first)) throw new LineError('UNSUPPORTED_STATEMENT', `"${first}" statements are not supported`)
  const pending: { from: string; to: string; link: ParsedLink }[] = []
  const declared: { id: string; shape: { label: string; shape: DiagramNodeShape } | undefined }[] = []
  declared.push({ id: first, shape: readShape(cursor) })
  let previous = first
  while (!atStatementEnd(cursor)) {
    const link = readLink(cursor)
    cursor.skipSpace()
    if (cursor.done || cursor.peek() === ';' || cursor.startsWith('%%')) throw new LineError('INCOMPLETE_LINK', 'a link must end at a node')
    const id = readId(cursor)
    if (KEYWORDS.has(id)) throw new LineError('UNSUPPORTED_STATEMENT', `"${id}" cannot be used as a node id`)
    declared.push({ id, shape: readShape(cursor) })
    pending.push({ from: previous, to: id, link })
    previous = id
  }
  // Commit only after the statement parsed; any issue fails the whole compile.
  for (const entry of declared) useNode(graph, entry.id, entry.shape)
  for (const { from, to, link } of pending) {
    if (from === to) throw new LineError('SELF_LINK', `self links (${from} -> ${from}) are not supported`)
    const parallel = graph.edges.some(edge => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))
    if (parallel) throw new LineError('PARALLEL_LINK', `${from} and ${to} are already linked; combine the labels into one link`)
    graph.edges.push({ from, to, ...link.label === undefined ? {} : { label: link.label }, ...link.dashed ? { dashed: true } : {} })
  }
}

type HeaderResult =
  | { readonly direction: MermaidDirection; readonly rest: string }
  | { readonly code: MermaidIssueCode; readonly message: string }

function parseHeader(text: string): HeaderResult {
  const match = /^(flowchart|graph)(?=$|[\s;])[ \t]*([A-Za-z]*)[ \t]*(.*)$/.exec(text)
  if (match === null) return { code: 'MISSING_HEADER', message: 'the first statement must be "flowchart <TD|TB|BT|LR|RL>" (or "graph ...")' }
  const word = match[2] ?? ''
  const rest = match[3] ?? ''
  const direction = word === '' ? 'TD' : DIRECTIONS.get(word)
  if (direction === undefined) return { code: 'UNSUPPORTED_DIRECTION', message: 'direction must be TD, TB, BT, LR or RL' }
  if (rest === '' || rest.startsWith('%%')) return { direction, rest: '' }
  if (rest.startsWith(';')) return { direction, rest: rest.slice(1) }
  return { code: 'UNSUPPORTED_STATEMENT', message: 'put statements after the header on a new line or after ";"' }
}

// -------------------------------------------------------------------------
// Layout

const HALF: Record<DiagramNodeShape, { w: number; h: number }> = {
  box: { w: 74, h: 30 },
  rounded: { w: 74, h: 30 },
  diamond: { w: 88, h: 46 },
  circle: { w: 40, h: 40 },
}
const INSET = 8
const MIN_GAP = 12
/** Shortest drawn link (after boundary trimming) that still shows a line plus arrow head. */
const MIN_VISIBLE_LINK = 18
/** Clearance kept between a link and an unrelated node, and between a label and any node. */
const CLEARANCE = 4
const LABEL_CLEARANCE = 2
/** Approximate width of one Latin-glyph unit of an 11px edge label. */
const LABEL_UNIT_WIDTH = 6.6
/** Centre distance beyond two shapes' extents: both edge gaps, the arrow, a visible link, and 1 for grid rounding. */
const LINK_ROOM = 5 + 8 + MIN_VISIBLE_LINK + 5 + 1
/** Same, for a labelled link across levels: the 13px label sits 6px above the midpoint and keeps 2px from both shapes. */
const LABEL_ROOM_ACROSS = 47
/** Extra length beyond a labelled link's text width when the label lies along the link. */
const LABEL_ROOM_ALONG = 13
const X_RANGE = [HALF.diamond.w + INSET, DIAGRAM_VIEW.width - HALF.diamond.w - INSET] as const
const Y_RANGE = [HALF.diamond.h + INSET, DIAGRAM_VIEW.height - HALF.diamond.h - INSET] as const
/** Prefix that cannot occur in a parsed id: placeholders reserving room for long links. */
const DUMMY = '\u0000'

function assignLayers(order: readonly string[], edges: readonly DiagramEdge[]): Map<string, number> {
  const out = new Map<string, string[]>(order.map(id => [id, []]))
  for (const edge of edges) out.get(edge.from)?.push(edge.to)
  // Iterative DFS in declaration order; links to an ancestor are back edges.
  const state = new Map<string, 1 | 2>()
  const forward = new Map<string, string[]>(order.map(id => [id, []]))
  for (const root of order) {
    if (state.has(root)) continue
    const stack: { id: string; next: number }[] = [{ id: root, next: 0 }]
    state.set(root, 1)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!
      const targets = out.get(top.id)!
      if (top.next >= targets.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const target = targets[top.next]!
      top.next += 1
      const seen = state.get(target)
      if (seen === 1) continue
      forward.get(top.id)!.push(target)
      if (seen === undefined) {
        state.set(target, 1)
        stack.push({ id: target, next: 0 })
      }
    }
  }
  // Longest path over the acyclic forward edges (Kahn order).
  const indegree = new Map<string, number>(order.map(id => [id, 0]))
  for (const targets of forward.values()) for (const target of targets) indegree.set(target, indegree.get(target)! + 1)
  const layer = new Map<string, number>(order.map(id => [id, 0]))
  const queue = order.filter(id => indegree.get(id) === 0)
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!
    for (const target of forward.get(id)!) {
      layer.set(target, Math.max(layer.get(target)!, layer.get(id)! + 1))
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  }
  return layer
}

/**
 * Order every level by barycenter sweeps. Links spanning several levels get a
 * placeholder slot on each level they pass, so the straight line drawn later
 * tends to run through reserved space instead of through a node.
 */
function orderLayers(
  order: readonly string[],
  edges: readonly DiagramEdge[],
  layer: Map<string, number>,
  count: number,
): { rows: string[][]; neighbours: Map<string, string[]> } {
  const neighbours = new Map<string, string[]>(order.map(id => [id, []]))
  const link = (a: string, b: string): void => {
    neighbours.get(a)!.push(b)
    neighbours.get(b)!.push(a)
  }
  const nodes = [...order]
  let dummies = 0
  for (const edge of edges) {
    const [low, high] = layer.get(edge.from)! < layer.get(edge.to)! ? [edge.from, edge.to] : [edge.to, edge.from]
    let previous = low
    for (let level = layer.get(low)! + 1; level < layer.get(high)!; level += 1) {
      const id = `${DUMMY}${String(dummies)}`
      dummies += 1
      layer.set(id, level)
      neighbours.set(id, [])
      nodes.push(id)
      link(previous, id)
      previous = id
    }
    link(previous, high)
  }
  const layers: string[][] = Array.from({ length: count }, () => [])
  for (const id of nodes) layers[layer.get(id)!]!.push(id)
  const centred = (): Map<string, number> => {
    const pos = new Map<string, number>()
    for (const row of layers) row.forEach((id, index) => pos.set(id, index - (row.length - 1) / 2))
    return pos
  }
  const sweep = (index: number, below: boolean): void => {
    const pos = centred()
    const keys = layers[index]!.map((id, current) => {
      const related = neighbours.get(id)!.filter(other => (below ? layer.get(other)! < index : layer.get(other)! > index))
      const key = related.length === 0 ? pos.get(id)! : related.reduce((sum, other) => sum + pos.get(other)!, 0) / related.length
      return { id, key, current }
    })
    keys.sort((a, b) => a.key - b.key || a.current - b.current)
    layers[index] = keys.map(entry => entry.id)
  }
  for (let round = 0; round < 4; round += 1) {
    for (let index = 1; index < count; index += 1) sweep(index, true)
    for (let index = count - 2; index >= 0; index -= 1) sweep(index, false)
  }
  return { rows: layers, neighbours }
}

/**
 * Fractional slot positions (0..width-1) per level, keeping each level's order
 * with at least one slot between neighbours. Nodes move toward the mean of
 * their neighbours; a node with a long link moves toward that link's reserved
 * placeholder so the straight line runs through the reserved space. Each level
 * is solved exactly by isotonic regression (pool adjacent violators).
 */
function assignSlots(rows: readonly string[][], neighbours: ReadonlyMap<string, string[]>, layer: ReadonlyMap<string, number>): Map<string, number> {
  const width = Math.max(...rows.map(row => row.length))
  const pos = new Map<string, number>()
  for (const row of rows) row.forEach((id, index) => pos.set(id, (width - 1) / 2 - (row.length - 1) / 2 + index))
  const mean = (ids: readonly string[]) => ids.reduce((sum, id) => sum + pos.get(id)!, 0) / ids.length
  const desire = (id: string, below: boolean): number => {
    const all = neighbours.get(id)!
    if (id.startsWith(DUMMY)) return mean(all)
    const reserved = all.filter(other => other.startsWith(DUMMY))
    if (reserved.length > 0) return mean(reserved)
    const level = layer.get(id)!
    const preferred = all.filter(other => (below ? layer.get(other)! < level : layer.get(other)! > level))
    if (preferred.length > 0) return mean(preferred)
    return all.length > 0 ? mean(all) : pos.get(id)!
  }
  const place = (row: readonly string[], below: boolean): void => {
    // Minimise sum (p_i - d_i)^2 subject to p_{i+1} >= p_i + 1: r_i = p_i - i must be nondecreasing.
    const blocks: { sum: number; count: number }[] = []
    row.forEach((id, index) => {
      blocks.push({ sum: desire(id, below) - index, count: 1 })
      while (blocks.length > 1 && blocks[blocks.length - 2]!.sum / blocks[blocks.length - 2]!.count > blocks[blocks.length - 1]!.sum / blocks[blocks.length - 1]!.count) {
        const last = blocks.pop()!
        blocks[blocks.length - 1]!.sum += last.sum
        blocks[blocks.length - 1]!.count += last.count
      }
    })
    const placed: number[] = []
    for (const block of blocks) for (let k = 0; k < block.count; k += 1) placed.push(block.sum / block.count + placed.length)
    for (let i = 0; i < placed.length; i += 1) placed[i] = Math.max(placed[i]!, i === 0 ? 0 : placed[i - 1]! + 1)
    for (let i = placed.length - 1; i >= 0; i -= 1) placed[i] = Math.min(placed[i]!, i === placed.length - 1 ? width - 1 : placed[i + 1]! - 1)
    row.forEach((id, index) => pos.set(id, placed[index]!))
  }
  for (let round = 0; round < 4; round += 1) {
    for (let index = 0; index < rows.length; index += 1) place(rows[index]!, true)
    for (let index = rows.length - 1; index >= 0; index -= 1) place(rows[index]!, false)
  }
  return pos
}

/**
 * Main-axis centre of each level. Each gap is sized from the shapes it
 * separates (plus the label of a one-level link), then gaps are evened out up
 * to the spacing cap; when the levels cannot fit, they are spread evenly and the
 * legibility check names what does not fit.
 */
function levelPositions(rows: readonly string[][], graph: Graph, layer: ReadonlyMap<string, number>, vertical: boolean, reversed: boolean): number[] {
  const view = vertical ? DIAGRAM_VIEW.height : DIAGRAM_VIEW.width
  if (rows.length === 1) return [view / 2]
  const reach = rows.map(row => Math.max(0, ...row.filter(id => !id.startsWith(DUMMY)).map(id => {
    const half = HALF[graph.nodes.get(id)!.shape ?? 'box']
    return vertical ? half.h : half.w
  })))
  const need = reach.slice(1).map((next, index) => reach[index]! + next + LINK_ROOM)
  for (const edge of graph.edges) {
    const a = layer.get(edge.from)!, b = layer.get(edge.to)!
    if (edge.label === undefined || edge.label.length === 0 || Math.abs(a - b) !== 1) continue
    const gap = Math.min(a, b)
    const room = vertical ? LABEL_ROOM_ACROSS : displayWidth(truncateLabel(edge.label, DIAGRAM_EDGE_LABEL_UNITS)) * LABEL_UNIT_WIDTH + LABEL_ROOM_ALONG
    need[gap] = Math.max(need[gap]!, reach[gap]! + reach[gap + 1]! + room)
  }
  const available = view - 2 * INSET - reach[0]! - reach[reach.length - 1]!
  const cap = vertical ? 140 : 360
  const total = (level: number) => need.reduce((sum, value) => sum + Math.max(value, level), 0)
  let gaps: number[]
  if (total(0) >= available) {
    gaps = need.map(() => available / need.length)
  } else {
    let low = 0, high = cap
    if (total(cap) > available) {
      for (let step = 0; step < 50; step += 1) {
        const mid = (low + high) / 2
        if (total(mid) > available) high = mid
        else low = mid
      }
    } else low = cap
    gaps = need.map(value => Math.max(value, low))
  }
  const span = reach[0]! + gaps.reduce((sum, value) => sum + value, 0) + reach[reach.length - 1]!
  const positions = [(view - span) / 2 + reach[0]!]
  for (const gap of gaps) positions.push(positions[positions.length - 1]! + gap)
  return reversed ? positions.map(value => view - value) : positions
}

function spread(count: number, range: readonly [number, number], maxSpacing: number): number[] {
  if (count === 1) return [(range[0] + range[1]) / 2]
  const spacing = Math.min(maxSpacing, (range[1] - range[0]) / (count - 1))
  const start = (range[0] + range[1]) / 2 - (spacing * (count - 1)) / 2
  return Array.from({ length: count }, (_, index) => start + spacing * index)
}

interface Point { readonly x: number; readonly y: number }
interface Box { readonly l: number; readonly r: number; readonly t: number; readonly b: number }
/** A node outline grown by a margin: convex polygon vertices, or a circle. */
type Outline = { readonly kind: 'polygon'; readonly points: readonly Point[] } | { readonly kind: 'circle'; readonly center: Point; readonly radius: number }

function outlineOf(node: DiagramNodeGeometry, pad: number): Outline {
  const { x, y } = node.center
  if (node.shape === 'circle') return { kind: 'circle', center: node.center, radius: node.radius + pad }
  if (node.shape === 'diamond') {
    // Offsetting each rhombus edge outward by `pad` moves the vertices to these half-diagonals.
    const edge = Math.hypot(node.halfWidth, node.halfHeight)
    const w = node.halfWidth + (pad * edge) / node.halfHeight, h = node.halfHeight + (pad * edge) / node.halfWidth
    return { kind: 'polygon', points: [{ x: x + w, y }, { x, y: y + h }, { x: x - w, y }, { x, y: y - h }] }
  }
  const w = node.halfWidth + pad, h = node.halfHeight + pad
  return { kind: 'polygon', points: [{ x: x - w, y: y - h }, { x: x + w, y: y - h }, { x: x + w, y: y + h }, { x: x - w, y: y + h }] }
}

function boxPoints(box: Box): Point[] {
  return [{ x: box.l, y: box.t }, { x: box.r, y: box.t }, { x: box.r, y: box.b }, { x: box.l, y: box.b }]
}

/** Separating-axis test for two convex point sets (a 2-point set is a segment). */
function convexMeet(a: readonly Point[], b: readonly Point[]): boolean {
  for (const set of [a, b]) {
    for (let i = 0; i < set.length; i += 1) {
      const p = set[i]!, q = set[(i + 1) % set.length]!
      const axis = { x: q.y - p.y, y: p.x - q.x }
      if (axis.x === 0 && axis.y === 0) continue
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity
      for (const v of a) { const d = v.x * axis.x + v.y * axis.y; minA = Math.min(minA, d); maxA = Math.max(maxA, d) }
      for (const v of b) { const d = v.x * axis.x + v.y * axis.y; minB = Math.min(minB, d); maxB = Math.max(maxB, d) }
      if (maxA <= minB || maxB <= minA) return false
    }
  }
  return true
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function segmentMeetsOutline(a: Point, b: Point, outline: Outline): boolean {
  if (outline.kind === 'circle') return distanceToSegment(outline.center, a, b) < outline.radius
  return convexMeet([a, b], outline.points)
}

function boxMeetsOutline(box: Box, outline: Outline): boolean {
  if (outline.kind === 'circle') {
    const nearX = Math.max(box.l, Math.min(outline.center.x, box.r)), nearY = Math.max(box.t, Math.min(outline.center.y, box.b))
    return Math.hypot(outline.center.x - nearX, outline.center.y - nearY) < outline.radius
  }
  return convexMeet(boxPoints(box), outline.points)
}

function boxesMeet(a: Box, b: Box): boolean {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t
}

/** Check the drawn geometry exactly as the Client renderer will produce it, against the real node shapes. */
function legibility(geometry: DiagramGeometry): { code: MermaidIssueCode; message: string } | undefined {
  const all = geometry.nodes
  const bounds = (node: DiagramNodeGeometry, pad: number): Box =>
    ({ l: node.center.x - node.halfWidth - pad, r: node.center.x + node.halfWidth + pad, t: node.center.y - node.halfHeight - pad, b: node.center.y + node.halfHeight + pad })
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (boxesMeet(bounds(all[i]!, MIN_GAP / 2), bounds(all[j]!, MIN_GAP / 2))) {
        return { code: 'LAYOUT_OVERCROWDED', message: 'too many nodes share one level to draw without overlap; split the flowchart or use fewer siblings' }
      }
    }
  }
  if (geometry.droppedEdges > 0) return { code: 'LAYOUT_OVERCROWDED', message: 'linked nodes are too close to draw the link' }
  const labels = geometry.edges.filter(edge => edge.labelText.length > 0).map(edge => {
    const width = displayWidth(truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS)) * LABEL_UNIT_WIDTH
    return { edge, box: { l: edge.label.x - width / 2, r: edge.label.x + width / 2, t: edge.label.y - 10, b: edge.label.y + 3 } as Box }
  })
  for (const edge of geometry.edges) {
    const name = `${edge.edge.from} -> ${edge.edge.to}`
    if (Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < MIN_VISIBLE_LINK) {
      return { code: 'LAYOUT_OVERCROWDED', message: `levels are too close to show the arrow of ${name}; use fewer levels or smaller shapes` }
    }
    for (const other of all) {
      if (other === edge.from || other === edge.to) continue
      if (segmentMeetsOutline(edge.start, edge.end, outlineOf(other, CLEARANCE))) {
        return { code: 'LAYOUT_OCCLUDED', message: `the link ${name} would be drawn through node ${other.node.id}; restructure the flowchart` }
      }
    }
    for (const label of labels) {
      if (label.edge === edge) continue
      if (convexMeet([edge.start, edge.end], boxPoints(label.box))) {
        return { code: 'LAYOUT_OCCLUDED', message: `the link ${name} would run through the label of ${label.edge.edge.from} -> ${label.edge.edge.to}; restructure or drop a label` }
      }
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    const { edge, box } = labels[i]!
    const name = `${edge.edge.from} -> ${edge.edge.to}`
    for (const other of all) {
      if (boxMeetsOutline(box, outlineOf(other, LABEL_CLEARANCE))) {
        return { code: 'LAYOUT_OCCLUDED', message: `the label of ${name} would be hidden by node ${other.node.id}; shorten it, use fewer levels, or try another direction` }
      }
    }
    for (let j = i + 1; j < labels.length; j += 1) {
      if (boxesMeet(box, labels[j]!.box)) {
        return { code: 'LAYOUT_OCCLUDED', message: `the labels of ${name} and ${labels[j]!.edge.edge.from} -> ${labels[j]!.edge.edge.to} would overlap; restructure or drop a label` }
      }
    }
  }
  return undefined
}

/** Compile one bounded Mermaid flowchart into a validated, legible `basic_diagram`. */
export function compileMermaidFlowchart(input: MermaidCompileInput): MermaidCompileResult {
  const fail = (code: MermaidIssueCode, line: number, message: string): MermaidCompileResult => ({ ok: false, issues: [{ code, line, message }] })
  const source: unknown = input?.source
  if (typeof source !== 'string') return fail('INVALID_SOURCE', 0, 'source must be a string of Mermaid flowchart text')
  if (new TextEncoder().encode(source).length > MERMAID_LIMITS.maxSourceBytes) {
    return fail('SOURCE_TOO_LARGE', 0, `source is limited to ${String(MERMAID_LIMITS.maxSourceBytes)} UTF-8 bytes`)
  }
  const lines = source.split(/\r?\n/)
  while (lines.length > 1 && /^[ \t]*$/.test(lines[lines.length - 1]!)) lines.pop()
  if (lines.length > MERMAID_LIMITS.maxLines) return fail('TOO_MANY_LINES', 0, `source is limited to ${String(MERMAID_LIMITS.maxLines)} lines`)

  const issues: MermaidIssue[] = []
  const graph: Graph = { nodes: new Map(), order: [], edges: [] }
  let direction: MermaidDirection | undefined
  let headerLine = 0
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1
    const raw = lines[index]!
    if (raw.length > MERMAID_LIMITS.maxLineLength) {
      issues.push({ code: 'LINE_TOO_LONG', line: lineNo, message: `lines are limited to ${String(MERMAID_LIMITS.maxLineLength)} characters` })
      continue
    }
    if (FORBIDDEN_CHAR.test(raw)) {
      issues.push({ code: 'CONTROL_CHARACTER', line: lineNo, message: 'control, invisible and bidirectional characters are not allowed' })
      continue
    }
    const text = raw.trim()
    if (text.length === 0) continue
    if (text.startsWith('%%')) {
      if (text.startsWith('%%{')) issues.push({ code: 'UNSUPPORTED_STATEMENT', line: lineNo, message: 'Mermaid directives (%%{...}%%) are not supported' })
      continue
    }
    let body = text
    if (direction === undefined) {
      // A refused line before the header was most likely the header itself.
      if (issues.some(issue => issue.code === 'LINE_TOO_LONG' || issue.code === 'CONTROL_CHARACTER')) return { ok: false, issues }
      const header = parseHeader(text)
      if ('code' in header) {
        // A missing or invalid header leaves nothing meaningful to parse further.
        if (header.code !== 'UNSUPPORTED_STATEMENT') return { ok: false, issues: [...issues, { code: header.code, line: lineNo, message: header.message }] }
        issues.push({ code: header.code, line: lineNo, message: header.message })
        direction = 'TD'
        headerLine = lineNo
        continue
      }
      direction = header.direction
      headerLine = lineNo
      body = header.rest
    }
    const cursor = new Cursor(body)
    try {
      while (true) {
        cursor.skipSpace()
        while (cursor.peek() === ';') {
          cursor.index += 1
          cursor.skipSpace()
        }
        if (cursor.done || cursor.startsWith('%%')) break
        parseStatement(cursor, graph)
      }
    } catch (error) {
      if (!(error instanceof LineError)) throw error
      issues.push({ code: error.code, line: lineNo, message: error.message })
    }
  }
  if (direction === undefined) {
    if (issues.some(issue => issue.code === 'LINE_TOO_LONG' || issue.code === 'CONTROL_CHARACTER')) return { ok: false, issues }
    return { ok: false, issues: [...issues, { code: 'MISSING_HEADER', line: 1, message: 'the first statement must be "flowchart <TD|TB|BT|LR|RL>"' }] }
  }
  if (issues.length > 0) return { ok: false, issues }
  if (graph.order.length === 0) return fail('EMPTY_DIAGRAM', headerLine, 'the flowchart declares no nodes')
  if (graph.order.length > RICH_LIMITS.maxDiagramNodes) return fail('TOO_MANY_NODES', 0, `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`)
  if (graph.edges.length > RICH_LIMITS.maxDiagramEdges) return fail('TOO_MANY_EDGES', 0, `at most ${String(RICH_LIMITS.maxDiagramEdges)} links are allowed`)

  const layer = assignLayers(graph.order, graph.edges)
  const layerCount = Math.max(...graph.order.map(id => layer.get(id)!)) + 1
  if (layerCount > MERMAID_LIMITS.maxLayers) {
    return fail('LAYOUT_TOO_DEEP', 0, `the longest path spans ${String(layerCount)} levels; at most ${String(MERMAID_LIMITS.maxLayers)} fit the diagram`)
  }
  const { rows, neighbours } = orderLayers(graph.order, graph.edges, layer, layerCount)
  const slots = assignSlots(rows, neighbours, layer)
  const width = Math.max(...rows.map(row => row.length))
  const vertical = direction === 'TD' || direction === 'BT'
  const mainPositions = levelPositions(rows, graph, layer, vertical, direction === 'BT' || direction === 'RL')
  const crossSlots = spread(width, vertical ? X_RANGE : Y_RANGE, vertical ? 200 : 120)
  const crossStep = width > 1 ? crossSlots[1]! - crossSlots[0]! : 0
  const grid = new Map<string, { x: number; y: number }>()
  rows.forEach((row, index) => {
    row.forEach(id => {
      if (id.startsWith(DUMMY)) return
      const main = mainPositions[index]!, cross = crossSlots[0]! + slots.get(id)! * crossStep
      // Integer 0..1000 grid exactly as the renderer reads it back.
      grid.set(id, {
        x: Math.round(vertical ? cross : main),
        y: Math.round(((vertical ? main : cross) / DIAGRAM_VIEW.height) * 1000),
      })
    })
  })
  const nodes: DiagramNode[] = graph.order.map(id => {
    const parsed = graph.nodes.get(id)!
    return { id, label: parsed.label ?? id, ...grid.get(id)!, shape: parsed.shape ?? 'box' }
  })
  const problem = legibility(buildDiagramGeometry(nodes, graph.edges))
  if (problem !== undefined) return fail(problem.code, 0, problem.message)

  const candidate = {
    schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
    type: 'basic_diagram',
    title: input.title,
    ...input.subtitle === undefined ? {} : { subtitle: input.subtitle },
    data: { nodes, edges: graph.edges },
  }
  const validated = validateRichContent(candidate)
  if (!validated.ok) return fail('INVALID_CONTENT', 0, formatValidationIssues(validated.issues))
  if (validated.value.type !== 'basic_diagram') return fail('INVALID_CONTENT', 0, 'compiled content is not a basic_diagram')
  return { ok: true, content: validated.value, direction, layers: layerCount }
}
