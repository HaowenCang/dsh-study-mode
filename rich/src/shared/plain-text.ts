/**
 * Plain-text admission shared by the heatmap and image protocols.
 *
 * Learner-visible text and model-facing summaries must stay one visual line in
 * logical order: C0/C1 controls, DEL, line and paragraph separators, and the
 * bidirectional embedding, override, isolate and mark characters are refused
 * (they can forge summary lines, reorder displayed text, or make exported SVG
 * invalid XML). Frozen RichContentV1 keeps its own rules.
 */

const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
const UNSAFE_TEXT_GLOBAL = new RegExp(UNSAFE_TEXT.source, 'g')

/** True when `text` contains none of the refused control or bidirectional-control characters. */
export function isPlainText(text: string): boolean {
  return !UNSAFE_TEXT.test(text)
}

/** `text` with every refused control or bidirectional-control character removed. */
export function stripUnsafeText(text: string): string {
  return text.replace(UNSAFE_TEXT_GLOBAL, '')
}
