/**
 * Client half of the interaction loop.
 *
 * One user action produces two officially supported Host-bound effects, in
 * this order:
 *   1. `remote.commands.execute(originalSessionId, "/rich-interaction <json>")`
 *      -addressed to the ORIGINAL session; the Host re-validates identity,
 *      freshness, and duplicates, then records the interaction in that
 *      session's durable command lifecycle plus the audit log.
 *   2. `remote.session.prompt({ sessionId, requestId, mode: 'queue', content })`
 *      queues the follow-up in the original session without touching its draft.
 *
 * The function never throws; every failure is returned as a bounded outcome so
 * the card can show it without disturbing the transcript.
 */
import {
  cardKeyFor,
  createAttemptId,
  RICH_INTERACTION_PROTOCOL,
  validateInteractionPayload,
  formatValidationIssues,
  type RichInteractionPayloadV1,
} from '../shared/index'
import type { ClientContext, InputActionsFace } from './contract'

/** Default round-trip budget for one interaction. */
export const INTERACTION_TIMEOUT_MS = 10_000

/** One interaction request. */
export interface InteractionRequest {
  readonly ctx: ClientContext
  readonly sessionId: string
  readonly callId: string
  readonly questionId?: string
  readonly actionId: string
  readonly answer?: string
  /** Retained for caller compatibility; interaction submission never invokes it. */
  readonly inputActions?: InputActionsFace | undefined
  /** Follow-up text submitted into the original session; omitted = audit only. */
  readonly submitText?: string
  readonly timeoutMs?: number
}

/** Bounded outcome shown on the card. */
export interface InteractionOutcome {
  readonly ok: boolean
  /** Short user-visible message (never model text). */
  readonly text: string
  /** True when the Host reported this attempt id as already observed. */
  readonly duplicate: boolean
  /** True only after the original session acknowledged accepting the follow-up. */
  readonly followUpQueued: boolean
  /** Attempt identity of this click (diagnostics / evidence). */
  readonly attemptId: string
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240)
  return String(error).slice(0, 240)
}

/** Build the exact payload sent to the Host. */
export function buildInteractionPayload(request: InteractionRequest, attemptId: string, now: number): RichInteractionPayloadV1 {
  return {
    protocol: RICH_INTERACTION_PROTOCOL,
    protocolVersion: 1,
    sessionId: request.sessionId,
    callId: request.callId,
    cardKey: cardKeyFor(request.callId, request.questionId),
    ...request.questionId === undefined ? {} : { questionId: request.questionId },
    actionId: request.actionId,
    attemptId,
    submittedAt: new Date(now).toISOString(),
    ...request.answer === undefined ? {} : { answer: request.answer },
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(`interaction timed out after ${String(timeoutMs)}ms`)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Run one action against the originating session. */
export async function submitInteraction(request: InteractionRequest): Promise<InteractionOutcome> {
  const attemptId = createAttemptId()
  const payload = buildInteractionPayload(request, attemptId, Date.now())

  const local = validateInteractionPayload(payload)
  if (!local.ok) {
    return {
      ok: false,
      text: `invalid interaction payload: ${local.issues.map(item => `${item.field}: ${item.detail}`).join('; ')}`,
      duplicate: false,
      followUpQueued: false,
      attemptId,
    }
  }

  // Session identity is checked against the slot binding before anything leaves
  // the page: a card can never submit into another session's audit command.
  if (payload.sessionId !== request.sessionId) {
    return { ok: false, text: 'refusing to submit: session identity mismatch', duplicate: false, followUpQueued: false, attemptId }
  }

  const command = `/rich-interaction ${JSON.stringify(payload)}`
  let hostText = ''
  let duplicate = false
  try {
    const result = await withTimeout(
      request.ctx.remote.commands.execute(request.sessionId, command, []),
      request.timeoutMs ?? INTERACTION_TIMEOUT_MS,
    )
    if (!result.ok) {
      return {
        ok: false,
        text: `host rejected the interaction (${result.error.code}): ${result.error.message}`.slice(0, 300),
        duplicate: false,
        followUpQueued: false,
        attemptId,
      }
    }
    const outcome = result.value.result
    if (outcome.kind !== 'success') {
      return {
        ok: false,
        text: (outcome.text ?? 'host rejected the interaction').slice(0, 300),
        duplicate: false,
        followUpQueued: false,
        attemptId,
      }
    }
    const receipt = outcome.text ?? 'recorded'
    duplicate = receipt.endsWith(' (duplicate)')
    hostText = receipt.slice(0, 300)
  } catch (error) {
    return {
      ok: false,
      text: `interaction failed: ${errorText(error)}`,
      duplicate: false,
      followUpQueued: false,
      attemptId,
    }
  }

  // A duplicate Host receipt must never enqueue another follow-up. A timed-out
  // Host command returned above; its eventual completion cannot reach this code.
  let followUpQueued = false
  if (!duplicate && request.submitText !== undefined && request.submitText.trim().length > 0) {
    const session = request.ctx.remote.session
    if (typeof session?.prompt !== 'function') {
      return { ok: true, text: `${hostText}; follow-up unavailable in this slot context`, duplicate, followUpQueued: false, attemptId }
    }
    const controller = new AbortController()
    try {
      // The audit protocol permits a legacy non-UUID attempt id, whereas the
      // official prompt needs a UUID. Mint at most once; never retry on timeout.
      const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId)
        ? attemptId : globalThis.crypto.randomUUID()
      const result = await withTimeout(session.prompt({
        requestId,
        sessionId: request.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: request.submitText }],
      }, controller.signal), request.timeoutMs ?? INTERACTION_TIMEOUT_MS)
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      if (result.value.accepted !== true) throw new Error('session did not acknowledge acceptance')
      followUpQueued = true
    } catch (error) {
      controller.abort()
      return {
        ok: true,
        text: `${hostText}; follow-up was not confirmed submitted: ${errorText(error)}`,
        duplicate,
        followUpQueued: false,
        attemptId,
      }
    }
  }

  return { ok: true, text: hostText, duplicate, followUpQueued, attemptId }
}

/** Diagnostic string for a rejected local payload (tests / card footer). */
export function describeLocalPayloadFailure(issues: readonly { field: string; detail: string }[]): string {
  return formatValidationIssues(issues.map(item => ({ code: 'INVALID_ACTION', path: item.field, detail: item.detail })))
}
