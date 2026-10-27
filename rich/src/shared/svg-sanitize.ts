/**
 * Allowlist sanitizer for model-written SVG drawings (`rich_svg`, VIS-03).
 *
 * The source is parsed by a small strict XML tokenizer and the figure is rebuilt
 * from the parsed tree, so no model text reaches the output except validated
 * attribute values and escaped text nodes. Allowed: geometric primitives, text,
 * groups and local arrow markers. Rejected: scripts, styles, foreign content,
 * images and any link, DOCTYPE/entities, event handlers, `url()` paints and
 * references to undefined markers. The result is shown as an <img>, where SVG
 * scripts and external loads are disabled anyway; the allowlist keeps the
 * stored file plain geometry regardless.
 */
import { escapeXml, FIGURE_THEME } from './figure-svg'

/** Presentation meta kind of a `rich_svg` result. */
export const SVG_META_KIND = 'rich-svg'
export const SVG_ENVELOPE_VERSION = 1

/** Durable presentation envelope: the rebuilt figure card, shown by the client as an image. */
export interface SvgEnvelope {
  readonly kind: typeof SVG_META_KIND
  readonly envelopeVersion: typeof SVG_ENVELOPE_VERSION
  readonly title: string
  readonly subtitle?: string
  readonly svg: string
}

export const SVG_LIMITS = { maxSourceChars: 65536, maxElements: 1500, maxDepth: 12, maxTextChars: 8000, maxAbsNumber: 1e6, maxViewBox: 10000 } as const

export type SanitizeResult =
  | { readonly ok: true; readonly viewBox: [number, number, number, number]; readonly inner: string; readonly rootPaint: string; readonly elements: number }
  | { readonly ok: false; readonly issues: readonly string[] }

interface Element { readonly name: string; readonly attrs: Map<string, string>; readonly children: Node[] }
type Node = Element | { readonly text: string }

// Every pattern is unambiguous (no two quantifiers can match the same character), so matching
// stays linear on hostile input; whitespace is the XML set only, never JS `\s`.
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:px)?$/
const LENGTH = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:px|%)?$/
const NUMBER_LIST = /^[\d \t\n\r,.eE+-]*$/
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d \t\n\r,.eE+-]*$/
const TRANSFORM = /^[ \t\n\r]*(?:(?:translate|rotate|scale|matrix|skewX|skewY)[ \t\n\r]*\([-+\d.eE \t\n\r,]*\)[ \t\n\r,]*)+$/
/** XML 1.0 `Char` minus nothing: tab, newline, carriage return and the allowed code point ranges. */
const XML_CHARS = /^[\t\n\r -퟿-�\u{10000}-\u{10ffff}]*$/u
const MAX_SCALAR = 64

/** True when `text` holds only characters XML allows (so it can enter a figure file and a URI). */
export function xmlText(text: string): boolean {
  return XML_CHARS.test(text)
}
const COLOR = /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla)\(\s*[-+\d.%\s,/]*\)|[a-zA-Z]{3,24})$/
const ID = /^[A-Za-z][\w-]{0,63}$/
const MARKER_REF = /^url\(#([A-Za-z][\w-]{0,63})\)$/

type Check = (value: string) => boolean
const finite = (value: string): boolean => Number.isFinite(Number.parseFloat(value)) && Math.abs(Number.parseFloat(value)) <= SVG_LIMITS.maxAbsNumber
const number: Check = v => v.length <= MAX_SCALAR && NUMBER.test(v.trim()) && finite(v)
const length: Check = v => v.length <= MAX_SCALAR && LENGTH.test(v.trim()) && finite(v)
const unit: Check = v => number(v) && Number.parseFloat(v) >= 0 && Number.parseFloat(v) <= 1
const oneOf = (...values: string[]): Check => v => values.includes(v.trim())
const list: Check = v => v.length <= 20000 && NUMBER_LIST.test(v) && v.split(/[ \t\n\r,]+/).filter(Boolean).every(part => part.length <= MAX_SCALAR && finite(part))
const dash: Check = v => v.trim() === 'none' || list(v)
const markerRef = (ids: ReadonlySet<string>): Check => v => v.trim() === 'none' || ids.has(MARKER_REF.exec(v.trim())?.[1] ?? '')

const PAINT: Record<string, Check> = {
  fill: v => COLOR.test(v.trim()), stroke: v => COLOR.test(v.trim()),
  'stroke-width': length, 'stroke-opacity': unit, 'fill-opacity': unit, opacity: unit,
  'stroke-dasharray': dash, 'stroke-dashoffset': number, 'stroke-linecap': oneOf('butt', 'round', 'square'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel'), 'stroke-miterlimit': number, 'fill-rule': oneOf('nonzero', 'evenodd'),
  transform: v => v.length <= 500 && TRANSFORM.test(v),
}
const FONT: Record<string, Check> = {
  'font-size': v => number(v) && Number.parseFloat(v) > 0 && Number.parseFloat(v) <= 200,
  'font-weight': oneOf('normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900'),
  'font-style': oneOf('normal', 'italic'), 'text-anchor': oneOf('start', 'middle', 'end'),
  'dominant-baseline': oneOf('auto', 'middle', 'central', 'hanging', 'alphabetic', 'mathematical', 'text-before-edge', 'text-after-edge'),
}
const MARKERS = ['marker-start', 'marker-mid', 'marker-end']

/** Element-specific attributes beyond paint; marker references are checked separately. */
const ELEMENTS: Record<string, Record<string, Check>> = {
  g: { ...FONT },
  defs: {},
  marker: { id: v => ID.test(v), viewBox: list, markerWidth: number, markerHeight: number, refX: number, refY: number, orient: v => v === 'auto' || v === 'auto-start-reverse' || number(v), markerUnits: oneOf('strokeWidth', 'userSpaceOnUse') },
  line: { x1: length, y1: length, x2: length, y2: length },
  rect: { x: length, y: length, width: length, height: length, rx: length, ry: length },
  circle: { cx: length, cy: length, r: length },
  ellipse: { cx: length, cy: length, rx: length, ry: length },
  polyline: { points: list },
  polygon: { points: list },
  path: { d: v => v.length <= 20000 && PATH_DATA.test(v) },
  text: { x: list, y: list, dx: list, dy: list, ...FONT },
  tspan: { x: list, y: list, dx: list, dy: list, 'baseline-shift': v => oneOf('sub', 'super')(v) || length(v), ...FONT },
  title: {},
  desc: {},
}
const MARKABLE = new Set(['line', 'polyline', 'polygon', 'path'])
const TEXT_PARENTS = new Set(['text', 'tspan', 'title', 'desc'])
/** Root attributes that are dropped (layout belongs to the figure card) rather than rejected. */
const ROOT_IGNORED = new Set(['xmlns', 'width', 'height', 'version', 'font-family', 'preserveAspectRatio', 'role', 'aria-label'])

function decode(text: string, issues: string[]): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z]+);?/g, (all, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
      if (code <= 0x10ffff && XML_CHARS.test(String.fromCodePoint(code))) return String.fromCodePoint(code)
    }
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[entity] !== undefined && all.endsWith(';')) return named[entity]
    issues.push(`entity "${all.slice(0, 12)}" is not allowed`)
    return ''
  })
}

/** Parse the source into one root element; structural problems become issues. */
function parse(source: string, issues: string[]): Element | undefined {
  let index = 0
  const stack: Element[] = []
  let root: Element | undefined
  const skip = (pattern: RegExp): boolean => { pattern.lastIndex = index; const match = pattern.exec(source); if (match === null) return false; index = pattern.lastIndex; return true }
  while (index < source.length && issues.length === 0) {
    if (source.startsWith('<!--', index)) { const end = source.indexOf('-->', index + 4); if (end < 0) { issues.push('unclosed comment'); break } index = end + 3; continue }
    if (source.startsWith('<?', index)) { const end = source.indexOf('?>', index); if (end < 0) { issues.push('unclosed processing instruction'); break } index = end + 2; continue }
    if (source.startsWith('<!', index)) { issues.push(`${source.startsWith('<!DOCTYPE', index) ? 'DOCTYPE' : 'markup declaration or CDATA'} is not allowed`); break }
    if (source.startsWith('</', index)) {
      const match = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(source.slice(index, index + 80))
      const open = stack.pop()
      if (match === null || open === undefined || open.name !== match[1]) { issues.push(`mismatched closing tag near offset ${String(index)}`); break }
      index += match[0].length
      continue
    }
    if (source[index] === '<') {
      const head = /^<([A-Za-z][\w:.-]*)/.exec(source.slice(index, index + 80))
      if (head === null) { issues.push(`invalid tag near offset ${String(index)}`); break }
      index += head[0].length
      const element: Element = { name: head[1] ?? '', attrs: new Map(), children: [] }
      const attribute = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y
      while (skip(/\s*/y), !source.startsWith('>', index) && !source.startsWith('/>', index)) {
        attribute.lastIndex = index - (/\s/.test(source[index - 1] ?? '') ? 1 : 0)
        const match = attribute.exec(source)
        if (match === null) { issues.push(`invalid attribute in <${element.name}>`); return undefined }
        index = attribute.lastIndex
        if (element.attrs.has(match[1] ?? '')) { issues.push(`duplicate attribute "${match[1] ?? ''}"`); return undefined }
        element.attrs.set(match[1] ?? '', decode(match[2] ?? match[3] ?? '', issues))
      }
      const selfClosing = source.startsWith('/>', index)
      index += selfClosing ? 2 : 1
      const parent = stack.at(-1)
      if (parent === undefined) {
        if (root !== undefined) { issues.push('more than one root element'); break }
        root = element
      } else parent.children.push(element)
      if (!selfClosing) stack.push(element)
      continue
    }
    const next = source.indexOf('<', index)
    const raw = source.slice(index, next < 0 ? source.length : next)
    index = next < 0 ? source.length : next
    const parent = stack.at(-1)
    // Whitespace between text runs is content (`<tspan>a</tspan> <tspan>b</tspan>`); elsewhere it is layout.
    if (raw.trim().length === 0) { if (parent !== undefined && TEXT_PARENTS.has(parent.name)) parent.children.push({ text: raw }); continue }
    if (parent === undefined) { issues.push('text outside the root element'); break }
    parent.children.push({ text: decode(raw, issues) })
  }
  if (issues.length === 0 && stack.length > 0) issues.push(`unclosed <${stack.at(-1)?.name ?? ''}>`)
  if (issues.length === 0 && root === undefined) issues.push('no <svg> root element')
  return issues.length === 0 ? root : undefined
}

function attributeString(attrs: Map<string, string>): string {
  return [...attrs].map(([name, value]) => ` ${name}="${escapeXml(value.trim().replace(/^currentColor$/, FIGURE_THEME.text))}"`).join('')
}

/**
 * Validate and rebuild a model-written SVG drawing.
 * @param source - complete SVG text with a `viewBox` on its root.
 */
export function sanitizeSvg(source: string): SanitizeResult {
  const issues: string[] = []
  if (typeof source !== 'string' || source.length === 0) return { ok: false, issues: ['svg must be a non-empty string'] }
  if (source.length > SVG_LIMITS.maxSourceChars) return { ok: false, issues: [`svg exceeds ${String(SVG_LIMITS.maxSourceChars)} characters`] }
  if (!xmlText(source)) return { ok: false, issues: ['svg contains characters that XML does not allow (control characters, U+FFFE/U+FFFF or unpaired surrogates)'] }
  const root = parse(source.trim(), issues)
  if (root === undefined) return { ok: false, issues }
  if (root.name !== 'svg') return { ok: false, issues: [`root must be <svg>, not <${root.name}>`] }
  const parts = (root.attrs.get('viewBox') ?? '').trim().split(/[ \t\n\r,]+/)
  const viewBox = parts.map(Number)
  if (parts.length !== 4 || !parts.every(part => number(part) && Number.isFinite(Number(part))) || (viewBox[2] ?? 0) < 1e-3 || (viewBox[3] ?? 0) < 1e-3
    || (viewBox[2] ?? 0) > SVG_LIMITS.maxViewBox || (viewBox[3] ?? 0) > SVG_LIMITS.maxViewBox) {
    return { ok: false, issues: ['the root <svg> needs viewBox="minX minY width height" with width and height from 0.001 to 10000'] }
  }
  // Marker ids are collected first so references may precede their <defs>.
  const markerIds = new Set<string>()
  const collect = (element: Element): void => {
    if (element.name === 'marker' && ID.test(element.attrs.get('id') ?? '')) markerIds.add(element.attrs.get('id') ?? '')
    for (const child of element.children) if ('name' in child) collect(child)
  }
  collect(root)
  let elements = 0, textChars = 0
  const rootPaint = new Map<string, string>()
  for (const [name, value] of root.attrs) {
    if (name === 'viewBox' || ROOT_IGNORED.has(name) || name.startsWith('xmlns:')) continue
    const check = PAINT[name] ?? FONT[name]
    if (check === undefined) issues.push(`<svg> attribute "${name}" is not allowed`)
    else if (!check(value)) issues.push(`<svg> attribute "${name}" has an invalid value`)
    else rootPaint.set(name, value)
  }
  const build = (element: Element, depth: number, parentName: string): string => {
    elements += 1
    if (depth > SVG_LIMITS.maxDepth) { issues.push(`nesting deeper than ${String(SVG_LIMITS.maxDepth)}`); return '' }
    const allowed = ELEMENTS[element.name]
    if (allowed === undefined || (element.name === 'tspan' && parentName !== 'text' && parentName !== 'tspan')) { issues.push(`<${element.name}> is not allowed`); return '' }
    const attrs = new Map<string, string>()
    for (const [name, value] of element.attrs) {
      const check = allowed[name] ?? (element.name === 'marker' || element.name === 'defs' ? undefined : PAINT[name])
        ?? (MARKABLE.has(element.name) && MARKERS.includes(name) ? markerRef(markerIds) : undefined)
      if (check === undefined) { issues.push(`<${element.name}> attribute "${name}" is not allowed`); continue }
      if (!check(value)) { issues.push(`<${element.name}> attribute "${name}" has an invalid value${MARKERS.includes(name) ? ' (use url(#id) of a defined marker)' : ''}`); continue }
      attrs.set(name, value)
    }
    let body = ''
    for (const child of element.children) {
      if ('name' in child) { body += build(child, depth + 1, element.name); continue }
      if (!TEXT_PARENTS.has(element.name)) { issues.push(`text is not allowed inside <${element.name}>`); continue }
      textChars += child.text.length
      body += escapeXml(child.text)
    }
    return `<${element.name}${attributeString(attrs)}${body.length > 0 ? `>${body}</${element.name}>` : '/>'}`
  }
  const inner = root.children.map(child => 'name' in child ? build(child, 1, 'svg') : (issues.push('text is not allowed inside <svg>'), '')).join('')
  if (elements > SVG_LIMITS.maxElements) issues.push(`more than ${String(SVG_LIMITS.maxElements)} elements`)
  if (textChars > SVG_LIMITS.maxTextChars) issues.push(`more than ${String(SVG_LIMITS.maxTextChars)} text characters`)
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)].slice(0, 8) }
  return { ok: true, viewBox: viewBox as [number, number, number, number], inner, rootPaint: attributeString(rootPaint), elements }
}

/** Longest figure card the client will show (the card adds a frame to a source of at most 64K characters). */
const MAX_CARD_CHARS = 262144

/**
 * Read a persisted `rich-svg` envelope; anything else is undefined.
 * The card is shown only through an <img>, where SVG cannot run script or load resources.
 */
export function readSvgMeta(meta: unknown): SvgEnvelope | undefined {
  const record = meta as Partial<SvgEnvelope> | null
  if (record === null || typeof record !== 'object' || record.kind !== SVG_META_KIND || record.envelopeVersion !== SVG_ENVELOPE_VERSION) return undefined
  if (typeof record.title !== 'string' || typeof record.svg !== 'string' || record.svg.length > MAX_CARD_CHARS) return undefined
  // An unpaired surrogate would make encodeURIComponent throw while the view renders.
  if (!xmlText(record.title) || !xmlText(record.svg)) return undefined
  if (!record.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ') || !record.svg.endsWith('</svg>')) return undefined
  if (record.subtitle !== undefined && typeof record.subtitle !== 'string') return undefined
  return { kind: SVG_META_KIND, envelopeVersion: SVG_ENVELOPE_VERSION, title: record.title, ...record.subtitle === undefined ? {} : { subtitle: record.subtitle }, svg: record.svg }
}
