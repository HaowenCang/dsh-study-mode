/**
 * Client interaction wiring: one click must produce exactly two official
 * operations against the ORIGINAL session, and every failure path must stay
 * bounded and non-throwing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { submitInteraction, buildInteractionPayload } from '../../src/client/interactions'
import type { ClientContext } from '../../src/client/contract'

interface RecordedCommand {
  readonly sessionId: string
  readonly line: string
  readonly attachments: readonly unknown[]
}

interface RecordedPrompt { requestId: string; sessionId: string; mode: 'queue'; content: { type: 'text'; text: string }[] }

function fakeContext(responder: (command: RecordedCommand) => Promise<unknown>, promptResponder: () => Promise<unknown> = async () => ({ ok: true, value: { accepted: true } })): {
  ctx: ClientContext
  commands: RecordedCommand[]
  created: string[]
  prompts: RecordedPrompt[]
  promptSignals: (AbortSignal | undefined)[]
} {
  const commands: RecordedCommand[] = []
  const created: string[] = []
  const prompts: RecordedPrompt[] = []
  const promptSignals: (AbortSignal | undefined)[] = []
  const ctx = {
    slots: { inject() {}, register() { return () => {} } },
    remote: {
      session: { async prompt(request: RecordedPrompt, signal?: AbortSignal) { prompts.push(request); promptSignals.push(signal); return promptResponder() } },
      commands: {
        async execute(sessionId: string, line: string, attachments: readonly unknown[] = []) {
          const command = { sessionId, line, attachments }
          commands.push(command)
          return responder(command)
        },
      },
    },
    sessions: {
      async create() {
        created.push('create')
        return 'new-session'
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  } as unknown as ClientContext
  return { ctx, commands, created, prompts, promptSignals }
}

function okAck(text = 'rich-interaction recorded: card=call-1 action=a1 attempt=attempt'): unknown {
  return { ok: true, value: { result: { kind: 'success', text } } }
}

function inputActionsRecorder(): { calls: string[]; actions: { setDraft(text: string): void; submit(): void } } {
  const calls: string[] = []
  return {
    calls,
    actions: {
      setDraft(text: string) { calls.push('setDraft:' + text) },
      submit() { calls.push('submit') },
    },
  }
}

const baseRequest = {
  sessionId: 'session-original',
  callId: 'call-1',
  questionId: 'q1',
  actionId: 'a1',
  submitText: 'follow-up text',
}

test('buildInteractionPayload derives cardKey and a unique attempt id', () => {
  const first = buildInteractionPayload({ ...baseRequest, ctx: fakeContext(async () => okAck()).ctx }, 'attempt-1', 1_700_000_000_000)
  assert.equal(first.sessionId, 'session-original')
  assert.equal(first.cardKey, 'call-1#q1')
  assert.equal(first.protocol, 'rich-interaction-v1')
  assert.equal(first.submittedAt, new Date(1_700_000_000_000).toISOString())
  const withoutQuestion = buildInteractionPayload({ ...baseRequest, ctx: fakeContext(async () => okAck()).ctx, questionId: undefined }, 'attempt-2', 1)
  assert.equal(withoutQuestion.cardKey, 'call-1')
  assert.equal(withoutQuestion.questionId, undefined)
})

test('happy path: command targets the original session, then the follow-up is submitted there', async () => {
  const fake = fakeContext(async () => okAck())
  const input = inputActionsRecorder()
  const outcome = await submitInteraction({
    ...baseRequest,
    ctx: fake.ctx,
    inputActions: input.actions,
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.duplicate, false)
  assert.equal(outcome.followUpQueued, true)
  assert.equal(fake.commands.length, 1)
  const command = fake.commands[0] as RecordedCommand
  assert.equal(command.sessionId, 'session-original')
  assert.ok(command.line.startsWith('/rich-interaction '))
  const payload = JSON.parse(command.line.slice('/rich-interaction '.length)) as Record<string, unknown>
  assert.equal(payload['sessionId'], 'session-original')
  assert.equal(payload['callId'], 'call-1')
  assert.equal(payload['cardKey'], 'call-1#q1')
  assert.equal(payload['questionId'], 'q1')
  assert.equal(payload['actionId'], 'a1')
  assert.equal(typeof payload['attemptId'], 'string')
  assert.deepEqual(command.attachments, [])
  // The official direct queue request preserves any unsent composer draft.
  assert.deepEqual(input.calls, [])
  assert.equal(fake.prompts.length, 1)
  assert.deepEqual(fake.prompts[0], {
    requestId: outcome.attemptId, sessionId: 'session-original', mode: 'queue',
    content: [{ type: 'text', text: 'follow-up text' }],
  })
  assert.match(fake.prompts[0]!.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.deepEqual(fake.created, [])
})

test('duplicate ack is surfaced, not hidden', async () => {
  const fake = fakeContext(async () => okAck('rich-interaction recorded: card=call-1 action=a1 attempt=x (duplicate)'))
  const input = inputActionsRecorder()
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, inputActions: input.actions })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.duplicate, true)
  assert.equal(outcome.followUpQueued, false)
  assert.deepEqual(fake.prompts, [])
  assert.deepEqual(input.calls, [])
})

test('duplicate detection survives diagnostic truncation for long valid card identities', async () => {
  const fake = fakeContext(async command => {
    const p = JSON.parse(command.line.slice('/rich-interaction '.length)) as Record<string, string>
    return okAck(`rich-interaction recorded: card=${p.cardKey} action=${p.actionId} attempt=${p.attemptId} (duplicate)`)
  })
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, callId: 'c'.repeat(128), questionId: 'q'.repeat(64), actionId: 'a'.repeat(64) })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.duplicate, true)
  assert.equal(outcome.followUpQueued, false)
  assert.deepEqual(fake.prompts, [])
  assert.ok(outcome.text.length <= 300)
})

test('duplicate text inside a card identity does not suppress a new accepted follow-up', async () => {
  const fake = fakeContext(async () => okAck('rich-interaction recorded: card=call-(duplicate) action=a1 attempt=x'))
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, callId: 'call-(duplicate)' })
  assert.equal(outcome.duplicate, false)
  assert.equal(outcome.followUpQueued, true)
})

test('host rejection is returned as a bounded failure without follow-up', async () => {
  const fake = fakeContext(async () => ({ ok: false, error: { code: 'DENIED', message: 'session mismatch' } }))
  const input = inputActionsRecorder()
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, inputActions: input.actions })
  assert.equal(outcome.ok, false)
  assert.match(outcome.text, /DENIED/)
  assert.equal(outcome.followUpQueued, false)
  assert.deepEqual(input.calls, [])
})

test('command result error is returned as a bounded failure', async () => {
  const fake = fakeContext(async () => ({ ok: true, value: { result: { kind: 'error', text: 'stale submission' } } }))
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.equal(outcome.ok, false)
  assert.match(outcome.text, /stale submission/)
})

test('transport timeout is bounded and non-throwing', async () => {
  const fake = fakeContext(async () => await new Promise(() => {}))
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, timeoutMs: 30 })
  assert.equal(outcome.ok, false)
  assert.match(outcome.text, /timed out/i)
})

test('throwing transport is bounded and non-throwing', async () => {
  const fake = fakeContext(async () => { throw new Error('socket closed') })
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.equal(outcome.ok, false)
  assert.match(outcome.text, /socket closed/)
})

test('missing session API: audit succeeds and unavailable never falls back to the composer', async () => {
  const fake = fakeContext(async () => okAck())
  const input = inputActionsRecorder()
  const ctx = { ...fake.ctx, remote: { commands: fake.ctx.remote.commands } }
  const outcome = await submitInteraction({ ...baseRequest, ctx, inputActions: input.actions })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.followUpQueued, false)
  assert.match(outcome.text, /follow-up unavailable/)
  assert.deepEqual(input.calls, [])
})

test('composer is never touched even when its actions throw', async () => {
  const fake = fakeContext(async () => okAck())
  const outcome = await submitInteraction({
    ...baseRequest,
    ctx: fake.ctx,
    inputActions: {
      setDraft() { throw new Error('editor disposed') },
      submit() { throw new Error('should not be reached') },
    },
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.followUpQueued, true)
  assert.equal(fake.prompts.length, 1)
})

test('direct follow-up needs no inputActions and blank follow-up is audit-only', async () => {
  const fake = fakeContext(async () => okAck())
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.equal(outcome.followUpQueued, true)
  await submitInteraction({ ...baseRequest, ctx: fake.ctx, submitText: '  ' })
  assert.equal(fake.commands.length, 2)
  assert.equal(fake.prompts.length, 1)
})

test('late host success after timeout cannot queue a follow-up', async () => {
  let finish!: (value: unknown) => void
  const fake = fakeContext(() => new Promise(resolve => { finish = resolve }))
  const input = inputActionsRecorder()
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, inputActions: input.actions, timeoutMs: 10 })
  assert.equal(outcome.ok, false)
  finish(okAck())
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(fake.prompts, [])
  assert.deepEqual(input.calls, [])
})

test('follow-up rejection or throw preserves audit success with bounded diagnostics', async () => {
  for (const responder of [
    async () => ({ ok: false, error: { code: 'DENIED', message: 'x'.repeat(1000) } }),
    async () => { throw new Error('socket closed') },
  ]) {
    const fake = fakeContext(async () => okAck(), responder)
    const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.followUpQueued, false)
    assert.match(outcome.text, /follow-up.*not.*submitted/)
    assert.ok(outcome.text.length <= 600)
    assert.equal(fake.prompts.length, 1)
  }
})

test('follow-up timeout is bounded and never retries an uncertain submission', async () => {
  const fake = fakeContext(async () => okAck(), async () => new Promise(() => {}))
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx, timeoutMs: 10 })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.followUpQueued, false)
  assert.match(outcome.text, /timed out/i)
  assert.equal(fake.prompts.length, 1)
  assert.equal(fake.promptSignals[0]?.aborted, true)
})

test('legacy audit attempt ids receive one separate UUID for the direct prompt', async t => {
  let calls = 0
  t.mock.method(globalThis.crypto, 'randomUUID', () => ++calls === 1 ? 'attempt-legacy' : '12345678-1234-4321-8123-123456789abc')
  const fake = fakeContext(async () => okAck())
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.equal(outcome.attemptId, 'attempt-legacy')
  assert.equal(outcome.followUpQueued, true)
  assert.equal(fake.prompts[0]?.requestId, '12345678-1234-4321-8123-123456789abc')
  assert.equal(calls, 2)
})

test('missing acceptance receipt cannot be reported as a queued follow-up', async () => {
  const fake = fakeContext(async () => okAck(), async () => ({ ok: true, value: { accepted: false } }))
  const outcome = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.followUpQueued, false)
  assert.match(outcome.text, /acknowledge acceptance/)
})

test('each click mints a distinct attempt id', async () => {
  const fake = fakeContext(async () => okAck())
  const first = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  const second = await submitInteraction({ ...baseRequest, ctx: fake.ctx })
  assert.notEqual(first.attemptId, second.attemptId)
  const payloads = fake.commands.map(command =>
    JSON.parse(command.line.slice('/rich-interaction '.length)) as { attemptId: string })
  assert.equal(new Set(payloads.map(payload => payload.attemptId)).size, 2)
})
