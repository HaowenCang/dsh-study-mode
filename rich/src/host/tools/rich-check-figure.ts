/**
 * `rich_check_figure` - read-only check of one figure fence before the model writes it (plan P7).
 *
 * When answers draw figures inline (```svg, ```mermaid, ```dsh-plot, ...), a refused fence is
 * shown to the learner but never reaches the model. This tool runs the exact check the inline
 * renderer runs (shared/figure-check) and returns OK or line-numbered issues. It writes no file,
 * returns no image line or path, and draws nothing: the figure appears only where the answer
 * writes the fence.
 */
import { checkFigure, FIGURE_LANGS, formatFigureIssues } from '../../shared/figure-check'
import type { ToolDefinitionLike } from '../types'

/** Upper bound on `source` (UTF-16 code units), checked before any parsing. */
export const CHECK_FIGURE_SOURCE_LIMIT = 256 * 1024

/** Persisted tool value; render() derives the model text from it so a replay says the same. */
export interface RichCheckFigureValue {
  readonly ok: boolean
  readonly lang: string
  readonly kind?: string
  /** Issue texts, `line N: …` when the source line is known. */
  readonly issues?: readonly string[]
}

const ARG_KEYS = ['lang', 'source']

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    lang: { type: 'string' },
    kind: { type: 'string' },
    // Strings only: DSH 0.2.2 tools.register rejects anyOf in an output schema (and would dispose this plugin).
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'lang'],
  additionalProperties: false,
}

function issuesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((issue): issue is string => typeof issue === 'string').map(issue => issue.slice(0, 300)) : []
}

function textOf(raw: unknown): string {
  const record = raw as Partial<RichCheckFigureValue> | null
  const lang = typeof record?.lang === 'string' ? record.lang.slice(0, 40) : 'figure'
  if (record?.ok === true) return `OK: this \`\`\`${lang} fence will be drawn in the answer. Write it there unchanged.`
  return `NOT OK: this \`\`\`${lang} fence would not be drawn. Fix these issues and check again:\n${formatFigureIssues(issuesOf(record?.issues))}`
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createCheckFigureTool(): ToolDefinitionLike {
  return {
    name: 'rich_check_figure',
    description:
      'Check one figure fence before you write it in your answer; nothing is drawn, saved or shown. '
      + `lang is the fence language (${FIGURE_LANGS.join(', ')}); source is the text between the fence lines. `
      + 'Returns OK, or the issues to fix with line numbers. Use it for any figure you are not sure about, then write the fence in your answer.',
    parameters: {
      type: 'object',
      properties: {
        lang: { type: 'string', enum: [...FIGURE_LANGS], description: 'Fence language.' },
        source: { type: 'string', description: 'Fence body, without the ``` lines.' },
      },
      required: ['lang', 'source'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => [{ type: 'text', text: textOf(rawValue) }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_check_figure: aborted before dispatch')
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('rich_check_figure: arguments must be an object')
      const record = args as Record<string, unknown>
      const extra = Object.keys(record).filter(key => !ARG_KEYS.includes(key))
      if (extra.length > 0) throw new Error(`rich_check_figure: unexpected field(s): ${extra.slice(0, 5).join(', ')}`)
      const lang = record['lang'], source = record['source']
      if (typeof lang !== 'string' || lang.length === 0 || lang.length > 40) throw new Error('rich_check_figure: lang must be a fence language')
      if (typeof source !== 'string') throw new Error('rich_check_figure: source must be a string')
      if (source.length > CHECK_FIGURE_SOURCE_LIMIT) throw new Error(`rich_check_figure: source is over the ${String(CHECK_FIGURE_SOURCE_LIMIT / 1024)} KiB limit`)
      const result = checkFigure(lang, source)
      return result.ok
        ? { ok: true, lang, kind: result.kind } satisfies RichCheckFigureValue
        : { ok: false, lang, issues: result.issues.slice(0, 12).map(issue => typeof issue === 'string' ? issue : `line ${String(issue.line)}: ${issue.message}`) } satisfies RichCheckFigureValue
    },
  }
}
