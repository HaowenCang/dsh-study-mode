/**
 * Denial-of-service bounds for RichContentV1 validation.
 *
 * The validator runs host-side on every model tool call and client-side on
 * every rendered card, so adversarial size must fail fast from cheap length
 * checks instead of walking attacker-sized arrays. Timings are deliberately
 * generous (a CI machine many times slower than a laptop still passes); they
 * exist to catch accidental O(n) work before the cap, not to benchmark.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { performance } from 'node:perf_hooks'
import {
  RICH_LIMITS,
  validateRichContent,
  type RichValidationCode,
} from '../../src/shared/index'

/** Generous upper bound; the real cost of these calls is well under 10ms. */
const ELAPSED_BUDGET_MS = 500

function measure(value: unknown): { elapsedMs: number; code: RichValidationCode | undefined } {
  const started = performance.now()
  const result = validateRichContent(value)
  const elapsedMs = performance.now() - started
  return { elapsedMs, code: result.ok ? undefined : result.issues[0]?.code }
}

function assertBounded(label: string, measured: { elapsedMs: number }): void {
  assert.ok(
    measured.elapsedMs < ELAPSED_BUDGET_MS,
    `${label} took ${measured.elapsedMs.toFixed(1)}ms (budget ${String(ELAPSED_BUDGET_MS)}ms)`,
  )
}

describe('validation denial-of-service bounds', () => {
  it('validates a 2048-point series within a bounded time', () => {
    const payload = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'max points',
      data: {
        series: [{
          name: 'dense',
          points: Array.from({ length: RICH_LIMITS.maxPointsPerSeries }, (_, index) => ({
            x: index / 100,
            y: Math.sin(index / 100),
          })),
        }],
      },
    }
    const measured = measure(payload)
    assertBounded('2048-point validation', measured)
    assert.equal(measured.code, undefined)
  })

  it('validates the full allowed maximum (8 series / 8192 points) within a bounded time', () => {
    const payload = {
      schemaVersion: 1,
      type: 'scatter_plot',
      title: 'max total points',
      data: {
        series: Array.from({ length: RICH_LIMITS.maxSeries }, (_, seriesIndex) => ({
          name: `s${String(seriesIndex)}`,
          points: Array.from({ length: RICH_LIMITS.maxTotalPoints / RICH_LIMITS.maxSeries }, (_, pointIndex) => ({
            x: pointIndex,
            y: seriesIndex,
          })),
        })),
      },
    }
    const measured = measure(payload)
    assertBounded('maximum allowed payload validation', measured)
    assert.equal(measured.code, undefined)
  })

  it('rejects a 100k-point payload with TOO_MANY_POINTS without per-point work', () => {
    // A throwing element proves the validator never reads points: the array
    // length alone must decide the rejection.
    const hostilePoint = new Proxy({}, { get() { throw new Error('point element was read') } })
    const payload = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'huge',
      data: { series: [{ name: 's', points: new Array(100_000).fill(hostilePoint) }] },
    }
    const measured = measure(payload)
    assert.equal(measured.code, 'TOO_MANY_POINTS')
    assertBounded('100k-point rejection', measured)
  })

  it('rejects a 100k-series payload with TOO_MANY_SERIES without walking series', () => {
    const payload = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'huge',
      data: { series: new Array(100_000).fill(null) },
    }
    const measured = measure(payload)
    assert.equal(measured.code, 'TOO_MANY_SERIES')
    assertBounded('100k-series rejection', measured)
  })

  it('rejects a 100k-node diagram with TOO_MANY_NODES without walking nodes', () => {
    const payload = {
      schemaVersion: 1,
      type: 'basic_diagram',
      title: 'huge',
      data: { nodes: new Array(100_000).fill(null), edges: [] },
    }
    const measured = measure(payload)
    assert.equal(measured.code, 'TOO_MANY_NODES')
    assertBounded('100k-node rejection', measured)
  })

  it('rejects a 100k-action card with TOO_MANY_ACTIONS without walking actions', () => {
    const payload = {
      schemaVersion: 1,
      type: 'message_card',
      title: 'huge',
      body: 'body',
      actions: new Array(100_000).fill(null),
    }
    const measured = measure(payload)
    assert.equal(measured.code, 'TOO_MANY_ACTIONS')
    assertBounded('100k-action rejection', measured)
  })

  it('rejects pathological nesting without throwing (serialization stays total)', () => {
    let deep: unknown = 'leaf'
    for (let index = 0; index < 100_000; index += 1) deep = [deep]
    const payload = { schemaVersion: 1, type: 'message_card', title: 'deep', body: 'body', padding: deep }
    let measured: { elapsedMs: number; code: RichValidationCode | undefined } | undefined
    assert.doesNotThrow(() => { measured = measure(payload) })
    assert.notEqual(measured, undefined)
    assert.equal(measured?.code, 'PAYLOAD_TOO_LARGE')
    assertBounded('pathological nesting rejection', measured as { elapsedMs: number })
  })

  it('rejects a 256 KiB+ payload by byte size without per-point validation', () => {
    // Structurally valid (caps pass) but padded far past the byte limit.
    const payload = {
      schemaVersion: 1,
      type: 'line_plot',
      title: 'padded',
      data: { series: [{ name: 's', points: [{ x: 0, y: 0 }] }] },
      padding: 'x'.repeat(RICH_LIMITS.maxSerializedBytes + 1024),
    }
    const measured = measure(payload)
    assert.equal(measured.code, 'PAYLOAD_TOO_LARGE')
    assertBounded('oversized payload rejection', measured)
  })
})
