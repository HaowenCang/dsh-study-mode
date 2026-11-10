/**
 * Mirror of ui-chat `ReasoningRow` (dsh-v0.2.2-rc.1 = master) built from shared primitives.
 *
 * The body goes through the public `conversation.chat.reasoning.content` Factory, which is what the
 * built-in default reasoning Body renders. Limitation: a plugin that replaces the
 * `conversation.chat.reasoning.body` Slot (e.g. CoT translation) is not consulted while the inline
 * renderer is active, because that Slot is a child of the shadowed built-in entry.
 */
import { createElement, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Primitives, UseDisclosure, UsePresentation } from './types'

/** ui-chat `reasoningText`: hide a leading provider signature block. */
export function reasoningText(text: string): string {
  if (text[0] !== '<') return text
  const opening = '<signature>'
  if (opening.startsWith(text)) return ''
  if (!text.startsWith(opening)) return text
  const end = text.indexOf('</signature>', opening.length)
  if (end === -1) return ''
  let start = end + '</signature>'.length
  while (start < text.length) {
    if (text[start] === '\n') start++
    else if (text[start] === '\r' && text[start + 1] === '\n') start += 2
    else break
  }
  return text.slice(start)
}

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestCompletedParagraphFirstLine(text: string): string {
  let summary = ''
  let paragraphStart = 0
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g
  for (;;) {
    const nextParagraph = separator.exec(text)
    const paragraphEnd = nextParagraph === null ? text.length : nextParagraph.index + nextParagraph[0].indexOf('\n')
    const newline = text.indexOf('\n', paragraphStart)
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim()
      if (candidate !== '') summary = candidate
    }
    if (nextParagraph === null) return summary
    paragraphStart = nextParagraph.index + nextParagraph[0].length
  }
}

export interface ReasoningRowProps {
  readonly text: string
  readonly running: boolean
  readonly textInteractionSource: boolean
  readonly useDisclosure: UseDisclosure
  readonly usePresentation: UsePresentation
  readonly renderFactorySlot: (name: string, props: Record<string, unknown>) => ReactNode
  readonly t: (key: string) => string
  readonly primitives: Primitives
}

export const InlineReasoningRow = memo(function InlineReasoningRow(props: ReasoningRowProps) {
  const { text: rawText, running, primitives: P, t } = props
  const { expanded, toggle } = props.useDisclosure()
  const { text, hidden } = useMemo(() => {
    const text = reasoningText(rawText)
    return { text, hidden: text !== rawText && text.trim() === '' }
  }, [rawText])
  const summaryText = running ? latestCompletedParagraphFirstLine(text) : firstLine(text)
  const summary = useMemo(() => summaryText.replaceAll('**', ''), [summaryText])
  const preview = props.usePresentation(policy => !expanded && summary !== '' && (running || policy.settledReasoningPreview !== false))
  if (hidden) return null
  const shimmer = (child: ReactNode): ReactNode => P.TextShimmer === undefined ? child : createElement(P.TextShimmer, null, child)
  const collapsed = createElement('span', { style: { display: 'contents' } },
    createElement('span', { className: 'dsh-inline-think-sep', 'data-shimmer-decoration': '', 'aria-hidden': true }),
    createElement('span', { className: 'dsh-inline-think-summary', 'data-streaming': running || undefined },
      createElement('span', { className: 'dsh-inline-think-text' }, shimmer(summary))))
  const body = expanded
    ? createElement('div', { className: 'dsh-inline-think-body', 'data-text-interaction-source': props.textInteractionSource && !running ? '' : undefined },
      props.renderFactorySlot('conversation.chat.reasoning.content', { text, running }))
    : undefined
  const icon = P.IconThinkOutlineRegular === undefined ? null : createElement(P.IconThinkOutlineRegular, { size: 14 })
  const row = P.DisclosureRow === undefined
    ? createElement('div', null, createElement('button', { type: 'button', onClick: toggle, 'aria-expanded': expanded }, t('message.think')), body)
    : createElement(P.DisclosureRow, {
      rowClassName: 'dsh-inline-think-row', leadingClassName: 'dsh-inline-think-leading', titleClassName: 'dsh-inline-think-title',
      icon, title: t('message.think'), running, open: expanded, expandable: true, expandOnRowClick: true, onToggle: toggle, collapsedContent: collapsed,
    }, body)
  return createElement('div', {
    'data-dsh-inline-think': '', 'data-variant': 'think', 'data-state': running ? 'running' : 'ok',
    'data-expanded': expanded || undefined, 'data-preview': preview || undefined,
  }, running ? createElement('span', { 'data-dsh-inline-hidden': '' }, t('row.running')) : null, row)
})
