/**
 * Plan P7: one shared figure check, the read-only `rich_check_figure` tool, and the Host `inline`
 * switch that drops the copy-the-image-line guidance when answers draw fences inline.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'
import { checkFigure, formatFigureIssues } from '../../src/shared/figure-check'
import { createCheckFigureTool } from '../../src/host/tools/rich-check-figure'
import { apply, inlineActive } from '../../src/host/index'
import type { ToolDefinitionLike } from '../../src/host/types'

const SVG_OK = '<svg viewBox="0 0 10 10"><title>T</title><rect width="5" height="5" fill="#4884aa"/></svg>'
const SVG_BAD = '<svg viewBox="0 0 10 10">\n<rect width="5"\n  onclick="x()"/>\n</svg>'

describe('checkFigure', () => {
  it('accepts every supported fence language', () => {
    assert.equal(checkFigure('svg', SVG_OK).ok, true)
    assert.equal(checkFigure('dsh-svg', SVG_OK).ok, true)
    const flow = checkFigure('mermaid', '%% title: Steps\nflowchart TD\n  A[Read] --> B[Solve]')
    assert.ok(flow.ok && flow.kind === 'diagram' && flow.content.title === 'Steps')
    assert.ok(checkFigure('dsh-mermaid', 'flowchart LR\nA --> B', { defaultTitle: '流程图' }).ok)
    const plot = checkFigure('dsh-plot', JSON.stringify({ title: 'Sine', fns: [{ expr: 'sin(x)', label: 'y' }], x: [0, 6] }))
    assert.ok(plot.ok && plot.kind === 'plot')
    const heat = checkFigure('dsh-heatmap', JSON.stringify({ title: 'H', values: [[0, 1], [2, 3]], colorScale: { palette: 'sequential', label: 'v' } }))
    assert.ok(heat.ok && heat.kind === 'heatmap')
    const phys = checkFigure('dsh-physics', '{"demo":"infinite_well"}')
    assert.ok(phys.ok && phys.kind === 'physics' && phys.demo === 'infinite_well')
  })

  it('refuses with line numbers where the source position is known', () => {
    const svg = checkFigure('svg', SVG_BAD)
    assert.ok(!svg.ok)
    assert.ok(svg.issues.some(issue => typeof issue !== 'string' && issue.line === 3 && issue.message.includes('onclick')), JSON.stringify(svg.issues))
    const flow = checkFigure('mermaid', 'flowchart TD\n  A --> B\n  click A call()')
    assert.ok(!flow.ok && flow.issues.some(issue => typeof issue !== 'string' && issue.line === 3), JSON.stringify(flow))
    const bad = checkFigure('dsh-plot', '{"fns":[{"expr":"process.exit()"}],"x":[0,1]}')
    assert.ok(!bad.ok)
    assert.ok(!checkFigure('dsh-heatmap', '[1,2').ok)
    assert.ok(!checkFigure('dsh-physics', '{"demo":"rm -rf"}').ok)
  })

  it('names the supported languages for an unknown one', () => {
    const result = checkFigure('graphviz', 'digraph{}')
    assert.ok(!result.ok && typeof result.issues[0] === 'string' && result.issues[0].includes('dsh-plot'))
  })

  it('formats issues one per line with line numbers', () => {
    assert.equal(formatFigureIssues(['a', { line: 4, message: 'b' }]), '- a\n- line 4: b')
    assert.equal(formatFigureIssues(Array.from({ length: 20 }, (_, i) => String(i))).split('\n').length, 12)
  })
})

const exec = { signal: new AbortController().signal, agent: { id: 'session-1' } }
const textOf = (tool: ToolDefinitionLike, args: unknown, value: unknown): string => tool.output.render(args, value as never).map(part => part.text).join('')

describe('rich_check_figure', () => {
  const tool = createCheckFigureTool()

  it('is a read-only checker that reports OK without any file or image line', async () => {
    assert.equal(tool.name, 'rich_check_figure')
    assert.deepEqual(tool.parameters['required'], ['lang', 'source'])
    const value = await tool.execute({ lang: 'svg', source: SVG_OK }, exec) as Record<string, unknown>
    assert.equal(value['ok'], true)
    assert.equal('figure' in value, false)
    const text = textOf(tool, { lang: 'svg' }, value)
    assert.match(text, /^OK/u)
    assert.doesNotMatch(text, /!\[|[A-Za-z]:\\|\/figures\//u)
    assert.match(text, /```svg/u)
  })

  it('returns refusals as a result the model can read, with line numbers', async () => {
    const value = await tool.execute({ lang: 'dsh-svg', source: SVG_BAD }, exec)
    const text = textOf(tool, { lang: 'dsh-svg' }, value)
    assert.match(text, /^NOT OK/u)
    assert.match(text, /line 3: .*onclick/u)
  })

  it('rejects malformed arguments and oversize sources before checking', async () => {
    await assert.rejects(tool.execute({ lang: 'svg' }, exec), /source/u)
    await assert.rejects(tool.execute({ lang: 'svg', source: SVG_OK, path: '/x' }, exec), /unexpected/u)
    await assert.rejects(tool.execute({ lang: 'svg', source: 'x'.repeat(300 * 1024) }, exec), /limit/u)
    await assert.rejects(tool.execute({ lang: 'svg', source: SVG_OK }, { signal: AbortSignal.abort() }), /aborted/u)
  })

  it('replays the same text from the persisted value', async () => {
    const value = await tool.execute({ lang: 'mermaid', source: 'flowchart TD\nA --> B' }, exec)
    assert.equal(textOf(tool, {}, JSON.parse(JSON.stringify(value))), textOf(tool, {}, value))
  })
})

function hostContext(options: { setExecutor?: boolean } = {}): { ctx: Parameters<typeof apply>[0]; tools: Map<string, ToolDefinitionLike>; logs: string[] } {
  const tools = new Map<string, ToolDefinitionLike>(), logs: string[] = []
  const ctx = {
    effect(callback: () => undefined | (() => void)) { callback() },
    tools: {
      register(definition: ToolDefinitionLike) { tools.set(definition.name, definition); return () => { tools.delete(definition.name) } },
      ...options.setExecutor === true ? { setExecutor() { return () => {} } } : {},
    },
    commands: { register() { return () => {} } },
    logger: { info(message: string, ...args: unknown[]) { logs.push(format(message, ...args)) }, warn() {}, error() {} },
  }
  return { ctx: ctx as Parameters<typeof apply>[0], tools, logs }
}

describe('Host inline switch', () => {
  it('auto follows the 0.2.2 Host signal; on/off override it', () => {
    assert.equal(inlineActive({ setExecutor: () => {} }, undefined), true)
    assert.equal(inlineActive({}, undefined), false)
    assert.equal(inlineActive({}, 'auto'), false)
    assert.equal(inlineActive({}, 'on'), true)
    assert.equal(inlineActive({ setExecutor: () => {} }, 'off'), false)
  })

  it('inline: tools carry no image-line note, write no figure file, and rich_check_figure is registered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rr-inline-'))
    const { ctx, tools, logs } = hostContext({ setExecutor: true })
    apply(ctx, { figuresDir: join(dir, 'figures') })
    assert.ok(tools.has('rich_check_figure'))
    for (const name of ['rich_render', 'rich_mermaid', 'rich_heatmap', 'rich_svg', 'rich_image']) {
      assert.doesNotMatch(tools.get(name)?.description ?? '', /Markdown image line/u, name)
    }
    const svg = tools.get('rich_svg')
    assert.ok(svg !== undefined)
    const value = await svg.execute({ title: 'T', svg: SVG_OK }, exec)
    assert.doesNotMatch(textOf(svg, {}, value), /!\[/u)
    assert.equal(existsSync(join(dir, 'figures')) ? readdirSync(join(dir, 'figures')).length : 0, 0)
    assert.ok(logs.some(line => line.includes('inline=on')), logs.join('\n'))
  })

  it('legacy: the figure note stays and rich_check_figure is not offered', () => {
    const { ctx, tools, logs } = hostContext()
    apply(ctx, { figuresDir: join(mkdtempSync(join(tmpdir(), 'rr-legacy-')), 'figures') })
    assert.equal(tools.has('rich_check_figure'), false)
    assert.match(tools.get('rich_mermaid')?.description ?? '', /Markdown image line/u)
    assert.ok(logs.some(line => line.includes('inline=off')), logs.join('\n'))
  })
})

/**
 * DSH 0.2.2 `tools.register` asserts each output schema against an enforced subset
 * (packages/core/tools/src/json-schema.ts: CONSTRAINT_KEYWORDS + ANNOTATION_KEYWORDS). A violation throws inside
 * the registration effect and disposes this whole Host plugin, so every rich_* tool would disappear.
 */
const DSH_OUTPUT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'default', 'examples'])
function unsupportedKeywords(schema: unknown, path = 'schema'): string[] {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [`${path} is not a schema object`]
  const node = schema as Record<string, unknown>, out: string[] = []
  for (const key of Object.keys(node)) if (!DSH_OUTPUT_KEYWORDS.has(key)) out.push(`${path}.${key}`)
  for (const [key, child] of Object.entries((node['properties'] as Record<string, unknown> | undefined) ?? {})) out.push(...unsupportedKeywords(child, `${path}.properties.${key}`))
  if (node['items'] !== undefined) out.push(...unsupportedKeywords(node['items'], `${path}.items`))
  for (const [index, child] of ((node['oneOf'] as unknown[] | undefined) ?? []).entries()) out.push(...unsupportedKeywords(child, `${path}.oneOf[${String(index)}]`))
  return out
}

describe('DSH 0.2.2 output-schema subset', () => {
  it('every Host tool output schema registers on DSH 0.2.2, inline and legacy', () => {
    for (const setExecutor of [true, false]) {
      const { ctx, tools } = hostContext({ setExecutor })
      apply(ctx, { figuresDir: join(mkdtempSync(join(tmpdir(), 'rr-schema-')), 'figures') })
      for (const tool of tools.values()) assert.deepEqual(unsupportedKeywords(tool.output.schema), [], tool.name)
    }
  })
})
