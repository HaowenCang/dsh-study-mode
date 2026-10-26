/**
 * Bounded Mermaid flowchart subset (VIS-01).
 *
 * The compiler turns a strict subset of Mermaid flowchart text into the
 * existing, already-audited `basic_diagram` payload; anything outside the
 * subset is refused with a line-numbered issue instead of being guessed.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { apply } from '../../src/client/apply'
import { buildDiagramGeometry, truncateLabel } from '../../src/client/renderers/diagram/geometry'
import { createToolView } from '../../src/client/toolview'
import type { ClientContext } from '../../src/client/contract'
import { createMermaidTool } from '../../src/host/tools/rich-mermaid'
import { compileMermaidFlowchart, MERMAID_LIMITS, type MermaidCompileResult } from '../../src/shared/mermaid'
import { readRichMeta, validateRichContent, type BasicDiagramContent } from '../../src/shared/index'
import { displayWidth } from '../../src/shared/text-width'

const exec = { signal: new AbortController().signal }

function ok(result: MermaidCompileResult): Extract<MermaidCompileResult, { ok: true }> {
  if (!result.ok) assert.fail(`expected success, got ${JSON.stringify(result.issues)}`)
  return result
}

function codes(result: MermaidCompileResult): string[] {
  assert.equal(result.ok, false, 'expected the source to be refused')
  return result.ok ? [] : result.issues.map(issue => `${issue.code}@${String(issue.line)}`)
}

function node(content: BasicDiagramContent, id: string) {
  const found = content.data.nodes.find(candidate => candidate.id === id)
  assert.ok(found, `node ${id} missing`)
  return found
}

/**
 * Independent rendered-geometry oracle (point sampling against the real
 * rectangle / rhombus / circle shapes, not the compiler's own tests): no link
 * through a third node, no label covered by a node, by another label, or
 * crossed by another link, and every arrow has visible line. The 6.6 px per
 * width unit of an 11 px edge label is the one assumption shared with the
 * implementation (font metrics).
 */
function assertLegible(content: BasicDiagramContent): void {
  const geometry = buildDiagramGeometry(content.data.nodes, content.data.edges)
  assert.equal(geometry.droppedEdges, 0)
  type G = (typeof geometry.nodes)[number]
  const inside = (n: G, x: number, y: number): boolean => {
    const dx = Math.abs(x - n.center.x), dy = Math.abs(y - n.center.y)
    if (n.shape === 'circle') return Math.hypot(dx, dy) < n.radius
    if (n.shape === 'diamond') return dx / n.halfWidth + dy / n.halfHeight < 1
    return dx < n.halfWidth && dy < n.halfHeight
  }
  const along = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Array.from({ length: 201 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 200, y: a.y + ((b.y - a.y) * i) / 200 }))
  const labels = geometry.edges.filter(edge => edge.labelText.length > 0).map(edge => {
    const width = displayWidth(truncateLabel(edge.labelText, 24)) * 6.6
    return { edge, l: edge.label.x - width / 2, r: edge.label.x + width / 2, t: edge.label.y - 10, b: edge.label.y + 3 }
  })
  for (const edge of geometry.edges) {
    const name = `${edge.edge.from}->${edge.edge.to}`
    assert.ok(Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) >= 18, `link ${name} too short to show`)
    const points = along(edge.start, edge.end)
    for (const other of geometry.nodes) {
      if (other === edge.from || other === edge.to) continue
      assert.ok(points.every(p => !inside(other, p.x, p.y)), `link ${name} crosses ${other.node.id}`)
    }
    for (const label of labels) {
      if (label.edge === edge) continue
      assert.ok(points.every(p => !(p.x > label.l && p.x < label.r && p.y > label.t && p.y < label.b)), `link ${name} runs through the label of ${label.edge.edge.from}->${label.edge.edge.to}`)
    }
  }
  for (const label of labels) {
    const name = `${label.edge.edge.from}->${label.edge.edge.to}`
    const samples: { x: number; y: number }[] = []
    for (let i = 0; i <= 12; i += 1) for (let j = 0; j <= 4; j += 1) samples.push({ x: label.l + ((label.r - label.l) * i) / 12, y: label.t + ((label.b - label.t) * j) / 4 })
    for (const other of geometry.nodes) assert.ok(samples.every(p => !inside(other, p.x, p.y)), `label of ${name} hidden by ${other.node.id}`)
    for (const peer of labels) {
      if (peer === label) continue
      assert.ok(!(label.l < peer.r && label.r > peer.l && label.t < peer.b && label.b > peer.t), `label of ${name} overlaps another label`)
    }
  }
}

const FORCE = [
  'flowchart TD',
  '  %% 受力分析的决策流程',
  '  A[受力分析] --> B{是否平衡}',
  '  B -->|是| C(列平衡方程)',
  '  B -->|否| D((牛顿第二定律))',
  '  C -.-> E([检查量纲])',
  '  D -- 积分 --> E',
].join('\n')

describe('compileMermaidFlowchart: supported subset', () => {
  it('compiles shapes, labels and link styles into a valid basic_diagram', () => {
    const result = ok(compileMermaidFlowchart({ title: '受力分析流程', source: FORCE }))
    const content = result.content
    assert.equal(content.type, 'basic_diagram')
    assert.equal(validateRichContent(content).ok, true)
    assert.deepEqual(content.data.nodes.map(n => [n.id, n.label, n.shape]), [
      ['A', '受力分析', 'box'],
      ['B', '是否平衡', 'diamond'],
      ['C', '列平衡方程', 'rounded'],
      ['D', '牛顿第二定律', 'circle'],
      ['E', '检查量纲', 'rounded'],
    ])
    assert.deepEqual(content.data.edges, [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C', label: '是' },
      { from: 'B', to: 'D', label: '否' },
      { from: 'C', to: 'E', dashed: true },
      { from: 'D', to: 'E', label: '积分' },
    ])
    assert.equal(result.direction, 'TD')
    assert.equal(result.layers, 4)
  })

  it('places layers along the declared direction', () => {
    const chain = (direction: string) => ok(compileMermaidFlowchart({ title: 't', source: `flowchart ${direction}\nA --> B --> C` })).content
    const td = chain('TD')
    assert.ok(node(td, 'A').y < node(td, 'B').y && node(td, 'B').y < node(td, 'C').y)
    assert.equal(node(td, 'A').x, node(td, 'C').x)
    const bt = chain('BT')
    assert.ok(node(bt, 'A').y > node(bt, 'B').y && node(bt, 'B').y > node(bt, 'C').y)
    const lr = chain('LR')
    assert.ok(node(lr, 'A').x < node(lr, 'B').x && node(lr, 'B').x < node(lr, 'C').x)
    assert.equal(node(lr, 'A').y, node(lr, 'C').y)
    const rl = chain('RL')
    assert.ok(node(rl, 'A').x > node(rl, 'B').x)
    assert.deepEqual(chain('TB').data.nodes, td.data.nodes)
    assert.deepEqual(ok(compileMermaidFlowchart({ title: 't', source: 'graph TD\nA --> B --> C' })).content.data, td.data)
  })

  it('keeps every coordinate an integer on the 0..1000 grid and nodes apart', () => {
    const source = 'flowchart TD\nA --> B\nA --> C\nA --> D\nB --> E\nC --> E\nD --> E\nE --> F'
    const content = ok(compileMermaidFlowchart({ title: 't', source })).content
    const seen = new Set<string>()
    for (const n of content.data.nodes) {
      assert.ok(Number.isInteger(n.x) && n.x >= 0 && n.x <= 1000)
      assert.ok(Number.isInteger(n.y) && n.y >= 0 && n.y <= 1000)
      seen.add(`${String(n.x)},${String(n.y)}`)
    }
    assert.equal(seen.size, content.data.nodes.length)
  })

  it('keeps plain label text literal, including quoted brackets and comparison signs', () => {
    const content = ok(compileMermaidFlowchart({
      title: 't',
      source: 'flowchart LR\nA["F = m[a] (vector)"] --> B[a < b & c > d]\nB --> C["a; b"];',
    })).content
    assert.equal(node(content, 'A').label, 'F = m[a] (vector)')
    assert.equal(node(content, 'B').label, 'a < b & c > d')
    assert.equal(node(content, 'C').label, 'a; b')
  })

  it('accepts semicolon-separated statements and references without shapes', () => {
    const content = ok(compileMermaidFlowchart({ title: 't', source: 'flowchart TD; A[起点]; A-->B; B-->C[终点]' })).content
    assert.deepEqual(content.data.nodes.map(n => [n.id, n.label]), [['A', '起点'], ['B', 'B'], ['C', '终点']])
  })

  it('lays out cycles by reversing back edges without dropping them', () => {
    const result = ok(compileMermaidFlowchart({ title: 't', source: 'flowchart TD\nA --> B\nB --> C\nC -->|迭代| A' }))
    assert.equal(result.layers, 3)
    assert.equal(result.content.data.edges.length, 3)
    assertLegible(result.content)
  })

  it('is deterministic and passes title/subtitle through', () => {
    const first = compileMermaidFlowchart({ title: '流程', subtitle: '合成示例', source: FORCE })
    const second = compileMermaidFlowchart({ title: '流程', subtitle: '合成示例', source: FORCE })
    assert.deepEqual(first, second)
    assert.equal(ok(first).content.subtitle, '合成示例')
  })
})

describe('compileMermaidFlowchart: refusals', () => {
  const refuse = (source: string) => codes(compileMermaidFlowchart({ title: 't', source }))

  it('requires a flowchart header with a supported direction', () => {
    assert.deepEqual(refuse('A --> B'), ['MISSING_HEADER@1'])
    assert.deepEqual(refuse('sequenceDiagram\nA->>B: hi'), ['MISSING_HEADER@1'])
    assert.deepEqual(refuse('flowchart XY\nA-->B'), ['UNSUPPORTED_DIRECTION@1'])
    assert.deepEqual(refuse('%% only a comment'), ['MISSING_HEADER@1'])
  })

  it('refuses statements outside the subset with their line numbers', () => {
    assert.deepEqual(refuse('flowchart TD\nA-->B\nclick A call alert()'), ['UNSUPPORTED_STATEMENT@3'])
    assert.deepEqual(refuse('flowchart TD\nsubgraph S\nA-->B\nend'), ['UNSUPPORTED_STATEMENT@2', 'UNSUPPORTED_STATEMENT@4'])
    assert.deepEqual(refuse('flowchart TD\nA-->B\nclassDef hot fill:#f00\nstyle A fill:#f00\nlinkStyle 0 stroke:red\nclass A hot'), [
      'UNSUPPORTED_STATEMENT@3', 'UNSUPPORTED_STATEMENT@4', 'UNSUPPORTED_STATEMENT@5', 'UNSUPPORTED_STATEMENT@6',
    ])
    assert.deepEqual(refuse('flowchart TD\ndirection LR\nA-->B'), ['UNSUPPORTED_STATEMENT@2'])
    assert.deepEqual(refuse('%%{init: {"theme":"dark"}}%%\nflowchart TD\nA-->B'), ['UNSUPPORTED_STATEMENT@1'])
  })

  it('refuses link forms it cannot draw faithfully', () => {
    for (const link of ['---', '==>', '===', '-.-', '--o', '--x', '<-->', '~~~', '--->', '-.->>']) {
      const result = refuse(`flowchart TD\nA ${link} B`)
      assert.deepEqual(result, ['UNSUPPORTED_LINK@2'], link)
    }
    assert.deepEqual(refuse('flowchart TD\nA & B --> C'), ['UNSUPPORTED_LINK@2'])
  })

  it('refuses shapes outside box/rounded/stadium/diamond/circle', () => {
    for (const shape of ['[[sub]]', '[(db)]', '>flag]', '{{hex}}', '[/para/]', '[\\alt\\]', '(((dbl)))']) {
      assert.deepEqual(refuse(`flowchart TD\nA${shape} --> B`), ['UNSUPPORTED_SHAPE@2'], shape)
    }
  })

  it('refuses malformed labels, ids and graph semantics', () => {
    assert.deepEqual(refuse('flowchart TD\nA[] --> B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA[unclosed --> B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA["x" y] --> B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse(`flowchart TD\nA[${'长'.repeat(121)}] --> B`), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse(`flowchart TD\nA -->|${'x'.repeat(81)}| B`), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA-->|是 B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse(`flowchart TD\n${'a'.repeat(65)} --> B`), ['INVALID_ID@2'])
    assert.deepEqual(refuse('flowchart TD\nA-B --> C'), ['UNSUPPORTED_LINK@2'])
    assert.deepEqual(refuse('flowchart TD\nA[一] --> B\nA[二] --> C'), ['CONFLICTING_NODE@3'])
    assert.deepEqual(refuse('flowchart TD\nA --> A'), ['SELF_LINK@2'])
    assert.deepEqual(refuse('flowchart TD\nA --> B\nA --> B'), ['PARALLEL_LINK@3'])
    assert.deepEqual(refuse('flowchart TD\nA -->'), ['INCOMPLETE_LINK@2'])
    assert.deepEqual(refuse('flowchart TD'), ['EMPTY_DIAGRAM@1'])
  })

  it('bounds source size, line count, node/edge count and layout capacity', () => {
    const big = 'flowchart TD\n' + `%% ${'x'.repeat(MERMAID_LIMITS.maxSourceBytes)}`
    assert.deepEqual(refuse(big), ['SOURCE_TOO_LARGE@0'])
    const lines = 'flowchart TD\n' + Array.from({ length: MERMAID_LIMITS.maxLines }, () => '%% c').join('\n')
    assert.deepEqual(refuse(lines), ['TOO_MANY_LINES@0'])
    assert.deepEqual(refuse('flowchart TD\nA --> B --> C --> D --> E --> F'), ['LAYOUT_TOO_DEEP@0'])
    const wide = 'flowchart TD\n' + Array.from({ length: 7 }, (_, i) => `R --> N${String(i)}`).join('\n')
    assert.deepEqual(refuse(wide), ['LAYOUT_OVERCROWDED@0'])
    const many = 'flowchart TD\n' + Array.from({ length: 61 }, (_, i) => `N${String(i)}`).join('\n')
    assert.deepEqual(refuse(many), ['TOO_MANY_NODES@0'])
  })

  it('stays bounded and non-throwing on hostile input', () => {
    const hostile = [
      'flowchart TD\n' + '['.repeat(4000),
      'flowchart TD\nA' + '-'.repeat(4000) + '>B',
      'flowchart TD\nA["' + '\\'.repeat(4000),
      'flowchart TD\n' + 'A-->'.repeat(1000),
      'flowchart TD\n' + '|'.repeat(4000),
      '\u0000flowchart TD\nA-->B',
    ]
    for (const source of hostile) {
      const started = performance.now()
      const result = compileMermaidFlowchart({ title: 't', source })
      assert.equal(typeof result.ok, 'boolean')
      assert.ok(performance.now() - started < 1000, 'compile must stay linear-time')
    }
    let seed = 7
    const alphabet = 'AB-.>|[](){}";%& \n\tx是'
    for (let round = 0; round < 500; round += 1) {
      let text = 'flowchart TD\n'
      for (let i = 0; i < 60; i += 1) {
        seed = (seed * 1103515245 + 12345) % 2147483648
        text += alphabet[seed % alphabet.length]
      }
      const result = compileMermaidFlowchart({ title: 't', source: text })
      if (result.ok) assert.equal(validateRichContent(result.content).ok, true)
    }
  })

  it('refuses non-string or oversized title and source', () => {
    assert.deepEqual(codes(compileMermaidFlowchart({ title: 't', source: 42 as unknown as string })), ['INVALID_SOURCE@0'])
    assert.deepEqual(codes(compileMermaidFlowchart({ title: '', source: 'flowchart TD\nA-->B' })), ['INVALID_CONTENT@0'])
  })
})

describe('rich_mermaid tool', () => {
  it('returns a canonical basic_diagram envelope that the existing reader accepts', async () => {
    const tool = createMermaidTool()
    assert.equal(tool.name, 'rich_mermaid')
    const value = await tool.execute({ title: '受力分析流程', source: FORCE }, exec)
    const meta = tool.output.presentationMeta?.({}, value as never)
    const envelope = readRichMeta(meta)
    assert.ok(envelope)
    assert.equal(envelope.content.type, 'basic_diagram')
    const text = tool.output.render({}, value as never).map(block => block.text).join('\n')
    assert.match(text, /5 nodes/)
    assert.match(text, /5 edges/)
    assert.match(text, /TD/)
  })

  it('throws a line-numbered error for unsupported syntax and refuses extra fields', async () => {
    const tool = createMermaidTool()
    await assert.rejects(() => tool.execute({ title: 't', source: 'flowchart TD\nclick A href "https://x"' }, exec), /UNSUPPORTED_STATEMENT.*line 2/)
    await assert.rejects(() => tool.execute({ title: 't', source: 'flowchart TD\nA-->B', theme: 'dark' }, exec), /unexpected field/)
    await assert.rejects(() => tool.execute(null, exec), /object/)
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(() => tool.execute({ title: 't', source: 'flowchart TD\nA-->B' }, { signal: aborted.signal }), /aborted/)
  })

  it('declares a closed raw JSON schema', () => {
    const tool = createMermaidTool()
    assert.equal(tool.parameters['additionalProperties'], false)
    assert.deepEqual(tool.parameters['required'], ['title', 'source'])
  })
})

describe('client registration', () => {
  it('registers a rich_mermaid Tool view separate from rich_render', () => {
    const keys: string[] = []
    const components: unknown[] = []
    const ctx = {
      slots: {
        inject(_name: string, factory: () => unknown) { factory() },
        register(spec: { key: string }, component: unknown) { keys.push(spec.key); components.push(component); return () => {} },
      },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    } as unknown as ClientContext
    apply(ctx)
    assert.deepEqual(keys, ['rich_render', 'rich_physics_demo', 'rich_mermaid'])
    assert.notEqual(components[2], components[0])
  })
})

describe('independent review findings (Opus 5.5, 2026-10-26)', () => {
  const refuse = (source: string) => codes(compileMermaidFlowchart({ title: 't', source }))
  const compile = (source: string) => ok(compileMermaidFlowchart({ title: 't', source }))

  it('F1: inherited object keys are not directions', () => {
    for (const word of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf']) {
      assert.deepEqual(refuse(`flowchart ${word}\nA-->B`), ['UNSUPPORTED_DIRECTION@1'], word)
    }
  })

  it('F2: skip links and back links never run through or hide behind another node', () => {
    for (const source of [
      'flowchart TD\nA-->B-->C\nA-->|skip|C',
      'flowchart TD\nA-->B-->C-->|retry|A',
      'flowchart LR\nA-->B-->C-->D\nA-->|shortcut|D',
      'flowchart BT\nA-->B-->C\nA-.->|skip|C',
      FORCE,
    ]) assertLegible(compile(source).content)
  })

  it('F2/F5: every accepted random flowchart is legible; the rest are refused as layout problems', () => {
    let seed = 11
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      // High bits: the low bits of a power-of-two LCG have very short periods.
      return (seed >>> 16) % n
    }
    const shapes = ['[x]', '(x)', '{x}', '((x))', '([x])']
    const seen = new Set<string>()
    let accepted = 0
    for (let round = 0; round < 400; round += 1) {
      const count = 2 + next(7)
      const lines = [`flowchart ${['TD', 'BT', 'LR', 'RL'][next(4)]!}`]
      for (let i = 0; i < count; i += 1) lines.push(`N${String(i)}${shapes[next(shapes.length)]!.replace('x', `n${String(i)}`)}`)
      const pairs = new Set<string>()
      for (let e = next(count * 2); e > 0; e -= 1) {
        const a = next(count), b = next(count)
        const key = `${String(Math.min(a, b))}-${String(Math.max(a, b))}`
        if (a === b || pairs.has(key)) continue
        pairs.add(key)
        lines.push(`N${String(a)} ${next(2) === 0 ? '-->' : '-.->'}${next(3) === 0 ? '|label text|' : ''} N${String(b)}`)
      }
      const result = compileMermaidFlowchart({ title: 't', source: lines.join('\n') })
      if (result.ok) {
        accepted += 1
        assertLegible(result.content)
      } else {
        for (const issue of result.issues) seen.add(issue.code)
      }
    }
    assert.ok(accepted > 200, `too few random flowcharts accepted: ${String(accepted)}`)
    for (const code of seen) assert.match(code, /^LAYOUT_/)
  })

  it('F2: a teaching retry loop with a Chinese back-link label routes through reserved space', () => {
    const content = compile('flowchart TD\n  A[建立模型] --> B[求解方程] --> C{结果是否合理}\n  C -->|否，修正假设| A\n  C -->|是| D[作答]').content
    assertLegible(content)
    assert.equal(node(content, 'A').x, node(content, 'C').x)
    assert.notEqual(node(content, 'B').x, node(content, 'A').x)
  })

  it('F2: links that cannot be drawn clear of other nodes are refused, not approximated', () => {
    assert.deepEqual(refuse('flowchart LR\nA-->B-->C-->D-->|apply the boundary condition|E'), ['LAYOUT_OCCLUDED@0'])
  })

  it('F3: a second link between the same two nodes is refused in either direction', () => {
    assert.deepEqual(refuse('flowchart LR\nA-->|go|B\nB-->|back|A'), ['PARALLEL_LINK@3'])
    assert.deepEqual(refuse('flowchart LR\nA-->B\nA-.->B'), ['PARALLEL_LINK@3'])
    assert.deepEqual(refuse('flowchart LR\nA-->|x|B\nA-->|y|B'), ['PARALLEL_LINK@3'])
  })

  it('F4: HTML tags, entities, Mermaid entity codes and markdown strings are refused in labels', () => {
    assert.deepEqual(refuse('flowchart TD\nA[line1<br>line2]-->B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA["a &amp; b"]-->B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA["x &#38; y"]-->B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA["say #quot;hi#quot;"]-->B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA["`**bold**`"]-->B'), ['INVALID_LABEL@2'])
    assert.deepEqual(refuse('flowchart TD\nA-->|<b>x</b>|B'), ['INVALID_LABEL@2'])
    assert.equal(node(compile('flowchart TD\nA["# 1; a & b"]-->B').content, 'A').label, '# 1; a & b')
  })

  it('F5: levels too close for a visible arrow are refused', () => {
    assert.deepEqual(refuse('flowchart TD\nA{a}-->B{b}-->C{c}-->D{d}-->E{e}'), ['LAYOUT_OVERCROWDED@0'])
    assertLegible(compile('flowchart TD\nA[a]-->B[b]-->C[c]-->D[d]-->E[e]').content)
    assertLegible(compile('flowchart LR\nA -->|apply the boundary condition| B').content)
  })

  it('F6: a trailing newline does not count as an extra line', () => {
    const source = 'flowchart TD\nA-->B\n' + Array.from({ length: MERMAID_LIMITS.maxLines - 2 }, () => '%% c').join('\n') + '\n'
    assert.equal(compileMermaidFlowchart({ title: 't', source }).ok, true)
  })

  it('F7: a second header and inline labels containing link text are refused; supported forms work', () => {
    assert.deepEqual(refuse('flowchart TD\nA-->B\nflowchart LR'), ['UNSUPPORTED_STATEMENT@3'])
    assert.deepEqual(refuse('flowchart TD\nA-->graph'), ['UNSUPPORTED_STATEMENT@2'])
    assert.deepEqual(refuse('flowchart TD\nA -- yes -- no --> B'), ['INVALID_LABEL@2'])
    assert.deepEqual(compile('flowchart TD\nA -- step 1. --> B').content.data.edges, [{ from: 'A', to: 'B', label: 'step 1.' }])
    assert.deepEqual(compile('flowchart TD\nA -. 近似 .-> B').content.data.edges, [{ from: 'A', to: 'B', label: '近似', dashed: true }])
    assert.deepEqual(compile('flowchart TD\nA -->|"x"| B').content.data.edges, [{ from: 'A', to: 'B', label: 'x' }])
    assert.equal(compile('flowchart\nA-->B').direction, 'TD')
  })

  it('F8: header trailers, comments and spaced shapes get accurate outcomes', () => {
    assert.equal(compile('flowchart TD %% note\nA-->B %% trailing note').content.data.edges.length, 1)
    assert.deepEqual(refuse('flowchart TD A-->B'), ['UNSUPPORTED_STATEMENT@1'])
    assert.deepEqual(refuse('flowchart TD\nA [x] --> B'), ['UNSUPPORTED_SHAPE@2'])
  })

  it('F8: the tool checks title before source', async () => {
    const tool = createMermaidTool()
    await assert.rejects(() => tool.execute({ source: 'flowchart TD\nA-->B' }, exec), /title must be a non-empty string/)
    await assert.rejects(() => tool.execute({ title: '', source: 'flowchart TD\nA-->B' }, exec), /title must be a non-empty string/)
    await assert.rejects(() => tool.execute({ title: 7, source: 'flowchart TD\nA-->B' }, exec), /title must be a non-empty string/)
  })

  it('F9: invisible and line-separator characters are refused', () => {
    for (const char of ['​', '‎', '‏', '؜', ' ', ' ', '⁠', '﻿']) {
      assert.deepEqual(refuse(`flowchart TD\nA[a${char}b]-->B`), ['CONTROL_CHARACTER@2'], `U+${char.charCodeAt(0).toString(16)}`)
    }
  })

  it('F10: width truncation counts emoji as wide and keeps grapheme clusters whole', () => {
    assert.equal(truncateLabel('😀'.repeat(15), 20), '😀'.repeat(8) + '...')
    assert.equal(truncateLabel('é'.repeat(30), 20), 'é'.repeat(17) + '...')
    assert.equal(displayWidth('牛顿 x'), 6)
  })

  it('F11: the rich_mermaid Tool view never previews argument content', () => {
    const ctx = { logger: { info() {}, warn() {}, error() {}, debug() {} } } as unknown as ClientContext
    const content = { schemaVersion: 1, type: 'message_card', title: 'smuggled', body: 'b' }
    const props = { sessionId: 's', callId: 'c', toolName: 'rich_mermaid', phase: 'start', block: { argsRaw: JSON.stringify({ title: 't', source: 'x', content }) } }
    const mermaidView = renderToStaticMarkup(createElement(createToolView(ctx, { previewArgs: false }) as never, props as never))
    assert.doesNotMatch(mermaidView, /smuggled/)
    const renderView = renderToStaticMarkup(createElement(createToolView(ctx) as never, { ...props, toolName: 'rich_render' } as never))
    assert.match(renderView, /smuggled/)
  })

  it('F11: the result value carries no unused warnings field', async () => {
    const value = await createMermaidTool().execute({ title: 't', source: 'flowchart TD\nA-->B' }, exec)
    assert.deepEqual(Object.keys(value as object).sort(), ['content', 'direction', 'layers', 'summary'])
  })
})

describe('independent re-review findings (Opus 5.5, 2026-10-26)', () => {
  const refuse = (source: string) => codes(compileMermaidFlowchart({ title: 't', source }))
  const compile = (source: string) => ok(compileMermaidFlowchart({ title: 't', source }))
  const NEWTON = '\nA[读题，确定研究对象] --> B[受力分析]\nB --> C{合力是否为零}\nC -->|是| D[列平衡方程]\nC -->|否| E[列牛顿第二定律]\nD --> F[求解并检查量纲]\nE --> F'
  const ENERGY = '\nA[能量守恒条件] --> B{只有保守力做功}\nB -->|是| C[机械能守恒]\nB -->|否| D[功能原理]\nC --> E[列方程求解]\nD --> E'

  it('N1: canonical decision charts are accepted (real shapes, not bounding boxes)', () => {
    for (const direction of ['TD', 'LR', 'BT', 'RL']) {
      assertLegible(compile(`flowchart ${direction}${NEWTON}`).content)
      assertLegible(compile(`flowchart ${direction}${ENERGY}`).content)
    }
  })

  it('N2: labels of crossing links never share a spot (pinned: refused, N-d)', () => {
    for (const source of [
      'flowchart TD\nA[初态]-->|等温|C[末态1]\nA-->|绝热|D[末态2]\nB[另一初态]-->|等压|C\nB-->|等容|D',
      'flowchart LR\nA[初态]-->|等温|C[末态1]\nA-->|绝热|D[末态2]\nB[另一初态]-->|等压|C\nB-->|等容|D',
    ]) {
      assert.deepEqual(refuse(source), ['LAYOUT_OCCLUDED@0'])
    }
  })

  it('N4: physics angle-bracket notation is plain text; HTML tags are refused with a hint', () => {
    assert.equal(node(compile('flowchart TD\nA["<E> = kT"]-->B').content, 'A').label, '<E> = kT')
    assert.equal(node(compile('flowchart TD\nA["<x^2> - <x>^2"]-->B').content, 'A').label, '<x^2> - <x>^2')
    assert.equal(node(compile('flowchart TD\nA[a<b, c>d]-->B').content, 'A').label, 'a<b, c>d')
    assert.deepEqual(compile('flowchart TD\nA -- <E> --> B').content.data.edges, [{ from: 'A', to: 'B', label: '<E>' }])
    const result = compileMermaidFlowchart({ title: 't', source: 'flowchart TD\nA["momentum <p>"]-->B' })
    assert.deepEqual(codes(result), ['INVALID_LABEL@2'])
    assert.match(result.ok ? '' : result.issues[0]!.message, /⟨/)
    for (const tag of ['<br>', '<br/>', '<BR />', '<b>x</b>', '<sub>2</sub>', '<span class="x">', '<img src=x>', '<script>']) {
      assert.deepEqual(refuse(`flowchart TD\nA["a ${tag} b"]-->B`), ['INVALID_LABEL@2'], tag)
    }
  })

  it('N5: a six-character CJK circle label is not truncated', () => {
    assert.equal(truncateLabel('牛顿第二定律', buildDiagramGeometry([{ id: 'c', label: '牛顿第二定律', x: 500, y: 500, shape: 'circle' }], []).nodes[0]!.labelMaxChars), '牛顿第二定律')
  })

  it('F5/F9/F10 follow-ups: short links, more invisible characters, BMP emoji width', () => {
    assert.deepEqual(refuse('flowchart TD\nA((a))-->B((b))-->C((c))-->D((d))-->E((e))'), ['LAYOUT_OVERCROWDED@0'])
    for (const code of [0x0d, 0x85, 0xad, 0x180e, 0x2061, 0x2064, 0x3164, 0xe0041]) {
      assert.deepEqual(refuse(`flowchart TD\nA[a${String.fromCodePoint(code)}b]-->B`), ['CONTROL_CHARACTER@2'], code.toString(16))
    }
    assert.equal(displayWidth(String.fromCodePoint(0x2705)), 2)
    assert.equal(displayWidth(String.fromCodePoint(0x2b50)), 2)
    assert.equal(displayWidth(String.fromCodePoint(0x27e8) + 'x' + String.fromCodePoint(0x27e9)), 3)
  })

  it('nits: trailing blank lines, combined inline and pipe labels', () => {
    const source = 'flowchart TD\nA-->B\n' + Array.from({ length: MERMAID_LIMITS.maxLines - 2 }, () => '%% c').join('\n') + '\n\n\n'
    assert.equal(compileMermaidFlowchart({ title: 't', source }).ok, true)
    assert.deepEqual(refuse('flowchart TD\nA -- x -->|y| B'), ['INVALID_LABEL@2'])
  })
})

describe('independent second re-review findings (Opus 5.5, 2026-10-26)', () => {
  const refuse = (source: string) => codes(compileMermaidFlowchart({ title: 't', source }))
  const compile = (source: string) => ok(compileMermaidFlowchart({ title: 't', source }))
  const LOOP5 = '\nA[审题] --> B[建立模型] --> C[求解] --> D{检验结果}\nD -->|不合理| B\nD -->|合理| E[作答]'
  const MOMENTUM = '\nA[确定系统] --> B{合外力为零}\nB -->|是| C[动量守恒]\nB -->|否| D{内力远大于外力}\nD -->|是| C\nD -->|否| F[动量定理]\nC --> E[列方程求解]\nF --> E'
  const INDUCTION = '\nA[验证n=1成立] --> B[假设n=k成立] --> C[证明n=k+1成立] --> D{推导成立}\nD -->|是| E[得出结论]\nD -->|否| F[检查假设] -.-> B'
  const cp = (...points: number[]) => String.fromCodePoint(...points)

  it('R1: a labelled link leaving a decision is drawn at five levels in every direction', () => {
    assertLegible(compile('flowchart TD\nA[审题]-->B[建立模型]-->C[求解]-->D{检验结果}\nD-->|是|E[作答]').content)
    for (const direction of ['TD', 'BT', 'LR', 'RL']) {
      for (const body of [LOOP5, MOMENTUM, INDUCTION]) assertLegible(compile(`flowchart ${direction}${body}`).content)
    }
  })

  it('R2: levels are sized from their own shapes, so nested decisions fit left to right', () => {
    assertLegible(compile('flowchart LR\nA[开始]-->B{条件一}-->C{条件二}-->D{条件三}-->E[情形]').content)
  })

  it('R3: wide Latin capitals are budgeted wider than lowercase letters and digits', () => {
    assert.equal(displayWidth('a1'), 2)
    assert.ok(displayWidth('W') >= 1.7 && displayWidth('M') >= 1.5 && displayWidth('m') >= 1.5)
    assert.ok(displayWidth('A') >= 1.2)
    const circle = buildDiagramGeometry([{ id: 'c', label: 'W'.repeat(12), x: 500, y: 500, shape: 'circle' }], []).nodes[0]!
    assert.ok(displayWidth(truncateLabel('W'.repeat(12), circle.labelMaxChars)) <= circle.labelMaxChars)
    assert.notEqual(truncateLabel('W'.repeat(12), circle.labelMaxChars), 'W'.repeat(12))
  })

  it('R4: flags, keycaps and emoji-presentation sequences count as wide', () => {
    for (const cluster of [cp(0x1f1e8, 0x1f1f3), cp(0x31, 0xfe0f, 0x20e3), cp(0xa9, 0xfe0f), cp(0x1f170, 0xfe0f), cp(0x1f004)]) {
      assert.equal(displayWidth(cluster), 2, cluster)
    }
    assert.equal(displayWidth(cp(0x27e8) + 'x' + cp(0x27e9)), 3)
  })

  it('N-a: every format, control and filler character is refused', () => {
    for (const code of [0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x2065, 0x206a, 0x206f, 0xfff9, 0xfffb, 0x1d173, 0x1d17a]) {
      assert.deepEqual(refuse(`flowchart TD\nA[a${cp(code)}b]-->B`), ['CONTROL_CHARACTER@2'], code.toString(16))
    }
    assert.equal(compile('flowchart TD\nA[a\tb]-->B').ok, true)
  })

  it('N-b: the tool description carries the angle-bracket hint', () => {
    assert.match(createMermaidTool().description, /⟨/)
  })

  it('N-c: a stray CR reports one issue; whitespace-only trailing lines are free', () => {
    assert.deepEqual(refuse('flowchart TD\rA-->B'), ['CONTROL_CHARACTER@1'])
    assert.deepEqual(refuse('flowchart TD\r\r\nA-->B'), ['CONTROL_CHARACTER@1'])
    const source = 'flowchart TD\nA-->B\n' + Array.from({ length: MERMAID_LIMITS.maxLines - 2 }, () => '%% c').join('\n') + '\n \n\t\n  '
    assert.equal(compileMermaidFlowchart({ title: 't', source }).ok, true)
  })
})
