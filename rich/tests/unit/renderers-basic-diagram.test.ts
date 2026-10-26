/**
 * Unit tests for the restricted `basic_diagram` renderer: primitive shapes on
 * the 0..1000 grid mapped into the fixed viewport, directed edges with arrow
 * markers and labels, tone fills, and escaped model text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BasicDiagram } from '../../src/client/renderers/basic-diagram'
import type { RendererTheme } from '../../src/client/renderers/types'
import type { BasicDiagramContent } from '../../src/shared/index'

const theme: RendererTheme = {
  text: '#1b1f24',
  muted: '#6b7280',
  border: '#d9dee7',
  surface: '#f6f7f9',
  accent: '#247bbf',
  series: ['#d94f2b'],
}

function render(content: BasicDiagramContent): string {
  return renderToStaticMarkup(createElement(BasicDiagram, { content, theme }))
}

function countOccurrences(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

const diagram: BasicDiagramContent = {
  schemaVersion: 1,
  type: 'basic_diagram',
  title: 'Release flow',
  subtitle: 'all four primitives',
  data: {
    nodes: [
      { id: 'a', label: 'Start', x: 500, y: 500, shape: 'box' },
      { id: 'b', label: 'Review', x: 100, y: 200, shape: 'rounded', tone: 'accent' },
      { id: 'c', label: 'Gate', x: 500, y: 100, shape: 'diamond' },
      { id: 'd', label: 'Ship', x: 900, y: 800, shape: 'circle', tone: 'muted' },
    ],
    edges: [
      { from: 'a', to: 'b', label: 'go' },
      { from: 'b', to: 'c', dashed: true },
      { from: 'c', to: 'd', label: 'ok' },
    ],
  },
}

test('diagram: renders only renderer-built primitives on the mapped grid', () => {
  const markup = render(diagram)
  assert.match(markup, /data-dsh-rich="basic-diagram"/)
  assert.match(markup, /<svg [^>]*role="img"/)
  assert.match(markup, /viewBox="0 0 1000 560"/)
  assert.equal(countOccurrences(markup, 'data-dsh-rich="node"'), 4)
  assert.equal(countOccurrences(markup, 'data-dsh-rich-node-shape="box"'), 1)
  assert.equal(countOccurrences(markup, 'data-dsh-rich-node-shape="rounded"'), 1)
  assert.equal(countOccurrences(markup, 'data-dsh-rich-node-shape="diamond"'), 1)
  assert.equal(countOccurrences(markup, 'data-dsh-rich-node-shape="circle"'), 1)
  // Node centres: (500,500) -> (500,280); (100,200) -> (100,112);
  // (500,100) -> (500,56); (900,800) -> (900,448).
  assert.match(markup, /x="426" y="250" width="148" height="60"/)
  assert.match(markup, /x="26" y="82" width="148" height="60" rx="14"/)
  assert.match(markup, /points="500,10 588,56 500,102 412,56"/)
  assert.match(markup, /cx="900" cy="448" r="40"/)
  assert.match(markup, /fill="#247bbf"/)
  assert.match(markup, /opacity="0\.72"/)
  assert.match(markup, />Start<\/text>/)
  assert.match(markup, /<title>Review<\/title>/)
})

test('diagram: directed edges carry arrow markers, labels and dashed styling', () => {
  const markup = render(diagram)
  assert.equal(countOccurrences(markup, 'data-dsh-rich="edge"'), 3)
  assert.match(markup, /<marker [^>]*orient="auto"/)
  assert.equal(countOccurrences(markup, 'marker-end="url(#dsh-rich-arrow-'), 3)
  assert.match(markup, /data-dsh-rich-edge-from="a" data-dsh-rich-edge-to="b" data-dsh-rich-edge-dashed="false"/)
  assert.match(markup, /data-dsh-rich-edge-from="b" data-dsh-rich-edge-to="c" data-dsh-rich-edge-dashed="true"/)
  assert.match(markup, /stroke-dasharray="7 5"/)
  assert.match(markup, /data-dsh-rich="edge-label"[^>]*><title>go<\/title>go<\/text>/)
  assert.match(markup, /data-dsh-rich="edge-label"[^>]*><title>ok<\/title>ok<\/text>/)
  assert.match(markup, /data-dsh-rich-edge-count="3"/)
})

test('diagram: accessible label summarises nodes and edges', () => {
  const markup = render(diagram)
  const aria = /aria-label="([^"]*)"/.exec(markup)
  assert.ok(aria !== null)
  assert.match(aria[1] as string, /Diagram Release flow/)
  assert.match(aria[1] as string, /4 nodes, 3 edges/)
})

test('diagram: unknown edge references are dropped, never crash', () => {
  const content: BasicDiagramContent = {
    schemaVersion: 1,
    type: 'basic_diagram',
    title: 'broken ref',
    data: {
      nodes: [{ id: 'a', label: 'Only', x: 500, y: 500 }],
      edges: [{ from: 'a', to: 'missing' }],
    },
  }
  const markup = render(content)
  assert.equal(countOccurrences(markup, 'data-dsh-rich="edge"'), 0)
  assert.match(markup, /data-dsh-rich-dropped-edges="1"/)
  assert.match(markup, />Only<\/text>/)
})

test('diagram: empty node list renders the explanatory state', () => {
  const content: BasicDiagramContent = {
    schemaVersion: 1,
    type: 'basic_diagram',
    title: 'empty',
    data: { nodes: [], edges: [] },
  }
  const markup = render(content)
  assert.match(markup, /data-dsh-rich="empty"/)
  assert.match(markup, /No diagram nodes to draw\./)
  assert.ok(!markup.includes('<svg'))
})

test('diagram: long labels are truncated for display and kept in the title', () => {
  const longLabel = 'A'.repeat(60)
  const content: BasicDiagramContent = {
    schemaVersion: 1,
    type: 'basic_diagram',
    title: 'long label',
    data: { nodes: [{ id: 'a', label: longLabel, x: 500, y: 500 }], edges: [] },
  }
  const markup = render(content)
  assert.ok(markup.includes(`<title>${longLabel}</title>`))
  // Capitals are budgeted at 1.35 units each (sans-serif metrics), so 12 fit the 17-unit room.
  assert.match(markup, />A{12}\.\.\.<\/text>/)
})

test('diagram: markup in node and edge labels is escaped, never rendered', () => {
  const content: BasicDiagramContent = {
    schemaVersion: 1,
    type: 'basic_diagram',
    title: '<script>alert(1)</script>',
    data: {
      nodes: [
        { id: 'a', label: '<script>alert(2)</script>', x: 100, y: 100 },
        { id: 'b', label: '<img src=x onerror=alert(3)>', x: 900, y: 900 },
      ],
      edges: [{ from: 'a', to: 'b', label: '<img src=x onerror=alert(4)>' }],
    },
  }
  const markup = render(content)
  assert.ok(!markup.includes('<script'))
  assert.ok(!markup.includes('<img'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(markup.includes('&lt;img'))
})

test('basic diagram: wide CJK labels are truncated by display width, not code units', async () => {
  const { truncateLabel } = await import('../../src/client/renderers/diagram/geometry')
  // A box allows 20 Latin-width units; each CJK glyph is about two of them.
  assert.equal(truncateLabel('一个非常长的标签用于检查截断与完整标题保留效果', 20), '一个非常长的标签...')
  assert.equal(truncateLabel('牛顿第二定律', 20), '牛顿第二定律')
  assert.equal(truncateLabel('受力分析 F=ma 与动量定理', 20), '受力分析 F=ma 与...')
  assert.equal(truncateLabel('abcdefghijklmnopqrstuvwxyz', 20), 'abcdefghijklmnop...') // m is budgeted 1.55 units
  // Never splits a surrogate pair.
  assert.equal(truncateLabel('𝜓'.repeat(30), 20), '𝜓'.repeat(17) + '...')
  const markup = render({
    schemaVersion: 1,
    type: 'basic_diagram',
    title: 'cjk',
    data: { nodes: [{ id: 'a', label: '一个非常长的标签用于检查截断与完整标题保留效果', x: 500, y: 500 }], edges: [] },
  })
  assert.match(markup, />一个非常长的标签\.\.\.<\/text>/)
  assert.match(markup, /<title>一个非常长的标签用于检查截断与完整标题保留效果<\/title>/)
})
