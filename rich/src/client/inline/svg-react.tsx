/**
 * Turn a sanitized SVG tree (`sanitizeSvgTree`) into React elements for inline figures.
 *
 * Only the allowlisted names and validated attributes of the tree reach the DOM; text becomes React
 * string children (escaped by React), never markup. Marker ids and `url(#id)` references get a
 * per-instance prefix so several inline drawings on one page cannot capture each other's markers.
 * No `dangerouslySetInnerHTML` and no `innerHTML` (the build rejects both).
 */
import type { createElement as CreateElement, ReactElement, ReactNode } from 'react'
import type { SanitizeTreeResult, SvgTreeNode } from '../../shared/svg-sanitize'

export interface SvgReactOptions {
  /** Per-instance id prefix (e.g. from React `useId`); normalised to `[A-Za-z][\w-]*`. */
  readonly idPrefix: string
  /** React's createElement, injected so this module stays importable from tests and the client alike. */
  readonly createElement: typeof CreateElement
  /** Extra props for the root `<svg>` (className, role, aria-label, width, height...). */
  readonly rootProps?: Readonly<Record<string, unknown>>
  /** Optional colour remapping hook (theme adaptation); returns the value to use for fill/stroke. */
  readonly paint?: (name: 'fill' | 'stroke', value: string, element: string) => string
}

const MARKER_REF = /^url\(#([A-Za-z][\w-]{0,63})\)$/

/** Normalise an arbitrary string into a safe id prefix. */
export function safeIdPrefix(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return /^[A-Za-z]/.test(cleaned) ? cleaned : 'f' + cleaned
}

/** `stroke-width` -> `strokeWidth`; every allowlisted attribute is a known React SVG prop in this form. */
function propName(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Build the root `<svg>` element.
 * @param tree - an accepted `sanitizeSvgTree` result.
 */
export function svgTreeToReact(tree: Extract<SanitizeTreeResult, { ok: true }>, options: SvgReactOptions): ReactElement {
  const prefix = safeIdPrefix(options.idPrefix)
  const h = options.createElement
  const props = (attrs: ReadonlyMap<string, string>, element: string, key?: number): Record<string, unknown> => {
    const out: Record<string, unknown> = key === undefined ? {} : { key }
    for (const [name, raw] of attrs) {
      let value = raw.trim()
      if (name === 'id' && element === 'marker') value = `${prefix}-${value}`
      else if (name.startsWith('marker-')) { const id = MARKER_REF.exec(value)?.[1]; if (id !== undefined) value = `url(#${prefix}-${id})` }
      else if ((name === 'fill' || name === 'stroke') && options.paint !== undefined) value = options.paint(name, value, element)
      out[propName(name)] = value
    }
    return out
  }
  const node = (child: SvgTreeNode, key: number): ReactNode => {
    if (!('name' in child)) return child.text
    return h(child.name, props(child.attrs, child.name, key), ...child.children.map(node))
  }
  return h('svg', { viewBox: tree.viewBox.join(' '), ...props(tree.rootPaint, 'svg'), ...options.rootProps }, ...tree.children.map(node))
}
