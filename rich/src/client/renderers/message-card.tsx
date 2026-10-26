/**
 * `message_card` renderer: plain-text body, optional question hint, and the
 * interactive action buttons that feed `src/client/interactions.ts`.
 *
 * The card is presentation only: it reports the chosen action id through
 * `onAction` and reflects `busy` / `settledActionId` / `feedback` supplied by
 * the owning Tool view. Model strings are rendered as React text children
 * (`body` uses `whiteSpace: 'pre-wrap'`), so no markup is ever injected.
 */
import type { ReactElement } from 'react'
import type { MessageCardContent } from '../../shared/index'
import type { RichRendererProps } from './types'

/** Props of the interactive card renderer. */
export interface MessageCardProps extends RichRendererProps<MessageCardContent> {
  /** Candidate action ids already accepted by the Host for this card instance. */
  readonly settledActionId?: string | undefined
  /** True while an action round-trip is in flight. */
  readonly busy?: boolean
  /** Bounded, user-visible outcome of the last action. */
  readonly feedback?: string | undefined
  /** Ask the owning card to run one action. */
  readonly onAction: (actionId: string) => void
}

/** Interactive message card renderer. */
export function MessageCard({ content, theme, onAction, busy, feedback, settledActionId }: MessageCardProps): ReactElement {
  const actions = content.actions ?? []
  const isBusy = busy === true
  const isSettled = settledActionId !== undefined
  const disabled = isBusy || isSettled
  return (
    <section
      data-dsh-rich="message-card"
      data-dsh-rich-question-id={content.questionId}
      aria-busy={isBusy ? true : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        border: `1px solid ${theme.border}`,
        borderRadius: '10px',
        background: theme.surface,
        color: theme.text,
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <header data-dsh-rich="card-header" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <div data-dsh-rich="card-title" style={{ fontWeight: 600, fontSize: '13px' }}>{content.title}</div>
        {content.subtitle !== undefined && content.subtitle.length > 0 ? (
          <div data-dsh-rich="card-subtitle" style={{ color: theme.muted, fontSize: '12px' }}>{content.subtitle}</div>
        ) : null}
      </header>
      <div
        data-dsh-rich="card-body"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: 1.5 }}
      >
        {content.body}
      </div>
      {content.questionId !== undefined ? (
        <div data-dsh-rich="question-hint" style={{ color: theme.muted, fontSize: '11px' }}>
          Choose an option to answer this question.
        </div>
      ) : null}
      {actions.length > 0 ? (
        <div
          data-dsh-rich="card-actions"
          role="group"
          aria-label={`${content.title} actions`}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
        >
          {actions.map(action => {
            const settled = settledActionId === action.id
            return (
              <button
                key={action.id}
                type="button"
                data-dsh-rich-action={action.id}
                data-dsh-rich-settled={settled ? 'true' : undefined}
                disabled={disabled}
                aria-disabled={disabled}
                aria-label={settled ? `${action.label} (submitted)` : action.label}
                onClick={() => {
                  if (!disabled) onAction(action.id)
                }}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: `1px solid ${settled ? theme.accent : theme.border}`,
                  background: settled ? theme.accent : 'transparent',
                  color: settled ? '#ffffff' : theme.text,
                  font: 'inherit',
                  fontSize: '12px',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled && !settled ? 0.55 : 1,
                }}
              >
                {action.label}
                {settled ? ' [submitted]' : ''}
              </button>
            )
          })}
        </div>
      ) : null}
      {isBusy ? (
        <div data-dsh-rich="busy" role="status" aria-live="polite" style={{ color: theme.muted, fontSize: '12px' }}>
          Submitting your choice...
        </div>
      ) : null}
      {feedback !== undefined && feedback.length > 0 ? (
        <div data-dsh-rich="feedback" role="status" aria-live="polite" style={{ color: theme.muted, fontSize: '12px', wordBreak: 'break-word' }}>
          {feedback}
        </div>
      ) : null}
    </section>
  )
}
