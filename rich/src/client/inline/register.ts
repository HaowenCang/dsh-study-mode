/**
 * Registration of the inline assistant renderer (plan P2).
 *
 * Shadows the ui-chat `conversation.chat.node` / `assistant-step` entry at priority -1 and declares
 * the child Slot `rich.inline.toolcall` (keyed by tool name, session scope) for inline tool-call
 * renderers such as Study cards. The built-in entry's business face (presentation policy, file path
 * resolver, file mentions) is borrowed through the public `slots.entries()` inspection API, so
 * presentation follows the user's settings without re-implementing ui-chat stores.
 *
 * Mode: `localStorage['dsh-rich-inline']` = `on` | `off` | `auto` (default). `auto` requires the DSH
 * 0.2.2 chat contract (the built-in entry's inject face carries `hooks.presentation` and `resolveFilePath`;
 * 0.2.1-rc.5 injects only `hooks.presentation`, P9 rc.5 finding); the check runs
 * at render time, because registration order against ui-chat is not guaranteed, and a miss throws so
 * the slot core retires the shadow and 0.2.1 keeps the tool-view path (INLINE_SPIKE decision 1).
 */
import { useSyncExternalStore } from 'react'
import { createInlineAssistantView, INLINE_TOOLCALL_SLOT } from './assistant-view'
import type { FigureRenderer } from './figure-fence'
import { createFigureRenderers } from './figure-renderers'
import { adaptPaint } from './paint'
import { installInlineStyles } from './styles'
import type { BuiltinFace, PresentationPolicy, Primitives, UsePresentation } from './types'

export type InlineMode = 'on' | 'off' | 'auto'

interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }

interface StoredEntryLike {
  readonly component?: unknown
  readonly options?: { readonly key?: string; readonly priority?: number }
  readonly inject?: (sessionId: string) => unknown
}

/** Slots face subset used here; `entries` is optional so older hosts degrade to the fallback. */
export interface InlineSlotsFace {
  inject(key: string, callback: () => undefined | (() => void)): void
  register(spec: Record<string, unknown>, component: unknown): () => void
  entries?(key: string): readonly StoredEntryLike[]
  /** Registration changes for a key (SlotCore.subscribe, microtask-batched); 0.2.1-rc.5 and 0.2.2 have it. */
  subscribe?(key: string, fn: () => void): () => void
}

export interface InlineContext {
  readonly slots: InlineSlotsFace
  readonly logger: { info(message: string): void; warn(message: string): void }
  get?(name: string): unknown
}

export function readInlineMode(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): InlineMode {
  try {
    const value = storage?.getItem('dsh-rich-inline')
    return value === 'on' || value === 'off' ? value : 'auto'
  } catch { return 'auto' }
}

function safeStorage(): Storage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

const isObservable = (value: unknown): value is Observable<PresentationPolicy> =>
  typeof value === 'object' && value !== null
  && typeof (value as Observable<unknown>).getSnapshot === 'function'
  && typeof (value as Observable<unknown>).subscribe === 'function'

/** Selector hook over one host observable, as ui-slots binds `hooks.*` sources. */
export function observableHook(source: Observable<PresentationPolicy>): UsePresentation {
  return selector => useSyncExternalStore(source.subscribe, () => selector(source.getSnapshot()), () => selector(source.getSnapshot()))
}

/** The built-in assistant-step entry (not ours), or undefined. */
export function findBuiltinEntry(slots: InlineSlotsFace, ours: unknown): StoredEntryLike | undefined {
  if (typeof slots.entries !== 'function') return undefined
  return slots.entries('conversation.chat.node').find(e => e.options?.key === 'assistant-step' && e.component !== ours && typeof e.inject === 'function')
}

/** Turn the built-in entry's inject result into the face the inline view reads. */
export function faceFromInjected(injected: unknown): BuiltinFace | undefined {
  if (typeof injected !== 'object' || injected === null) return undefined
  const raw = injected as { hooks?: { presentation?: unknown }; resolveFilePath?: unknown; fileMentions?: unknown }
  const presentation = raw.hooks?.presentation
  return {
    ...isObservable(presentation) ? { usePresentation: observableHook(presentation) } : {},
    ...typeof raw.resolveFilePath === 'function' ? { resolveFilePath: raw.resolveFilePath as (path: string) => string } : {},
    ...typeof raw.fileMentions === 'function' ? { fileMentions: raw.fileMentions as NonNullable<BuiltinFace['fileMentions']> } : {},
  }
}

export interface RegisterInlineOptions {
  readonly primitives: Primitives
  readonly renderers?: Readonly<Record<string, FigureRenderer>>
  readonly mode?: InlineMode
}

/**
 * Register the shadow inside `slots.inject('conversation.chat.node')` so it follows the slot's
 * lifecycle. Returns whether registration was attempted.
 */
export function registerInlineAssistant(ctx: InlineContext, options: RegisterInlineOptions): boolean {
  const mode = options.mode ?? readInlineMode()
  if (mode === 'off') {
    ctx.logger.info('rich-response: inline renderer off (dsh-rich-inline=off)')
    return false
  }
  const faces = new Map<string, BuiltinFace>()
  // eslint-disable-next-line prefer-const -- referenced by the face lookup before assignment completes
  let View: unknown
  View = createInlineAssistantView({
    primitives: options.primitives,
    requireBuiltinFace: mode === 'auto',
    renderers: options.renderers ?? createFigureRenderers(),
    paint: adaptPaint,
    builtinFace: (sessionId) => {
      const cached = faces.get(sessionId)
      if (cached !== undefined) return cached
      let face: BuiltinFace | undefined
      try { face = faceFromInjected(findBuiltinEntry(ctx.slots, View)?.inject?.(sessionId)) } catch { face = undefined }
      if (face?.usePresentation === undefined) face = undefined
      // `auto` needs the DSH 0.2.2 face: 0.2.1-rc.5 also injects hooks.presentation, but only 0.2.2 adds
      // resolveFilePath (and fileMentions). Without it auto retires, keeping 0.2.1 on the built-in renderer.
      if (mode === 'auto' && face?.resolveFilePath === undefined) face = undefined
      if (face !== undefined && face.fileMentions === undefined) {
        const mentions = ctx.get?.('chatFileMentions') as { forClosing?: (owner: unknown, sessionId: string, trigger: unknown) => unknown } | undefined
        if (typeof mentions?.forClosing === 'function') face = { ...face, fileMentions: (owner, trigger) => mentions.forClosing?.(owner, sessionId, trigger) }
      }
      if (face === undefined) return undefined
      if (faces.size > 64) faces.clear()
      faces.set(sessionId, face)
      return face
    },
  })
  ctx.slots.inject('conversation.chat.node', () => {
    let disposeShadow: (() => void) | undefined
    const mount = (): void => {
      if (disposeShadow !== undefined) return
      disposeShadow = () => {} // guards re-entry from a registration notification
      const disposeStyles = installInlineStyles()
      const dispose = ctx.slots.register({
        name: 'conversation.chat.node', key: 'assistant-step', priority: -1, locale: 'chat',
        children: { [INLINE_TOOLCALL_SLOT]: { kind: 'keyed', scope: 'session' } },
      }, View)
      ctx.logger.info(`rich-response: inline renderer registered (mode=${mode})`)
      disposeShadow = () => { dispose(); disposeStyles(); faces.clear() }
    }
    let unsubscribe: (() => void) | undefined
    // auto decides before registering (P9 rc.5 finding): on 0.2.1 the shadow is never registered, so the
    // built-in renderer runs without a retire-by-throw (which logs two console errors per page).
    const decide = (): boolean => {
      const contract = builtinContract(ctx.slots, View)
      if (contract === undefined) return false
      if (contract === '0.2.2') mount()
      else ctx.logger.info('rich-response: inline renderer off (auto: built-in chat contract older than DSH 0.2.2)')
      return true
    }
    // Without an inspection or subscription surface: register and rely on the render-time guard.
    if (mode === 'on' || typeof ctx.slots.entries !== 'function') mount()
    else if (!decide()) {
      if (typeof ctx.slots.subscribe !== 'function') mount()
      else unsubscribe = ctx.slots.subscribe('conversation.chat.node', () => {
        if (decide()) { unsubscribe?.(); unsubscribe = undefined }
      })
    }
    return () => { unsubscribe?.(); unsubscribe = undefined; disposeShadow?.(); disposeShadow = undefined }
  })
  return true
}

/**
 * Which chat contract the built-in assistant-step entry exposes: `0.2.2` (inject face with
 * `hooks.presentation` and `resolveFilePath`), `older` (0.2.1-rc.5 injects `hooks.presentation` only),
 * or undefined while ui-chat has not registered it. Calling `inject` only builds lazy closures.
 */
export function builtinContract(slots: InlineSlotsFace, ours: unknown): '0.2.2' | 'older' | undefined {
  const entry = findBuiltinEntry(slots, ours)
  if (entry === undefined) return undefined
  let face: BuiltinFace | undefined
  try { face = faceFromInjected(entry.inject?.('')) } catch { return 'older' }
  return face?.usePresentation !== undefined && face.resolveFilePath !== undefined ? '0.2.2' : 'older'
}
