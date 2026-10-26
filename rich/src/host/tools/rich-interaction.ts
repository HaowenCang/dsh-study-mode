/**
 * `rich-interaction` -the Host audit command behind an interactive card.
 *
 * A click on a message-card action does two independent things:
 *   1. this command records the interaction in the ORIGINAL session's durable
 *      command lifecycle (`command/run` / `command/done`) and appends an
 *      operator-configured JSONL audit record;
 *   2. the Client separately submits a follow-up message through the official
 *      session input face (see `src/client/interactions.ts`).
 *
 * Everything is validated here: session identity must match the receiving
 * agent (which is the session id in 0.2.1-rc.2), the timestamp must be fresh,
 * and duplicate attempt ids are observable rather than silently ignored.
 */
import {
  cardKeyFor,
  formatValidationIssues,
  MAX_INTERACTION_RAW_INPUT,
  MAX_INTERACTION_SKEW_MS,
  validateInteractionPayload,
  type RichInteractionRecord,
} from '../../shared/index'
import { appendAuditRecord, type AttemptTracker } from '../audit'
import type { CommandDefinitionLike, CommandInvocationLike, CommandResultLike, HostLogger } from '../types'

/** Inputs of one audit command. */
export interface RichInteractionCommandOptions {
  readonly logger: HostLogger
  readonly tracker: AttemptTracker
  readonly auditLog?: string
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number
}

/** Validate session binding, freshness, and duplicates, then record. */
export function createRichInteractionCommand(options: RichInteractionCommandOptions): CommandDefinitionLike {
  const now = options.now ?? (() => Date.now())
  return {
    name: 'rich-interaction',
    description: 'Record one interactive-card action against its originating session (host audit).',
    input: { hint: 'internal: called by the rich-response card, not typed by users' },
    recordInput: true,
    handler(invocation: CommandInvocationLike): CommandResultLike {
      const raw = invocation.rawInput.trim()
      if (raw.length === 0) return { kind: 'error', text: 'rich-interaction: empty payload' }
      if (raw.length > MAX_INTERACTION_RAW_INPUT) {
        return { kind: 'error', text: 'rich-interaction: payload too large' }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { kind: 'error', text: 'rich-interaction: payload is not valid JSON' }
      }
      const validation = validateInteractionPayload(parsed)
      if (!validation.ok) {
        return {
          kind: 'error',
          text: `rich-interaction: invalid payload: ${formatValidationIssues(validation.issues.map(item => ({
            code: 'INVALID_ACTION',
            path: item.field,
            detail: item.detail,
          })))}`,
        }
      }
      const payload = validation.value
      const agentId = invocation.agent.id
      if (payload.sessionId !== agentId) {
        return {
          kind: 'error',
          text: `rich-interaction: session mismatch (payload=${payload.sessionId}, agent=${agentId})`,
        }
      }
      const submittedMs = Date.parse(payload.submittedAt)
      const skew = Math.abs(now() - submittedMs)
      if (skew > MAX_INTERACTION_SKEW_MS) {
        return { kind: 'error', text: `rich-interaction: stale submission (skew ${String(skew)}ms)` }
      }
      const expectedCardKey = cardKeyFor(payload.callId, payload.questionId)
      if (payload.cardKey !== expectedCardKey) {
        return { kind: 'error', text: 'rich-interaction: cardKey does not match call/question identity' }
      }
      const duplicate = options.tracker.observe(payload.attemptId)
      const record: RichInteractionRecord = {
        ...payload,
        receivedAt: new Date(now()).toISOString(),
        agentId,
        duplicate,
      }
      if (options.auditLog !== undefined) appendAuditRecord(options.auditLog, record, options.logger)
      options.logger.info(
        'rich-response: interaction recorded session=%s card=%s action=%s attempt=%s duplicate=%s',
        agentId,
        payload.cardKey,
        payload.actionId,
        payload.attemptId,
        String(duplicate),
      )
      return {
        kind: 'success',
        text: `rich-interaction recorded: card=${payload.cardKey} action=${payload.actionId} attempt=${payload.attemptId}${duplicate ? ' (duplicate)' : ''}`,
      }
    },
  }
}
