/**
 * Inline renderers for the non-SVG figure fences (plan P5).
 *
 * Every fence goes through the same validators as the corresponding rich_* tool and is drawn by the
 * same React renderer as its tool view, so the body and the tool view cannot disagree:
 *   mermaid / dsh-mermaid -> compileMermaidFlowchart (rich_mermaid subset) -> basic_diagram
 *   dsh-plot             -> RichContentV1 line/scatter plot, or bounded functions via plot-expr
 *   dsh-heatmap          -> validateHeatmap -> Heatmap
 *   dsh-physics          -> physicsArgs ({demo}) -> PhysicsDemoCard
 * Mermaid draws from its complete lines while streaming; the JSON forms wait for the closing fence.
 * Nothing here evaluates model text as code: plot expressions use the plot-expr shunting-yard parser.
 */
import { Component, createElement } from 'react'
import type { ReactNode } from 'react'
import { checkFigure, FIGURE_JSON_LIMIT, mermaidTitle, parseFigureJson } from '../../shared/figure-check'
import type { FigureCheck } from '../../shared/figure-check'
import type { RichContentV1 } from '../../shared/protocol'
import { Heatmap } from '../heatmap-view'
import { PhysicsDemoCard } from '../physics-view'
import { RichContentView } from '../renderers/index'
import { themeOf } from '../toolview'
import type { FigureRender, FigureRenderer, FigureRendererInput } from './figure-fence'

export { FIGURE_JSON_LIMIT, mermaidTitle, parseFigureJson }

/** Keeps a throwing renderer inside its figure (mirrors the tool-view boundary). */
class FigureBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  override render(): ReactNode {
    return this.state.failed ? createElement('div', { role: 'alert', 'data-dsh-figure-error': '' }, 'Figure could not be drawn.') : this.props.children
  }
}
const guarded = (node: ReactNode): ReactNode => createElement(FigureBoundary, null, node)

const richFigure = (content: RichContentV1): FigureRender => ({
  kind: 'figure',
  label: content.title,
  node: guarded(createElement(RichContentView, { content, theme: themeOf(), onAction: () => {} })),
})

/** Draw a successful shared check (the same check rich_check_figure reports to the model). */
function draw(check: Extract<FigureCheck, { ok: true }>, figureKey: string | undefined): FigureRender {
  switch (check.kind) {
    case 'diagram': case 'plot': return richFigure(check.content)
    case 'heatmap': return { kind: 'figure', label: check.content.title, node: guarded(createElement(Heatmap, { content: check.content })) }
    case 'physics': {
      // Slider positions are local view preferences keyed by figure occurrence, never learning evidence.
      const storageKey = 'dsh-rich-physics:inline:v1:' + (figureKey ?? check.demo)
      return { kind: 'figure', label: check.demo, node: guarded(createElement(PhysicsDemoCard, { key: storageKey, demo: check.demo, storageKey })) }
    }
    case 'svg': return { kind: 'code' }
  }
}

function mermaid(defaultTitle: string): FigureRenderer {
  return ({ source, closed, lang }) => {
    if (!closed) {
      // Only complete lines; an unfinished fence is never refused.
      const cut = source.lastIndexOf('\n')
      if (cut < 0) return { kind: 'pending' }
      const partial = checkFigure(lang, source.slice(0, cut), { defaultTitle: mermaidTitle(source) ?? defaultTitle })
      return partial.ok ? draw(partial, undefined) : { kind: 'pending' }
    }
    const result = checkFigure(lang, source, { defaultTitle })
    return result.ok ? draw(result, undefined) : { kind: 'refused', issues: result.issues }
  }
}

/** JSON figures wait for the closing fence, then validate and draw in one step. */
const json: FigureRenderer = ({ source, closed, lang, figureKey }: FigureRendererInput) => {
  if (!closed) return { kind: 'pending' }
  const result = checkFigure(lang, source)
  return result.ok ? draw(result, figureKey) : { kind: 'refused', issues: result.issues }
}

/** 32-bit FNV-1a over UTF-16 code units. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash
}

/** Small memo: a streaming tail re-renders on every chunk with mostly identical inputs. */
function memoized(renderer: FigureRenderer): FigureRenderer {
  const cache = new Map<string, FigureRender>()
  return input => {
    const cut = input.closed ? input.source : input.source.slice(0, Math.max(0, input.source.lastIndexOf('\n')))
    // Key by length and a 32-bit FNV-1a hash: the cache must not retain whole (possibly huge) fence sources.
    const key = JSON.stringify([input.lang, input.closed, input.figureKey ?? '', cut.length, fnv1a(cut)])
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = renderer(input)
    if (cache.size >= 48) cache.delete(cache.keys().next().value as string)
    cache.set(key, value)
    return value
  }
}

export function createFigureRenderers(lang: string | undefined = globalThis.document?.documentElement?.lang): Record<string, FigureRenderer> {
  const flow = memoized(mermaid((lang ?? '').toLowerCase().startsWith('zh') ? '流程图' : 'Flowchart'))
  return {
    'mermaid': flow,
    'dsh-mermaid': flow,
    'dsh-plot': memoized(json),
    'dsh-heatmap': memoized(json),
    'dsh-physics': memoized(json),
  }
}
