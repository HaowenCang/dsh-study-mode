/**
 * Inline rendering (plan P1): top-level figure fences are split out of assistant Markdown so the
 * shadowed assistant renderer can draw them; everything else stays one Markdown document.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FIGURE_LANGS, linkDefinitions, splitFences } from '../../src/shared/fence-split'

const kinds = (text: string): string[] => splitFences(text).map(s => s.kind === 'md' ? 'md' : `fig:${s.lang}:${s.closed ? 'closed' : 'open'}`)

describe('splitFences', () => {
  it('recognises exactly the figure languages', () => {
    assert.deepEqual([...FIGURE_LANGS].sort(), ['dsh-heatmap', 'dsh-mermaid', 'dsh-physics', 'dsh-plot', 'dsh-svg', 'mermaid', 'svg'])
  })

  it('returns one md segment for text without figure fences', () => {
    const text = '# t\n\n```ts\nconst a = 1\n```\n\nend'
    assert.deepEqual(splitFences(text), [{ kind: 'md', text, offset: 0 }])
  })

  it('splits a closed svg fence and keeps exact surrounding text and offsets', () => {
    const text = 'before\n\n```svg\n<svg viewBox="0 0 1 1"/>\n```\n\nafter'
    const segments = splitFences(text)
    assert.deepEqual(kinds(text), ['md', 'fig:svg:closed', 'md'])
    const [a, f, b] = segments
    assert.equal(a?.kind === 'md' && a.text, 'before\n\n')
    assert.ok(f?.kind === 'figure')
    assert.equal(f.source, '<svg viewBox="0 0 1 1"/>')
    assert.equal(text.slice(f.offset, f.offset + 3), '```')
    assert.ok(b?.kind === 'md')
    assert.equal(b.text, '\nafter')
    assert.equal(text.slice(b.offset), b.text)
  })

  it('reports an unclosed trailing fence as open (streaming)', () => {
    const segments = splitFences('a\n\n```svg\n<svg viewBox="0 0 10 10">\n<rect')
    assert.deepEqual(segments.map(s => s.kind), ['md', 'figure'])
    const f = segments[1]
    assert.ok(f?.kind === 'figure' && !f.closed)
    assert.equal(f.source, '<svg viewBox="0 0 10 10">\n<rect')
  })

  it('treats an opening line still being typed as Markdown until its newline arrives', () => {
    assert.deepEqual(kinds('a\n\n```sv'), ['md'])
    assert.deepEqual(kinds('a\n\n```svg'), ['md'])
    assert.deepEqual(kinds('a\n\n```svg\n'), ['md', 'fig:svg:open'])
  })

  it('accepts tilde fences, longer fences and case-insensitive info strings with extra words', () => {
    assert.deepEqual(kinds('~~~Mermaid title\nflowchart TD\n~~~\n'), ['fig:mermaid:closed'])
    assert.deepEqual(kinds('````dsh-plot\n{}\n```\nstill code\n````\n'), ['fig:dsh-plot:closed'])
    const long = splitFences('````dsh-plot\n{}\n```\nstill code\n````\n')[0]
    assert.ok(long?.kind === 'figure')
    assert.equal(long.source, '{}\n```\nstill code')
  })

  it('does not split figure fences nested in another code block', () => {
    const text = '````markdown\n```svg\n<svg/>\n```\n````\n'
    assert.deepEqual(kinds(text), ['md'])
  })

  it('does not split indented, quoted or list-nested fences', () => {
    assert.deepEqual(kinds(' ```svg\n<svg/>\n```\n'), ['md'])
    assert.deepEqual(kinds('> ```svg\n> <svg/>\n> ```\n'), ['md'])
    assert.deepEqual(kinds('- item\n\n  ```svg\n  <svg/>\n  ```\n'), ['md'])
  })

  it('ignores unknown languages and backtick info strings', () => {
    assert.deepEqual(kinds('```svgx\n<svg/>\n```\n'), ['md'])
    assert.deepEqual(kinds('```svg `x`\n<svg/>\n```\n'), ['md'])
  })

  it('needs a closing fence of the same character and at least the opening length', () => {
    assert.deepEqual(kinds('````svg\n<svg/>\n```\n'), ['fig:svg:open'])
    assert.deepEqual(kinds('```svg\n<svg/>\n~~~\n'), ['fig:svg:open'])
    assert.deepEqual(kinds('```svg\n<svg/>\n   ```  \nz'), ['fig:svg:closed', 'md'])
    assert.deepEqual(kinds('```svg\n<svg/>\n```x\n'), ['fig:svg:open'])
  })

  it('splits several figures in order and handles CRLF', () => {
    const text = 'p1\r\n```svg\r\n<svg/>\r\n```\r\np2\r\n```dsh-heatmap\r\n{}\r\n```\r\n'
    assert.deepEqual(kinds(text), ['md', 'fig:svg:closed', 'md', 'fig:dsh-heatmap:closed'])
    const fig = splitFences(text)[1]
    assert.ok(fig?.kind === 'figure')
    assert.equal(fig.source, '<svg/>')
  })

  it('is linear on hostile input', () => {
    const text = '```svg\n'.repeat(20000)
    const start = performance.now()
    splitFences(text)
    assert.ok(performance.now() - start < 500)
  })
})

describe('linkDefinitions', () => {
  it('collects reference definitions outside code fences', () => {
    const text = 'see [a]\n\n[a]: https://example.com/a\n\n```\n[b]: https://example.com/b\n```\n  [c]: <https://example.com/c> "t"\n'
    assert.deepEqual(linkDefinitions(text), ['[a]: https://example.com/a', '  [c]: <https://example.com/c> "t"'])
  })
})
