/**
 * Artifact-level checks: the BUILT bundles must load and behave.
 *
 * These tests run after `npm run build` (the `verify` script orders them) and
 * are the first real proof that
 *   - lib/index.js exports a valid Cordis Host plugin and registers both
 *     contributions under an effect;
 *   - lib/client.js speaks the browser module-table handoff exactly, resolves
 *     only React from the table, and its registered component renders the
 *     expected card markup for a persisted tool result.
 *
 * The bundle is evaluated with `vm.runInThisContext` so its realm matches the
 * test's realm: production props come from the same page realm, and a strict
 * plain-object contract then behaves exactly as it will in the browser.
 *
 * These tests do not replace the DSH Web end-to-end run; they close the gap
 * between "TypeScript compiles" and "the shipped artifact does something".
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import * as vm from 'node:vm'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

const hostUrl = new URL('../../lib/index.js', import.meta.url)
const clientPath = new URL('../../lib/client.js', import.meta.url)

interface FakeToolDefinition {
  readonly name: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): readonly { type: string; text: string }[]
    presentationMeta(args: unknown, value: unknown): unknown
  }
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}

interface FakeCommandDefinition {
  readonly name: string
  handler(invocation: { agent: { id: string }; rawInput: string; signal: AbortSignal }): { kind: string; text?: string }
}

/** Minimal structural stand-in for the Cordis Host context. */
function fakeHostContext(): {
  ctx: Record<string, unknown>
  tool: (name?: string) => FakeToolDefinition
  command: () => FakeCommandDefinition
  disposers: (() => void)[]
} {
  const registeredTools = new Map<string, FakeToolDefinition>()
  let registeredCommand: FakeCommandDefinition | undefined
  const disposers: (() => void)[] = []
  const ctx = {
    effect(callback: () => undefined | (() => void)) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    tools: {
      register(definition: FakeToolDefinition) {
        registeredTools.set(definition.name, definition)
        return () => { registeredTools.delete(definition.name) }
      },
    },
    commands: {
      register(definition: FakeCommandDefinition) {
        registeredCommand = definition
        return () => { registeredCommand = undefined }
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  return {
    ctx,
    tool: (name = 'rich_render') => {
      const tool = registeredTools.get(name)
      if (tool === undefined) throw new Error('tool was not registered: ' + name)
      return tool
    },
    command: () => {
      if (registeredCommand === undefined) throw new Error('command was not registered')
      return registeredCommand
    },
    disposers,
  }
}

/** Load the built client bundle through a fake module table in this realm. */
function loadClientBundle(): { id: string; factory: (require: (id: string) => unknown) => unknown } {
  const source = readFileSync(clientPath, 'utf8')
  const handed: { id: string; factory: (require: (id: string) => unknown) => unknown }[] = []
  const holder = globalThis as { window?: unknown }
  const previous = holder.window
  holder.window = {
    __ModuleLoader__: {
      load(registration: { id: string; factory: (require: (id: string) => unknown) => unknown }) {
        handed.push(registration)
      },
    },
  }
  try {
    vm.runInThisContext(source, { filename: 'lib/client.js' })
  } finally {
    holder.window = previous
  }
  assert.equal(handed.length, 1, 'bundle must register exactly one client module')
  return handed[0] as { id: string; factory: (require: (id: string) => unknown) => unknown }
}

/** A module-table require that accepts exactly React. */
function requireFromTable(requested: string[], specifier: string): unknown {
  requested.push(specifier)
  if (specifier === 'react') return React
  if (specifier === 'react/jsx-runtime') return JsxRuntime
  throw new Error('unexpected module request: ' + specifier)
}

interface FakeClientContext {
  readonly registrations: { name: string; key?: string; component: unknown }[]
}

/** Apply the client plugin against a fake slot registry / remote. */
function applyClientPlugin(exports: { apply(ctx: unknown): void }): FakeClientContext {
  const registrations: { name: string; key?: string; component: unknown }[] = []
  exports.apply({
    slots: {
      inject(_key: string, callback: () => undefined | (() => void)) { callback() },
      register(spec: { name: string; key?: string }, component: unknown) {
        registrations.push({ name: spec.name, key: spec.key, component })
        return () => {}
      },
    },
    remote: {
      commands: {
        execute: async () => ({ ok: false, error: { code: 'NO_HOST', message: 'unit test' } }),
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  })
  return { registrations }
}

/** Render one toolview occurrence to static markup. */
function renderToolView(component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(component as React.FunctionComponent<Record<string, unknown>>, props),
  )
}

/** Canonical sine payload used across the artifact tests. */
const RICH_PAYLOAD = {
  schemaVersion: 1,
  type: 'line_plot',
  title: 'Sine Function',
  data: {
    series: [
      { name: 'sin(x)', points: [{ x: 0, y: 0 }, { x: Math.PI / 2, y: 1 }, { x: Math.PI, y: 0 }] },
    ],
  },
}

test('built host bundle: exports a plugin and registers tool + command under effects', async () => {
  const mod = await import(hostUrl.href) as {
    name: string
    inject: string[]
    apply(ctx: unknown, config?: unknown): void
  }
  assert.equal(mod.name, 'dsh-rich-response')
  assert.deepEqual(mod.inject, ['tools', 'commands'])
  const dir = mkdtempSync(join(tmpdir(), 'dsh-rich-response-'))
  try {
    const fake = fakeHostContext()
    mod.apply(fake.ctx, { auditLog: join(dir, 'audit.jsonl'), maxTrackedAttempts: 8 })
    assert.equal(fake.disposers.length, 4)
    const tool = fake.tool()
    assert.equal(tool.name, 'rich_render')
    const physics = fake.tool('rich_physics_demo')
    const demoValue = await physics.execute({ demo: 'ising' }, { signal: new AbortController().signal })
    assert.deepEqual(physics.output.presentationMeta({}, demoValue), { kind: 'rich-physics', version: 1, demo: 'ising' })
    const mermaid = fake.tool('rich_mermaid')
    const flow = await mermaid.execute({ title: 'flow', source: 'flowchart LR\nA[start] --> B{ok}' }, { signal: new AbortController().signal })
    assert.equal((mermaid.output.presentationMeta({}, flow) as { content: { type: string } }).content.type, 'basic_diagram')
    // Model-facing schema must be raw JSON Schema, not the author-side DSL.
    assert.equal(tool.parameters['type'], 'object')
    assert.equal((tool.parameters['required'] as string[])[0], 'content')
    assert.equal(tool.output.schema['type'], 'object')

    const value = await tool.execute({ content: RICH_PAYLOAD }, { signal: new AbortController().signal }) as {
      content: { type: string }
      summary: string
    }
    assert.equal(value.content.type, 'line_plot')
    assert.match(value.summary, /line_plot/)
    assert.match(value.summary, /3 points/)

    const meta = tool.output.presentationMeta({ content: RICH_PAYLOAD }, value) as {
      kind: string
      envelopeVersion: number
      content: { schemaVersion: number }
    }
    assert.equal(meta.kind, 'rich-response')
    assert.equal(meta.envelopeVersion, 1)
    assert.equal(meta.content.schemaVersion, 1)

    await assert.rejects(
      () => tool.execute({ content: { schemaVersion: 2, type: 'line_plot', title: 'x' } }, { signal: new AbortController().signal }),
      /invalid RichContentV1 payload/,
    )

    const command = fake.command()
    assert.equal(command.name, 'rich-interaction')
    const accepted = command.handler({
      agent: { id: 'session-abc' },
      rawInput: JSON.stringify({
        protocol: 'rich-interaction-v1',
        protocolVersion: 1,
        sessionId: 'session-abc',
        callId: 'call-1',
        cardKey: 'call-1#q1',
        questionId: 'q1',
        actionId: 'a',
        attemptId: 'attempt-1',
        submittedAt: new Date().toISOString(),
      }),
      signal: new AbortController().signal,
    })
    assert.equal(accepted.kind, 'success')
    const crossSession = command.handler({
      agent: { id: 'session-OTHER' },
      rawInput: JSON.stringify({
        protocol: 'rich-interaction-v1',
        protocolVersion: 1,
        sessionId: 'session-abc',
        callId: 'call-1',
        cardKey: 'call-1',
        actionId: 'a',
        attemptId: 'attempt-2',
        submittedAt: new Date().toISOString(),
      }),
      signal: new AbortController().signal,
    })
    assert.equal(crossSession.kind, 'error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('built client bundle: module-table handoff, React-only externals, registers keyed toolview', () => {
  const source = readFileSync(clientPath, 'utf8')
  assert.ok(source.startsWith('window.__ModuleLoader__.load({ id: "dsh-rich-response", factory: (require) => {'))
  assert.ok(!/\beval\s*\(/.test(source), 'client bundle must not call eval')
  assert.ok(!/new\s+Function\s*\(/.test(source), 'client bundle must not construct Functions')
  assert.ok(!source.includes('document.write'))
  assert.ok(!source.includes('innerHTML'))

  const registration = loadClientBundle()
  assert.equal(registration.id, 'dsh-rich-response')
  const requested: string[] = []
  const exports = registration.factory(specifier => requireFromTable(requested, specifier)) as {
    apply?: unknown
    inject?: string[]
  }
  assert.deepEqual([...new Set(requested)].sort(), ['react', 'react/jsx-runtime'])
  assert.deepEqual(exports.inject, ['slots', 'remote', 'remote.commands', 'remote.session'])
  assert.equal(typeof exports.apply, 'function')

  const client = applyClientPlugin(exports as { apply(ctx: unknown): void })
  assert.equal(client.registrations.length, 3)
  assert.equal(client.registrations[0]?.name, 'tool.call.toolview')
  assert.equal(client.registrations[0]?.key, 'rich_render')
  assert.equal(client.registrations[1]?.name, 'tool.call.toolview')
  assert.equal(client.registrations[1]?.key, 'rich_physics_demo')
  assert.equal(client.registrations[2]?.key, 'rich_mermaid')
  assert.notEqual(client.registrations[2]?.component, client.registrations[0]?.component)
  const ToolView = client.registrations[0]?.component

  const markup = renderToolView(ToolView, {
    sessionId: 'session-abc',
    callId: 'call-1',
    toolName: 'rich_render',
    phase: 'result',
    block: {
      kind: 'tool-result',
      seq: 10,
      time: 1,
      callId: 'call-1',
      name: 'rich_render',
      content: [{ type: 'text', text: 'line_plot "Sine Function": 1 series, 3 points' }],
      isError: false,
      meta: { kind: 'rich-response', envelopeVersion: 1, content: RICH_PAYLOAD },
      call: { name: 'rich_render', argsRaw: JSON.stringify({ content: RICH_PAYLOAD }) },
      subCalls: [],
    },
  })
  assert.match(markup, /data-dsh-rich="tool-card"/)
  assert.match(markup, /data-dsh-rich-status="ok"/)
  assert.match(markup, /data-dsh-rich-session="session-abc"/)
  assert.match(markup, /Sine Function|line-plot-scaffold/)

  const failed = renderToolView(ToolView, {
    sessionId: 'session-abc',
    callId: 'call-2',
    toolName: 'rich_render',
    phase: 'result',
    block: {
      kind: 'tool-result',
      seq: 11,
      time: 2,
      callId: 'call-2',
      name: 'rich_render',
      content: [{ type: 'text', text: 'invalid RichContentV1 payload: INVALID_TITLE@title' }],
      isError: true,
      error: { name: 'ToolArgsError', code: 'INVALID_ARGS' },
      call: null,
      subCalls: [],
    },
  })
  assert.match(failed, /data-dsh-rich="error-state"/)

  const unsupported = renderToolView(ToolView, {
    sessionId: 'session-abc',
    callId: 'call-3',
    toolName: 'rich_render',
    phase: 'result',
    block: {
      kind: 'tool-result',
      seq: 12,
      time: 3,
      callId: 'call-3',
      name: 'rich_render',
      content: [],
      isError: false,
      meta: { kind: 'rich-response', envelopeVersion: 1, content: { schemaVersion: 7, type: 'line_plot', title: 'future' } },
      call: null,
      subCalls: [],
    },
  })
  assert.match(unsupported, /data-dsh-rich="unsupported-version"/)
  assert.match(unsupported, /unsupported rich content version 7/)

  // A tampered persisted envelope version must never render even when the
  // content itself would validate (the envelope reader is authoritative).
  const tamperedEnvelope = renderToolView(ToolView, {
    sessionId: 'session-abc',
    callId: 'call-4',
    toolName: 'rich_render',
    phase: 'result',
    block: {
      kind: 'tool-result',
      seq: 13,
      time: 4,
      callId: 'call-4',
      name: 'rich_render',
      content: [],
      isError: false,
      meta: { kind: 'rich-response', envelopeVersion: 2, content: RICH_PAYLOAD },
      call: null,
      subCalls: [],
    },
  })
  assert.match(tamperedEnvelope, /data-dsh-rich="unsupported-envelope"/)
  assert.ok(!tamperedEnvelope.includes('data-dsh-rich="line-plot"'))
})

test('built client bundle: preparing and start stages render bounded states', () => {
  const registration = loadClientBundle()
  const exports = registration.factory(specifier => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return JsxRuntime
    throw new Error('unexpected module request: ' + specifier)
  }) as { apply(ctx: unknown): void }
  const client = applyClientPlugin(exports)
  const ToolView = client.registrations[0]?.component

  const preparing = renderToolView(ToolView, {
    sessionId: 's',
    callId: 'c',
    toolName: 'rich_render',
    phase: 'preparing',
    block: { phase: 'preparing', callId: 'c', name: 'rich_render', turn: 1, step: 1, time: 1, args: {}, subCalls: [] },
  })
  assert.match(preparing, /data-dsh-rich-phase="preparing"/)
  assert.match(preparing, /preparing rich content/)

  const start = renderToolView(ToolView, {
    sessionId: 's',
    callId: 'c',
    toolName: 'rich_render',
    phase: 'start',
    block: {
      phase: 'start', callId: 'c', name: 'rich_render', turn: 1, step: 1, time: 1,
      args: {}, subCalls: [], argsRaw: JSON.stringify({ content: RICH_PAYLOAD }),
    },
  })
  assert.match(start, /data-dsh-rich-phase="start"/)
  assert.match(start, /live preview/)
})
