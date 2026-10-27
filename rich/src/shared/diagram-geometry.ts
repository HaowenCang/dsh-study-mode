/**
 * Pure geometry of the restricted diagram renderer, shared so the Host-side
 * Mermaid layout can check legibility against exactly what the Client draws.
 *
 * The model only supplies integer coordinates on a virtual 1000 x 1000 grid and
 * a closed set of shape/tone enums; this module maps those onto the fixed SVG
 * viewport and computes edge endpoints on the node boundaries. No model text
 * ever becomes markup, and no model value becomes an SVG element name or
 * attribute name.
 */
import type { DiagramEdge, DiagramNode } from './protocol'
import { graphemes, graphemeWidth } from './text-width'

/** Fixed diagram viewport in SVG user units. */
export const DIAGRAM_VIEW = { width: 1000, height: 560 } as const

/** Label font sizes in SVG user units; on screen they scale with the drawn width. */
export const DIAGRAM_FONT = { node: 12, edge: 11 } as const

/**
 * Smallest on-screen width of the diagram in CSS pixels. Narrower cards scroll
 * horizontally instead, so node labels never drop below about 8 px (VIS-02).
 */
export const DIAGRAM_MIN_RENDER_WIDTH = 680

/** Shape metrics in SVG user units (independent of the 0..1000 model grid). */
export const DIAGRAM_BOX = { width: 148, height: 60 } as const
export const DIAGRAM_DIAMOND = { halfWidth: 88, halfHeight: 46 } as const
export const DIAGRAM_CIRCLE_RADIUS = 40
/** Edge labels are truncated to this many Latin-glyph width units. */
export const DIAGRAM_EDGE_LABEL_UNITS = 24

const BOX_HALF_WIDTH = DIAGRAM_BOX.width / 2
const BOX_HALF_HEIGHT = DIAGRAM_BOX.height / 2
const DIAMOND_HALF_WIDTH = DIAGRAM_DIAMOND.halfWidth
const DIAMOND_HALF_HEIGHT = DIAGRAM_DIAMOND.halfHeight
const CIRCLE_RADIUS = DIAGRAM_CIRCLE_RADIUS

/** Padding kept between a mapped node centre and the viewport edge. */
const VIEWPORT_INSET = 8

/** Gap between a node border and the start/end of an edge. */
const EDGE_GAP = 5
/** Extra room kept for the arrow head marker. */
const ARROW_GAP = 8
/** Edges shorter than this are dropped instead of inverted. */
const MIN_EDGE_LENGTH = 18

/** One pixel-space point. */
export interface DiagramPoint {
  readonly x: number
  readonly y: number
}

/** A node after grid -> viewport mapping. */
export interface DiagramNodeGeometry {
  readonly node: DiagramNode
  readonly shape: NonNullable<DiagramNode['shape']>
  readonly center: DiagramPoint
  readonly halfWidth: number
  readonly halfHeight: number
  readonly radius: number
  readonly labelMaxChars: number
}

/** An edge after boundary trimming, ready to become a `<line>`. */
export interface DiagramEdgeGeometry {
  readonly edge: DiagramEdge
  readonly from: DiagramNodeGeometry
  readonly to: DiagramNodeGeometry
  readonly start: DiagramPoint
  readonly end: DiagramPoint
  readonly label: DiagramPoint
  readonly labelText: string
}

/** Result of mapping the whole diagram payload. */
export interface DiagramGeometry {
  readonly nodes: readonly DiagramNodeGeometry[]
  readonly edges: readonly DiagramEdgeGeometry[]
  readonly droppedEdges: number
}

function clampTo(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low
  if (value < low) return low
  if (value > high) return high
  return value
}

/** Accept only the closed shape enum; default to `box`. */
export function normalizeShape(shape: DiagramNode['shape']): NonNullable<DiagramNode['shape']> {
  switch (shape) {
    case 'rounded':
    case 'diamond':
    case 'circle':
    case 'box':
      return shape
    default:
      return 'box'
  }
}

/** Map one grid node into viewport pixels, clamped so its shape stays visible. */
export function mapNode(node: DiagramNode): DiagramNodeGeometry {
  const shape = normalizeShape(node.shape)
  const halfWidth =
    shape === 'diamond' ? DIAMOND_HALF_WIDTH : shape === 'circle' ? CIRCLE_RADIUS : BOX_HALF_WIDTH
  const halfHeight =
    shape === 'diamond' ? DIAMOND_HALF_HEIGHT : shape === 'circle' ? CIRCLE_RADIUS : BOX_HALF_HEIGHT
  const x = Number.isFinite(node.x) ? node.x : 500
  const y = Number.isFinite(node.y) ? node.y : 500
  const center: DiagramPoint = {
    x: clampTo((x / 1000) * DIAGRAM_VIEW.width, halfWidth + VIEWPORT_INSET, DIAGRAM_VIEW.width - halfWidth - VIEWPORT_INSET),
    y: clampTo((y / 1000) * DIAGRAM_VIEW.height, halfHeight + VIEWPORT_INSET, DIAGRAM_VIEW.height - halfHeight - VIEWPORT_INSET),
  }
  return {
    node,
    shape,
    center,
    halfWidth,
    halfHeight,
    radius: shape === 'circle' ? CIRCLE_RADIUS : 0,
    // Width units (CJK = 2): a circle's 79-unit text chord fits six CJK glyphs at 12px.
    labelMaxChars: shape === 'circle' ? 12 : shape === 'diamond' ? 17 : 20,
  }
}

/**
 * Distance from a node centre to its border along a unit direction.
 * Rectangles and diamonds use their exact boundary, circles their radius.
 */
export function boundaryDistance(geometry: DiagramNodeGeometry, directionX: number, directionY: number): number {
  const absX = Math.abs(directionX)
  const absY = Math.abs(directionY)
  switch (geometry.shape) {
    case 'circle':
      return geometry.radius
    case 'diamond': {
      const term = absX / geometry.halfWidth + absY / geometry.halfHeight
      return term > 0 ? 1 / term : geometry.halfWidth
    }
    case 'box':
    case 'rounded': {
      const candidates: number[] = []
      if (absX > 1e-9) candidates.push(geometry.halfWidth / absX)
      if (absY > 1e-9) candidates.push(geometry.halfHeight / absY)
      return candidates.length > 0 ? Math.min(...candidates) : geometry.halfHeight
    }
    default:
      return geometry.halfHeight
  }
}

/**
 * Shorten a model label for on-diagram display (full text stays in `<title>`).
 * `maxChars` is a budget in Latin-glyph units (see text-width); grapheme
 * clusters are never split.
 */
export function truncateLabel(label: string, maxChars: number): string {
  const clusters = graphemes(label)
  let total = 0
  for (const cluster of clusters) total += graphemeWidth(cluster)
  if (total <= maxChars) return label
  const budget = Math.max(1, maxChars - 3)
  let used = 0
  let kept = ''
  for (const cluster of clusters) {
    const width = graphemeWidth(cluster)
    if (used + width > budget) break
    used += width
    kept += cluster
  }
  return `${kept.length > 0 ? kept : clusters[0] ?? ''}...`
}

/** Map nodes and build boundary-trimmed directed edges. */
export function buildDiagramGeometry(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): DiagramGeometry {
  const byId = new Map<string, DiagramNodeGeometry>()
  const mappedNodes: DiagramNodeGeometry[] = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node === null || typeof node !== 'object' || typeof node.id !== 'string') continue
    if (byId.has(node.id)) continue
    const geometry = mapNode(node)
    byId.set(node.id, geometry)
    mappedNodes.push(geometry)
  }

  const mappedEdges: DiagramEdgeGeometry[] = []
  let droppedEdges = 0
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (edge === null || typeof edge !== 'object' || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      droppedEdges += 1
      continue
    }
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (from === undefined || to === undefined || from === to) {
      droppedEdges += 1
      continue
    }
    const dx = to.center.x - from.center.x
    const dy = to.center.y - from.center.y
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length < MIN_EDGE_LENGTH) {
      droppedEdges += 1
      continue
    }
    const unitX = dx / length
    const unitY = dy / length
    const maxOffset = (length - 4) / 2
    const startOffset = Math.min(boundaryDistance(from, unitX, unitY) + EDGE_GAP, maxOffset)
    const endOffset = Math.min(boundaryDistance(to, -unitX, -unitY) + EDGE_GAP + ARROW_GAP, maxOffset)
    const start: DiagramPoint = {
      x: from.center.x + unitX * startOffset,
      y: from.center.y + unitY * startOffset,
    }
    const end: DiagramPoint = {
      x: to.center.x - unitX * endOffset,
      y: to.center.y - unitY * endOffset,
    }
    mappedEdges.push({
      edge,
      from,
      to,
      start,
      end,
      label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6 },
      labelText: typeof edge.label === 'string' ? edge.label : '',
    })
  }
  return { nodes: mappedNodes, edges: mappedEdges, droppedEdges }
}

