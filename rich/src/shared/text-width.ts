/**
 * Approximate display width of model text, shared by the Host-side Mermaid
 * layout and the Client diagram renderer so both budget labels identically.
 * Units are Latin-glyph widths; East Asian wide/fullwidth characters and
 * pictographic emoji (including BMP symbols U+2600-27BF, U+2B00-2BFF, flags,
 * keycaps and emoji-presentation sequences) cost two; wide Latin glyphs are
 * rounded up from sans-serif metrics. Text is measured per grapheme cluster.
 */
const WIDE_CHAR = /[\u1100-\u115F\u2600-\u27BF\u2B00-\u2BFF\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}\uFE0F\u20E3]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u
const LATIN_WIDE = new Map<string, number>([['W', 1.75], ['@', 1.75], ['%', 1.6], ['M', 1.55], ['m', 1.55]])
const LATIN_CAPITAL = /^[A-HK-Zw]$/

let segmenter: Intl.Segmenter | null | undefined

/** Split text into grapheme clusters (code points where Intl.Segmenter is absent). */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl === 'object' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  }
  if (segmenter === null) return Array.from(text)
  return Array.from(segmenter.segment(text), part => part.segment)
}

/** Width of one grapheme cluster in Latin-glyph units. */
export function graphemeWidth(cluster: string): number {
  if (WIDE_CHAR.test(cluster)) return 2
  return LATIN_WIDE.get(cluster) ?? (LATIN_CAPITAL.test(cluster) ? 1.35 : 1)
}

/** Width of a whole string in Latin-glyph units. */
export function displayWidth(text: string): number {
  let total = 0
  for (const cluster of graphemes(text)) total += graphemeWidth(cluster)
  return total
}
