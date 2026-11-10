/**
 * One validation route for every inline figure fence (plan P5/P7).
 *
 * Used by the client renderers (to decide what to draw) and by the read-only Host tool
 * `rich_check_figure` (so the model can test a figure before writing it in its answer), so both
 * always agree. Pure: no React, no DOM, no file system.
 */
import { validateHeatmap } from './heatmap'
import type { HeatmapContent } from './heatmap'
import { compileMermaidFlowchart } from './mermaid'
import { physicsArgs } from './physics-protocol'
import type { PhysicsDemo } from './physics-protocol'
import { sampleFunctionPlot } from './plot-expr'
import type { FunctionPlotSpec } from './plot-expr'
import { RICH_CONTENT_SCHEMA_VERSION } from './protocol'
import type { BasicDiagramContent, LinePlotContent, ScatterPlotContent } from './protocol'
import { sanitizeSvgTree } from './svg-sanitize'
import type { SanitizeTreeResult } from './svg-sanitize'
import { validateRichContent } from './validation'

export const FIGURE_LANGS = ['svg', 'dsh-svg', 'mermaid', 'dsh-mermaid', 'dsh-plot', 'dsh-heatmap', 'dsh-physics'] as const
export type FigureLang = typeof FIGURE_LANGS[number]

/** A refusal reason; `line` (1-based) when the source position is known. */
export type FigureIssue = string | { readonly line: number; readonly message: string }

export type FigureCheck =
  | { readonly ok: true; readonly kind: 'svg'; readonly tree: Extract<SanitizeTreeResult, { ok: true }> }
  | { readonly ok: true; readonly kind: 'diagram'; readonly content: BasicDiagramContent }
  | { readonly ok: true; readonly kind: 'plot'; readonly content: LinePlotContent | ScatterPlotContent }
  | { readonly ok: true; readonly kind: 'heatmap'; readonly content: HeatmapContent }
  | { readonly ok: true; readonly kind: 'physics'; readonly demo: PhysicsDemo }
  | { readonly ok: false; readonly issues: readonly FigureIssue[] }

/** Upper bound on a JSON figure fence, checked before parsing (UTF-16 code units). */
export const FIGURE_JSON_LIMIT = 256 * 1024

export function parseFigureJson(source: string): { ok: true; value: unknown } | { ok: false; issue: string } {
  if (source.length > FIGURE_JSON_LIMIT) return { ok: false, issue: `figure data is limited to ${String(FIGURE_JSON_LIMIT / 1024)} KiB` }
  try { return { ok: true, value: JSON.parse(source) as unknown } } catch (error) {
    return { ok: false, issue: 'invalid JSON: ' + (error instanceof Error ? error.message : 'parse error').slice(0, 160) }
  }
}

/** Title from a leading `%% title: …` comment line. */
export function mermaidTitle(source: string): string | undefined {
  for (const raw of source.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') continue
    const match = /^%%\s*title\s*:\s*(.+)$/iu.exec(line)
    return match?.[1] === undefined ? undefined : match[1].trim().slice(0, 120)
  }
  return undefined
}

const lineAt = (source: string, offset: number): number => source.slice(0, offset).split('\n').length

/** Offset of the first `<name` start tag (followed by space, `/` or `>`), or -1. */
function tagOffset(source: string, name: string): number {
  for (let at = source.indexOf('<' + name); at >= 0; at = source.indexOf('<' + name, at + 1)) {
    if (/[\s/>]/u.test(source[at + name.length + 1] ?? '')) return at
  }
  return -1
}

/**
 * 1-based line of the source an SVG allowlist issue most likely refers to (display only; the issue
 * text stays identical to the rich_svg tool output). Undefined when it cannot be located.
 */
export function issueLine(source: string, issue: string): number | undefined {
  const offset = /near offset (\d+)/u.exec(issue)
  if (offset !== null) return lineAt(source, Number(offset[1]))
  const attribute = /^<([\w:.-]+)> attribute "([^"]+)"/u.exec(issue)
  if (attribute !== null) {
    const tag = tagOffset(source, attribute[1] ?? '')
    const at = tag < 0 ? -1 : source.indexOf((attribute[2] ?? '') + '=', tag)
    return at < 0 ? undefined : lineAt(source, at)
  }
  const element = /^<([\w:.-]+)> is not allowed/u.exec(issue) ?? /^unclosed <([\w:.-]+)>/u.exec(issue)
  if (element !== null) {
    const at = tagOffset(source, element[1] ?? '')
    return at < 0 ? undefined : lineAt(source, at)
  }
  const entity = /^entity "([^"]+)"/u.exec(issue)
  if (entity !== null) { const at = source.indexOf(entity[1] ?? ''); return at < 0 ? undefined : lineAt(source, at) }
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Validate one closed figure fence exactly as the inline renderer will draw it. */
export function checkFigure(lang: string, source: string, options: { readonly defaultTitle?: string } = {}): FigureCheck {
  switch (lang) {
    case 'svg': case 'dsh-svg': {
      const tree = sanitizeSvgTree(source)
      return tree.ok ? { ok: true, kind: 'svg', tree } : { ok: false, issues: tree.issues.map(issue => { const line = issueLine(source, issue); return line === undefined ? issue : { line, message: issue } }) }
    }
    case 'mermaid': case 'dsh-mermaid': {
      const result = compileMermaidFlowchart({ title: mermaidTitle(source) ?? options.defaultTitle ?? 'Flowchart', source })
      return result.ok ? { ok: true, kind: 'diagram', content: result.content } : { ok: false, issues: result.issues.map(issue => ({ line: issue.line, message: issue.message })) }
    }
    case 'dsh-plot': {
      const parsed = parseFigureJson(source)
      if (!parsed.ok) return { ok: false, issues: [parsed.issue] }
      const value = parsed.value
      if (!isRecord(value)) return { ok: false, issues: ['plot data must be a JSON object'] }
      if ('type' in value) {
        if (value['type'] !== 'line_plot' && value['type'] !== 'scatter_plot') return { ok: false, issues: ['dsh-plot draws line_plot or scatter_plot only'] }
        const checked = validateRichContent({ schemaVersion: RICH_CONTENT_SCHEMA_VERSION, ...value })
        if (!checked.ok) return { ok: false, issues: checked.issues.map(i => `${i.path}: ${i.detail}`) }
        return { ok: true, kind: 'plot', content: checked.value as LinePlotContent | ScatterPlotContent }
      }
      const sampled = sampleFunctionPlot(value as unknown as FunctionPlotSpec)
      return sampled.ok ? { ok: true, kind: 'plot', content: sampled.content } : { ok: false, issues: sampled.issues }
    }
    case 'dsh-heatmap': {
      const parsed = parseFigureJson(source)
      if (!parsed.ok) return { ok: false, issues: [parsed.issue] }
      const candidate = isRecord(parsed.value) && !('schemaVersion' in parsed.value) ? { schemaVersion: 1, ...parsed.value } : parsed.value
      const checked = validateHeatmap(candidate)
      return checked.ok ? { ok: true, kind: 'heatmap', content: checked.value } : { ok: false, issues: checked.issues.map(i => `${i.path}: ${i.detail}`) }
    }
    case 'dsh-physics': {
      const parsed = parseFigureJson(source)
      if (!parsed.ok) return { ok: false, issues: [parsed.issue] }
      try { return { ok: true, kind: 'physics', demo: physicsArgs(parsed.value).demo } } catch (error) {
        return { ok: false, issues: [error instanceof Error ? error.message : 'unsupported physics demo'] }
      }
    }
    default:
      return { ok: false, issues: [`unsupported figure language "${lang.slice(0, 40)}"; use one of ${FIGURE_LANGS.join(', ')}`] }
  }
}

/** Plain-text issue list, one per line, with line numbers when known. */
export function formatFigureIssues(issues: readonly FigureIssue[]): string {
  return issues.slice(0, 12).map(issue => typeof issue === 'string' ? '- ' + issue : `- line ${String(issue.line)}: ${issue.message}`).join('\n')
}
