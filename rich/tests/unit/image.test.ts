/**
 * `rich_image`: an existing workspace raster image shown to the learner only.
 *
 * Covers header inspection for the four admitted formats, the Host tool's
 * path, size, format and provenance gates over a temporary workspace, the
 * durable envelope reader, and the Tool view markup.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IMAGE_LIMITS, inspectImage, readImageMeta, type ImageEnvelope } from '../../src/shared/image'
import { createImageTool, type ImageToolServices } from '../../src/host/tools/rich-image'
import { ImageToolView } from '../../src/client/image-view'
import type { ToolViewProps } from '../../src/client/contract'

const signal = new AbortController().signal

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A decodable RGB PNG of the given size (every pixel the same color). */
function png(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) raw.set([36, 123, 191], row * (width * 3 + 1) + 1 + column * 3)
  }
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** PNG signature plus an IHDR declaring the given size and no pixel data. */
function pngHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const ihdr = chunk('IHDR', header)
  const out = new Uint8Array(8 + ihdr.length)
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  out.set(ihdr, 8)
  return out
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function ascii(text: string): number[] {
  return [...text].map(char => char.charCodeAt(0))
}

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff]
}

interface GifFrame {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/** A structurally complete GIF89a: no global color table, each frame with a graphic control extension and a 2-color local table. */
function gif(width: number, height: number, frames: readonly GifFrame[], options: { readonly trailer?: boolean } = {}): Uint8Array {
  const out = [...ascii('GIF89a'), ...u16(width), ...u16(height), 0, 0, 0]
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0, 0, 0, 0, 0)
    out.push(0x2c, ...u16(frame.left), ...u16(frame.top), ...u16(frame.width), ...u16(frame.height), 0x80, 0, 0, 0, 255, 255, 255)
    out.push(2, 2, 0x4c, 0x01, 0)
  }
  if (options.trailer !== false) out.push(0x3b)
  return bytes(...out)
}

/** SOI, an APP1 Exif segment whose IFD0 holds only the orientation tag, then SOF0 with height 0x0102 and width 0x0304. */
function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff = [...ascii('MM'), 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]
  const app1 = [...ascii('Exif'), 0, 0, ...tiff]
  return bytes(0xff, 0xd8, 0xff, 0xe1, 0, app1.length + 2, ...app1, 0xff, 0xc0, 0, 17, 8, 1, 2, 3, 4, 3, ...new Array(9).fill(0))
}

describe('image header inspection', () => {
  it('reads PNG, GIF, JPEG and the three WebP variants', () => {
    assert.deepEqual(inspectImage(png(3, 2)), { ok: true, mediaType: 'image/png', width: 3, height: 2 })
    assert.deepEqual(inspectImage(gif(5, 7, [{ left: 0, top: 0, width: 5, height: 7 }])), { ok: true, mediaType: 'image/gif', width: 5, height: 7 })
    // SOI, APP0 (length 16), SOF0: length 17, precision 8, height 0x0102, width 0x0304.
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 1, 2, 3, 4, 3, ...new Array(9).fill(0))
    assert.deepEqual(inspectImage(jpeg), { ok: true, mediaType: 'image/jpeg', width: 0x0304, height: 0x0102 })
    const riff = (kind: string, body: number[]): Uint8Array => bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(kind), 0, 0, 0, 0, ...body)
    assert.deepEqual(inspectImage(riff('VP8X', [0, 0, 0, 0, 9, 0, 0, 4, 0, 0])), { ok: true, mediaType: 'image/webp', width: 10, height: 5 })
    // VP8L: signature 0x2f, then 14-bit (width-1) and 14-bit (height-1) little-endian bit fields.
    assert.deepEqual(inspectImage(riff('VP8L', [0x2f, 9, 0x40, 1, 0])), { ok: true, mediaType: 'image/webp', width: 10, height: 6 })
    // VP8: frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height.
    assert.deepEqual(inspectImage(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 20, 0, 30, 0])), { ok: true, mediaType: 'image/webp', width: 20, height: 30 })
  })

  it('refuses SVG, unknown, truncated and malformed headers', () => {
    assert.equal(inspectImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')).ok, false)
    assert.equal(inspectImage(bytes(1, 2, 3)).ok, false)
    assert.equal(inspectImage(png(2, 2).subarray(0, 20)).ok, false)
    assert.equal(inspectImage(pngHeader(0, 4)).ok, false)
    const scanBeforeFrame = bytes(0xff, 0xd8, 0xff, 0xda, 0, 2, 0, 0)
    assert.equal(inspectImage(scanBeforeFrame).ok, false)
  })

  it('walks every GIF frame and refuses frames outside the screen or beyond the pixel budget', () => {
    assert.equal(inspectImage(gif(10, 10, [{ left: 0, top: 0, width: 10, height: 10 }, { left: 2, top: 3, width: 4, height: 4 }])).ok, true)
    assert.equal(inspectImage(bytes(...ascii('GIF89a'), 5, 0, 7, 0, 0, 0, 0)).ok, false, 'a header without frames is not an image')
    assert.equal(inspectImage(gif(10, 10, [{ left: 5, top: 0, width: 60000, height: 60000 }])).ok, false, 'frame larger than the logical screen')
    assert.equal(inspectImage(gif(10, 10, [{ left: 0, top: 0, width: 10, height: 10 }], { trailer: false })).ok, false, 'truncated stream')
    assert.equal(inspectImage(gif(10, 10, [{ left: 0, top: 0, width: 0, height: 10 }])).ok, false, 'empty frame')
    const screen = { left: 0, top: 0, width: 8000, height: 5000 }
    assert.equal(inspectImage(gif(8000, 5000, [screen])).ok, true)
    assert.equal(inspectImage(gif(8000, 5000, [screen, screen])).ok, false, 'summed frame area above maxPixels')
  })

  it('reports JPEG dimensions after the Exif orientation', () => {
    assert.deepEqual(inspectImage(jpegWithOrientation(1)), { ok: true, mediaType: 'image/jpeg', width: 0x0304, height: 0x0102 })
    assert.deepEqual(inspectImage(jpegWithOrientation(6)), { ok: true, mediaType: 'image/jpeg', width: 0x0102, height: 0x0304 })
    assert.deepEqual(inspectImage(jpegWithOrientation(8)), { ok: true, mediaType: 'image/jpeg', width: 0x0102, height: 0x0304 })
  })
})

interface Workspace {
  readonly root: string
  readonly services: ImageToolServices
  readonly agent: { readonly id: string }
  /** Every filesystem method call, as `method path-or-target`. */
  readonly calls: string[]
}

/**
 * A filesystem facade over a real temporary directory that follows RC.3
 * `dsh-fs-local` on this platform: `displayPath` is the lexical
 * `path.resolve(cwd, path)`, `targetKey` the realpath, `contains` compares
 * realpaths with a `..${sep}` prefix test, and `lstat` probes the lexical path.
 */
function workspace(): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rich-image-')))
  const calls: string[] = []
  const services: ImageToolServices = {
    fs: {
      async resolve(path, opts) {
        calls.push(`resolve ${path}`)
        const displayPath = resolvePath(opts?.cwd ?? root, path)
        let targetKey = displayPath
        try { targetKey = await realpath(displayPath) } catch { /* an absent target keeps its lexical path */ }
        return { targetKey, displayPath }
      },
      contains(parent, child) {
        const rel = relative(parent.targetKey, child.targetKey)
        return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
      },
      async lstat(path, opts) {
        calls.push(`lstat ${path}`)
        try {
          const info = await lstat(resolvePath(opts?.cwd ?? root, path))
          return { type: info.isSymbolicLink() ? 'symlink' : info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
        } catch { return undefined }
      },
      async stat(target) {
        calls.push(`stat ${target.targetKey}`)
        try {
          const info = await stat(target.targetKey)
          return { type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other', size: info.size }
        } catch { return undefined }
      },
      async readBytes(target, _signal, maxBytes) {
        calls.push(`readBytes ${target.targetKey}`)
        const data = await readFile(target.targetKey)
        if (data.length > maxBytes) throw Object.assign(new Error('too large'), { code: 'FS_TOO_LARGE' })
        return new Uint8Array(data)
      },
    },
    workingDirectory: { async ensure() { return root } },
  }
  return { root, services, agent: { id: 'session-1' }, calls }
}

describe('rich_image tool', () => {
  let space: Workspace
  const image = png(4, 3)
  before(() => {
    space = workspace()
    mkdirSync(join(space.root, 'figures'))
    writeFileSync(join(space.root, 'figures', 'field.png'), image)
    writeFileSync(join(space.root, 'figures', 'mislabelled.jpg'), image)
    writeFileSync(join(space.root, 'figures', 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    writeFileSync(join(space.root, 'figures', 'huge.png'), pngHeader(IMAGE_LIMITS.maxDimension + 1, 2))
    writeFileSync(join(space.root, 'figures', 'raw'), image)
    writeFileSync(join(space.root, 'figures', 'big.png'), Buffer.concat([image, Buffer.alloc(2000)]))
    writeFileSync(join(space.root, '..', `outside-${basename(space.root)}.png`), image)
    mkdirSync(join(space.root, '..', `outside-dir-${basename(space.root)}`))
    writeFileSync(join(space.root, '..', `outside-dir-${basename(space.root)}`, 'field.png'), image)
  })
  after(() => {
    rmSync(space.root, { recursive: true, force: true })
    rmSync(join(space.root, '..', `outside-${basename(space.root)}.png`), { force: true })
    rmSync(join(space.root, '..', `outside-dir-${basename(space.root)}`), { recursive: true, force: true })
  })

  function tool(maxImageBytes?: number) {
    return createImageTool({ services: () => space.services, ...maxImageBytes === undefined ? {} : { maxImageBytes } })
  }
  function run(args: unknown, maxImageBytes?: number) {
    return tool(maxImageBytes).execute(args, { signal, agent: space.agent })
  }
  const args = { path: 'figures/field.png', alt: 'Uniform blue test field', source: 'computed' }

  it('declares a closed schema with required path, alt and source', () => {
    const definition = tool()
    assert.equal(definition.name, 'rich_image')
    assert.equal(definition.parameters['additionalProperties'], false)
    assert.deepEqual(definition.parameters['required'], ['path', 'alt', 'source'])
  })

  it('records format, size, hash and declared provenance and projects a path-free envelope', async () => {
    const value = await run({ ...args, caption: ' Field after 10 steps ', sourceNote: 'matplotlib imshow' }) as Record<string, unknown>
    const sha256 = createHash('sha256').update(image).digest('hex')
    assert.deepEqual(value['image'], {
      mediaType: 'image/png',
      bytes: image.length,
      width: 4,
      height: 3,
      sha256,
      name: 'field.png',
      data: Buffer.from(image).toString('base64'),
    })
    assert.equal(value['caption'], 'Field after 10 steps')
    assert.equal(value['source'], 'computed')
    assert.equal(value['path'], join(space.root, 'figures', 'field.png'))
    const definition = tool()
    const [text] = definition.output.render({}, value as never)
    assert.match(text?.text ?? '', /^Displayed image "field\.png" to the learner \(image\/png, 4x3 px, \d+ bytes, sha256 [0-9a-f]{12}\)\./)
    assert.match(text?.text ?? '', /You cannot see this image/)
    const meta = definition.output.presentationMeta?.({}, value as never) as Record<string, unknown>
    assert.equal(meta['kind'], 'rich-image')
    assert.equal(meta['envelopeVersion'], 1)
    assert.equal('path' in meta, false)
    assert.ok(readImageMeta(meta) !== undefined)
  })

  it('identifies an extension-less file from its signature', async () => {
    const value = await run({ ...args, path: 'figures/raw' }) as { image: { mediaType: string } }
    assert.equal(value.image.mediaType, 'image/png')
  })

  it('refuses missing, outside, oversized, mislabelled, vector and huge images', async () => {
    await assert.rejects(run({ ...args, path: 'figures/none.png' }), /not found/)
    await assert.rejects(run({ ...args, path: `../outside-${basename(space.root)}.png` }), /outside the session working directory/)
    await assert.rejects(run({ ...args, path: join(space.root, '..', `outside-${basename(space.root)}.png`) }), /outside the session working directory/)
    await assert.rejects(run({ ...args, path: 'figures/big.png' }, 1024), /exceeds the 1024-byte limit/)
    assert.ok(await run({ ...args, path: 'figures/big.png' }, 4096))
    await assert.rejects(run({ ...args, path: 'figures/mislabelled.jpg' }), /extension declares image\/jpeg/)
    await assert.rejects(run({ ...args, path: 'figures/vector.svg' }), /PNG, JPEG, GIF or WebP/)
    await assert.rejects(run({ ...args, path: 'figures/huge.png' }), /8192 px/)
    await assert.rejects(run({ ...args, path: 'figures' }), /not a regular file/)
  })

  it('refuses a symbolic link even when it points inside the workspace', async (context) => {
    try {
      symlinkSync(join(space.root, 'figures', 'field.png'), join(space.root, 'figures', 'link.png'))
    } catch {
      context.skip('symbolic links are not creatable here')
      return
    }
    await assert.rejects(run({ ...args, path: 'figures/link.png' }), /symbolic link/)
  })

  it('refuses network, device, drive-relative and outside paths before any filesystem access', async () => {
    const outside = `outside-${basename(space.root)}.png`
    const cases: Array<[string, RegExp]> = [
      ['\\\\203.0.113.9\\share\\field.png', /network, device or drive-relative/],
      ['//203.0.113.9/share/field.png', /network, device or drive-relative/],
      ['\\\\?\\C:\\field.png', /network, device or drive-relative/],
      ['Z:field.png', /network, device or drive-relative/],
      [`../${outside}`, /outside the session working directory/],
      [`figures/../../${outside}`, /outside the session working directory/],
      [join(space.root, '..', outside), /outside the session working directory/],
    ]
    for (const [path, expected] of cases) {
      space.calls.length = 0
      await assert.rejects(run({ ...args, path }), expected, path)
      assert.deepEqual(space.calls, [], `no filesystem call for ${path}`)
    }
  })

  it('accepts an absolute path inside the working directory and normalizes dot segments', async () => {
    const absolute = await run({ ...args, path: join(space.root, 'figures', 'field.png') }) as { path: string }
    assert.equal(absolute.path, join(space.root, 'figures', 'field.png'))
    const dotted = await run({ ...args, path: 'figures/./sub/../field.png' }) as { path: string }
    assert.equal(dotted.path, join(space.root, 'figures', 'field.png'))
  })

  it('refuses a file reached through a directory link or junction that leaves the workspace', async (context) => {
    try {
      symlinkSync(join(space.root, '..', `outside-dir-${basename(space.root)}`), join(space.root, 'linked'), 'junction')
    } catch {
      context.skip('directory links are not creatable here')
      return
    }
    await assert.rejects(run({ ...args, path: 'linked/field.png' }), /outside the session working directory/)
  })

  it('refuses a run_code sub-dispatch, whose result value would reach the model', async () => {
    space.calls.length = 0
    await assert.rejects(tool().execute(args, { signal, agent: space.agent, parent: {} }), /call rich_image directly/)
    assert.deepEqual(space.calls, [])
  })

  it('refuses control, line-separator and bidirectional-control characters in learner-visible text', async () => {
    for (const code of [0x07, 0x0a, 0x85, 0x2028, 0x202e, 0x2066, 0x200f]) {
      const bad = `field ${String.fromCharCode(code)} map`
      await assert.rejects(run({ ...args, alt: bad }), /alt/, `alt U+${code.toString(16)}`)
      await assert.rejects(run({ ...args, caption: bad }), /caption/, `caption U+${code.toString(16)}`)
    }
  })

  it('validates arguments and requires the session filesystem', async () => {
    await assert.rejects(run({ ...args, extra: 1 }), /unexpected argument/)
    await assert.rejects(run({ ...args, alt: '  ' }), /alt/)
    await assert.rejects(run({ ...args, source: 'generated' }), /source/)
    await assert.rejects(run({ ...args, caption: 'x'.repeat(IMAGE_LIMITS.maxCaptionLength + 1) }), /caption/)
    await assert.rejects(
      createImageTool({ services: () => ({}) }).execute(args, { signal, agent: space.agent }),
      /session filesystem is not available/,
    )
    await assert.rejects(tool().execute(args, { signal }), /session filesystem is not available/)
  })

  it('fails loud on an out-of-range byte limit', () => {
    assert.throws(() => createImageTool({ services: () => ({}), maxImageBytes: 1023 }), /maxImageBytes/)
    assert.throws(() => createImageTool({ services: () => ({}), maxImageBytes: IMAGE_LIMITS.maxImageBytesCeiling + 1 }), /maxImageBytes/)
    assert.throws(() => createImageTool({ services: () => ({}), maxImageBytes: 2048.5 }), /maxImageBytes/)
  })
})

function envelope(overrides: Record<string, unknown> = {}, imageOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  const data = png(4, 3)
  return {
    kind: 'rich-image',
    envelopeVersion: 1,
    image: {
      mediaType: 'image/png',
      bytes: data.length,
      width: 4,
      height: 3,
      sha256: createHash('sha256').update(data).digest('hex'),
      name: 'field.png',
      data: Buffer.from(data).toString('base64'),
      ...imageOverrides,
    },
    alt: 'Uniform blue test field',
    source: 'user_provided',
    ...overrides,
  }
}

describe('rich_image envelope', () => {
  it('reads a consistent envelope', () => {
    const read = readImageMeta(envelope({ caption: 'cap', sourceNote: 'from the course handout' }))
    assert.equal(read?.image.width, 4)
    assert.equal(read?.caption, 'cap')
  })

  it('rejects foreign, tampered or inconsistent envelopes', () => {
    assert.equal(readImageMeta(envelope({ kind: 'rich-response' })), undefined)
    assert.equal(readImageMeta(envelope({ envelopeVersion: 2 })), undefined)
    assert.equal(readImageMeta(envelope({ source: 'generated' })), undefined)
    assert.equal(readImageMeta(envelope({}, { mediaType: 'image/svg+xml' })), undefined)
    assert.equal(readImageMeta(envelope({}, { mediaType: 'image/jpeg' })), undefined)
    assert.equal(readImageMeta(envelope({}, { width: 5 })), undefined)
    assert.equal(readImageMeta(envelope({}, { bytes: 3 })), undefined)
    assert.equal(readImageMeta(envelope({}, { data: 'not base64!' })), undefined)
    assert.equal(readImageMeta(envelope({}, { sha256: 'abc' })), undefined)
    assert.equal(readImageMeta(envelope({ alt: '' })), undefined)
    assert.equal(readImageMeta(null), undefined)
  })
})

describe('rich_image Tool view', () => {
  function props(meta: unknown, isError = false): ToolViewProps {
    return {
      sessionId: 's',
      callId: 'c',
      toolName: 'rich_image',
      phase: 'result',
      block: { kind: 'tool-result', seq: 1, time: 1, callId: 'c', name: 'rich_image', content: [{ type: 'text', text: 'cannot read "x.png": not found' }], isError, meta, call: null, subCalls: [] },
    }
  }

  it('shows caption and declared provenance while the picture waits for its digest check', () => {
    const value = envelope({ caption: '<b>Field</b>', source: 'computed', sourceNote: 'matplotlib imshow' }) as unknown as ImageEnvelope
    const markup = renderToStaticMarkup(createElement(ImageToolView, props(value)))
    assert.ok(!markup.includes('<img'))
    assert.match(markup, /正在校验图片/)
    assert.ok(markup.includes('&lt;b&gt;Field&lt;/b&gt;'))
    assert.match(markup, /来源（模型声明）：计算生成 · matplotlib imshow/)
    assert.match(markup, /field\.png · PNG · 4×3 px/)
    assert.match(markup, /sha256 [0-9a-f]{12}/)
  })

  it('shows a bounded alert for failures and invalid envelopes', () => {
    const failed = renderToStaticMarkup(createElement(ImageToolView, props(undefined, true)))
    assert.match(failed, /role="alert"/)
    assert.match(failed, /not found/)
    const invalid = renderToStaticMarkup(createElement(ImageToolView, props(envelope({}, { width: 9 }))))
    assert.match(invalid, /role="alert"/)
    assert.ok(!invalid.includes('<img'))
  })
})
