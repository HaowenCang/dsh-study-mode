/**
 * Shared interaction-payload validation.
 *
 * The client mints the payload, but the Host is the authority: it re-validates
 * every field, binds the payload to the receiving session, checks freshness,
 * and dedupes attempts. These tests pin the field-level contract the Host
 * relies on (the Host command behavior itself is covered in host.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  cardKeyFor,
  createAttemptId,
  MAX_INTERACTION_RAW_INPUT,
  MAX_INTERACTION_SKEW_MS,
  RICH_INTERACTION_PROTOCOL,
  RICH_LIMITS,
  validateInteractionPayload,
  type InteractionIssue,
  type RichInteractionPayloadV1,
} from '../../src/shared/index'

const FIXED_NOW = Date.parse('2026-01-01T12:00:00.000Z')

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: RICH_INTERACTION_PROTOCOL,
    protocolVersion: 1,
    sessionId: 'session-01',
    callId: 'call-01',
    cardKey: 'call-01#deploy-1',
    questionId: 'deploy-1',
    actionId: 'approve',
    attemptId: 'attempt-01',
    submittedAt: new Date(FIXED_NOW).toISOString(),
    answer: 'Approved.',
    ...overrides,
  }
}

function expectValid(value: unknown): RichInteractionPayloadV1 {
  const result = validateInteractionPayload(value)
  if (!result.ok) {
    assert.fail(`expected valid interaction payload, got: ${result.issues.map(item => `${item.field}: ${item.detail}`).join('; ')}`)
  }
  return result.value
}

function expectInvalid(value: unknown, field?: string): readonly InteractionIssue[] {
  const result = validateInteractionPayload(value)
  if (result.ok) assert.fail('expected interaction payload to be rejected')
  if (field !== undefined) {
    assert.ok(
      result.issues.some(item => item.field === field),
      `expected an issue on field "${field}", got: ${result.issues.map(item => item.field).join(', ')}`,
    )
  }
  return result.issues
}

function without(field: string): Record<string, unknown> {
  const candidate = validPayload()
  delete candidate[field]
  return candidate
}

describe('interaction constants', () => {
  it('pins the protocol marker, dedupe window and raw-input bound', () => {
    assert.equal(RICH_INTERACTION_PROTOCOL, 'rich-interaction-v1')
    assert.equal(MAX_INTERACTION_SKEW_MS, 10 * 60 * 1000)
    assert.equal(MAX_INTERACTION_RAW_INPUT, 8 * 1024)
  })
})

describe('validateInteractionPayload — accepted payloads', () => {
  it('accepts and normalizes a complete payload', () => {
    const payload = validPayload({ sessionId: ' session-01 ', answer: ' Approved. ' })
    assert.deepEqual(expectValid(payload), {
      protocol: RICH_INTERACTION_PROTOCOL,
      protocolVersion: 1,
      sessionId: 'session-01',
      callId: 'call-01',
      cardKey: 'call-01#deploy-1',
      questionId: 'deploy-1',
      actionId: 'approve',
      attemptId: 'attempt-01',
      submittedAt: new Date(FIXED_NOW).toISOString(),
      answer: 'Approved.',
    })
  })

  it('accepts a minimal payload without questionId or answer', () => {
    const payload = validPayload({ cardKey: 'call-01' })
    delete payload['questionId']
    delete payload['answer']
    const value = expectValid(payload)
    assert.equal(Object.hasOwn(value, 'questionId'), false)
    assert.equal(Object.hasOwn(value, 'answer'), false)
  })

  it('accepts both millisecond and second ISO-8601 UTC instants', () => {
    expectValid(validPayload({ submittedAt: '2026-01-01T12:00:00Z' }))
    expectValid(validPayload({ submittedAt: '2026-01-01T12:00:00.123Z' }))
  })

  it('ignores unknown extra fields and never pollutes prototypes', () => {
    const payload = validPayload() as Record<string, unknown>
    const withProtoKeys = `{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},${JSON.stringify(payload).slice(1)}`
    const value = expectValid(JSON.parse(withProtoKeys) as unknown)
    assert.equal(Object.hasOwn(value, 'injected'), false)
    assert.equal(Object.hasOwn(value, '__proto__'), false)
    assert.equal(Object.hasOwn(value, 'constructor'), false)
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined)
    assert.equal((Object.prototype as unknown as Record<string, unknown>)['polluted'], undefined)
  })
})

describe('validateInteractionPayload — required fields and protocol', () => {
  it('rejects every missing required field by name', () => {
    for (const field of [
      'protocol',
      'protocolVersion',
      'sessionId',
      'callId',
      'cardKey',
      'actionId',
      'attemptId',
      'submittedAt',
    ]) {
      expectInvalid(without(field), field)
    }
  })

  it('rejects a wrong protocol marker', () => {
    for (const protocol of ['rich-interaction-v2', 'rich-response-v1', '', 1, null] as unknown[]) {
      expectInvalid(validPayload({ protocol }), 'protocol')
    }
  })

  it('rejects a wrong protocolVersion', () => {
    for (const protocolVersion of [0, 2, '1', null] as unknown[]) {
      expectInvalid(validPayload({ protocolVersion }), 'protocolVersion')
    }
  })

  it('rejects non-object payloads with the root field', () => {
    for (const value of [null, undefined, [], 'payload', 42, true] as unknown[]) {
      expectInvalid(value, '')
    }
  })
})

describe('validateInteractionPayload — identity constraints', () => {
  it('enforces SAFE_ID on actionId', () => {
    for (const actionId of ['bad id', 'a/b', '<b>', 'x'.repeat(RICH_LIMITS.maxActionIdLength + 1)] as unknown[]) {
      expectInvalid(validPayload({ actionId }), 'actionId')
    }
  })

  it('enforces SAFE_ID on questionId', () => {
    for (const questionId of ['bad id', 'a#b', 'x'.repeat(RICH_LIMITS.maxQuestionIdLength + 1)] as unknown[]) {
      expectInvalid(validPayload({ questionId }), 'questionId')
    }
  })

  it('rejects non-string required fields', () => {
    for (const field of ['sessionId', 'callId', 'cardKey', 'actionId', 'attemptId', 'submittedAt']) {
      expectInvalid(validPayload({ [field]: 42 }), field)
    }
  })

  it('rejects overlong identity fields', () => {
    expectInvalid(validPayload({ sessionId: 's'.repeat(RICH_LIMITS.maxNodeIdLength + 65) }), 'sessionId')
    expectInvalid(validPayload({ callId: 'c'.repeat(RICH_LIMITS.maxNodeIdLength + 65) }), 'callId')
    expectInvalid(validPayload({ cardKey: 'k'.repeat(201) }), 'cardKey')
    expectInvalid(validPayload({ attemptId: 'a'.repeat(129) }), 'attemptId')
  })

  it('rejects an overlong answer', () => {
    expectInvalid(validPayload({ answer: 'x'.repeat(RICH_LIMITS.maxSubmitTextLength + 1) }), 'answer')
  })

  it('rejects an empty answer when the field is present', () => {
    expectInvalid(validPayload({ answer: '   ' }), 'answer')
  })
})

describe('validateInteractionPayload — ISO-8601 timestamps', () => {
  it('rejects date-only, locale, offset and calendar-invalid timestamps', () => {
    const invalid = [
      '2026-01-01',
      'January 1, 2026',
      '2026-01-01T12:00:00+00:00',
      '2026-01-01T12:00:00.000',
      '2026-13-01T00:00:00Z',
      '2026-01-01T25:00:00Z',
      'not-a-date',
      '0',
      '   ',
    ]
    for (const submittedAt of invalid) {
      expectInvalid(validPayload({ submittedAt }), 'submittedAt')
    }
  })

  it('rejects a non-string timestamp', () => {
    expectInvalid(validPayload({ submittedAt: FIXED_NOW }), 'submittedAt')
  })
})

describe('validateInteractionPayload — totality', () => {
  it('never throws for hostile values', () => {
    const throwing: Record<string, unknown> = {}
    Object.defineProperty(throwing, 'protocol', {
      enumerable: true,
      get() { throw new Error('boom') },
    })
    const proxy = new Proxy({}, { get() { throw new Error('trap') } })
    const values: unknown[] = [
      throwing,
      proxy,
      Object.create(null),
      new Map(),
      new Date(),
      () => undefined,
      Symbol('x'),
      10n,
      { get submittedAt() { throw new Error('x') } },
    ]
    for (const value of values) {
      assert.doesNotThrow(() => {
        const result = validateInteractionPayload(value)
        assert.equal(typeof result.ok, 'boolean')
      })
    }
    expectInvalid(throwing, '')
  })
})

describe('cardKeyFor', () => {
  it('derives the card key from the call identity plus optional question identity', () => {
    assert.equal(cardKeyFor('call-01'), 'call-01')
    assert.equal(cardKeyFor('call-01', undefined), 'call-01')
    assert.equal(cardKeyFor('call-01', 'deploy-1'), 'call-01#deploy-1')
    assert.equal(cardKeyFor('-', ''), '-#')
  })

  it('is exactly the value the payload validator accepts', () => {
    const payload = validPayload({ callId: 'call-01', questionId: 'deploy-1', cardKey: cardKeyFor('call-01', 'deploy-1') })
    expectValid(payload)
  })

  it('separates distinct valid identities and stays stable across calls', () => {
    assert.equal(cardKeyFor('call-01', 'q1'), 'call-01#q1')
    assert.equal(cardKeyFor('call-01', 'q1'), cardKeyFor('call-01', 'q1'))
    assert.notEqual(cardKeyFor('call-01', 'q1'), cardKeyFor('call-01', 'q2'))
    assert.notEqual(cardKeyFor('call-01', 'q1'), cardKeyFor('call-02', 'q1'))
    // The Host always recomputes the key from the validated callId/questionId
    // pair, so an attacker cannot pick a different (callId, questionId)
    // representation for the same key: questionId is SAFE_ID (no '#').
    assert.equal(cardKeyFor('a#b', 'c'), 'a#b#c')
    expectInvalid(validPayload({ questionId: 'b#c' }), 'questionId')
  })
})

describe('createAttemptId', () => {
  it('produces unique, bounded identities over many calls', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 1000; index += 1) {
      const id = createAttemptId()
      assert.equal(typeof id, 'string')
      assert.ok(id.length > 0 && id.length <= 128, `unexpected attempt id length: ${String(id.length)}`)
      assert.equal(seen.has(id), false, `duplicate attempt id: ${id}`)
      seen.add(id)
    }
    assert.equal(seen.size, 1000)
  })
})
