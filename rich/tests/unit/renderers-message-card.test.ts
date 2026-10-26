/**
 * Unit tests for the interactive `message_card` renderer: real buttons, busy /
 * settled disabled semantics, feedback, question hint, plain-text body and
 * escaped model text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MessageCard } from '../../src/client/renderers/message-card'
import type { RendererTheme } from '../../src/client/renderers/types'
import type { MessageCardContent } from '../../src/shared/index'

const theme: RendererTheme = {
  text: '#1b1f24',
  muted: '#6b7280',
  border: '#d9dee7',
  surface: '#f6f7f9',
  accent: '#247bbf',
  series: ['#d94f2b'],
}

interface RenderOptions {
  readonly busy?: boolean
  readonly feedback?: string
  readonly settledActionId?: string
  readonly onAction?: (actionId: string) => void
}

const sample: MessageCardContent = {
  schemaVersion: 1,
  type: 'message_card',
  title: 'Deploy?',
  subtitle: 'confirm the rollout',
  questionId: 'q1',
  body: 'line1\nline2',
  actions: [
    { id: 'approve', label: 'Approve', submitText: 'approve' },
    { id: 'reject', label: 'Reject', submitText: 'reject' },
  ],
}

function render(content: MessageCardContent, options: RenderOptions = {}): string {
  return renderToStaticMarkup(createElement(MessageCard, {
    content,
    theme,
    onAction: options.onAction ?? (() => undefined),
    busy: options.busy,
    feedback: options.feedback,
    settledActionId: options.settledActionId,
  }))
}

function buttons(markup: string): readonly string[] {
  return [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
}

function countOccurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

test('message card: renders a plain-text body, question hint and real buttons', () => {
  const markup = render(sample)
  assert.match(markup, /data-dsh-rich="message-card"/)
  assert.match(markup, /data-dsh-rich-question-id="q1"/)
  assert.match(markup, /data-dsh-rich="question-hint"/)
  assert.match(markup, /white-space:pre-wrap/)
  assert.ok(markup.includes('line1\nline2'))
  assert.equal(countOccurrences(markup, 'data-dsh-rich-action="'), 2)
  const rendered = buttons(markup)
  assert.equal(rendered.length, 2)
  assert.match(rendered[0] as string, /^<button type="button" data-dsh-rich-action="approve"/)
  assert.match(rendered[1] as string, /^<button type="button" data-dsh-rich-action="reject"/)
  assert.match(markup, />Approve</)
  assert.match(markup, />Reject</)
  assert.match(markup, /role="group"/)
  assert.match(markup, /aria-label="Deploy\? actions"/)
})

test('message card: no actions means no action group and no crash', () => {
  const content: MessageCardContent = { ...sample, actions: undefined }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="card-body"/)
  assert.ok(!markup.includes('data-dsh-rich="card-actions"'))
  assert.equal(buttons(markup).length, 0)
})

test('message card: busy disables every button and announces progress', () => {
  const markup = render(sample, { busy: true })
  const rendered = buttons(markup)
  assert.equal(rendered.length, 2)
  for (const button of rendered) {
    assert.ok(button.includes('disabled=""'), `button was not disabled: ${button}`)
    assert.ok(button.includes('aria-disabled="true"'))
  }
  assert.match(markup, /data-dsh-rich="busy"/)
  assert.match(markup, /Submitting your choice\.\.\./)
  assert.match(markup, /aria-busy="true"/)
})

test('message card: settled action is disabled and marked as submitted', () => {
  const markup = render(sample, { settledActionId: 'approve' })
  const rendered = buttons(markup)
  assert.equal(rendered.length, 2)
  const approve = rendered[0] as string
  assert.ok(approve.includes('data-dsh-rich-settled="true"'))
  assert.ok(approve.includes('disabled=""'))
  assert.ok(approve.includes('aria-label="Approve (submitted)"'))
  assert.ok(!(rendered[1] as string).includes('data-dsh-rich-settled="true"'))
  assert.ok((rendered[1] as string).includes('disabled=""'))
  assert.match(markup, /Approve \[submitted\]/)
})

test('message card: idle buttons are enabled and not marked disabled', () => {
  const markup = render(sample)
  for (const button of buttons(markup)) {
    assert.ok(!button.includes('disabled=""'))
    assert.ok(button.includes('aria-disabled="false"'))
  }
})

test('message card: feedback is shown in a live status region', () => {
  const markup = render(sample, { feedback: 'Recorded by host; follow-up queued' })
  assert.match(markup, /data-dsh-rich="feedback"/)
  assert.match(markup, /role="status" aria-live="polite"/)
  assert.match(markup, /Recorded by host; follow-up queued/)
})

test('message card: markup in title, body or feedback is escaped', () => {
  const content: MessageCardContent = {
    schemaVersion: 1,
    type: 'message_card',
    title: '<script>alert(1)</script>',
    body: 'before <img src=x onerror=alert(2)> after',
    actions: [{ id: 'ok', label: '<b>bold?</b>', submitText: 'ok' }],
  }
  const markup = render(content, { feedback: '<b>bad feedback</b>' })
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img'))
  assert.ok(!markup.includes('<b>bold?'))
  assert.ok(!markup.includes('<b>bad feedback'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(markup.includes('&lt;img'))
  assert.ok(markup.includes('&lt;b&gt;bold?&lt;/b&gt;'))
  assert.ok(markup.includes('&lt;b&gt;bad feedback&lt;/b&gt;'))
})
