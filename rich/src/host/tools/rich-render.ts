/**
 * `rich_render` -the Host half of every rich response card.
 *
 * The model supplies one RichContentV1 object as a JSON argument. The Host
 * validates it against the Shared protocol, returns the canonical payload as
 * the tool value (so it is losslessly persisted), and projects the durable
 * presentation envelope through `output.presentationMeta`. The model-facing
 * content is a short human-readable summary; the visual never crosses the
 * model context.
 */
import {
  formatValidationIssues,
  RICH_CONTENT_SCHEMA_VERSION,
  RICH_LIMITS,
  RICH_META_ENVELOPE_VERSION,
  RICH_META_KIND,
  summarizeRichContent,
  validateRichContent,
  type RichContentV1,
  type RichMetaEnvelopeV1,
} from '../../shared/index'
import { RICH_RENDER_CONTENT_SCHEMA } from '../../shared/tool-schemas'
import { richContentFigureSvg } from '../../shared/figure-svg'
import { FIGURE_OUTPUT_PROPERTIES, FIGURE_TOOL_NOTE, figureInstruction, writeFigure, type FigureFields, type FigureToolOptions } from '../figures'
import type { ToolDefinitionLike } from '../types'

/** Canonical tool value persisted as `tool/result` content + meta source. */
export interface RichRenderValue extends FigureFields {
  readonly content: RichContentV1
  readonly summary: string
}

/** Parameters accepted by `rich_render`. */
export interface RichRenderArgs {
  readonly content?: unknown
}

/** Raw JSON Schema for the canonical output value. */
const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    content: { type: 'object' },
    summary: { type: 'string' },
    ...FIGURE_OUTPUT_PROPERTIES,
  },
  required: ['content', 'summary'],
  additionalProperties: false,
}

function valueOf(value: unknown): RichRenderValue {
  const record = value as Partial<RichRenderValue> | null
  return {
    content: record?.content as RichContentV1,
    summary: typeof record?.summary === 'string' ? record.summary : '',
  }
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createRichRenderTool(options: FigureToolOptions = {}): ToolDefinitionLike {
  return {
    name: 'rich_render',
    description:
      'Render one structured visual response card in the conversation. '
      + 'Use it for function curves (line_plot), charts (scatter_plot), simple diagrams (basic_diagram), '
      + `and interactive message cards (message_card). The payload must be RichContentV1 with schemaVersion ${String(RICH_CONTENT_SCHEMA_VERSION)}; `
      + `at most ${String(RICH_LIMITS.maxSeries)} series, ${String(RICH_LIMITS.maxPointsPerSeries)} points per series, `
      + 'finite coordinates only. Never put HTML, SVG source, URLs, or executable expressions in the payload.'
      + (options.figures === undefined ? '' : FIGURE_TOOL_NOTE),
    // Raw model-facing JSON Schema (a plain ToolDefinition passes `parameters`
    // straight through to the provider). The author-side schema DSL is only
    // compiled by `defineTool`, which this zero-dependency plugin does not use;
    // bounds and semantics are enforced by validateRichContent in `execute`.
    parameters: {
      type: 'object',
      properties: {
        content: RICH_RENDER_CONTENT_SCHEMA,
      },
      required: ['content'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => {
        const value = valueOf(rawValue)
        return [{ type: 'text', text: value.summary + figureInstruction(rawValue, options.figures) }]
      },
      presentationMeta: (_args, rawValue): RichMetaEnvelopeV1 => {
        const value = valueOf(rawValue)
        return {
          kind: RICH_META_KIND,
          envelopeVersion: RICH_META_ENVELOPE_VERSION,
          content: value.content,
        }
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_render: aborted before dispatch')
      const candidate = (args as RichRenderArgs | null)?.content
      const result = validateRichContent(candidate)
      if (!result.ok) {
        throw new Error(`rich_render: invalid RichContentV1 payload: ${formatValidationIssues(result.issues)}`)
      }
      return {
        content: result.value,
        summary: summarizeRichContent(result.value),
        ...writeFigure(options.figures, exec, richContentFigureSvg(result.value), 'svg', result.value.title),
      } satisfies RichRenderValue
    },
  }
}
