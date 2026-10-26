/**
 * `tool.call.toolview` component for the `rich_render` tool.
 *
 * Lifecycle handled here (verified against 0.2.1-rc.2 slot contract):
 *   preparing - arguments still streaming: bounded "preparing" state;
 *   start     - complete `argsRaw` arrives before execution settles: live preview;
 *   result    - durable `meta` envelope is the ONLY source of the visual, so a
 *               reload / history replay rebuilds the exact same static card.
 *
 * Failure, interruption, unsupported versions, and malformed payloads all
 * degrade to an explicit, bounded card instead of throwing into the transcript.
 * Source file text is ASCII-only on purpose: it survives any toolchain.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatValidationIssues,
  readRichMeta,
  readSchemaVersion,
  validateRichContent,
  type RichContentV1,
} from '../shared/index'
import type { ClientContext, ContentBlockLike, ToolResultBlock, ToolViewProps } from './contract'
import { submitInteraction, type InteractionOutcome } from './interactions'
import { RichContentView } from './renderers/index'
import type { RendererTheme } from './renderers/types'

const SERIES_COLORS = ['#d94f2b', '#247bbf', '#1a7f37', '#8e44ad', '#c98a00', '#0f766e', '#b0355b', '#475569']

function themeOf(): RendererTheme {
  return {
    text: 'var(--dsw-color-text-primary, #1b1f24)',
    muted: 'var(--dsw-color-text-secondary, #6b7280)',
    border: 'var(--dsw-color-border, #d9dee7)',
    surface: 'var(--dsw-color-bg-secondary, #f6f7f9)',
    accent: '#247bbf',
    series: SERIES_COLORS,
  }
}

type Stage =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'preview'; readonly content: RichContentV1 }
  | { readonly kind: 'ready'; readonly content: RichContentV1 }
  | { readonly kind: 'error'; readonly text: string; readonly code: string }
  | { readonly kind: 'unsupported'; readonly version: number | undefined; readonly raw: string }
  | { readonly kind: 'unsupported-envelope'; readonly version: number | undefined; readonly raw: string }
  | { readonly kind: 'invalid'; readonly text: string }
  | { readonly kind: 'missing' }

function textOf(content: readonly ContentBlockLike[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
    .trim()
}

function candidateFromArgs(raw: string | undefined): { ok: true; content: RichContentV1 } | { ok: false; text: string } {
  if (raw === undefined || raw.trim().length === 0) return { ok: false, text: 'arguments not available yet' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, text: 'arguments are not valid JSON yet' }
  }
  const candidate = (parsed as { content?: unknown } | null)?.content
  const result = validateRichContent(candidate)
  if (result.ok) return { ok: true, content: result.value }
  return { ok: false, text: formatValidationIssues(result.issues) }
}

function stageOf(props: ToolViewProps, previewArgs: boolean): Stage {
  if (props.phase === 'preparing') return { kind: 'preparing' }
  if (props.phase === 'start') {
    if (!previewArgs) return { kind: 'preparing' }
    const candidate = candidateFromArgs((props.block as { argsRaw?: string }).argsRaw)
    return candidate.ok ? { kind: 'preview', content: candidate.content } : { kind: 'preparing' }
  }
  const block = props.block as ToolResultBlock
  if (block.isError === true) {
    const detail = textOf(block.content)
    const reason = block.error?.reason
    const code = block.error?.code ?? 'TOOL_ERROR'
    return {
      kind: 'error',
      code,
      text: [detail, reason === undefined ? '' : `(${reason})`, block.error?.name ?? ''].filter(Boolean).join(' ').slice(0, 600),
    }
  }
  const meta = block.meta
  if (meta !== null && typeof meta === 'object') {
    const record = meta as Record<string, unknown>
    if (record['kind'] === 'rich-response') {
      const raw = JSON.stringify(record).slice(0, 4000)
      // The envelope reader is the single authority: it checks the envelope
      // version AND re-validates the content. Rendering never bypasses it.
      const envelope = readRichMeta(meta)
      if (envelope !== undefined) return { kind: 'ready', content: envelope.content }
      const content = record['content']
      const schemaVersion = readSchemaVersion(content)
      if (schemaVersion !== undefined && schemaVersion !== 1) {
        return { kind: 'unsupported', version: schemaVersion, raw }
      }
      const envelopeVersion = typeof record['envelopeVersion'] === 'number'
        ? record['envelopeVersion']
        : undefined
      if (record['envelopeVersion'] !== 1) {
        return { kind: 'unsupported-envelope', version: envelopeVersion, raw }
      }
      const validated = validateRichContent(content)
      return { kind: 'invalid', text: formatValidationIssues(validated.ok ? [] : validated.issues) }
    }
  }
  return { kind: 'missing' }
}

function Frame(props: {
  readonly phase: string
  readonly callId: string
  readonly sessionId: string
  readonly status: string
  readonly title: string
  readonly badge: string
  readonly children: React.ReactNode
}) {
  const shortCall = props.callId.length > 18 ? props.callId.slice(0, 18) + '...' : props.callId
  return (
    <section
      data-dsh-rich="tool-card"
      data-dsh-rich-phase={props.phase}
      data-dsh-rich-status={props.status}
      data-dsh-rich-call-id={props.callId}
      data-dsh-rich-session={props.sessionId}
      style={{
        border: '1px solid var(--dsw-color-border, #d9dee7)',
        borderRadius: '10px',
        padding: '10px 12px',
        margin: '6px 0',
        background: 'var(--dsw-color-bg-primary, #ffffff)',
        color: 'var(--dsw-color-text-primary, #1b1f24)',
        font: '13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif',
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <strong style={{ fontSize: '13px' }}>{props.title}</strong>
        <span style={{ opacity: 0.65, fontSize: '12px' }}>{props.badge}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.45, fontSize: '11px' }} title={props.callId}>{shortCall}</span>
      </header>
      {props.children}
    </section>
  )
}

function Note(props: { readonly tone?: 'error' | 'muted'; readonly children: React.ReactNode }) {
  const color = props.tone === 'error' ? '#c62828' : 'var(--dsw-color-text-secondary, #6b7280)'
  return <div style={{ color, fontSize: '12px', padding: '4px 0' }}>{props.children}</div>
}

interface ActionState {
  readonly status: 'idle' | 'busy' | 'settled' | 'error'
  readonly actionId?: string
  readonly outcome?: InteractionOutcome
}

/** The registered Tool view. One instance per tool call in the transcript. */
export function createToolView(ctx: ClientContext, options: { readonly previewArgs?: boolean } = {}) {
  // Tools whose arguments are not RichContentV1 (rich_mermaid) render from the persisted result only.
  const previewArgs = options.previewArgs !== false
  return function RichRenderToolView(props: ToolViewProps) {
    const stage = stageOf(props, previewArgs)
    const theme = useMemo(themeOf, [])
    const [action, setAction] = useState<ActionState>({ status: 'idle' })
    const mounted = useRef(true)
    const requestSeq = useRef(0)
    useEffect(() => () => { mounted.current = false }, [])

    const content = stage.kind === 'ready' ? stage.content : stage.kind === 'preview' ? stage.content : undefined
    const questionId = content?.type === 'message_card' ? content.questionId : undefined

    const runAction = (actionId: string): void => {
      if (action.status === 'busy' || action.status === 'settled') return
      if (content === undefined) return
      const chosen = content.type === 'message_card'
        ? content.actions?.find(candidate => candidate.id === actionId)
        : undefined
      if (chosen === undefined) return
      const seq = requestSeq.current + 1
      requestSeq.current = seq
      setAction({ status: 'busy', actionId })
      void submitInteraction({
        ctx,
        sessionId: props.sessionId,
        callId: props.callId,
        ...questionId === undefined ? {} : { questionId },
        actionId: chosen.id,
        answer: chosen.submitText,
        inputActions: props.inputActions,
        submitText: chosen.submitText,
      }).then(outcome => {
        // Late callbacks from a superseded click never overwrite newer state.
        if (!mounted.current || requestSeq.current !== seq) return
        setAction(outcome.ok
          ? { status: 'settled', actionId, outcome }
          : { status: 'error', actionId, outcome })
      })
    }

    const busy = action.status === 'busy'
    const settledActionId = action.status === 'settled' ? action.actionId : undefined
    const feedback = action.outcome === undefined
      ? undefined
      : action.status === 'settled'
        ? action.outcome.text
          + (action.outcome.followUpQueued ? ' | follow-up queued in this session' : '')
          + (action.outcome.duplicate ? ' | duplicate attempt observed by host' : '')
        : action.outcome.text

    const badge = content === undefined ? props.phase : content.type + ' | v1'
    const status = stage.kind === 'ready'
      ? (action.status === 'error' ? 'action-error' : action.status === 'settled' ? 'interacted' : 'ok')
      : stage.kind

    return (
      <Frame phase={props.phase} callId={props.callId} sessionId={props.sessionId} status={status} title="Rich response" badge={badge}>
        {stage.kind === 'preparing' ? <Note>preparing rich content...</Note> : null}
        {stage.kind === 'preview' ? <Note>running - live preview from validated arguments</Note> : null}
        {stage.kind === 'error' ? (
          <div data-dsh-rich="error-state" role="alert">
            <Note tone="error">tool call failed ({stage.code})</Note>
            <div style={{ fontSize: '12px', opacity: 0.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{stage.text}</div>
          </div>
        ) : null}
        {stage.kind === 'unsupported' ? (
          <div data-dsh-rich="unsupported-version" role="alert">
            <Note tone="error">unsupported rich content version {String(stage.version ?? 'unknown')}; expected schemaVersion 1.</Note>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '12px' }}>raw payload</summary>
              <pre style={{ maxHeight: '180px', overflow: 'auto', fontSize: '11px' }}>{stage.raw}</pre>
            </details>
          </div>
        ) : null}
        {stage.kind === 'unsupported-envelope' ? (
          <div data-dsh-rich="unsupported-envelope" role="alert">
            <Note tone="error">unsupported rich meta envelope version {String(stage.version ?? 'unknown')}; expected envelopeVersion 1.</Note>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '12px' }}>raw payload</summary>
              <pre style={{ maxHeight: '180px', overflow: 'auto', fontSize: '11px' }}>{stage.raw}</pre>
            </details>
          </div>
        ) : null}
        {stage.kind === 'invalid' ? (
          <div data-dsh-rich="invalid-payload" role="alert">
            <Note tone="error">the persisted rich payload failed validation.</Note>
            <div style={{ fontSize: '12px', opacity: 0.8, wordBreak: 'break-word' }}>{stage.text}</div>
          </div>
        ) : null}
        {stage.kind === 'missing' ? (
          <div data-dsh-rich="missing-payload">
            <Note>this tool result carries no rich payload; showing the tool text only.</Note>
          </div>
        ) : null}
        {content !== undefined ? (
          <RichContentView
            content={content}
            theme={theme}
            onAction={runAction}
            busy={busy}
            feedback={feedback}
            settledActionId={settledActionId}
          />
        ) : null}
        {action.status === 'error' ? (
          <div data-dsh-rich="action-error" style={{ color: '#c62828', fontSize: '12px', marginTop: '4px' }}>{feedback}</div>
        ) : null}
        {action.status === 'settled' ? (
          <div data-dsh-rich="action-ack" style={{ color: '#1a7f37', fontSize: '12px', marginTop: '4px' }}>{feedback}</div>
        ) : null}
      </Frame>
    )
  }
}
