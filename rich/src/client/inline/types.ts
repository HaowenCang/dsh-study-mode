/**
 * Structural contracts for the inline assistant renderer (plan P2).
 *
 * The shadow registers `conversation.chat.node` / `assistant-step` at priority -1 and mirrors the
 * built-in `AssistantNodeView` + `AssistantMarkdown` (ui-chat, identical in dsh-v0.2.2-rc.1 and
 * master fcc0ad4621). Only the props verified by the P0 spike (project-handoff/INLINE_SPIKE.md) are
 * read; `contract-guard.ts` checks them at render time so a mismatch retires the shadow and the
 * built-in renderer takes over.
 */
import type { ComponentType, ReactNode, Ref } from 'react'

export type AssistantBlock =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reasoning'; readonly text: string }
  | { readonly kind: 'image'; readonly attachment: unknown }
  | { readonly kind: 'tool-call'; readonly callId: string; readonly name: string; readonly argsRaw: string }
  | { readonly kind: 'other'; readonly block: unknown }

export interface AssistantData {
  readonly step: number
  readonly status: 'running' | 'settled' | 'interrupted' | string
  readonly blocks: readonly AssistantBlock[]
  readonly finalNode?: { readonly seq: number; readonly messageId?: unknown } | undefined
}

export interface TurnProcessOwner {
  readonly foldable: boolean
  readonly open: boolean
  readonly setOpen: (open: boolean) => void
  readonly spec: { readonly answerStep: number | null; readonly inlineReasoning: boolean }
}

/** Presentation policy fields this renderer reads (ui-chat ChatPresentationPolicy). */
export interface PresentationPolicy {
  readonly foldedReplies?: 'all' | 'final' | string
  readonly settledReasoningPreview?: boolean
}

export type Selector<T, R> = (value: T) => R
export type UsePresentation = <R>(selector: Selector<PresentationPolicy, R>) => R
export type UseDisclosure = () => { readonly expanded: boolean; readonly toggle: () => void }
export type UseGroupAction = (hidden: boolean, reveal: () => void) => Ref<HTMLDivElement>

/** Props of the keyed chat node seat that the shadow reads (verified in P0). */
export interface InlineNodeProps {
  readonly node: { readonly data: AssistantData; readonly location?: { readonly kind: string; readonly turn?: unknown } }
  readonly groupPart?: string | undefined
  readonly sessionId: string
  readonly t: (key: string, params?: Record<string, unknown>) => string
  readonly useDisclosure: UseDisclosure
  readonly useGroupAction: UseGroupAction
  readonly useTurnData?: (key: string) => unknown
  readonly useContextMenu?: () => { readonly getTriggerProps: (target: () => unknown) => unknown }
  readonly turnProcess?: TurnProcessOwner | undefined
  readonly openFile?: (path: string) => void
  readonly loadImage?: unknown
  readonly renderFactorySlot: (name: string, props: Record<string, unknown>) => ReactNode
  readonly renderSlot?: (key: string, owner: Record<string, unknown>, opts?: { readonly entryKey?: string; readonly fallback?: ReactNode }) => ReactNode
}

/** Built-in business face borrowed from the shadowed ui-chat entry's `inject(sessionId)`. */
export interface BuiltinFace {
  readonly usePresentation?: UsePresentation
  readonly resolveFilePath?: (path: string) => string
  readonly fileMentions?: (owner: unknown, getFileTriggerProps: (path: string) => unknown) => unknown
}

/** Shared runtime components from `@deepseek-ai/dsh-client-ui-primitives` (platform module). */
export interface Primitives {
  readonly MarkdownText: ComponentType<{
    text: string; streaming?: boolean; labels: MarkdownLabels; fileMentions?: unknown; pathImages?: unknown
    variant?: 'body' | 'compact'; textInteractionSource?: boolean
  }>
  readonly CodeBlock: ComponentType<{
    code: string; lang?: string; streaming?: boolean; copyLabel: string; copiedLabel: string
    toolbarLabels?: { codeLabel: string; wrapLabel: string; unwrapLabel: string }
  }>
  readonly JsonBlock?: ComponentType<{ label: string; payload: unknown; truncatedLabel: (total: number) => string }>
  readonly DisclosureRow?: ComponentType<{
    icon: ReactNode; title: string; open: boolean; expandable: boolean; onToggle: () => void; running?: boolean
    expandOnRowClick?: boolean; collapsedContent?: ReactNode; children?: ReactNode; rowClassName?: string
    leadingClassName?: string; titleClassName?: string
  }>
  readonly TextShimmer?: ComponentType<{ children?: ReactNode }>
  readonly IconThinkOutlineRegular?: ComponentType<{ size?: number }>
}

export interface MarkdownLabels {
  readonly code: { readonly copyLabel: string; readonly copiedLabel: string; readonly toolbarLabels: { readonly codeLabel: string; readonly wrapLabel: string; readonly unwrapLabel: string } }
  readonly footnotes: string
}

/** One registered inline renderer for a tool call (e.g. Study cards). */
export interface InlineToolCallOwner {
  readonly callId: string
  readonly toolName: string
  readonly argsRaw: string
  readonly sessionId: string
  readonly step: number
  /** True when this call's own step is not visible and the card is shown in a later step. */
  readonly relocated: boolean
  /** False while the step that made the call is still streaming (the tool has not run yet). */
  readonly settled: boolean
  /** True while the call's turn is still open (tools may not have produced their results yet). */
  readonly turnOpen: boolean
}
