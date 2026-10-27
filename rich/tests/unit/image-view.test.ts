/**
 * `rich_image` Tool view: the persisted SHA-256 is checked before the picture
 * is shown, and a mismatch replaces the picture with an alert.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImageFigure, ImageToolView, verifyImageDigest } from '../../src/client/image-view'
import { readImageMeta, type ImageEnvelope } from '../../src/shared/image'
import type { ToolViewProps } from '../../src/client/contract'

/** A 1x1 PNG header-valid file (signature + IHDR + IEND); the view never decodes pixels. */
function tinyPng(): Uint8Array {
  return new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64'))
}

function envelope(sha256?: string): ImageEnvelope {
  const data = tinyPng()
  const meta = {
    kind: 'rich-image',
    envelopeVersion: 1,
    image: {
      mediaType: 'image/png',
      bytes: data.length,
      width: 1,
      height: 1,
      sha256: sha256 ?? createHash('sha256').update(data).digest('hex'),
      name: 'dot.png',
      data: Buffer.from(data).toString('base64'),
    },
    alt: 'One blue pixel',
    source: 'computed',
  }
  const read = readImageMeta(meta)
  assert.ok(read !== undefined)
  return read
}

function props(meta: unknown): ToolViewProps {
  return {
    sessionId: 's',
    callId: 'c',
    toolName: 'rich_image',
    phase: 'result',
    block: { kind: 'tool-result', seq: 1, time: 1, callId: 'c', name: 'rich_image', content: [], isError: false, meta, call: null, subCalls: [] },
  }
}

describe('rich_image digest check', () => {
  it('verifies the recorded SHA-256 against the decoded bytes', async () => {
    assert.equal(await verifyImageDigest(envelope().image), 'verified')
    assert.equal(await verifyImageDigest(envelope('0'.repeat(64)).image), 'mismatch')
  })

  it('withholds the picture until the digest is checked', () => {
    const markup = renderToStaticMarkup(createElement(ImageToolView, props(envelope())))
    assert.ok(!markup.includes('<img'))
    assert.match(markup, /正在校验图片/)
  })

  it('shows a verified picture and replaces a mismatched one with an alert', () => {
    const verified = renderToStaticMarkup(createElement(ImageFigure, { envelope: envelope(), digest: 'verified' }))
    assert.match(verified, /<img [^>]*src="data:image\/png;base64,/)
    assert.match(verified, /alt="One blue pixel"/)
    assert.match(verified, /sha256 [0-9a-f]{12}（已校验）/)
    const mismatch = renderToStaticMarkup(createElement(ImageFigure, { envelope: envelope('0'.repeat(64)), digest: 'mismatch' }))
    assert.ok(!mismatch.includes('<img'))
    assert.match(mismatch, /role="alert"/)
    assert.match(mismatch, /SHA-256/)
    const unchecked = renderToStaticMarkup(createElement(ImageFigure, { envelope: envelope(), digest: 'unavailable' }))
    assert.match(unchecked, /<img /)
    assert.match(unchecked, /未校验/)
  })
})
