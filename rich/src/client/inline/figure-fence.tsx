/**
 * One figure fence drawn inline in an assistant message (plan P3/P5).
 *
 * SVG fences are parsed with the `rich_svg` allowlist and rebuilt as React elements: while the
 * fence streams, the tolerant partial mode draws every complete element and keeps the last good
 * drawing; once closed, the strict mode decides. Generic fences (```svg) that fail fall back to the
 * ordinary code block (the user may have asked for source); namespaced ones (```dsh-svg) show a
 * refusal with the reasons. Every figure has a source toggle (D-017). Other languages are routed by
 * `renderers` so this module stays independent of their implementations.
 */
import { createElement, memo, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { issueLine } from '../../shared/figure-check'
import type { FigureIssue } from '../../shared/figure-check'
import { sanitizeSvgTree } from '../../shared/svg-sanitize'
import type { SanitizeTreeResult } from '../../shared/svg-sanitize'
import { svgTreeToReact } from './svg-react'
import type { MarkdownLabels, Primitives } from './types'

export interface FigureCopy {
  readonly showSource: string
  readonly hideSource: string
  readonly drawing: string
  readonly refused: string
  readonly figure: string
  readonly line: (line: number) => string
}

/** Short UI copy; Chinese when the page language is Chinese. */
export function figureCopy(lang: string | undefined = globalThis.document?.documentElement?.lang): FigureCopy {
  return (lang ?? '').toLowerCase().startsWith('zh')
    ? { showSource: '查看源码', hideSource: '隐藏源码', drawing: '正在绘制…', refused: '图形未通过安全检查，未绘制：', figure: '图形', line: (n: number) => `第 ${String(n)} 行` }
    : { showSource: 'Show source', hideSource: 'Hide source', drawing: 'Drawing…', refused: 'This figure was not drawn because it failed the safety check:', figure: 'Figure', line: (n: number) => `Line ${String(n)}` }
}

/** Outcome of one non-SVG renderer for a closed (or streaming) fence. */
export type FigureRender =
  | { readonly kind: 'figure'; readonly node: ReactNode; readonly label?: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused'; readonly issues: readonly FigureIssue[] }
  | { readonly kind: 'code' }

export type { FigureIssue }
export { issueLine }

export interface FigureRendererInput {
  readonly source: string
  readonly closed: boolean
  readonly streaming: boolean
  readonly lang: string
  /** Stable per figure occurrence (session, step, block, offset): keys local view preferences. */
  readonly figureKey?: string
}

export type FigureRenderer = (input: FigureRendererInput) => FigureRender

export interface FigureFenceProps {
  readonly lang: string
  readonly source: string
  readonly closed: boolean
  readonly streaming: boolean
  readonly primitives: Primitives
  readonly labels: MarkdownLabels
  readonly renderers?: Readonly<Record<string, FigureRenderer>>
  readonly paint?: (name: 'fill' | 'stroke', value: string, element: string) => string
  readonly copy?: FigureCopy
  readonly figureKey?: string
}

/** Width the SVG is drawn at: its own width within [320, 760] px, never wider than the column. */
function svgMaxWidth(viewBoxWidth: number): string {
  return `min(100%, ${String(Math.round(Math.max(320, Math.min(760, viewBoxWidth))))}px)`
}

function titleOf(tree: Extract<SanitizeTreeResult, { ok: true }>): string | undefined {
  const title = tree.children.find(child => child.name === 'title')
  const text = title?.children.map(c => 'text' in c ? c.text : '').join('').trim()
  return text !== undefined && text.length > 0 ? text.slice(0, 200) : undefined
}

const GENERIC = new Set(['svg', 'mermaid'])
/** Issue shown when checking or drawing a figure fails unexpectedly; the failure stays inside this figure. */
const UNEXPECTED = 'figure could not be drawn'
/** Per-mount counter: `useId` is unique only within one React root, marker ids must be unique in the document. */
let instances = 0

export const FigureFence = memo(function FigureFence(props: FigureFenceProps): ReactElement {
  const { lang, source, closed, streaming, primitives, labels } = props
  const copy = props.copy ?? figureCopy()
  const [showSource, setShowSource] = useState(false)
  const id = useId()
  const [instance] = useState(() => (instances += 1))
  const lastGood = useRef<Extract<SanitizeTreeResult, { ok: true }> | undefined>(undefined)
  const isSvg = lang === 'svg' || lang === 'dsh-svg'
  const live = streaming && !closed

  const svg = useMemo(() => {
    if (!isSvg) return undefined
    // Never let model text throw out of a figure: a throw here would retire the whole inline renderer.
    let tree: SanitizeTreeResult
    try { tree = sanitizeSvgTree(source, { partial: live }) } catch { tree = { ok: false, issues: [UNEXPECTED] } }
    if (tree.ok) lastGood.current = tree
    return tree
  }, [isSvg, source, live])

  let render: FigureRender
  if (isSvg) {
    const tree = svg?.ok === true ? svg : live ? lastGood.current : undefined
    let node: ReactNode | undefined
    if (tree !== undefined) {
      try {
        node = svgTreeToReact(tree, {
          idPrefix: 'dshfig' + instance.toString(36) + id,
          createElement,
          ...props.paint === undefined ? {} : { paint: props.paint },
          rootProps: { 'data-dsh-figure-svg': '', role: 'img', 'aria-label': titleOf(tree) ?? copy.figure, width: '100%', style: { maxWidth: svgMaxWidth(tree.viewBox[2]) } },
        })
      } catch { node = undefined }
    }
    if (tree !== undefined && node !== undefined) render = { kind: 'figure', label: titleOf(tree) ?? copy.figure, node }
    else if (tree === undefined && live) render = { kind: 'pending' }
    else if (GENERIC.has(lang)) render = { kind: 'code' }
    else render = { kind: 'refused', issues: tree !== undefined ? [UNEXPECTED] : svg?.ok === false ? svg.issues : [] }
  } else {
    const renderer = props.renderers?.[lang]
    try {
      render = renderer === undefined ? { kind: 'code' } : renderer({ source, closed, streaming, lang, ...props.figureKey === undefined ? {} : { figureKey: props.figureKey } })
    } catch { render = { kind: 'refused', issues: [UNEXPECTED] } }
    if (render.kind === 'refused' && GENERIC.has(lang)) render = { kind: 'code' }
  }

  const code = createElement(primitives.CodeBlock, {
    code: source, lang: lang.replace(/^dsh-/, ''), streaming: live,
    copyLabel: labels.code.copyLabel, copiedLabel: labels.code.copiedLabel, toolbarLabels: labels.code.toolbarLabels,
  })
  if (render.kind === 'code') return createElement('div', { 'data-dsh-figure-fallback': lang }, code)

  const toggle = createElement('button', {
    type: 'button', 'aria-expanded': showSource, onClick: () => { setShowSource(open => !open) },
  }, showSource ? copy.hideSource : copy.showSource)

  if (render.kind === 'refused') {
    return createElement('figure', { 'data-dsh-figure': lang, 'data-state': 'refused' },
      createElement('div', { 'data-dsh-figure-error': '' }, copy.refused,
        createElement('ol', null, ...render.issues.slice(0, 8).map((issue, i) => {
          const text = typeof issue === 'string' ? issue : issue.message
          const line = typeof issue === 'string' ? issueLine(source, issue) : issue.line
          return createElement('li', { key: i }, line === undefined || line < 1 ? text : `${copy.line(line)}: ${text}`)
        }))),
      createElement('div', { 'data-dsh-figure-bar': '' }, toggle),
      showSource ? code : null)
  }
  if (render.kind === 'pending') {
    return createElement('figure', { 'data-dsh-figure': lang, 'data-state': 'pending' },
      createElement('div', { 'data-dsh-figure-pending': '', role: 'status' }, copy.drawing))
  }
  return createElement('figure', { 'data-dsh-figure': lang, 'data-state': live ? 'drawing' : 'ready', 'aria-busy': live || undefined },
    createElement('div', { 'data-dsh-figure-scroll': '' }, render.node),
    createElement('div', { 'data-dsh-figure-bar': '' }, toggle),
    showSource ? code : null)
})
