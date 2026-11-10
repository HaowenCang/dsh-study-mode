/**
 * Split assistant Markdown into ordinary Markdown and top-level figure fences (inline rendering).
 *
 * Only fences that open at column 0 with a recognised language become figure segments; that keeps
 * fences inside lists, block quotes and indented blocks as code, exactly as Markdown shows them.
 * Every other fence (any language, indent 0-3) is still tracked so a figure-looking fence inside
 * another code block is never split. Closing fences follow CommonMark: the same character, at
 * least the opening length, indent 0-3, nothing but spaces after it. A trailing fence without its
 * closing line is reported `closed: false` so a streaming renderer can draw progressively.
 */

/** Fence languages drawn inline. Generic names render too, with a source toggle (D-017). */
export const FIGURE_LANGS: ReadonlySet<string> = new Set(['svg', 'dsh-svg', 'mermaid', 'dsh-mermaid', 'dsh-plot', 'dsh-heatmap', 'dsh-physics'])

export type FenceSegment =
  | { readonly kind: 'md'; readonly text: string; readonly offset: number }
  | { readonly kind: 'figure'; readonly lang: string; readonly source: string; readonly closed: boolean; readonly offset: number }

interface Line { readonly start: number; readonly end: number; readonly text: string; readonly complete: boolean }

function lines(text: string): Line[] {
  const out: Line[] = []
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl < 0 ? text.length : nl + 1
    const raw = text.slice(start, nl < 0 ? text.length : nl)
    out.push({ start, end, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw, complete: nl >= 0 })
    start = end
  }
  return out
}

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/
const CLOSE = /^ {0,3}(`{3,}|~{3,}) *$/

function opening(line: string): { indent: number; fence: string; info: string } | undefined {
  const match = OPEN.exec(line)
  if (match === null) return undefined
  const fence = match[2] ?? ''
  const info = (match[3] ?? '').trim()
  if (fence.startsWith('`') && info.includes('`')) return undefined
  return { indent: (match[1] ?? '').length, fence, info }
}

function closes(line: string, fence: string): boolean {
  const match = CLOSE.exec(line)
  const run = match?.[1]
  return run !== undefined && run[0] === fence[0] && run.length >= fence.length
}

/**
 * Split `text` into Markdown and figure segments in document order. Segment offsets index `text`;
 * Markdown segments are exact substrings, figure sources exclude the fence lines and the final line break.
 */
export function splitFences(text: string): FenceSegment[] {
  const segments: FenceSegment[] = []
  const all = lines(text)
  let mdStart = 0
  let i = 0
  while (i < all.length) {
    const line = all[i] as Line
    const open = opening(line.text)
    // An opening line still being streamed (no newline yet) is not a fence yet.
    if (open === undefined || !line.complete) { i += 1; continue }
    const lang = (open.info.split(/[ \t]/)[0] ?? '').toLowerCase()
    let j = i + 1
    while (j < all.length && !closes((all[j] as Line).text, open.fence)) j += 1
    const closed = j < all.length
    if (open.indent === 0 && FIGURE_LANGS.has(lang)) {
      if (line.start > mdStart) segments.push({ kind: 'md', text: text.slice(mdStart, line.start), offset: mdStart })
      const body = all.slice(i + 1, j)
      const source = body.map(l => l.text).join('\n')
      segments.push({ kind: 'figure', lang, source, closed, offset: line.start })
      mdStart = closed ? (all[j] as Line).end : text.length
    }
    i = closed ? j + 1 : all.length
  }
  if (mdStart < text.length || segments.length === 0) segments.push({ kind: 'md', text: text.slice(mdStart), offset: mdStart })
  return segments
}

const DEFINITION = /^ {0,3}\[(?:[^\]\\\n]|\\.){1,999}\]:[ \t]*\S/

/**
 * Link reference definitions outside code fences, so each split Markdown segment can carry them
 * (definitions do not render, but a reference in one segment may be defined in another).
 */
export function linkDefinitions(text: string): string[] {
  const out: string[] = []
  const all = lines(text)
  let i = 0
  while (i < all.length) {
    const line = all[i] as Line
    const open = opening(line.text)
    if (open !== undefined) {
      let j = i + 1
      while (j < all.length && !closes((all[j] as Line).text, open.fence)) j += 1
      i = j + 1
      continue
    }
    if (DEFINITION.test(line.text)) out.push(line.text)
    i += 1
  }
  return out
}
