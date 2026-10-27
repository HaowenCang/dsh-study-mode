/**
 * `rich_svg` - a freeform model-written drawing (VIS-03).
 *
 * For schematics the structured tools cannot express (force diagrams, geometry,
 * circuits, apparatus), the model writes plain SVG geometry. The Host accepts it
 * only through the allowlist sanitizer, rebuilds it inside the light figure card,
 * writes the card as a figure file and returns the Markdown line for the answer.
 * The rebuilt card, never the model's source text, is persisted and shown.
 */
import { drawingFigureSvg } from '../../shared/figure-svg'
import { sanitizeSvg, xmlText, SVG_ENVELOPE_VERSION, SVG_LIMITS, SVG_META_KIND, type SvgEnvelope } from '../../shared/svg-sanitize'
import { stripUnsafeText } from '../../shared/plain-text'
import { FIGURE_OUTPUT_PROPERTIES, FIGURE_TOOL_NOTE, figureInstruction, writeFigure, type FigureFields, type FigureToolOptions } from '../figures'
import type { ToolDefinitionLike } from '../types'

/** Canonical tool value persisted as the `tool/result` value. */
export interface RichSvgValue extends FigureFields {
  readonly title: string
  readonly subtitle?: string
  /** The rebuilt figure card (sanitized drawing inside the card frame). */
  readonly svg: string
  readonly summary: string
}

const ARG_KEYS = ['title', 'subtitle', 'svg']
const MAX_TITLE = 120
const MAX_SUBTITLE = 200

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    subtitle: { type: 'string' },
    svg: { type: 'string' },
    summary: { type: 'string' },
    ...FIGURE_OUTPUT_PROPERTIES,
  },
  required: ['title', 'svg', 'summary'],
  additionalProperties: false,
}

function valueOf(value: unknown): RichSvgValue {
  const record = value as Partial<RichSvgValue> | null
  return {
    title: typeof record?.title === 'string' ? record.title : '',
    ...typeof record?.subtitle === 'string' ? { subtitle: record.subtitle } : {},
    svg: typeof record?.svg === 'string' ? record.svg : '',
    summary: typeof record?.summary === 'string' ? record.summary : '',
  }
}

function plainText(value: unknown, key: string, max: number): string {
  const text = typeof value === 'string' ? stripUnsafeText(value).replace(/\s+/g, ' ').trim() : ''
  if (text.length === 0 || !xmlText(text) || [...text].length > max) throw new Error(`rich_svg: ${key} must be 1..${String(max)} characters of plain text`)
  return text
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createSvgTool(options: FigureToolOptions = {}): ToolDefinitionLike {
  return {
    name: 'rich_svg',
    description:
      'Draw a schematic figure as plain SVG geometry: force and motion diagrams, geometry, circuits, apparatus, coordinate sketches. '
      + 'Prefer rich_render for data plots, rich_mermaid for flowcharts and rich_heatmap for matrices. '
      + 'svg is one <svg viewBox="minX minY width height"> element (viewBox required; width and height are ignored) containing only '
      + 'g, defs, marker, line, polyline, polygon, rect, circle, ellipse, path, text, tspan, title, desc. '
      + 'Use presentation attributes (fill, stroke, stroke-width, stroke-dasharray, opacity, transform, font-size, text-anchor, ...) with literal colours; '
      + 'arrowheads use a <marker id="..."> in <defs> referenced as marker-end="url(#id)". '
      + 'Not allowed: style attributes or <style>, script, event handlers, links, <image>, <use>, foreignObject, gradients, url() paints, entities other than &amp; &lt; &gt; &quot; &apos;. '
      + `At most ${String(SVG_LIMITS.maxElements)} elements and ${String(SVG_LIMITS.maxSourceChars)} characters. `
      + 'The drawing is placed on a white card, scaled to 600 px wide; use font-size 12 to 16 at that scale. '
      + 'The check covers only allowed markup, not whether the drawing is correct; you cannot see the result.'
      + (options.figures === undefined ? '' : FIGURE_TOOL_NOTE),
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `Figure title shown on the card, at most ${String(MAX_TITLE)} characters.` },
        subtitle: { type: 'string', description: 'Optional one-line caption.' },
        svg: { type: 'string', description: 'Complete <svg viewBox="..."> markup in the allowed subset.' },
      },
      required: ['title', 'svg'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => [{ type: 'text', text: valueOf(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue): SvgEnvelope => {
        const value = valueOf(rawValue)
        return {
          kind: SVG_META_KIND,
          envelopeVersion: SVG_ENVELOPE_VERSION,
          title: value.title,
          ...value.subtitle === undefined ? {} : { subtitle: value.subtitle },
          svg: value.svg,
        }
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_svg: aborted before dispatch')
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('rich_svg: arguments must be an object')
      const record = args as Record<string, unknown>
      const extra = Object.keys(record).filter(key => !ARG_KEYS.includes(key))
      if (extra.length > 0) throw new Error(`rich_svg: unexpected argument ${extra.slice(0, 3).join(', ')}`)
      const title = plainText(record['title'], 'title', MAX_TITLE)
      const subtitle = record['subtitle'] === undefined ? undefined : plainText(record['subtitle'], 'subtitle', MAX_SUBTITLE)
      if (typeof record['svg'] !== 'string') throw new Error('rich_svg: svg must be a string of SVG markup')
      const result = sanitizeSvg(record['svg'])
      if (!result.ok) throw new Error(`rich_svg: invalid SVG drawing: ${result.issues.join('; ')}`)
      const inner = result.rootPaint.length > 0 ? `<g${result.rootPaint}>${result.inner}</g>` : result.inner
      const svg = drawingFigureSvg({ title, subtitle }, result.viewBox, inner)
      const summary = `Drew "${title}" as an SVG figure (${String(result.elements)} elements, viewBox ${result.viewBox.join(' ')}). `
        + 'Only the allowed markup was checked; you cannot see the drawing.'
      return {
        title,
        ...subtitle === undefined ? {} : { subtitle },
        svg,
        summary,
        ...writeFigure(options.figures, exec, svg, 'svg', title),
      } satisfies RichSvgValue
    },
  }
}
