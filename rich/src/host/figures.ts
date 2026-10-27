/**
 * Figure files for inline answers (VIS-03).
 *
 * DSH 0.2.1-rc.3 Markdown shows `![alt](<absolute path>)` as an image at that
 * position of the answer, read through its authenticated /api/file route. A
 * figure tool therefore writes its static image here and hands the model one
 * Markdown line to place in its answer. Files are content-addressed per session
 * and never overwritten, so a line that was already shown keeps its picture.
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

/** One written figure and the line that embeds it. */
export interface FigureRef {
  readonly path: string
  readonly markdown: string
}

/** Result of a write: the figure, or why it is unavailable (the card still renders). */
export type FigureWrite = { readonly ok: true; readonly figure: FigureRef } | { readonly ok: false; readonly reason: string }

export interface FigureStore {
  /** Absolute figure directory; a persisted line is replayed only for a file below it. */
  readonly root: string
  write(sessionId: string | undefined, bytes: string | Uint8Array, extension: 'svg' | 'png' | 'jpg' | 'gif' | 'webp', alt: string): FigureWrite
}

/** Same home as the DSH launcher: a non-blank $DSH_HOME, otherwise ~/.dsh. */
export function defaultFiguresDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['DSH_HOME']?.trim()
  return join(configured !== undefined && configured.length > 0 ? configured : join(homedir(), '.dsh'), 'rich-response', 'figures')
}

/**
 * Alt text without the characters that would end the Markdown image syntax or start
 * inline markup across it (a backtick would open a code span that swallows the path).
 */
export function figureAlt(text: string): string {
  const flat = text.replace(/[[\]()\\`<>*_!\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return (chars.length > 80 ? `${chars.slice(0, 79).join('')}…` : flat) || 'figure'
}

/** Absolute path as a Markdown destination: forward slashes, everything outside a safe set percent-encoded. */
export function markdownPath(path: string): string {
  // encodeURIComponent leaves ( ) ! ' * as they are; a parenthesis would end the Markdown destination.
  return [...path.replace(/\\/g, '/')].map(ch => /[A-Za-z0-9._~/:-]/.test(ch)
    ? ch
    : encodeURIComponent(ch).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('')
}

function session(sessionId: string | undefined): string {
  const safe = (sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return safe.length > 0 ? safe : 'unscoped'
}

/**
 * Create the store. `dir` must be absolute; nothing is created until the first write.
 * @param dir - operator-configured figure directory.
 */
export function createFigureStore(dir: string): FigureStore {
  const root = resolve(dir)
  return {
    root,
    write(sessionId, bytes, extension, alt) {
      let temporary: string | undefined
      try {
        if (!isAbsolute(dir)) return { ok: false, reason: 'figure directory is not absolute' }
        const folder = join(root, session(sessionId))
        mkdirSync(folder, { recursive: true })
        if (lstatSync(root).isSymbolicLink() || lstatSync(folder).isSymbolicLink()) return { ok: false, reason: 'figure directory is a symbolic link' }
        const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
        const path = join(folder, `fig-${digest}.${extension}`)
        // Built before any write, so a path the line cannot encode leaves no orphan file.
        const markdown = `![${figureAlt(alt)}](${markdownPath(path)})`
        // Content-addressed: an existing file already holds these bytes and may be open for display.
        if (!existsSync(path)) {
          // Exclusive write-then-rename: never follows a planted file, never shows a half-written one.
          temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
          writeFileSync(temporary, bytes, { flag: 'wx' })
          renameSync(temporary, path)
          temporary = undefined
        }
        return { ok: true, figure: { path, markdown } }
      } catch (error) {
        if (temporary !== undefined) try { unlinkSync(temporary) } catch { /* already gone */ }
        return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : 'write failed' }
      }
    },
  }
}

/** Persisted figure fields of a figure tool's value. */
export interface FigureFields {
  readonly figure?: FigureRef
  readonly figureUnavailable?: string
}

/** Tool construction option shared by the figure tools; without a store no file is written. */
export interface FigureToolOptions {
  readonly figures?: FigureStore
}

/** Output-schema properties of {@link FigureFields}. */
export const FIGURE_OUTPUT_PROPERTIES: Record<string, unknown> = {
  figure: { type: 'object', properties: { path: { type: 'string' }, markdown: { type: 'string' } }, required: ['path', 'markdown'], additionalProperties: false },
  figureUnavailable: { type: 'string' },
}

/** Description sentence of every tool that returns a figure line. */
export const FIGURE_TOOL_NOTE = ' The result contains one Markdown image line for the drawn figure: copy it onto its own line in your answer where the figure belongs, '
  + 'so the learner sees the figure next to the text that discusses it.'

/** Session folder key: in DSH 0.2.1-rc.3 the calling Agent's id is its session id. */
export function figureSession(exec: { readonly agent?: unknown }): string | undefined {
  const id = (exec.agent as { id?: unknown } | undefined)?.id
  return typeof id === 'string' ? id : undefined
}

/** Write one figure when a store is configured and turn the outcome into persisted fields. */
export function writeFigure(store: FigureStore | undefined, exec: { readonly agent?: unknown }, bytes: string | Uint8Array | undefined,
  extension: 'svg' | 'png' | 'jpg' | 'gif' | 'webp', alt: string): FigureFields {
  if (store === undefined || bytes === undefined) return {}
  const result = store.write(figureSession(exec), bytes, extension, alt)
  return result.ok ? { figure: result.figure } : { figureUnavailable: result.reason }
}

/**
 * Model-facing text appended to a figure tool's summary, read from the persisted
 * value so a replayed result says the same as the original one.
 */
export function figureInstruction(value: unknown, store: FigureStore | undefined): string {
  const record = value as FigureFields | null
  const markdown = record?.figure?.markdown, path = record?.figure?.path
  // Replay only a line this store would write for that file: rebuilt from a path below the root.
  const alt = typeof markdown === 'string' ? /^!\[([^\]\n]*)\]\(/.exec(markdown)?.[1] : undefined
  const line = store !== undefined && alt !== undefined && typeof path === 'string' && isAbsolute(path) && resolve(path).startsWith(store.root + sep)
    ? `![${figureAlt(alt)}](${markdownPath(resolve(path))})`
    : undefined
  if (line !== undefined && line === markdown) {
    return `\nTo show this figure inside your answer, put this line on its own line where the figure belongs (copy it exactly; do not write SVG or image data yourself):\n${markdown}`
  }
  return typeof record?.figureUnavailable === 'string'
    ? `\nThe inline figure file is unavailable (${record.figureUnavailable.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').slice(0, 200)}); the learner sees the figure only in the tool record.`
    : ''
}
