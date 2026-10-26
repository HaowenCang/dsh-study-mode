/**
 * Host-side protocol wiring tests.
 *
 * - `createRichRenderTool`: validation, canonical value, `output.render`,
 *   `output.schema`, and the durable `output.presentationMeta` envelope that a
 *   reload/history replay reads back.
 * - `createRichInteractionCommand`: session binding, freshness, card identity,
 *   duplicate attempts, malformed/oversized input, and the best-effort audit
 *   append.
 *
 * The command tests use a fake logger, tracker and clock; no DSH runtime is
 * started. Temp files live under the OS temp dir and are removed afterwards.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { AttemptTracker } from '../../src/host/audit'
import { createRichInteractionCommand } from '../../src/host/tools/rich-interaction'
import { createRichRenderTool } from '../../src/host/tools/rich-render'
import type { CommandDefinitionLike, CommandInvocationLike, HostLogger } from '../../src/host/types'
import {
  cardKeyFor,
  MAX_INTERACTION_RAW_INPUT,
  MAX_INTERACTION_SKEW_MS,
  readRichMeta,
  RICH_INTERACTION_PROTOCOL,
  RICH_META_ENVELOPE_VERSION,
  RICH_META_KIND,
  summarizeRichContent,
  validateInteractionPayload,
  validateRichContent,
  type RichContentV1,
  type RichInteractionPayloadV1,
  type RichMetaEnvelopeV1,
} from '../../src/shared/index'

const FIXED_NOW = Date.parse('2026-01-01T12:00:00.000Z')
const SESSION = 'session-01'
const CALL = 'call-01'
const QUESTION = 'deploy-1'

const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-rich-host-'))
after(() => { rmSync(tempRoot, { recursive: true, force: true }) })

// ---------------------------------------------------------------------------
// Shared fixtures / fakes.
// ---------------------------------------------------------------------------

interface LogCall {
  readonly level: 'info' | 'warn' | 'error'
  readonly message: string
  readonly args: readonly unknown[]
}

interface FakeLogger {
  readonly logger: HostLogger
  readonly calls: LogCall[]
}

function createFakeLogger(): FakeLogger {
  const calls: LogCall[] = []
  const record = (level: LogCall['level']) => (message: string, ...args: unknown[]): void => {
    calls.push({ level, message, args })
  }
  return { logger: { info: record('info'), warn: record('warn'), error: record('error') }, calls }
}

function validLineCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'line_plot',
    title: 'Sine',
    subtitle: 'y = sin(x)',
    data: {
      series: [{ name: 'sin', color: '#247bbf', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      xAxis: { label: 'x' },
    },
  }
}

function validCardCandidate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    type: 'message_card',
    title: 'Deploy?',
    questionId: QUESTION,
    body: 'Choose.',
    actions: [{ id: 'approve', label: 'Approve', submitText: 'Approved.' }],
  }
}

function expectValidContent(content: unknown): RichContentV1 {
  const result = validateRichContent(content)
  if (!result.ok) assert.fail(`fixture content must be valid: ${JSON.stringify(result.issues)}`)
  return result.value
}

// ---------------------------------------------------------------------------
// rich_render tool.
// ---------------------------------------------------------------------------

describe('createRichRenderTool', () => {
  const tool = createRichRenderTool()
  const signal = new AbortController().signal

  interface RenderValue {
    readonly content: RichContentV1
    readonly summary: string
  }

  async function execute(args: unknown): Promise<RenderValue> {
    return await tool.execute(args, { signal }) as RenderValue
  }

  type RenderFn = (args: unknown, value: unknown) => readonly { readonly type: 'text'; readonly text: string }[]
  type MetaFn = (args: unknown, value: unknown) => RichMetaEnvelopeV1

  const render = tool.output.render as unknown as RenderFn
  const presentationMeta = tool.output.presentationMeta as unknown as MetaFn | undefined

  it('is registered under the expected name with a raw JSON-Schema parameter declaration', () => {
    assert.equal(tool.name, 'rich_render')
    assert.ok(tool.description.length > 100)
    assert.match(tool.description, /schemaVersion 1/)
    // A plain ToolDefinition forwards `parameters` as raw JSON Schema; only
    // `defineTool` compiles the author-side DSL. Verify the raw shape.
    const parameters = tool.parameters as Record<string, unknown>
    assert.equal(parameters['type'], 'object')
    assert.deepEqual(parameters['required'], ['content'])
    assert.equal(parameters['additionalProperties'], false)
    const properties = parameters['properties'] as Record<string, Record<string, unknown>>
    assert.equal(properties['content']?.['type'], 'object')
    assert.deepEqual(JSON.parse(JSON.stringify(parameters)) as unknown, parameters)
  })

  it('returns the canonical content plus a bounded summary for a valid call', async () => {
    const value = await execute({ content: validLineCandidate() })
    const expected = expectValidContent(validLineCandidate())
    assert.deepEqual(value.content, expected)
    assert.equal(value.summary, summarizeRichContent(expected))
    assert.ok(value.summary.length < 300, `summary must be bounded, was ${String(value.summary.length)}`)
    assert.equal(value.summary, 'line_plot "Sine": 1 series, 2 points')
  })

  it('returns only losslessly persistable JSON', async () => {
    const value = await execute({ content: validCardCandidate() })
    assert.deepEqual(JSON.parse(JSON.stringify(value)) as unknown, value)
  })

  it('throws with the validation code for an invalid payload', async () => {
    const emptyTitle = { ...validLineCandidate(), title: '   ' }
    await assert.rejects(execute({ content: emptyTitle }), /INVALID_TITLE@title/)

    const futureSchema = { ...validLineCandidate(), schemaVersion: 2 }
    await assert.rejects(execute({ content: futureSchema }), /UNSUPPORTED_SCHEMA_VERSION@schemaVersion/)

    const hugePoints = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'huge',
      data: { series: [{ name: 's', points: new Array(100_000).fill(null) }] },
    }
    await assert.rejects(execute({ content: hugePoints }), /TOO_MANY_POINTS/)
  })

  it('rejects missing arguments with a bounded validation error', async () => {
    await assert.rejects(execute(undefined), /NOT_AN_OBJECT/)
    await assert.rejects(execute(null), /NOT_AN_OBJECT/)
    await assert.rejects(execute({}), /NOT_AN_OBJECT/)
  })

  it('honours an aborted execution signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      tool.execute({ content: validLineCandidate() }, { signal: controller.signal }),
      /aborted/,
    )
  })

  it('exposes a JSON-serializable output.schema matching the canonical value', () => {
    const schema = tool.output.schema as Record<string, unknown>
    assert.equal(schema['type'], 'object')
    assert.deepEqual(schema['required'], ['content', 'summary'])
    assert.equal(schema['additionalProperties'], false)
    assert.deepEqual(JSON.parse(JSON.stringify(schema)) as unknown, schema)
  })

  it('renders exactly one bounded text block', async () => {
    const value = await execute({ content: validLineCandidate() })
    const blocks = render({ content: validLineCandidate() }, value)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0]?.type, 'text')
    assert.equal(blocks[0]?.text, value.summary)
    assert.ok((blocks[0]?.text ?? '').length < 300)
  })

  it('renders total output for malformed/pre-result values instead of throwing', () => {
    for (const rawValue of [undefined, null, {}, { summary: 42 }, { content: {} }] as unknown[]) {
      const blocks = render(undefined, rawValue)
      assert.equal(blocks.length, 1)
      assert.equal(blocks[0]?.type, 'text')
      assert.equal(typeof blocks[0]?.text, 'string')
    }
    assert.equal(render(undefined, { summary: 'ready' })[0]?.text, 'ready')
  })

  it('projects exactly the durable presentationMeta envelope', async () => {
    assert.notEqual(presentationMeta, undefined)
    const value = await execute({ content: validLineCandidate() })
    const meta = presentationMeta?.(undefined, value) as RichMetaEnvelopeV1
    assert.deepEqual(meta, {
      kind: RICH_META_KIND,
      envelopeVersion: RICH_META_ENVELOPE_VERSION,
      content: value.content,
    })
    assert.equal(Object.keys(meta).length, 3)
  })

  it('round-trips the presentation envelope through readRichMeta and JSON persistence', async () => {
    const value = await execute({ content: validCardCandidate() })
    const meta = presentationMeta?.(undefined, value) as RichMetaEnvelopeV1

    const read = readRichMeta(meta)
    assert.notEqual(read, undefined)
    assert.deepEqual(read, meta)

    const persisted = JSON.parse(JSON.stringify(meta)) as unknown
    const replayed = readRichMeta(persisted)
    assert.notEqual(replayed, undefined)
    assert.deepEqual(replayed, meta)
    // History replay must rebuild the identical static payload.
    assert.equal(JSON.stringify(replayed), JSON.stringify(meta))
  })
})

// ---------------------------------------------------------------------------
// rich-interaction command.
// ---------------------------------------------------------------------------

interface CommandHarness {
  readonly command: CommandDefinitionLike
  readonly logger: FakeLogger
  readonly tracker: AttemptTracker
  setNow(ms: number): void
  now(): number
}

function createHarness(options: { readonly auditLog?: string; readonly now?: number } = {}): CommandHarness {
  const logger = createFakeLogger()
  const tracker = new AttemptTracker(512)
  let current = options.now ?? FIXED_NOW
  const command = createRichInteractionCommand({
    logger: logger.logger,
    tracker,
    ...options.auditLog === undefined ? {} : { auditLog: options.auditLog },
    now: () => current,
  })
  return {
    command,
    logger,
    tracker,
    setNow(ms: number): void { current = ms },
    now(): number { return current },
  }
}

function rawInteraction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: RICH_INTERACTION_PROTOCOL,
    protocolVersion: 1,
    sessionId: SESSION,
    callId: CALL,
    cardKey: cardKeyFor(CALL, QUESTION),
    questionId: QUESTION,
    actionId: 'approve',
    attemptId: 'attempt-1',
    submittedAt: new Date(FIXED_NOW).toISOString(),
    answer: 'Approved.',
    ...overrides,
  }
}

function rawLine(record: Record<string, unknown>): string {
  return JSON.stringify(record)
}

function invocation(rawInput: string, agentId: string = SESSION): CommandInvocationLike {
  return { agent: { id: agentId }, rawInput, signal: new AbortController().signal }
}

type CommandResult = { readonly kind: 'success' | 'error'; readonly text?: string }

/** Run the (synchronous) handler and unwrap its result type for assertions. */
function dispatch(harness: CommandHarness, rawInput: string, agentId: string = SESSION): CommandResult {
  const outcome = harness.command.handler(invocation(rawInput, agentId))
  if (outcome instanceof Promise) assert.fail('rich-interaction handler must be synchronous')
  return outcome
}

function canonicalPayload(record: Record<string, unknown>): RichInteractionPayloadV1 {
  const result = validateInteractionPayload(record)
  if (!result.ok) assert.fail(`fixture payload must validate: ${JSON.stringify(result.issues)}`)
  return result.value
}

describe('createRichInteractionCommand  - success path', () => {
  it('records a valid interaction against the originating session', () => {
    const harness = createHarness()
    const result = dispatch(harness, rawLine(rawInteraction()))
    assert.equal(result.kind, 'success')
    assert.match(result.text ?? '', /rich-interaction recorded/)
    assert.match(result.text ?? '', /card=call-01#deploy-1/)
    assert.match(result.text ?? '', /action=approve/)
    assert.match(result.text ?? '', /attempt=attempt-1/)
    assert.equal((result.text ?? '').includes('(duplicate)'), false)
    assert.ok((result.text ?? '').length < 400)

    const info = harness.logger.calls.find(call => call.level === 'info')
    assert.notEqual(info, undefined)
    assert.match(info?.message ?? '', /interaction recorded/)
    assert.deepEqual(info?.args, [SESSION, 'call-01#deploy-1', 'approve', 'attempt-1', 'false'])
  })

  it('accepts a payload without questionId, recording callId as the card key', () => {
    const harness = createHarness()
    const record = rawInteraction({ cardKey: CALL })
    delete record['questionId']
    const result = dispatch(harness, rawLine(record))
    assert.equal(result.kind, 'success')
    assert.match(result.text ?? '', /card=call-01 /)
  })
})

describe('createRichInteractionCommand  - rejection paths', () => {
  it('rejects a session mismatch without recording', () => {
    const harness = createHarness()
    const result = dispatch(harness, rawLine(rawInteraction()), 'other-session')
    assert.equal(result.kind, 'error')
    assert.match(result.text ?? '',  /session mismatch/)
    assert.equal(harness.logger.calls.some(call => call.level === 'info'), false)
    assert.equal(harness.tracker.size, 0)
  })

  it('rejects stale and future-dated submissions', () => {
    const harness = createHarness()
    const stale = rawInteraction({ submittedAt: new Date(FIXED_NOW - MAX_INTERACTION_SKEW_MS - 1000).toISOString() })
    assert.equal(dispatch(harness, rawLine(stale)).kind, 'error')

    const future = rawInteraction({ submittedAt: new Date(FIXED_NOW + MAX_INTERACTION_SKEW_MS + 1000).toISOString() })
    const result = dispatch(harness, rawLine(future))
    assert.equal(result.kind, 'error')
    assert.match(result.text ?? '',  /stale submission/)

    // Exactly at the tolerated boundary is still accepted.
    const boundary = rawInteraction({ submittedAt: new Date(FIXED_NOW - MAX_INTERACTION_SKEW_MS).toISOString() })
    assert.equal(dispatch(harness, rawLine(boundary)).kind, 'success')
  })

  it('rejects malformed JSON and empty input', () => {
    const harness = createHarness()
    const malformed = dispatch(harness, '{not json')
    assert.equal(malformed.kind, 'error')
    assert.match(malformed.text ?? '',  /not valid JSON/)

    const empty = dispatch(harness, '   ')
    assert.equal(empty.kind, 'error')
    assert.match(empty.text ?? '',  /empty payload/)

    const emptyObject = dispatch(harness, '{}')
    assert.equal(emptyObject.kind, 'error')
    assert.match(emptyObject.text ?? '',  /invalid payload/)
  })

  it('rejects oversized raw input before parsing', () => {
    const harness = createHarness()
    const result = dispatch(harness, 'x'.repeat(MAX_INTERACTION_RAW_INPUT + 1))
    assert.equal(result.kind, 'error')
    assert.match(result.text ?? '',  /payload too large/)
  })

  it('surfaces field-level validation codes for an invalid payload', () => {
    const harness = createHarness()
    const invalid = rawInteraction({ protocol: 'rich-interaction-v2', actionId: 'bad id' })
    const result = dispatch(harness, rawLine(invalid))
    assert.equal(result.kind, 'error')
    assert.match(result.text ?? '',  /invalid payload/)
    assert.match(result.text ?? '',  /INVALID_ACTION@protocol/)
    assert.match(result.text ?? '',  /INVALID_ACTION@actionId/)
  })

  it('rejects a cardKey that does not match the call/question identity', () => {
    const harness = createHarness()
    const result = dispatch(harness, rawLine(rawInteraction({ cardKey: 'call-01#other' })))
    assert.equal(result.kind, 'error')
    assert.match(result.text ?? '',  /cardKey does not match/)

    const omittedQuestion = rawInteraction({ cardKey: 'call-01#ghost' })
    delete omittedQuestion['questionId']
    assert.equal(dispatch(harness, rawLine(omittedQuestion)).kind, 'error')
  })

  it('never records an attempt for a rejected payload', () => {
    const harness = createHarness()
    dispatch(harness, rawLine(rawInteraction({ cardKey: 'wrong' })))
    dispatch(harness, 'not json')
    assert.equal(harness.tracker.size, 0)
  })
})

describe('createRichInteractionCommand  - duplicate attempts', () => {
  it('returns success with (duplicate) on a repeated attempt id', () => {
    const harness = createHarness()
    const record = rawInteraction()
    const first = dispatch(harness, rawLine(record))
    const second = dispatch(harness, rawLine({ ...record, answer: 'Again.' }))
    assert.equal(first.kind, 'success')
    assert.equal((first.text ?? '').includes('(duplicate)'), false)
    assert.equal(second.kind, 'success')
    assert.match(second.text ?? '', /\(duplicate\)/)
    assert.equal(harness.tracker.size, 1)
  })

  it('treats an attempt already observed before dispatch as a duplicate', () => {
    const harness = createHarness()
    harness.tracker.observe('attempt-1')
    const result = dispatch(harness, rawLine(rawInteraction()))
    assert.equal(result.kind, 'success')
    assert.match(result.text ?? '', /\(duplicate\)/)
  })

  it('distinguishes different attempt ids', () => {
    const harness = createHarness()
    const first = dispatch(harness, rawLine(rawInteraction({ attemptId: 'attempt-1' })))
    const second = dispatch(harness, rawLine(rawInteraction({ attemptId: 'attempt-2' })))
    assert.equal((first.text ?? '').includes('(duplicate)'), false)
    assert.equal((second.text ?? '').includes('(duplicate)'), false)
    assert.equal(harness.tracker.size, 2)
  })
})

describe('createRichInteractionCommand  - audit log', () => {
  interface AuditRecord extends RichInteractionPayloadV1 {
    readonly receivedAt: string
    readonly agentId: string
    readonly duplicate: boolean
  }

  function readAudit(path: string): AuditRecord[] {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as AuditRecord)
  }

  it('appends one JSONL record per accepted interaction', () => {
    const auditLog = join(tempRoot, 'audit', 'interactions.jsonl')
    const harness = createHarness({ auditLog })
    const record = rawInteraction()
    assert.equal(dispatch(harness, rawLine(record)).kind, 'success')

    const lines = readAudit(auditLog)
    assert.equal(lines.length, 1)
    const written = lines[0]
    assert.notEqual(written, undefined)
    assert.deepEqual(written, {
      ...canonicalPayload(record),
      receivedAt: new Date(FIXED_NOW).toISOString(),
      agentId: SESSION,
      duplicate: false,
    })
  })

  it('marks duplicate deliveries in the audit record', () => {
    const auditLog = join(tempRoot, 'audit-duplicate', 'interactions.jsonl')
    const harness = createHarness({ auditLog })
    dispatch(harness, rawLine(rawInteraction()))
    dispatch(harness, rawLine(rawInteraction()))
    const lines = readAudit(auditLog)
    assert.equal(lines.length, 2)
    assert.equal(lines[0]?.duplicate, false)
    assert.equal(lines[1]?.duplicate, true)
  })

  it('uses the injected clock for receivedAt', () => {
    const auditLog = join(tempRoot, 'audit-clock', 'interactions.jsonl')
    const harness = createHarness({ auditLog, now: FIXED_NOW + 60_000 })
    const record = rawInteraction({ submittedAt: new Date(FIXED_NOW + 60_000).toISOString() })
    dispatch(harness, rawLine(record))
    assert.equal(readAudit(auditLog)[0]?.receivedAt, new Date(FIXED_NOW + 60_000).toISOString())
  })

  it('does not write audit records for rejected interactions', () => {
    const auditLog = join(tempRoot, 'audit-rejected', 'interactions.jsonl')
    const harness = createHarness({ auditLog })
    dispatch(harness, rawLine(rawInteraction({ cardKey: 'wrong' })), 'other-session')
    assert.equal(existsSync(auditLog), false)
  })

  it('does not create an audit file when no path is configured', () => {
    const harness = createHarness()
    assert.equal(dispatch(harness, rawLine(rawInteraction())).kind, 'success')
    assert.equal(harness.logger.calls.some(call => call.level === 'warn'), false)
  })

  it('treats the audit append as best-effort when the path is unwritable', () => {
    const blocker = join(tempRoot, 'not-a-directory')
    writeFileSync(blocker, 'file blocks mkdir')
    const auditLog = join(blocker, 'nested', 'interactions.jsonl')
    const harness = createHarness({ auditLog })

    let result: CommandResult | undefined
    assert.doesNotThrow(() => { result = dispatch(harness, rawLine(rawInteraction())) })
    assert.equal(result?.kind, 'success')
    assert.match(result?.text ?? '', /recorded/)

    const warning = harness.logger.calls.find(call => call.level === 'warn')
    assert.notEqual(warning, undefined)
    assert.match(warning?.message ?? '', /audit append failed/)
  })
})
