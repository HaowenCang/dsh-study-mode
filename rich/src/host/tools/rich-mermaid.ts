/**
 * `rich_mermaid` - bounded Mermaid flowchart text rendered as a rich diagram.
 *
 * The Host compiles a strict flowchart subset (see shared/mermaid) into a
 * canonical `basic_diagram` payload and projects the ordinary RichMetaEnvelopeV1,
 * so the existing audited Tool view and renderer draw it and a reload replays
 * the same static card. Mermaid itself is never executed; unsupported syntax
 * fails the call with line-numbered issues the model can correct.
 */
import {
  RICH_META_ENVELOPE_VERSION,
  RICH_META_KIND,
  summarizeRichContent,
  type BasicDiagramContent,
  type RichMetaEnvelopeV1,
} from '../../shared/index'
import { compileMermaidFlowchart, MERMAID_LIMITS, type MermaidDirection } from '../../shared/mermaid'
import type { ToolDefinitionLike } from '../types'

/** Canonical tool value persisted as `tool/result` content + meta source. */
export interface RichMermaidValue {
  readonly content: BasicDiagramContent
  readonly summary: string
  readonly direction: MermaidDirection
  readonly layers: number
}

const ARG_KEYS = ['title', 'subtitle', 'source']

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    content: { type: 'object' },
    summary: { type: 'string' },
    direction: { type: 'string', enum: ['TD', 'BT', 'LR', 'RL'] },
    layers: { type: 'integer' },
  },
  required: ['content', 'summary', 'direction', 'layers'],
  additionalProperties: false,
}

function valueOf(value: unknown): RichMermaidValue {
  const record = value as Partial<RichMermaidValue> | null
  return {
    content: record?.content as BasicDiagramContent,
    summary: typeof record?.summary === 'string' ? record.summary : '',
    direction: record?.direction ?? 'TD',
    layers: typeof record?.layers === 'number' ? record.layers : 0,
  }
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createMermaidTool(): ToolDefinitionLike {
  return {
    name: 'rich_mermaid',
    description:
      'Draw a small flowchart from a bounded subset of Mermaid flowchart syntax (Mermaid itself is not run). '
      + 'First line: "flowchart TD" (or TB, BT, LR, RL). Nodes: id, id[box], id(rounded), id([stadium]), id{decision}, id((circle)); '
      + 'quote labels that contain brackets, e.g. A["F = m[a]"]. Links: A --> B, A -.-> B (dashed), A -->|label| B, A -- label --> B; chains allowed. '
      + 'Ids use letters, digits and _; ([stadium]) is drawn as a rounded box. Labels are plain text (no <br>, HTML, entities or markdown); write averages as \u27E8p\u27E9, not <p>. '
      + 'Not supported: subgraph, click, style/classDef/linkStyle, other diagram types, &, ---, ==>, two links between the same pair of nodes. '
      + `At most ${String(MERMAID_LIMITS.maxLayers)} levels along the main direction and about 5 nodes side by side; `
      + 'unsupported syntax, overcrowded levels, or links that would cross other nodes or hide their labels fail with issues to fix.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Card title shown above the diagram.' },
        subtitle: { type: 'string', description: 'Optional short caption.' },
        source: { type: 'string', description: 'Mermaid flowchart text in the supported subset.' },
      },
      required: ['title', 'source'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => [{ type: 'text', text: valueOf(rawValue).summary }],
      presentationMeta: (_args, rawValue): RichMetaEnvelopeV1 => ({
        kind: RICH_META_KIND,
        envelopeVersion: RICH_META_ENVELOPE_VERSION,
        content: valueOf(rawValue).content,
      }),
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_mermaid: aborted before dispatch')
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('rich_mermaid: arguments must be an object')
      const record = args as Record<string, unknown>
      const extra = Object.keys(record).filter(key => !ARG_KEYS.includes(key))
      if (extra.length > 0) throw new Error(`rich_mermaid: unexpected field(s): ${extra.slice(0, 5).join(', ')}`)
      if (typeof record['title'] !== 'string' || record['title'].trim().length === 0) throw new Error('rich_mermaid: title must be a non-empty string')
      if (record['subtitle'] !== undefined && typeof record['subtitle'] !== 'string') throw new Error('rich_mermaid: subtitle must be a string')
      const result = compileMermaidFlowchart({
        title: record['title'] as string,
        source: record['source'] as string,
        ...record['subtitle'] === undefined ? {} : { subtitle: record['subtitle'] as string },
      })
      if (!result.ok) {
        const detail = result.issues.slice(0, 8)
          .map(issue => `${issue.code}${issue.line > 0 ? ` (line ${String(issue.line)})` : ''}: ${issue.message}`)
          .join('; ')
        throw new Error(`rich_mermaid: unsupported Mermaid source: ${detail}`)
      }
      const summary = `Mermaid flowchart (${result.direction}, ${String(result.layers)} levels) rendered as ${summarizeRichContent(result.content)}`
      return {
        content: result.content,
        summary,
        direction: result.direction,
        layers: result.layers,
      } satisfies RichMermaidValue
    },
  }
}
