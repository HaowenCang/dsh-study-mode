/**
 * `rich_heatmap` - a validated numeric matrix shown as a colored grid card.
 *
 * The Host validates HeatmapV1, persists the canonical payload as the tool
 * value and projects the `rich-heatmap` envelope as presentation meta. The
 * model receives a one-line summary with the grid size and value range; the
 * picture never enters the model context.
 */
import {
  formatHeatmapIssues,
  HEATMAP_ENVELOPE_VERSION,
  HEATMAP_LIMITS,
  HEATMAP_META_KIND,
  summarizeHeatmap,
  validateHeatmap,
  type HeatmapContent,
  type HeatmapEnvelope,
} from '../../shared/heatmap'
import type { ToolDefinitionLike } from '../types'

/** Canonical tool value persisted as the `tool/result` value. */
export interface RichHeatmapValue {
  readonly content: HeatmapContent
  readonly summary: string
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    content: { type: 'object' },
    summary: { type: 'string' },
  },
  required: ['content', 'summary'],
  additionalProperties: false,
}

function valueOf(value: unknown): RichHeatmapValue {
  const record = value as Partial<RichHeatmapValue> | null
  return {
    content: record?.content as HeatmapContent,
    summary: typeof record?.summary === 'string' ? record.summary : '',
  }
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createHeatmapTool(): ToolDefinitionLike {
  return {
    name: 'rich_heatmap',
    description:
      'Show a numeric matrix as a colored grid card: a 2D field, probability density, lattice configuration, '
      + 'correlation or confusion matrix. Use only numbers you actually computed or were given; never invent data. '
      + `values is row-major (values[row][column]), rectangular, at most ${String(HEATMAP_LIMITS.maxRows)} rows, `
      + `${String(HEATMAP_LIMITS.maxColumns)} columns and ${String(HEATMAP_LIMITS.maxCells)} cells, finite numbers with |v| <= 1e7. `
      + 'origin "lower" (default) draws values[0] as the bottom row like a y-up plot; "upper" draws it on top like a matrix. '
      + 'yAxis min/max always run bottom to top, so with origin "upper" values[0] lies at yAxis.max. '
      + 'Axis min/max give the coordinates of the grid edges. colorScale.palette is "sequential" (default) or "diverging" '
      + '(centered on the scale midpoint; without an explicit range it is symmetric around 0). An explicit colorScale range must contain every value. '
      + 'The learner sees the picture; you receive only a summary line.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'object',
          description:
            'HeatmapV1: { schemaVersion: 1, title, subtitle?, values: number[][], origin?: "lower"|"upper", '
            + 'xAxis?: { label?, unit?, min?, max? }, yAxis?: { label?, unit?, min?, max? }, '
            + 'colorScale?: { palette?: "sequential"|"diverging", label?, unit?, min?, max? } }.',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => [{ type: 'text', text: valueOf(rawValue).summary }],
      presentationMeta: (_args, rawValue): HeatmapEnvelope => ({
        kind: HEATMAP_META_KIND,
        envelopeVersion: HEATMAP_ENVELOPE_VERSION,
        content: valueOf(rawValue).content,
      }),
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_heatmap: aborted before dispatch')
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('rich_heatmap: arguments must be an object')
      const extra = Object.keys(args).filter(key => key !== 'content')
      if (extra.length > 0) throw new Error(`rich_heatmap: unexpected argument ${extra.slice(0, 3).join(', ')}`)
      const result = validateHeatmap((args as { content?: unknown }).content)
      if (!result.ok) throw new Error(`rich_heatmap: invalid HeatmapV1 payload: ${formatHeatmapIssues(result.issues)}`)
      return { content: result.value, summary: summarizeHeatmap(result.value) } satisfies RichHeatmapValue
    },
  }
}
