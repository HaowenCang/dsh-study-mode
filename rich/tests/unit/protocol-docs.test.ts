/**
 * Documentation conformance tests.
 *
 * The protocol documentation is executable: every `json valid` example must
 * pass the shared validator and canonicalize, every `json invalid <CODE>`
 * example must fail with that exact code, and the limits/error-code tables must
 * stay in sync with `src/shared/protocol.ts`. This prevents the spec from
 * drifting away from the implementation between edits.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  cardKeyFor,
  RICH_CONTENT_TYPES,
  RICH_INTERACTION_PROTOCOL,
  RICH_LIMITS,
  readRichMeta,
  validateInteractionPayload,
  validateRichContent,
  type RichValidationCode,
} from '../../src/shared/index'

/** The test runner spawns `node --test` with the repository root as cwd. */
function resolveRepoFile(relative: string): string {
  const fromCwd = join(process.cwd(), relative)
  if (existsSync(fromCwd)) return fromCwd
  // Bundled location is `<repo>/.tmp/unit/<name>.mjs`.
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url))
}

const protocolDoc = readFileSync(resolveRepoFile('docs/protocol-v1.md'), 'utf8')
const securityDoc = readFileSync(resolveRepoFile('docs/security-model.md'), 'utf8')
const protocolSource = readFileSync(resolveRepoFile('src/shared/protocol.ts'), 'utf8')

interface JsonFence {
  readonly info: string
  readonly body: string
}

function extractJsonFences(markdown: string): JsonFence[] {
  const fences: JsonFence[] = []
  // Allow the fence to be indented (examples nested under numbered list items);
  // JSON.parse accepts the resulting leading whitespace.
  const pattern = /^[ \t]*```json([^\n]*)\n([\s\S]*?)^[ \t]*```$/gm
  let match: RegExpExecArray | null = pattern.exec(markdown)
  while (match !== null) {
    fences.push({ info: (match[1] ?? '').trim(), body: match[2] ?? '' })
    match = pattern.exec(markdown)
  }
  return fences
}

function parseFence(fence: JsonFence): unknown {
  try {
    return JSON.parse(fence.body) as unknown
  } catch (error) {
    assert.fail(`docs JSON example is not parseable: ${String(error)}\n${fence.body.slice(0, 200)}`)
  }
}

const fences = extractJsonFences(protocolDoc)
const validFences = fences.filter(fence => fence.info === 'valid')
const invalidFences = fences.filter(fence => fence.info.startsWith('invalid '))
const interactionFences = fences.filter(fence => fence.info === 'interaction')
const envelopeFences = fences.filter(fence => fence.info === 'envelope')

function describeResult(result: ReturnType<typeof validateRichContent>): string {
  return result.ok
    ? `passed as ${result.value.type}`
    : result.issues.map(item => `${item.code}@${item.path}`).join(', ')
}

describe('documentation: code fences are well formed', () => {
  it('labels every JSON fence with a known marker', () => {
    assert.ok(fences.length >= 9, `expected at least 9 JSON examples, found ${String(fences.length)}`)
    for (const fence of fences) {
      assert.match(
        fence.info,
        /^(?:valid|invalid [A-Z_]+|interaction|envelope)$/,
        `unexpected JSON fence marker: "${fence.info}"`,
      )
    }
  })

  it('contains at least 4 valid content examples, 2 invalid examples, and the envelope/interaction specs', () => {
    assert.ok(validFences.length >= 4, `expected >= 4 valid examples, found ${String(validFences.length)}`)
    assert.ok(invalidFences.length >= 2, `expected >= 2 invalid examples, found ${String(invalidFences.length)}`)
    assert.equal(interactionFences.length, 1)
    assert.equal(envelopeFences.length, 1)
  })

  it('covers all four content types, with line_plot exercised twice', () => {
    const types = validFences.map(fence => (parseFence(fence) as { type?: unknown }).type)
    for (const type of RICH_CONTENT_TYPES) {
      assert.ok(types.includes(type), `missing a valid example for ${type}`)
    }
    assert.ok(types.filter(type => type === 'line_plot').length >= 2, 'expected sine and quadratic line_plot examples')
    assert.ok(types.filter(type => type === 'scatter_plot').length >= 1)
  })
})

describe('documentation: valid examples match the implementation', () => {
  it('accepts every valid example and leaves it canonical after a JSON round-trip', () => {
    for (const [index, fence] of validFences.entries()) {
      const result = validateRichContent(parseFence(fence))
      assert.ok(result.ok, `valid example #${String(index + 1)} was rejected: ${describeResult(result)}`)
      if (!result.ok) continue

      const persisted = JSON.parse(JSON.stringify(result.value)) as unknown
      assert.deepEqual(persisted, result.value, `valid example #${String(index + 1)} is not canonical JSON`)

      const revalidated = validateRichContent(persisted)
      assert.ok(revalidated.ok, `persisted example #${String(index + 1)} failed revalidation: ${describeResult(revalidated)}`)
      if (revalidated.ok) assert.deepEqual(revalidated.value, result.value)
    }
  })

  it('shows the scatter example with two series and duplicate x values', () => {
    const scatter = validFences
      .map(parseFence)
      .find(value => (value as { type?: unknown }).type === 'scatter_plot') as
        | { data: { series: { points: { x: number }[] }[] } }
        | undefined
    assert.notEqual(scatter, undefined)
    assert.equal(scatter?.data.series.length, 2)
    const xs = scatter?.data.series.flatMap(series => series.points.map(point => point.x)) ?? []
    assert.ok(new Set(xs).size < xs.length, 'scatter example should contain duplicate x values')
  })

  it('shows the interactive card with bounded plain-text actions', () => {
    const card = validFences
      .map(parseFence)
      .find(value => (value as { type?: unknown }).type === 'message_card') as
        | { questionId?: string; actions?: { id: string; submitText: string }[] }
        | undefined
    assert.notEqual(card, undefined)
    assert.equal(typeof card?.questionId, 'string')
    assert.ok((card?.actions?.length ?? 0) > 0)
    for (const action of card?.actions ?? []) {
      assert.ok(action.submitText.length > 0)
      assert.equal(/^https?:/i.test(action.submitText), false)
    }
  })
})

describe('documentation: invalid examples produce the documented code', () => {
  it('rejects every invalid example with its declared code', () => {
    for (const fence of invalidFences) {
      const marker = fence.info.split(' ')[1]
      assert.ok(marker !== undefined && marker.length > 0, `missing code in fence marker "${fence.info}"`)
      const expected = marker as RichValidationCode
      const result = validateRichContent(parseFence(fence))
      assert.equal(result.ok, false, `invalid example marked ${expected} unexpectedly passed`)
      if (result.ok) continue
      assert.ok(
        result.issues.some(issue => issue.code === expected),
        `expected ${expected}, got ${describeResult(result)}`,
      )
    }
  })

  it('documents the negative-zero rejection that the implementation enforces', () => {
    assert.ok(protocolDoc.includes('`-0`'), 'protocol doc must explain the -0 rule')
    const negativeZero = invalidFences.find(fence => fence.info === 'invalid NON_FINITE_NUMBER')
    assert.notEqual(negativeZero, undefined)
  })
})

describe('documentation: envelope and interaction examples', () => {
  it('reads back the documented envelope example', () => {
    const envelope = envelopeFences[0]
    assert.notEqual(envelope, undefined)
    const read = readRichMeta(parseFence(envelope as JsonFence))
    assert.notEqual(read, undefined)
    assert.equal(read?.kind, 'rich-response')
    assert.equal(read?.envelopeVersion, 1)
    assert.ok(validateRichContent(read?.content).ok)
  })

  it('validates the documented interaction example and its card identity', () => {
    const fence = interactionFences[0]
    assert.notEqual(fence, undefined)
    const parsed = parseFence(fence as JsonFence) as { callId?: string; questionId?: string; cardKey?: string }
    const result = validateInteractionPayload(parsed)
    assert.ok(result.ok, `documented interaction payload is invalid: ${JSON.stringify(result.ok ? [] : result.issues)}`)
    if (!result.ok) return
    assert.equal(result.value.protocol, RICH_INTERACTION_PROTOCOL)
    assert.equal(result.value.cardKey, cardKeyFor(result.value.callId, result.value.questionId))
  })
})

describe('documentation: limits and error-code tables stay in sync', () => {
  it('lists every RICH_LIMITS key with its exact value', () => {
    for (const [key, value] of Object.entries(RICH_LIMITS)) {
      const row = new RegExp(`\\|\\s*\`${key}\`\\s*\\|\\s*${String(value)}\\s*\\|`)
      assert.match(protocolDoc, row, `limits table is missing the exact row for ${key}=${String(value)}`)
    }
  })

  it('lists every RichValidationCode member from the protocol union', () => {
    const start = protocolSource.indexOf('export type RichValidationCode')
    assert.notEqual(start, -1, 'could not locate RichValidationCode in protocol.ts')
    const section = protocolSource.slice(start)
    const codes = [...section.matchAll(/'([A-Z][A-Z_]+)'/g)].map(match => match[1] as RichValidationCode)
    assert.ok(codes.length >= 20, `expected the full code union, found ${String(codes.length)} codes`)
    for (const code of codes) {
      assert.ok(protocolDoc.includes(`\`${code}\``), `error-code table is missing ${code}`)
    }
  })

  it('lists every supported content type', () => {
    for (const type of RICH_CONTENT_TYPES) {
      assert.ok(protocolDoc.includes(`\`${type}\``), `protocol doc is missing type ${type}`)
    }
  })

  it('documents the v1-only versioning policy', () => {
    assert.match(protocolDoc, /v1 is the only understood content schema/i)
    assert.ok(protocolDoc.includes('UNSUPPORTED_SCHEMA_VERSION'))
    assert.ok(protocolDoc.includes('never rendered'))
  })
})

describe('documentation: security model coverage', () => {
  it('contains every required section heading', () => {
    const headings = [
      'Trust boundary',
      'XSS / SVG-injection defense in depth',
      'Resource limits and denial of service',
      'Cross-session submission defense',
      'Persistence tampering',
      'Host audit-log write path',
      'Dependency surface and supply chain',
      'Residual risks',
    ]
    for (const heading of headings) {
      assert.ok(securityDoc.includes(heading), `security model is missing section "${heading}"`)
    }
  })

  it('cross-links the protocol spec', () => {
    assert.ok(securityDoc.includes('protocol-v1.md'))
    assert.ok(protocolDoc.includes('security-model.md'))
  })

  it('documents what is structurally impossible and the core defenses', () => {
    for (const claim of ['dangerouslySetInnerHTML', 'no URLs', 'no SVG source', 'no executable code', 'foreign meta', 'operator-configured only']) {
      assert.ok(securityDoc.toLowerCase().includes(claim.toLowerCase()), `security model should mention "${claim}"`)
    }
  })

  it('ranks residual risks with explicit severities', () => {
    assert.ok(securityDoc.includes('| R1 | Medium |'), 'expected the Medium residual risk row')
    const lowRows = securityDoc.split('\n').filter(line => /^\| R\d+ \| Low \|/.test(line))
    assert.ok(lowRows.length >= 5, `expected at least 5 Low residual risks, found ${String(lowRows.length)}`)
    assert.match(securityDoc, /Accepted|Mitigated/, 'each residual risk should record its status')
  })
})
