/**
 * Theme adaptation of model-written SVG paint (plan P6).
 *
 * Inline figures inherit `color` from the page (`--dsw-alias-label-primary`), so `currentColor`
 * already follows light/dark. Models still often write literal black ink and white backgrounds,
 * which vanish (or glare) on the dark theme. Only those two extremes are mapped:
 *   - near-black fill/stroke (relative luminance < 0.15) -> currentColor;
 *   - near-white fill (luminance > 0.9) of an area shape -> the page base surface token.
 * Every other colour is kept: hues carry meaning. White text or strokes stay white (they normally
 * sit on a coloured shape). The result is a CSS value used only on screen; the allowlist output of
 * rich_svg (data-URI images) is not affected.
 */
const NAMED: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0], white: [255, 255, 255], snow: [255, 250, 250], whitesmoke: [245, 245, 245],
  ghostwhite: [248, 248, 255], ivory: [255, 255, 240], floralwhite: [255, 250, 240], azure: [240, 255, 255],
  mintcream: [245, 255, 250], aliceblue: [240, 248, 255], seashell: [255, 245, 238], linen: [250, 240, 230],
}
const AREA = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path'])
export const SURFACE = 'var(--dsw-alias-bg-base, #ffffff)'

/** sRGB triple of a hex, rgb()/rgba() or named colour; undefined for anything else (hsl, none, …). */
export function parseColor(value: string): readonly [number, number, number] | undefined {
  const v = value.trim().toLowerCase()
  // Own properties only: `constructor` and similar names must not resolve through Object.prototype.
  if (Object.hasOwn(NAMED, v)) return NAMED[v]
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/u.exec(v)?.[1]
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c).join('') : hex.slice(0, 6)
    return [0, 2, 4].map(i => Number.parseInt(full.slice(i, i + 2), 16)) as unknown as readonly [number, number, number]
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/u.exec(v)
  if (rgb !== null) {
    const channel = (s: string): number => s.endsWith('%') ? Math.round(Number.parseFloat(s) * 2.55) : Number.parseFloat(s)
    const out = [channel(rgb[1] ?? ''), channel(rgb[2] ?? ''), channel(rgb[3] ?? '')]
    return out.every(c => Number.isFinite(c) && c >= 0 && c <= 255) ? out as unknown as readonly [number, number, number] : undefined
  }
  return undefined
}

export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function adaptPaint(name: 'fill' | 'stroke', value: string, element: string): string {
  const rgb = parseColor(value)
  if (rgb === undefined) return value
  const l = luminance(rgb)
  if (l < 0.15) return 'currentColor'
  if (name === 'fill' && l > 0.9 && AREA.has(element)) return SURFACE
  return value
}
