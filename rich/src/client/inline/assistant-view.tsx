/**
 * Inline assistant renderer (plan P2): shadows `conversation.chat.node` / `assistant-step`.
 *
 * Mirrors ui-chat `AssistantNodeView` + `AssistantMarkdown` (dsh-v0.2.2-rc.1 = master fcc0ad4621),
 * borrowing the shadowed built-in entry's injected business face (presentation policy, file path
 * resolver, file mentions) so presentation does not drift. Differences from the built-in:
 *   - top-level figure fences in text blocks render as figures (`FigureFence`);
 *   - tool-call blocks dispatch to the child Slot `rich.inline.toolcall` keyed by tool name (Study
 *     cards register there); calls whose own step is not visible (tool-only steps, or "Final answer
 *     only" while the turn is folded) are relocated to the next visible text step (P0 S3/S3b);
 *   - image blocks load through `loadImage` (the built-in images child Slot is not reachable).
 */
import { createElement, Fragment, memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { linkDefinitions, splitFences } from '../../shared/fence-split'
import { assertInlineContract, InlineContractError } from './contract-guard'
import { FigureFence, figureCopy } from './figure-fence'
import type { FigureRenderer } from './figure-fence'
import { InlineReasoningRow } from './reasoning-row'
import type { AssistantBlock, AssistantData, BuiltinFace, InlineNodeProps, InlineToolCallOwner, MarkdownLabels, PresentationPolicy, Primitives, UsePresentation } from './types'

export const INLINE_TOOLCALL_SLOT = 'rich.inline.toolcall'

/** ui-util-workspace-path `fileMediaUrl` (dsh-v0.2.2-rc.1 8656e1c23d = master). */
export function fileMediaUrl(base: string, path: string): string | undefined {
  const absolute = path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
  if ((!/^https?:/u.test(base) && !base.startsWith('dsh-app://app/')) || !absolute
    || /^[/\\]{2}/u.test(path) || /[\u0000-\u001f\u007f]/u.test(path)) return undefined
  return new URL(`api/file?path=${encodeURIComponent(path)}`, base).href
}

/** ui-chat `localPathMediaUrl`: authored Markdown image destination -> file API URL. */
export function localPathMediaUrl(base: string, value: string): string | undefined {
  let path: string
  try { path = decodeURIComponent(value.split(/[?#]/u)[0] ?? '') } catch { return undefined }
  return fileMediaUrl(base, path)
}

export function markdownLabels(t: (key: string) => string): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap') } },
    footnotes: t('markdown.footnotes'),
  }
}

const DEFAULT_POLICY: PresentationPolicy = { foldedReplies: 'all', settledReasoningPreview: true }
const fallbackUsePresentation: UsePresentation = selector => selector(DEFAULT_POLICY)

const hasText = (blocks: readonly AssistantBlock[]): boolean => blocks.some(b => b.kind === 'text' && b.text.trim() !== '')

interface StepView { readonly step: number; readonly blocks: readonly AssistantBlock[] }

/** Assistant steps of the node's turn, oldest first; empty when the location shape is unknown. */
function turnSteps(node: InlineNodeProps['node']): StepView[] {
  const turn = node.location?.turn as { steps?: ReadonlyArray<{ data?: { get?: (key: string) => unknown } }> } | undefined
  if (!Array.isArray(turn?.steps)) return []
  const out: StepView[] = []
  for (const entry of turn.steps) {
    const data = typeof entry?.data?.get === 'function' ? entry.data.get('assistant-step') as AssistantData | undefined : undefined
    if (data !== undefined && Array.isArray(data.blocks) && typeof data.step === 'number') out.push({ step: data.step, blocks: data.blocks })
  }
  return out.sort((a, b) => a.step - b.step)
}

/**
 * Which tool calls this step renders, and which earlier calls it adopts.
 * A step hosts its own calls when it has visible text and is not folded away; otherwise the next
 * hosting step adopts them. `finalOnlyFolded` means only the answer step is visible.
 */
export function placeToolCalls(current: StepView, steps: readonly StepView[], finalOnlyFolded: boolean, answerStep: number | null): { own: boolean; adopted: Array<{ step: number; block: Extract<AssistantBlock, { kind: 'tool-call' }> }> } {
  const hosts = (s: StepView): boolean => hasText(s.blocks) && !(finalOnlyFolded && answerStep !== null && s.step !== answerStep)
  const own = hosts(current)
  const adopted: Array<{ step: number; block: Extract<AssistantBlock, { kind: 'tool-call' }> }> = []
  if (!own) return { own, adopted }
  const earlier = steps.filter(s => s.step < current.step)
  for (let i = earlier.length - 1; i >= 0; i--) {
    const s = earlier[i] as StepView
    if (hosts(s)) break
    for (const b of s.blocks) if (b.kind === 'tool-call') adopted.unshift({ step: s.step, block: b })
  }
  return { own, adopted }
}

/** One assistant image block through the session-authorized loader. */
const AssistantImage = memo(function AssistantImage({ attachment, loadImage }: { attachment: unknown; loadImage: unknown }) {
  const [src, setSrc] = useState<string | undefined>(() => {
    const peek = (loadImage as { peek?: (a: unknown) => string | undefined } | undefined)?.peek
    return typeof peek === 'function' ? peek(attachment) : undefined
  })
  useEffect(() => {
    if (src !== undefined || typeof loadImage !== 'function') return
    let live = true
    void (loadImage as (a: unknown) => Promise<string>)(attachment).then(url => { if (live && typeof url === 'string') setSrc(url) }, () => {})
    return () => { live = false }
  }, [attachment, loadImage, src])
  return src === undefined ? null : createElement('img', { src, alt: '', 'data-dsh-inline-image': '', style: { maxWidth: 'min(100%, 640px)', borderRadius: 'var(--dsw-radius-lg, 12px)' } })
})

function ProcessReasoning({ hidden, reveal, useGroupAction, children }: { hidden: boolean; reveal: () => void; useGroupAction: InlineNodeProps['useGroupAction']; children?: ReactNode }): ReactElement {
  const ref = useGroupAction(hidden, reveal)
  return createElement('div', { ref, 'data-turn-process-inline': hidden || undefined }, children)
}

export interface InlineAssistantDeps {
  readonly primitives: Primitives
  /** Business face of the shadowed built-in entry for this session (undefined when unavailable). */
  readonly builtinFace: (sessionId: string) => BuiltinFace | undefined
  /** Throw (retiring the shadow) when the built-in face is unavailable: `auto` mode on 0.2.1. */
  readonly requireBuiltinFace?: boolean
  readonly renderers?: Readonly<Record<string, FigureRenderer>>
  readonly paint?: (name: 'fill' | 'stroke', value: string, element: string) => string
}

export function createInlineAssistantView(deps: InlineAssistantDeps) {
  const P = deps.primitives
  return memo(function InlineAssistantView(raw: unknown): ReactElement | null {
    assertInlineContract(raw)
    const props = raw
    const { node, groupPart, sessionId, t } = props
    const data = node.data
    const face = useMemo(() => deps.builtinFace(sessionId), [sessionId])
    if (face === undefined && deps.requireBuiltinFace === true) throw new InlineContractError(['built-in assistant-step face (hooks.presentation)'])
    const usePresentation = face?.usePresentation ?? fallbackUsePresentation
    const labels = useMemo(() => markdownLabels(t), [t])
    const copy = useMemo(() => figureCopy(), [])
    const pathImages = useMemo(() => ({ resolve: (value: string) => localPathMediaUrl(document.baseURI, value) }), [])

    // File mentions of the closing turn, as the built-in AssistantNodeView computes them.
    const contextMenu = props.useContextMenu?.()
    const resolveFilePath = face?.resolveFilePath
    const getFileTriggerProps = useCallback((path: string) => contextMenu?.getTriggerProps(() => ({
      kind: 'file', value: { sessionId, path: resolveFilePath === undefined ? path : resolveFilePath(path) },
    })), [contextMenu, sessionId, resolveFilePath])
    const turn = node.location?.kind === 'turn' || node.location?.kind === 'step' ? node.location.turn as { status?: string } | undefined : undefined
    const tail = props.useTurnData?.('turn-tail') as { closing?: { finalNode?: { seq?: number } } } | undefined
    const owner = useMemo(() => {
      if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
      if (tail?.closing?.finalNode?.seq !== data.finalNode.seq) return undefined
      return { turn, seq: data.finalNode.seq, openFile: props.openFile }
    }, [data.finalNode, props.openFile, tail, turn])
    const mentions = useMemo(
      () => owner === undefined || face?.fileMentions === undefined ? undefined : face.fileMentions(owner, getFileTriggerProps),
      [face, owner, getFileTriggerProps],
    )

    const keepReplies = usePresentation(policy => policy.foldedReplies === 'all')
    const finalOnly = usePresentation(policy => policy.foldedReplies === 'final')
    const tp = props.turnProcess
    const reasoningHidden = tp !== undefined && tp.foldable
      && (keepReplies ? groupPart !== 'reasoning' : tp.spec.answerStep === data.step && tp.spec.inlineReasoning)
      && !tp.open
    const revealProcess = useCallback(() => { tp?.setOpen(true) }, [tp])

    const streaming = data.status === 'running'
    const interrupted = data.status === 'interrupted'
    const textInteractionSource = data.status === 'settled' && data.finalNode?.messageId !== undefined
    const blocks = data.blocks
    const placement = placeToolCalls({ step: data.step, blocks }, turnSteps(node), finalOnly && tp !== undefined && tp.foldable && !tp.open, tp?.spec.answerStep ?? null)

    const toolCall = (block: Extract<AssistantBlock, { kind: 'tool-call' }>, step: number, relocated: boolean, key: string): ReactNode => {
      if (props.renderSlot === undefined) return null
      const ownerProps: InlineToolCallOwner = { callId: block.callId, toolName: block.name, argsRaw: block.argsRaw, sessionId, step, relocated, settled: relocated || !streaming, turnOpen: turn?.status === 'open' }
      return createElement(Fragment, { key }, props.renderSlot(INLINE_TOOLCALL_SLOT, { ...ownerProps }, { entryKey: block.name, fallback: null }))
    }

    const lastText = blocks.reduce((last, b, i) => b.kind === 'text' ? i : last, -1)
    const rendered: ReactNode[] = []
    if (groupPart !== 'reasoning') for (const { step, block } of placement.adopted) rendered.push(toolCall(block, step, true, `adopt:${block.callId}`))
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as AssistantBlock
      if (groupPart === 'reasoning' && block.kind !== 'reasoning') continue
      if (groupPart === 'response' && block.kind === 'reasoning') continue
      switch (block.kind) {
        case 'text': {
          const segments = splitFences(block.text)
          const defs = segments.length > 1 ? linkDefinitions(block.text) : []
          const suffix = defs.length > 0 ? '\n\n' + defs.join('\n') + '\n' : ''
          segments.forEach((segment, s) => {
            const tailSegment = streaming && i === lastText && s === segments.length - 1
            if (segment.kind === 'md') {
              if (segment.text.trim() === '' && segments.length > 1) return
              rendered.push(createElement(P.MarkdownText, {
                key: `${String(i)}:${String(segment.offset)}`, text: segment.text + suffix, streaming: tailSegment, labels,
                fileMentions: mentions, pathImages, textInteractionSource,
              }))
            } else {
              rendered.push(createElement(FigureFence, {
                key: `${String(i)}:${String(segment.offset)}:fig`, lang: segment.lang, source: segment.source, closed: segment.closed,
                streaming: tailSegment, primitives: P, labels, copy, figureKey: `${sessionId}:${String(data.step)}:${String(i)}:${String(segment.offset)}`,
                ...deps.renderers === undefined ? {} : { renderers: deps.renderers },
                ...deps.paint === undefined ? {} : { paint: deps.paint },
              }))
            }
          })
          break
        }
        case 'reasoning':
          if (block.text.trim() === '') break
          rendered.push(createElement(ProcessReasoning, { key: i, hidden: reasoningHidden, reveal: revealProcess, useGroupAction: props.useGroupAction },
            createElement(InlineReasoningRow, {
              text: block.text, running: streaming && i === blocks.length - 1, textInteractionSource,
              useDisclosure: props.useDisclosure, usePresentation, renderFactorySlot: props.renderFactorySlot, t, primitives: P,
            })))
          break
        case 'image':
          rendered.push(createElement(AssistantImage, { key: i, attachment: block.attachment, loadImage: props.loadImage }))
          break
        case 'tool-call':
          if (placement.own) rendered.push(toolCall(block, data.step, false, `call:${block.callId}`))
          break
        default:
          rendered.push(P.JsonBlock === undefined ? null : createElement(P.JsonBlock, {
            key: i, label: t('message.unknownBlock'), payload: (block as { block?: unknown }).block,
            truncatedLabel: (total: number) => t('json.truncated', { total }),
          }))
      }
    }
    const hasVisible = streaming || interrupted || blocks.some(b => b.kind !== 'tool-call') || placement.adopted.length > 0
    if (!hasVisible) return null
    const stopped = interrupted && (groupPart === undefined || groupPart === 'response'
      || !blocks.some(b => b.kind !== 'reasoning' && b.kind !== 'tool-call'))
    return createElement('div', { 'data-dsh-inline-assistant': '', 'data-streaming': streaming || undefined },
      createElement('div', { 'data-dsh-inline-body': '' }, ...rendered,
        stopped ? createElement('span', { key: 'stopped', 'data-dsh-inline-stopped': '' }, t('message.stopped')) : null))
  })
}
