/**
 * Interaction payload validation shared by the Client producer and the Host
 * audit command. The Host is the authority: it re-validates everything and
 * additionally checks session identity, staleness, and duplicate attempts.
 */
import {
  RICH_INTERACTION_PROTOCOL,
  RICH_LIMITS,
  type RichInteractionPayloadV1,
} from './protocol'

/** Clock skew tolerated between a browser click and Host receipt. */
export const MAX_INTERACTION_SKEW_MS = 10 * 60 * 1000

/** Upper bound on the raw command argument carrying one interaction. */
export const MAX_INTERACTION_RAW_INPUT = 8 * 1024

/** Field-level validation failure for one interaction payload. */
export interface InteractionIssue {
  readonly field: string
  readonly detail: string
}

/** Result of validating one interaction payload. */
export type InteractionValidationResult =
  | { readonly ok: true; readonly value: RichInteractionPayloadV1 }
  | { readonly ok: false; readonly issues: readonly InteractionIssue[] }

const SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/
/**
 * Strict ISO-8601 UTC instant, exactly the shape `Date#toISOString` emits.
 * Accepting arbitrary `Date.parse` inputs would let a producer smuggle locale
 * dates or date-only strings past the freshness check, so the format itself is
 * part of the protocol.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

function text(value: unknown, field: string, maxLength: number, issues: InteractionIssue[]): string | undefined {
  if (typeof value !== 'string') {
    issues.push({ field, detail: 'must be a string' })
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    issues.push({ field, detail: 'must not be empty' })
    return undefined
  }
  if (trimmed.length > maxLength) {
    issues.push({ field, detail: `must be at most ${String(maxLength)} characters` })
    return undefined
  }
  return trimmed
}

/** Validate one untrusted interaction payload (no session or clock checks here). */
function readInteractionPayload(value: unknown): InteractionValidationResult {
  const issues: InteractionIssue[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ field: '', detail: 'payload must be a JSON object' }] }
  }
  const record = value as Record<string, unknown>
  if (record['protocol'] !== RICH_INTERACTION_PROTOCOL) {
    issues.push({ field: 'protocol', detail: `must be "${RICH_INTERACTION_PROTOCOL}"` })
  }
  if (record['protocolVersion'] !== 1) {
    issues.push({ field: 'protocolVersion', detail: 'must be 1' })
  }
  const sessionId = text(record['sessionId'], 'sessionId', RICH_LIMITS.maxNodeIdLength + 64, issues)
  const callId = text(record['callId'], 'callId', RICH_LIMITS.maxNodeIdLength + 64, issues)
  const cardKey = text(record['cardKey'], 'cardKey', 200, issues)
  const actionId = text(record['actionId'], 'actionId', RICH_LIMITS.maxActionIdLength, issues)
  if (actionId !== undefined && !SAFE_ID.test(actionId)) {
    issues.push({ field: 'actionId', detail: 'must match [A-Za-z0-9._:-]{1,64}' })
  }
  const attemptId = text(record['attemptId'], 'attemptId', 128, issues)
  const submittedAt = text(record['submittedAt'], 'submittedAt', 64, issues)
  let questionId: string | undefined
  if (record['questionId'] !== undefined) {
    if (typeof record['questionId'] !== 'string' || !SAFE_ID.test(record['questionId'])) {
      issues.push({ field: 'questionId', detail: 'must match [A-Za-z0-9._:-]{1,64}' })
    } else questionId = record['questionId']
  }
  let answer: string | undefined
  if (record['answer'] !== undefined) {
    answer = text(record['answer'], 'answer', RICH_LIMITS.maxSubmitTextLength, issues)
  }
  if (submittedAt !== undefined && (!ISO_INSTANT.test(submittedAt) || Number.isNaN(Date.parse(submittedAt)))) {
    issues.push({ field: 'submittedAt', detail: 'must be an ISO-8601 UTC instant (for example 2026-01-01T00:00:00.000Z)' })
  }
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      protocol: RICH_INTERACTION_PROTOCOL,
      protocolVersion: 1,
      sessionId: sessionId as string,
      callId: callId as string,
      cardKey: cardKey as string,
      ...questionId === undefined ? {} : { questionId },
      actionId: actionId as string,
      attemptId: attemptId as string,
      submittedAt: submittedAt as string,
      ...answer === undefined ? {} : { answer },
    },
  }
}

/**
 * Validate one untrusted interaction payload (no session or clock checks
 * here). Total by construction: a value whose fields throw when read (a proxy,
 * or an object with throwing accessors) is rejected instead of propagated to
 * the command handler.
 */
export function validateInteractionPayload(value: unknown): InteractionValidationResult {
  try {
    return readInteractionPayload(value)
  } catch {
    return { ok: false, issues: [{ field: '', detail: 'payload could not be read as a JSON object' }] }
  }
}

/** Stable card identity used by client and Host: call identity plus optional question identity. */
export function cardKeyFor(callId: string, questionId?: string): string {
  return questionId === undefined ? callId : `${callId}#${questionId}`
}

/** Create a per-click attempt identity (crypto-backed when available). */
export function createAttemptId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (globalCrypto?.randomUUID !== undefined) return globalCrypto.randomUUID()
  const random = Math.random().toString(36).slice(2, 12)
  return `attempt-${Date.now().toString(36)}-${random}`
}
