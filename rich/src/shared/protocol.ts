/**
 * RichContentV1 - the versioned, declarative payload rendered by this plugin.
 *
 * Every value here is untrusted model output. The protocol therefore admits
 * only bounded, finite, lossless JSON data: no HTML, no SVG source, no URLs,
 * no executable expressions, no color strings other than hex literals.
 *
 * Target: DSH 0.2.1-rc.2 (fixed tag dsh-v0.2.1-rc.2).
 */

/** The only schema version this plugin understands. */
export const RICH_CONTENT_SCHEMA_VERSION = 1 as const

/** Marker key carried in the persisted tool-result `meta` object. */
export const RICH_META_KIND = 'rich-response' as const

/** Version of the persisted meta envelope (independent of the content schema). */
export const RICH_META_ENVELOPE_VERSION = 1 as const

/** Marker used by the Host audit command payload. */
export const RICH_INTERACTION_PROTOCOL = 'rich-interaction-v1' as const

/** Hard resource limits. They are enforced host-side and re-checked client-side. */
export const RICH_LIMITS = {
  /** Maximum serialized payload size of the whole content object (UTF-8 bytes). */
  maxSerializedBytes: 256 * 1024,
  maxTitleLength: 200,
  maxSubtitleLength: 500,
  maxSeries: 8,
  maxPointsPerSeries: 2048,
  maxTotalPoints: 8192,
  maxAxisLabelLength: 80,
  maxDiagramNodes: 60,
  maxDiagramEdges: 120,
  maxNodeIdLength: 64,
  maxNodeLabelLength: 120,
  maxEdgeLabelLength: 80,
  maxCardBodyLength: 4000,
  maxCardActions: 5,
  maxActionIdLength: 64,
  maxActionLabelLength: 120,
  maxSubmitTextLength: 2000,
  maxQuestionIdLength: 64,
  /** Largest absolute coordinate accepted from the model. */
  maxAbsCoordinate: 1e7,
} as const

/** A finite two-dimensional point. */
export interface PlotPoint {
  readonly x: number
  readonly y: number
}

/** One named data series. */
export interface PlotSeries {
  readonly name: string
  readonly points: readonly PlotPoint[]
  /** Optional hex color (`#rgb` or `#rrggbb`); renderers keep their own palette otherwise. */
  readonly color?: string
}

/** Axis decoration supplied by the model; renderers choose their own defaults when absent. */
export interface AxisSpec {
  readonly label?: string
  readonly unit?: string
  /** Explicit lower bound; when present it must be finite and below `max`. */
  readonly min?: number
  /** Explicit upper bound; when present it must be finite and above `min`. */
  readonly max?: number
}

/** Shared body of line and scatter plots. */
export interface PlotData {
  readonly series: readonly PlotSeries[]
  readonly xAxis?: AxisSpec
  readonly yAxis?: AxisSpec
}

/** A piecewise-linear function curve / multi-series line chart. */
export interface LinePlotContent {
  readonly schemaVersion: typeof RICH_CONTENT_SCHEMA_VERSION
  readonly type: 'line_plot'
  readonly title: string
  readonly subtitle?: string
  readonly data: PlotData
}

/** A scatter chart over the same bounded point model. */
export interface ScatterPlotContent {
  readonly schemaVersion: typeof RICH_CONTENT_SCHEMA_VERSION
  readonly type: 'scatter_plot'
  readonly title: string
  readonly subtitle?: string
  readonly data: PlotData
}

/** Restricted shape primitive; the renderer builds the SVG itself. */
export type DiagramNodeShape = 'box' | 'rounded' | 'diamond' | 'circle'
/** Semantic emphasis for one node. */
export type DiagramNodeTone = 'default' | 'accent' | 'muted'

/** One node on a model-supplied integer grid; never raw SVG. */
export interface DiagramNode {
  readonly id: string
  readonly label: string
  /** Column on a virtual grid (integer, 0..1000). */
  readonly x: number
  /** Row on a virtual grid (integer, 0..1000). */
  readonly y: number
  readonly shape?: DiagramNodeShape
  readonly tone?: DiagramNodeTone
}

/** One directed edge between two declared nodes. */
export interface DiagramEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
  readonly dashed?: boolean
}

/** A simple flow/relationship diagram assembled from restricted primitives. */
export interface BasicDiagramContent {
  readonly schemaVersion: typeof RICH_CONTENT_SCHEMA_VERSION
  readonly type: 'basic_diagram'
  readonly title: string
  readonly subtitle?: string
  readonly data: {
    readonly nodes: readonly DiagramNode[]
    readonly edges: readonly DiagramEdge[]
  }
}

/** One interactive action offered by a message card. */
export interface MessageCardAction {
  readonly id: string
  readonly label: string
  /**
   * Plain-text follow-up submitted into the originating session when the user
   * presses the action. Never a URL and never markup.
   */
  readonly submitText: string
}

/** A small interactive card; the Phase 1 interaction proof. */
export interface MessageCardContent {
  readonly schemaVersion: typeof RICH_CONTENT_SCHEMA_VERSION
  readonly type: 'message_card'
  readonly title: string
  readonly subtitle?: string
  /** Stable question identity chosen by the producer, streamed back in interactions. */
  readonly questionId?: string
  readonly body: string
  readonly actions?: readonly MessageCardAction[]
}

/** The complete v1 discriminated union. */
export type RichContentV1 =
  | LinePlotContent
  | ScatterPlotContent
  | BasicDiagramContent
  | MessageCardContent

/** Every supported `type` discriminant. */
export const RICH_CONTENT_TYPES = [
  'line_plot',
  'scatter_plot',
  'basic_diagram',
  'message_card',
] as const

/** One supported content type name. */
export type RichContentType = (typeof RICH_CONTENT_TYPES)[number]

/**
 * The durable envelope persisted through a tool result's `meta` field.
 * `content` is always the complete canonical payload, so a reload or a
 * historical replay can rebuild the same static visual without any live state.
 */
export interface RichMetaEnvelopeV1 {
  readonly kind: typeof RICH_META_KIND
  readonly envelopeVersion: typeof RICH_META_ENVELOPE_VERSION
  readonly content: RichContentV1
}

/**
 * One bounded interaction echo sent to the Host audit command.
 * It deliberately carries the original session and call identity so the Host
 * can reject cross-session or stale submissions.
 */
export interface RichInteractionPayloadV1 {
  readonly protocol: typeof RICH_INTERACTION_PROTOCOL
  readonly protocolVersion: 1
  /** Session the interaction was produced in (must equal the receiving agent id). */
  readonly sessionId: string
  /** Tool call that produced the card. */
  readonly callId: string
  /** Stable card identity derived from `(callId, questionId)` or `callId`. */
  readonly cardKey: string
  /** Producer-provided question identity, when the card declares one. */
  readonly questionId?: string
  /** Action chosen by the user. */
  readonly actionId: string
  /** Unique per click; the Host uses it to make duplicate delivery observable. */
  readonly attemptId: string
  /** Client timestamp of the click. */
  readonly submittedAt: string
  /** Optional selected answer text (already bounded by the card action). */
  readonly answer?: string
}

/** One entry written by the Host audit command and read back by tests. */
export interface RichInteractionRecord extends RichInteractionPayloadV1 {
  readonly receivedAt: string
  readonly agentId: string
  readonly duplicate: boolean
}

/** Locale-agnostic description of a validation failure. */
export interface RichValidationIssue {
  /** Stable machine code (used by tests and diagnostics). */
  readonly code: RichValidationCode
  /** JSON-pointer-ish path inside the payload, e.g. `data.series[2].points[7].y`. */
  readonly path: string
  /** Short English detail; never contains model text beyond a bounded excerpt. */
  readonly detail: string
}

/** Every validation failure code the protocol can produce. */
export type RichValidationCode =
  | 'NOT_AN_OBJECT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNKNOWN_TYPE'
  | 'INVALID_TITLE'
  | 'INVALID_SUBTITLE'
  | 'INVALID_BODY'
  | 'INVALID_QUESTION_ID'
  | 'INVALID_SERIES'
  | 'TOO_MANY_SERIES'
  | 'TOO_MANY_POINTS'
  | 'TOO_MANY_TOTAL_POINTS'
  | 'INVALID_POINT'
  | 'NON_FINITE_NUMBER'
  | 'COORDINATE_OUT_OF_RANGE'
  | 'INVALID_AXIS'
  | 'INVALID_AXIS_RANGE'
  | 'INVALID_COLOR'
  | 'INVALID_SHAPE'
  | 'TOO_MANY_NODES'
  | 'TOO_MANY_EDGES'
  | 'INVALID_NODE'
  | 'DUPLICATE_NODE_ID'
  | 'INVALID_EDGE'
  | 'UNKNOWN_EDGE_REF'
  | 'INVALID_ACTION'
  | 'TOO_MANY_ACTIONS'
