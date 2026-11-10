/**
 * Inline assistant renderer (plan P2/P3): the `assistant-step` shadow mirrors the built-in renderer,
 * draws figure fences in place (also while streaming), dispatches tool calls to the
 * `rich.inline.toolcall` child Slot (relocating calls whose own step is not visible), and throws
 * on a contract mismatch so the slot core hands rendering back to the built-in renderer.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createInlineAssistantView, fileMediaUrl, INLINE_TOOLCALL_SLOT, localPathMediaUrl, placeToolCalls } from '../../src/client/inline/assistant-view'
import { InlineContractError } from '../../src/client/inline/contract-guard'
import { checkPrimitives } from '../../src/client/inline/platform'
import { issueLine } from '../../src/client/inline/figure-fence'
import { faceFromInjected, readInlineMode, registerInlineAssistant } from '../../src/client/inline/register'
import type { AssistantBlock, BuiltinFace, PresentationPolicy, Primitives } from '../../src/client/inline/types'

const primitives: Primitives = {
  MarkdownText: ({ text, streaming }) => createElement('div', { 'data-md': '', 'data-streaming': streaming ? '1' : undefined }, text),
  CodeBlock: ({ code, lang }) => createElement('pre', { 'data-code': lang ?? '' }, code),
}

const policyFace = (policy: PresentationPolicy): BuiltinFace => ({ usePresentation: selector => selector(policy) })

interface StepFixture { step: number; blocks: AssistantBlock[] }

function nodeProps(current: StepFixture & { status?: string }, options: { steps?: StepFixture[]; turnProcess?: unknown; groupPart?: string; omit?: string } = {}): Record<string, unknown> {
  const steps = (options.steps ?? [current]).map(s => ({ data: { get: (key: string) => key === 'assistant-step' ? { step: s.step, status: 'settled', blocks: s.blocks } : undefined } }))
  const props: Record<string, unknown> = {
    node: { data: { step: current.step, status: current.status ?? 'settled', blocks: current.blocks }, location: { kind: 'step', turn: { status: 'closed', steps } } },
    sessionId: 's1',
    t: (key: string) => key,
    useDisclosure: () => ({ expanded: false, toggle() {} }),
    useGroupAction: () => null,
    renderFactorySlot: () => null,
    renderSlot: (key: string, owner: Record<string, unknown>, opts?: { entryKey?: string }) => createElement('span', {
      'data-slot': key, 'data-entry': opts?.entryKey, 'data-call': owner['callId'], 'data-step': String(owner['step']), 'data-relocated': String(owner['relocated']),
    }),
    ...options.groupPart === undefined ? {} : { groupPart: options.groupPart },
    ...options.turnProcess === undefined ? {} : { turnProcess: options.turnProcess },
  }
  if (options.omit !== undefined) delete props[options.omit]
  return props
}

function render(props: Record<string, unknown>, face: BuiltinFace | null = policyFace({ foldedReplies: 'all' }), require = false): string {
  const View = createInlineAssistantView({ primitives, builtinFace: () => face ?? undefined, requireBuiltinFace: require }) as (p: unknown) => ReactNode
  return renderToStaticMarkup(createElement(View as never, props as never))
}

const SVG = '<svg viewBox="0 0 100 50"><title>Two boxes</title><rect x="1" y="1" width="20" height="20"/><circle cx="60" cy="25" r="10"/></svg>'

describe('inline assistant view: figure fences', () => {
  it('draws a closed svg fence between the paragraphs it splits', () => {
    const html = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text: `Before.\n\n\`\`\`svg\n${SVG}\n\`\`\`\n\nAfter.` }] }))
    const before = html.indexOf('Before.')
    const figure = html.indexOf('<figure data-dsh-figure="svg" data-state="ready"')
    const after = html.indexOf('After.')
    assert.ok(before >= 0 && figure > before && after > figure, html)
    assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="Two boxes"/)
    assert.match(html, /<rect /)
    assert.doesNotMatch(html, /```|&lt;svg/)
  })

  it('draws the complete elements of a streaming fence and marks only the tail segment streaming', () => {
    const text = 'Intro.\n\n```dsh-svg\n<svg viewBox="0 0 10 10"><rect x="1" y="1" width="2" height="2"/><circ'
    const html = render(nodeProps({ step: 1, status: 'running', blocks: [{ kind: 'text', text }] }))
    assert.match(html, /data-state="drawing"/)
    assert.match(html, /<rect /)
    assert.doesNotMatch(html, /<circ/)
    assert.match(html, /<div data-md="">Intro\./, 'the frozen paragraph before the fence is not streaming')
  })

  it('falls back to a code block for a failing generic svg fence and refuses a failing dsh-svg fence', () => {
    const bad = '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>'
    const generic = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text: '```svg\n' + bad + '\n```' }] }))
    assert.match(generic, /data-dsh-figure-fallback="svg"/)
    assert.match(generic, /<pre data-code="svg">/)
    const named = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text: '```dsh-svg\n' + bad + '\n```' }] }))
    assert.match(named, /data-state="refused"/)
    assert.doesNotMatch(named, /<script/)
  })

  it('numbers refusal issues by the source line they refer to', () => {
    const source = '<svg viewBox="0 0 10 10">\n<rect width="1" height="1"/>\n<rect width="2" onclick="x"/>\n<script>1</script>\n</svg>'
    assert.equal(issueLine(source, '<rect> attribute "onclick" is not allowed'), 3)
    assert.equal(issueLine(source, '<script> is not allowed'), 4)
    assert.equal(issueLine(source, 'mismatched closing tag near offset 27'), 2)
    assert.equal(issueLine(source, 'no <svg> root element'), undefined)
    assert.equal(issueLine('<svg viewBox="0 0 1 1"><text x="1">&nbsp;</text></svg>', 'entity "&nbsp;" is not allowed'), 1)
    const html = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text: '```dsh-svg\n' + source + '\n```' }] }))
    assert.match(html, /<li>(Line 4|第 4 行): &lt;script&gt; is not allowed<\/li>/)
  })

  it('leaves fences of other languages and nested fences to MarkdownText', () => {
    const text = '````markdown\n```svg\n' + SVG + '\n```\n````\n\n```python\nprint(1)\n```'
    const html = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text }] }))
    assert.doesNotMatch(html, /data-dsh-figure/)
  })
})

describe('inline assistant view: tool calls', () => {
  const call = (callId: string, name = 'study_issue_question'): AssistantBlock => ({ kind: 'tool-call', callId, name, argsRaw: '{}' })

  it('dispatches a tool call at its own position, keyed by tool name', () => {
    const html = render(nodeProps({ step: 1, blocks: [{ kind: 'text', text: 'Try this:' }, call('c1'), { kind: 'text', text: 'Good luck.' }] }))
    const slot = `<span data-slot="${INLINE_TOOLCALL_SLOT}" data-entry="study_issue_question" data-call="c1" data-step="1" data-relocated="false"></span>`
    assert.ok(html.indexOf('Try this:') < html.indexOf(slot) && html.indexOf(slot) < html.indexOf('Good luck.'), html)
  })

  it('relocates calls of an earlier tool-only step to the next text step', () => {
    const steps: StepFixture[] = [{ step: 1, blocks: [call('c1')] }, { step: 2, blocks: [{ kind: 'text', text: 'Answer.' }] }]
    const own = render(nodeProps(steps[0] as StepFixture, { steps }))
    assert.equal(own, '', 'a tool-only step renders nothing itself')
    const next = render(nodeProps(steps[1] as StepFixture, { steps }))
    assert.match(next, /data-call="c1" data-step="1" data-relocated="true"/)
    assert.ok(next.indexOf('data-call="c1"') < next.indexOf('Answer.'), 'adopted cards come first')
  })

  it('relocates to the answer step under "Final answer only" while the turn is folded', () => {
    const steps: StepFixture[] = [
      { step: 1, blocks: [{ kind: 'text', text: 'Question time.' }, call('c1')] },
      { step: 2, blocks: [{ kind: 'text', text: 'Final.' }] },
    ]
    const tp = { foldable: true, open: false, setOpen() {}, spec: { answerStep: 2, inlineReasoning: false } }
    const face = policyFace({ foldedReplies: 'final' })
    assert.doesNotMatch(render(nodeProps(steps[0] as StepFixture, { steps, turnProcess: tp }), face), /data-call/)
    assert.match(render(nodeProps(steps[1] as StepFixture, { steps, turnProcess: tp }), face), /data-call="c1" data-step="1" data-relocated="true"/)
    // Opened turn: the call renders at its own step again.
    const open = { ...tp, open: true }
    assert.match(render(nodeProps(steps[0] as StepFixture, { steps, turnProcess: open }), face), /data-relocated="false"/)
    assert.doesNotMatch(render(nodeProps(steps[1] as StepFixture, { steps, turnProcess: open }), face), /data-call/)
  })

  it('placeToolCalls stops adopting at the previous hosting step', () => {
    const s = (step: number, blocks: AssistantBlock[]) => ({ step, blocks })
    const steps = [s(1, [call('a')]), s(2, [{ kind: 'text', text: 'x' }, call('b')]), s(3, [call('c')]), s(4, [call('d')]), s(5, [{ kind: 'text', text: 'y' }])]
    const placed = placeToolCalls(steps[4] as never, steps, false, null)
    assert.deepEqual(placed.adopted.map(a => a.block.kind === 'tool-call' ? a.block.callId : ''), ['c', 'd'])
  })

  it('renders nothing for a tool call when the child slot is not available', () => {
    const props = nodeProps({ step: 1, blocks: [{ kind: 'text', text: 'Hi' }, call('c1')] }, { omit: 'renderSlot' })
    assert.doesNotMatch(render(props), /data-slot/)
  })
})

describe('inline assistant view: built-in parity and contract', () => {
  it('shows the stopped marker for an interrupted step and hides reasoning in the response part', () => {
    const html = render(nodeProps({ step: 1, status: 'interrupted', blocks: [{ kind: 'reasoning', text: 'think' }, { kind: 'text', text: 'partial' }] }, { groupPart: 'response' }))
    assert.match(html, /data-dsh-inline-stopped="">message\.stopped/)
    assert.doesNotMatch(html, /data-dsh-inline-think/)
  })

  it('throws InlineContractError when a verified prop is missing', () => {
    assert.throws(() => render(nodeProps({ step: 1, blocks: [] }, { omit: 'useDisclosure' })), (error: unknown) => error instanceof InlineContractError && error.missing.includes('useDisclosure'))
    assert.throws(() => render({ ...nodeProps({ step: 1, blocks: [] }), node: { data: { step: 1, status: 'settled' } } }), InlineContractError)
  })

  it('throws in auto mode when the built-in face is unavailable (0.2.1), renders with defaults in on mode', () => {
    const props = nodeProps({ step: 1, blocks: [{ kind: 'text', text: 'Hi' }] })
    assert.throws(() => render(props, null, true), InlineContractError)
    assert.match(render(props, null, false), /Hi/)
  })

  it('maps local image destinations exactly like ui-chat fileMediaUrl', () => {
    assert.equal(fileMediaUrl('http://127.0.0.1:1/app/', '/tmp/a b.png'), 'http://127.0.0.1:1/app/api/file?path=%2Ftmp%2Fa%20b.png')
    assert.equal(fileMediaUrl('http://h/', 'C:\\x\\y.png'), 'http://h/api/file?path=C%3A%5Cx%5Cy.png')
    assert.equal(fileMediaUrl('http://h/', 'relative.png'), undefined)
    assert.equal(fileMediaUrl('http://h/', '//server/share.png'), undefined)
    assert.equal(fileMediaUrl('file:///x/', '/tmp/a.png'), undefined)
    assert.equal(localPathMediaUrl('http://h/', '/tmp/a%20b.png?x#y'), 'http://h/api/file?path=%2Ftmp%2Fa%20b.png')
    assert.equal(localPathMediaUrl('http://h/', '/tmp/%E0%A4%A'), undefined)
  })
})

describe('inline registration', () => {
  const fakeCtx = (builtinInject?: (sessionId: string) => unknown) => {
    const registered: Array<{ spec: Record<string, unknown>; component: unknown }> = []
    const ctx = {
      slots: {
        inject(_key: string, callback: () => undefined | (() => void)) { callback() },
        register(spec: Record<string, unknown>, component: unknown) { registered.push({ spec, component }); return () => {} },
        entries: () => [
          ...builtinInject === undefined ? [] : [{ component: 'builtin', options: { key: 'assistant-step' }, inject: builtinInject }],
          ...registered.map(r => ({ component: r.component, options: { key: r.spec['key'] as string, priority: r.spec['priority'] as number } })),
        ],
      },
      logger: { info() {}, warn() {} },
    }
    return { ctx, registered }
  }

  it('shadows assistant-step at priority -1 with the inline tool-call child slot', () => {
    const { ctx, registered } = fakeCtx()
    assert.equal(registerInlineAssistant(ctx, { primitives, mode: 'auto' }), true)
    assert.equal(registered.length, 1)
    assert.deepEqual(registered[0]?.spec, {
      name: 'conversation.chat.node', key: 'assistant-step', priority: -1, locale: 'chat',
      children: { [INLINE_TOOLCALL_SLOT]: { kind: 'keyed', scope: 'session' } },
    })
  })

  it('registers nothing when switched off', () => {
    const { ctx, registered } = fakeCtx()
    assert.equal(registerInlineAssistant(ctx, { primitives, mode: 'off' }), false)
    assert.equal(registered.length, 0)
    assert.equal(readInlineMode({ getItem: () => 'off' }), 'off')
    assert.equal(readInlineMode({ getItem: () => 'junk' }), 'auto')
    assert.equal(readInlineMode({ getItem: () => { throw new Error('denied') } }), 'auto')
  })

  it('borrows the built-in presentation policy through slots.entries()', () => {
    let policy: PresentationPolicy = { foldedReplies: 'final' }
    const presentation = { getSnapshot: () => policy, subscribe: () => () => {} }
    const sessions: string[] = []
    const { ctx, registered } = fakeCtx(sessionId => { sessions.push(sessionId); return { hooks: { presentation }, resolveFilePath: (p: string) => p } })
    registerInlineAssistant(ctx, { primitives, mode: 'auto' })
    const View = registered[0]?.component as (p: unknown) => ReactNode
    const steps: StepFixture[] = [
      { step: 1, blocks: [{ kind: 'text', text: 'Q' }, { kind: 'tool-call', callId: 'c1', name: 'study_issue_question', argsRaw: '{}' }] },
      { step: 2, blocks: [{ kind: 'text', text: 'Final.' }] },
    ]
    const tp = { foldable: true, open: false, setOpen() {}, spec: { answerStep: 2, inlineReasoning: false } }
    const html = renderToStaticMarkup(createElement(View as never, nodeProps(steps[1] as StepFixture, { steps, turnProcess: tp }) as never))
    assert.match(html, /data-relocated="true"/, 'final-only policy from the built-in face relocates the card')
    assert.deepEqual(sessions, ['', 's1'], 'one contract probe before registering, then the rendered session')
    policy = { foldedReplies: 'all' }
    assert.equal(faceFromInjected({ hooks: { presentation: {} } })?.usePresentation, undefined, 'a non-observable is ignored')
    assert.equal(faceFromInjected(null), undefined)
  })

  it('auto retires on the DSH 0.2.1 face (hooks.presentation only, no resolveFilePath); on still renders', () => {
    // P9 rc.5 browser finding: 0.2.1-rc.5 also injects { hooks: { presentation } }; the 0.2.2 contract adds
    // resolveFilePath and fileMentions (ui-chat register-node-renderers.ts). auto must keep 0.2.1 on the built-in.
    const presentation = { getSnapshot: (): PresentationPolicy => ({ foldedReplies: 'all' }), subscribe: () => () => {} }
    const steps: StepFixture[] = [{ step: 1, blocks: [{ kind: 'text', text: 'Body.' }] }]
    // auto decides before registering, so 0.2.1 never sees the shadow (no retire-by-throw console errors).
    const auto = fakeCtx(() => ({ hooks: { presentation } }))
    const infos: string[] = []
    ;(auto.ctx.logger as { info(message: string): void }).info = message => { infos.push(message) }
    registerInlineAssistant(auto.ctx, { primitives, mode: 'auto' })
    assert.equal(auto.registered.length, 0, 'auto registers nothing on the 0.2.1 face')
    assert.ok(infos.some(m => /inline renderer off/.test(m)), 'auto logs why it stayed off')
    // The render-time guard still retires a shadow that meets the 0.2.1 face (e.g. registered before ui-chat).
    const View = createInlineAssistantView({ primitives, builtinFace: () => undefined, requireBuiltinFace: true }) as (p: unknown) => ReactNode
    assert.throws(() => renderToStaticMarkup(createElement(View as never, nodeProps(steps[0] as StepFixture, { steps }) as never)), InlineContractError)
    // on still renders on the 0.2.1 face.
    const on = fakeCtx(() => ({ hooks: { presentation } }))
    ;(on.ctx as { get?: (name: string) => unknown }).get = name => name === 'chatFileMentions' ? { forClosing: () => null } : undefined
    registerInlineAssistant(on.ctx, { primitives, mode: 'on' })
    const OnView = on.registered[0]?.component as (p: unknown) => ReactNode
    assert.match(renderToStaticMarkup(createElement(OnView as never, nodeProps(steps[0] as StepFixture, { steps }) as never)), /Body\./)
  })

  it('auto waits for the built-in entry through slots.subscribe and registers once on the 0.2.2 face', () => {
    const presentation = { getSnapshot: (): PresentationPolicy => ({ foldedReplies: 'all' }), subscribe: () => () => {} }
    let builtin: ((sessionId: string) => unknown) | undefined
    const listeners = new Set<() => void>()
    const registered: unknown[] = []
    const ctx = {
      slots: {
        inject(_key: string, callback: () => undefined | (() => void)) { callback() },
        register(spec: Record<string, unknown>) { registered.push(spec); for (const l of [...listeners]) l(); return () => {} },
        entries: () => builtin === undefined ? [] : [{ component: 'builtin', options: { key: 'assistant-step' }, inject: builtin }],
        subscribe(_key: string, fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
      },
      logger: { info() {}, warn() {} },
    }
    registerInlineAssistant(ctx, { primitives, mode: 'auto' })
    assert.equal(registered.length, 0, 'nothing before ui-chat registers')
    assert.equal(listeners.size, 1)
    builtin = () => ({ hooks: { presentation }, resolveFilePath: (p: string) => p })
    for (const l of [...listeners]) l()
    assert.equal(registered.length, 1, 'registered once the 0.2.2 face appears')
    assert.equal(listeners.size, 0, 'unsubscribed after deciding')
  })

  it('checks the shared primitives module surface', () => {
    assert.deepEqual(checkPrimitives({}).missing, ['MarkdownText', 'CodeBlock'])
    assert.deepEqual(checkPrimitives(null).missing, ['module'])
    const ok = checkPrimitives({ MarkdownText: () => null, CodeBlock: { $$typeof: Symbol.for('react.memo') }, JsonBlock: 3 })
    assert.equal(ok.missing.length, 0)
    assert.equal(ok.primitives?.JsonBlock, undefined)
  })
})
