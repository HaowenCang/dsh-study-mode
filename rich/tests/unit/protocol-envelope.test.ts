/**
 * Envelope / type-guard / diagnostic-term tests for RichContentV1.
 *
 * The persisted `meta` envelope is the ONLY source of a rich card after a
 * reload, so these tests pin the guard behavior: foreign or malformed meta is
 * ignored (never thrown), valid meta round-trips through JSON persistence, and
 * diagnostic strings stay bounded.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatValidationIssues,
  isRichContentV1,
  isRichMetaEnvelopeV1,
  readRichMeta,
  RICH_CONTENT_SCHEMA_VERSION,
  RICH_CONTENT_TYPES,
  RICH_INTERACTION_PROTOCOL,
  RICH_META_ENVELOPE_VERSION,
  RICH_META_KIND,
  RICH_LIMITS,
  serializedByteSize,
  summarizeRichContent,
  validateRichContent,
  type RichContentV1,
  type RichMetaEnvelopeV1,
  type RichValidationIssue,
} from '../../src/shared/index'

function validLineContent(): RichContentV1 {
  const result = validateRichContent({
    schemaVersion: 1,
    type: 'line_plot',
    title: 'Sine',
    data: { series: [{ name: 'sin', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] },
  })
  if (!result.ok) assert.fail('fixture must be valid')
  return result.value
}

function validCardContent(): RichContentV1 {
  const result = validateRichContent({
    schemaVersion: 1,
    type: 'message_card',
    title: 'Card',
    body: 'Body',
    actions: [
      { id: 'a', label: 'A', submitText: 'A.' },
      { id: 'b', label: 'B', submitText: 'B.' },
    ],
  })
  if (!result.ok) assert.fail('fixture must be valid')
  return result.value
}

function validEnvelope(): RichMetaEnvelopeV1 {
  return {
    kind: RICH_META_KIND,
    envelopeVersion: RICH_META_ENVELOPE_VERSION,
    content: validLineContent(),
  }
}

describe('protocol constants', () => {
  it('pins the v1 marker values', () => {
    assert.equal(RICH_CONTENT_SCHEMA_VERSION, 1)
    assert.equal(RICH_META_KIND, 'rich-response')
    assert.equal(RICH_META_ENVELOPE_VERSION, 1)
    assert.equal(RICH_INTERACTION_PROTOCOL, 'rich-interaction-v1')
    assert.deepEqual([...RICH_CONTENT_TYPES], ['line_plot', 'scatter_plot', 'basic_diagram', 'message_card'])
  })

  it('pins the resource limits used by the docs', () => {
    assert.deepEqual(RICH_LIMITS, {
      maxSerializedBytes: 256 * 1024,
      maxTitleLength: 200,
      maxSubtitleLength: 500,
      maxSeries: 8,
      maxPointsPerSeries: 2048,
      maxTotalPoints: 8192,
      maxAxisLabelLength: 80,
      maxDiagramNodes: 60,
      maxDiagramEdges: 120,
      maxNodeIdLength: 64,
      maxNodeLabelLength: 120,
      maxEdgeLabelLength: 80,
      maxCardBodyLength: 4000,
      maxCardActions: 5,
      maxActionIdLength: 64,
      maxActionLabelLength: 120,
      maxSubmitTextLength: 2000,
      maxQuestionIdLength: 64,
      maxAbsCoordinate: 1e7,
    })
  })
})

describe('readRichMeta', () => {
  it('returns the canonical envelope for a valid persisted meta value', () => {
    const envelope = validEnvelope()
    const read = readRichMeta(envelope)
    assert.notEqual(read, undefined)
    assert.equal(read?.kind, RICH_META_KIND)
    assert.equal(read?.envelopeVersion, RICH_META_ENVELOPE_VERSION)
    assert.deepEqual(read?.content, envelope.content)
  })

  it('ignores extra keys beside the envelope fields', () => {
    const persisted = { ...validEnvelope(), extra: 'ignored', receivedAt: '2026-01-01T00:00:00.000Z' }
    assert.deepEqual(readRichMeta(persisted)?.content, validEnvelope().content)
  })

  it('returns undefined for foreign meta kinds', () => {
    for (const kind of ['tool-result', 'rich', '', 1, null] as unknown[]) {
      assert.equal(readRichMeta({ ...validEnvelope(), kind }), undefined)
    }
  })

  it('returns undefined for a wrong envelopeVersion', () => {
    assert.equal(readRichMeta({ ...validEnvelope(), envelopeVersion: 2 }), undefined)
    assert.equal(readRichMeta({ ...validEnvelope(), envelopeVersion: '1' }), undefined)
    assert.equal(readRichMeta({ ...validEnvelope(), envelopeVersion: undefined }), undefined)
  })

  it('returns undefined for invalid or missing content', () => {
    const invalidContent: unknown[] = [
      undefined,
      null,
      42,
      { schemaVersion: 1, type: 'message_card', title: 'only title' },
      { schemaVersion: 2, type: 'line_plot', title: 'future', data: { series: [] } },
    ]
    for (const content of invalidContent) {
      assert.equal(readRichMeta({ kind: RICH_META_KIND, envelopeVersion: RICH_META_ENVELOPE_VERSION, content }), undefined)
    }
  })

  it('returns undefined for non-object meta values', () => {
    for (const value of [undefined, null, 0, 'x', [], true] as unknown[]) {
      assert.equal(readRichMeta(value), undefined)
    }
  })

  it('round-trips through JSON persistence and rebuilds the identical static payload', () => {
    const original = validEnvelope()
    const persisted = JSON.parse(JSON.stringify(original)) as unknown
    const read = readRichMeta(persisted)
    assert.notEqual(read, undefined)
    assert.deepEqual(read, original)
    // Values are canonical: a second round-trip is byte-identical.
    assert.equal(JSON.stringify(read), JSON.stringify(original))
  })

  it('never throws for hostile meta values (throwing accessor / proxy)', () => {
    const throwing: Record<string, unknown> = {}
    Object.defineProperty(throwing, 'kind', {
      enumerable: true,
      get() { throw new Error('boom') },
    })
    assert.doesNotThrow(() => readRichMeta(throwing))
    assert.equal(readRichMeta(throwing), undefined)

    const proxy = new Proxy({}, {
      getPrototypeOf() { throw new Error('trap') },
      get() { throw new Error('trap') },
    })
    assert.doesNotThrow(() => readRichMeta(proxy))
    assert.equal(readRichMeta(proxy), undefined)
  })
})

describe('isRichMetaEnvelopeV1', () => {
  it('agrees with readRichMeta on a corpus', () => {
    const corpus: unknown[] = [
      validEnvelope(),
      JSON.parse(JSON.stringify(validEnvelope())) as unknown,
      { ...validEnvelope(), kind: 'other' },
      { ...validEnvelope(), envelopeVersion: 2 },
      { ...validEnvelope(), content: null },
      null,
      undefined,
      [],
      'envelope',
      { kind: RICH_META_KIND },
    ]
    for (const candidate of corpus) {
      assert.equal(isRichMetaEnvelopeV1(candidate), readRichMeta(candidate) !== undefined)
    }
  })
})

describe('isRichContentV1', () => {
  it('agrees with validateRichContent across valid and invalid payloads', () => {
    const corpus: unknown[] = [
      validLineContent(),
      validCardContent(),
      {
        schemaVersion: 1,
        type: 'basic_diagram',
        title: 'Flow',
        data: { nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }], edges: [] },
      },
      null,
      undefined,
      42,
      [],
      { schemaVersion: 1 },
      { schemaVersion: 2, type: 'line_plot', title: 'x', data: { series: [] } },
      { schemaVersion: 1, type: 'unknown', title: 'x', data: { series: [] } },
      { schemaVersion: 1, type: 'message_card', title: '', body: 'b' },
    ]
    for (const candidate of corpus) {
      assert.equal(isRichContentV1(candidate), validateRichContent(candidate).ok)
    }
    assert.equal(isRichContentV1(validLineContent()), true)
  })

  it('narrows to a usable RichContentV1 at runtime', () => {
    const candidate: unknown = validCardContent()
    if (!isRichContentV1(candidate)) assert.fail('expected valid content')
    assert.equal(candidate.type, 'message_card')
    assert.equal(candidate.body, 'Body')
  })
})

describe('formatValidationIssues', () => {
  function manyIssues(count: number): RichValidationIssue[] {
    return Array.from({ length: count }, (_, index) => ({
      code: 'NON_FINITE_NUMBER',
      path: `data.series[0].points[${String(index)}].y`,
      detail: 'must be a finite, canonical JSON number',
    }))
  }

  it('formats the first 8 issues plus a count suffix', () => {
    const formatted = formatValidationIssues(manyIssues(20))
    assert.equal(formatted.split('; ').length, 8)
    assert.match(formatted, /\(\+12 more\)$/)
    assert.match(formatted, /^NON_FINITE_NUMBER@data\.series\[0\]\.points\[0\]\.y: /)
  })

  it('is bounded for very large issue lists', () => {
    const formatted = formatValidationIssues(manyIssues(10_000))
    assert.ok(formatted.length < 2000, `diagnostic should stay bounded, was ${String(formatted.length)} chars`)
    assert.equal(formatted.includes('\n'), false)
    assert.match(formatted, /\(\+9992 more\)$/)
  })

  it('uses <root> for the empty path and handles no issues', () => {
    const formatted = formatValidationIssues([{ code: 'NOT_AN_OBJECT', path: '', detail: 'payload must be a JSON object' }])
    assert.match(formatted, /^NOT_AN_OBJECT@<root>: /)
    assert.equal(formatValidationIssues([]), '')
  })

  it('keeps a real validation rejection bounded', () => {
    const points = Array.from({ length: 64 }, () => 'not a point')
    const result = validateRichContent({
      schemaVersion: 1,
      type: 'line_plot',
      title: 'bad points',
      data: { series: [{ name: 's', points }] },
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    const formatted = formatValidationIssues(result.issues)
    assert.ok(formatted.length < 2000)
    assert.match(formatted, /INVALID_POINT@data\.series\[0\]\.points\[0\]/)
  })
})

describe('serializedByteSize', () => {
  it('counts UTF-8 bytes, not UTF-16 code units', () => {
    const ascii = { text: 'abc' }
    assert.equal(serializedByteSize(ascii), Buffer.byteLength(JSON.stringify(ascii), 'utf8'))

    const multibyte = { text: 'é中🙂' }
    const expected = Buffer.byteLength(JSON.stringify(multibyte), 'utf8')
    assert.equal(serializedByteSize(multibyte), expected)
    assert.ok(expected > JSON.stringify(multibyte).length, 'fixture must actually be multibyte')
  })

  it('matches JSON.stringify byte length for arbitrary valid payloads', () => {
    for (const value of [null, true, 0, 'x', [1, 2, 3], { a: [1, { b: 'é' }] }] as unknown[]) {
      assert.equal(serializedByteSize(value), Buffer.byteLength(JSON.stringify(value), 'utf8'))
    }
  })

  it('returns Infinity instead of throwing for non-JSON values', () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic['self'] = cyclic
    assert.equal(serializedByteSize(cyclic), Number.POSITIVE_INFINITY)
    assert.equal(serializedByteSize(10n), Number.POSITIVE_INFINITY)
    assert.equal(serializedByteSize(undefined), Number.POSITIVE_INFINITY)
    assert.equal(serializedByteSize(() => undefined), Number.POSITIVE_INFINITY)
    assert.equal(serializedByteSize(Symbol('s')), Number.POSITIVE_INFINITY)
  })

  it('stays finite for the largest allowed payload', () => {
    const payload = { schemaVersion: 1, type: 'message_card', title: 't', body: 'x'.repeat(4000) }
    const size = serializedByteSize(payload)
    assert.ok(Number.isFinite(size))
    assert.ok(size < RICH_LIMITS.maxSerializedBytes)
  })
})

describe('summarizeRichContent', () => {
  it('summarizes plots with series and total point counts', () => {
    assert.equal(summarizeRichContent(validLineContent()), 'line_plot "Sine": 1 series, 2 points')
  })

  it('summarizes diagrams with node and edge counts', () => {
    const result = validateRichContent({
      schemaVersion: 1,
      type: 'basic_diagram',
      title: 'Flow',
      data: {
        nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }, { id: 'b', label: 'B', x: 10, y: 10 }],
        edges: [{ from: 'a', to: 'b' }],
      },
    })
    if (!result.ok) assert.fail('fixture must be valid')
    assert.equal(summarizeRichContent(result.value), 'basic_diagram "Flow": 2 nodes, 1 edges')
  })

  it('summarizes cards with their action count', () => {
    assert.equal(summarizeRichContent(validCardContent()), 'message_card "Card": 2 actions')
  })

  it('stays bounded for maximum-length titles', () => {
    const result = validateRichContent({
      schemaVersion: 1,
      type: 'message_card',
      title: 't'.repeat(RICH_LIMITS.maxTitleLength),
      body: 'b',
    })
    if (!result.ok) assert.fail('fixture must be valid')
    const summary = summarizeRichContent(result.value)
    assert.ok(summary.length < 300, `summary must stay bounded, was ${String(summary.length)} chars`)
    assert.equal(summary.includes('\n'), false)
  })
})
