/**
 * ImageV1 - one existing raster image shown to the learner, never to the model.
 *
 * The Host reads a workspace file, checks its format and size, and persists
 * the bytes (base64) with their SHA-256 and the model-declared provenance in a
 * `rich-image` envelope. The bytes travel in the session log, so a deployment
 * that uploads session logs uploads them too. Only PNG, JPEG, GIF and WebP are
 * admitted; SVG and every other format are refused because they can carry
 * markup or script.
 */
import { isPlainText } from './plain-text'
import { isRecord } from './validation'

export const IMAGE_META_KIND = 'rich-image' as const
export const IMAGE_ENVELOPE_VERSION = 1 as const

export const IMAGE_LIMITS = {
  maxPathLength: 1024,
  maxAltLength: 300,
  maxCaptionLength: 500,
  maxSourceNoteLength: 300,
  maxNameLength: 120,
  maxDimension: 8192,
  maxPixels: 40_000_000,
  /** Default per-image byte limit (`maxImageBytes` config). */
  defaultMaxImageBytes: 512 * 1024,
  minImageBytesLimit: 1024,
  maxImageBytesCeiling: 2 * 1024 * 1024,
} as const

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/** `computed`: produced by code run for this task; `user_provided`: supplied by the learner or course material. Declared by the model, not verified. */
export const IMAGE_SOURCES = ['computed', 'user_provided'] as const
export type ImageSource = (typeof IMAGE_SOURCES)[number]

/** Format facts read from the file header. */
export type ImageInspection =
  | { readonly ok: true; readonly mediaType: ImageMediaType; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string }

export interface ImageData {
  readonly mediaType: ImageMediaType
  readonly bytes: number
  readonly width: number
  readonly height: number
  /** Lowercase hex SHA-256 of the file bytes, computed by the Host. */
  readonly sha256: string
  /** File name without directories. */
  readonly name: string
  /** Standard base64 of the file bytes. */
  readonly data: string
}

/** Durable envelope persisted through the tool result `meta`. */
export interface ImageEnvelope {
  readonly kind: typeof IMAGE_META_KIND
  readonly envelopeVersion: typeof IMAGE_ENVELOPE_VERSION
  readonly image: ImageData
  readonly alt: string
  readonly caption?: string
  readonly source: ImageSource
  readonly sourceNote?: string
}

function fail(reason: string): ImageInspection {
  return { ok: false, reason }
}

function matches(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.length < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

function matchesAscii(data: Uint8Array, offset: number, text: string): boolean {
  return matches(data, offset, [...text].map(char => char.charCodeAt(0)))
}

function u16be(data: Uint8Array, offset: number): number {
  return ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)
}

function u16le(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)
}

function u24le(data: Uint8Array, offset: number): number {
  return u16le(data, offset) | ((data[offset + 2] ?? 0) << 16)
}

function u32le(data: Uint8Array, offset: number): number {
  return (u16le(data, offset) + u16le(data, offset + 2) * 0x10000) >>> 0
}

function u32be(data: Uint8Array, offset: number): number {
  return (((data[offset] ?? 0) << 24) >>> 0) + (((data[offset + 1] ?? 0) << 16) | ((data[offset + 2] ?? 0) << 8) | (data[offset + 3] ?? 0))
}

function sized(mediaType: ImageMediaType, width: number, height: number): ImageInspection {
  if (width < 1 || height < 1) return fail('the header declares an empty image')
  return { ok: true, mediaType, width, height }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** Orientation tag (0x0112) of the TIFF IFD0 in `data[start, end)`, or undefined when absent or malformed. */
function exifOrientation(data: Uint8Array, start: number, end: number): number | undefined {
  const little = matchesAscii(data, start, 'II')
  if (!little && !matchesAscii(data, start, 'MM')) return undefined
  const read16 = (at: number): number => (little ? u16le(data, at) : u16be(data, at))
  const read32 = (at: number): number => (little ? u32le(data, at) : u32be(data, at))
  if (start + 8 > end || read16(start + 2) !== 42) return undefined
  const ifd = start + read32(start + 4)
  if (ifd + 2 > end) return undefined
  const count = read16(ifd)
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > end) return undefined
    if (read16(entry) === 0x0112) return read16(entry + 2) === 3 ? read16(entry + 8) : undefined
  }
  return undefined
}

/** Frame size from the first SOF marker, reported after the first Exif orientation (5-8 swap the sides, as browsers display them). */
function inspectJpeg(data: Uint8Array): ImageInspection {
  let offset = 2
  let orientation: number | undefined
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return fail('the JPEG marker sequence is malformed')
    const marker = data[offset + 1] ?? 0
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return fail('the JPEG has no frame header before its image data')
    const length = u16be(data, offset + 2)
    if (length < 2) return fail('the JPEG marker sequence is malformed')
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > data.length) return fail('the JPEG frame header is truncated')
      const width = u16be(data, offset + 7)
      const height = u16be(data, offset + 5)
      return orientation !== undefined && orientation >= 5 && orientation <= 8 ? sized('image/jpeg', height, width) : sized('image/jpeg', width, height)
    }
    if (marker === 0xe1 && orientation === undefined && matchesAscii(data, offset + 4, 'Exif') && data[offset + 8] === 0 && data[offset + 9] === 0) {
      orientation = exifOrientation(data, offset + 10, Math.min(data.length, offset + 2 + length))
    }
    offset += 2 + length
  }
  return fail('the JPEG frame header is missing or truncated')
}

function inspectWebp(data: Uint8Array): ImageInspection {
  if (matchesAscii(data, 12, 'VP8X')) {
    if (data.length < 30) return fail('the WebP header is truncated')
    return sized('image/webp', u24le(data, 24) + 1, u24le(data, 27) + 1)
  }
  if (matchesAscii(data, 12, 'VP8L')) {
    if (data.length < 25 || data[20] !== 0x2f) return fail('the WebP lossless header is malformed')
    const b1 = data[21] ?? 0
    const b2 = data[22] ?? 0
    const b3 = data[23] ?? 0
    const b4 = data[24] ?? 0
    return sized('image/webp', 1 + (b1 | ((b2 & 0x3f) << 8)), 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)))
  }
  if (matchesAscii(data, 12, 'VP8 ')) {
    if (data.length < 30 || !matches(data, 23, [0x9d, 0x01, 0x2a])) return fail('the WebP lossy header is malformed')
    return sized('image/webp', u16le(data, 26) & 0x3fff, u16le(data, 28) & 0x3fff)
  }
  return fail('the WebP container has no image header')
}

function colorTableBytes(packed: number): number {
  return (packed & 0x80) === 0 ? 0 : 3 * (1 << ((packed & 0x07) + 1))
}

/** Offset after a data sub-block chain starting at `offset`, or undefined when the chain is truncated. */
function skipSubBlocks(data: Uint8Array, offset: number): number | undefined {
  let at = offset
  while (at < data.length) {
    const size = data[at] ?? 0
    at += 1
    if (size === 0) return at
    at += size
  }
  return undefined
}

/**
 * Walk every GIF block to the trailer. Each frame must be non-empty and lie
 * inside the logical screen, and the summed frame area is bounded by
 * `maxPixels`, so the logical-screen size bounds what a decoder allocates.
 */
function inspectGif(data: Uint8Array): ImageInspection {
  if (data.length < 13) return fail('the GIF header is truncated')
  const width = u16le(data, 6)
  const height = u16le(data, 8)
  if (width < 1 || height < 1) return fail('the header declares an empty image')
  let offset = 13 + colorTableBytes(data[10] ?? 0)
  let frames = 0
  let area = 0
  while (offset < data.length) {
    const introducer = data[offset]
    if (introducer === 0x3b) return frames === 0 ? fail('the GIF contains no image') : { ok: true, mediaType: 'image/gif', width, height }
    if (introducer === 0x21) {
      const next = skipSubBlocks(data, offset + 2)
      if (next === undefined) break
      offset = next
      continue
    }
    if (introducer !== 0x2c) return fail('the GIF block sequence is malformed')
    if (offset + 10 > data.length) break
    const left = u16le(data, offset + 1)
    const top = u16le(data, offset + 3)
    const frameWidth = u16le(data, offset + 5)
    const frameHeight = u16le(data, offset + 7)
    if (frameWidth < 1 || frameHeight < 1 || left + frameWidth > width || top + frameHeight > height) {
      return fail('a GIF frame is empty or extends beyond the logical screen')
    }
    frames += 1
    area += frameWidth * frameHeight
    if (area > IMAGE_LIMITS.maxPixels) return fail(`the GIF frames total more than ${String(IMAGE_LIMITS.maxPixels)} pixels`)
    offset += 10 + colorTableBytes(data[offset + 9] ?? 0)
    // One LZW minimum-code-size byte precedes the image data sub-blocks.
    const next = skipSubBlocks(data, offset + 1)
    if (next === undefined) break
    offset = next
  }
  return fail('the GIF stream is truncated')
}

/**
 * Identify an admitted raster format and its pixel size from the file header.
 * Reads headers and block structure (every GIF frame); it does not decode pixel data.
 * @param data - the complete file bytes.
 * @returns the media type and size, or the reason the bytes are refused.
 */
export function inspectImage(data: Uint8Array): ImageInspection {
  if (matches(data, 0, PNG_SIGNATURE)) {
    if (data.length < 24 || u32be(data, 8) !== 13 || !matchesAscii(data, 12, 'IHDR')) return fail('the PNG header is truncated or malformed')
    return sized('image/png', u32be(data, 16), u32be(data, 20))
  }
  if (matchesAscii(data, 0, 'GIF87a') || matchesAscii(data, 0, 'GIF89a')) return inspectGif(data)
  if (matches(data, 0, [0xff, 0xd8, 0xff])) return inspectJpeg(data)
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WEBP')) return inspectWebp(data)
  return fail('the content is not a PNG, JPEG, GIF or WebP image')
}

/** The media type an image file extension declares; `null` for a non-image extension, `undefined` for none. */
export function imageMediaTypeForExtension(extension: string): ImageMediaType | null | undefined {
  switch (extension.toLowerCase()) {
    case '': return undefined
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    default: return null
  }
}

/** True when a size is within the per-side and total pixel limits. */
export function imageSizeAllowed(width: number, height: number): boolean {
  return width <= IMAGE_LIMITS.maxDimension && height <= IMAGE_LIMITS.maxDimension && width * height <= IMAGE_LIMITS.maxPixels
}

/** Trimmed bounded plain text without control or bidirectional-control characters, or undefined. */
export function imageText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength || !isPlainText(trimmed)) return undefined
  return trimmed
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const SHA256 = /^[0-9a-f]{64}$/

function decodeBase64(text: string): Uint8Array | undefined {
  try {
    const binary = globalThis.atob(text)
    const out = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
    return out
  } catch {
    // atob rejects malformed input with a DOMException; the envelope is then invalid.
    return undefined
  }
}

/**
 * The file bytes of an envelope already accepted by {@link readImageMeta}.
 * @param image - validated image data.
 * @returns the decoded bytes.
 */
export function imageBytes(image: ImageData): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(image.data)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
  return out
}

function readImageData(raw: unknown): ImageData | undefined {
  if (!isRecord(raw)) return undefined
  const { mediaType, bytes, width, height, sha256, data } = raw
  const name = imageText(raw['name'], IMAGE_LIMITS.maxNameLength)
  if (typeof mediaType !== 'string' || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(mediaType)) return undefined
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > IMAGE_LIMITS.maxImageBytesCeiling) return undefined
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)) return undefined
  if (typeof sha256 !== 'string' || !SHA256.test(sha256) || name === undefined) return undefined
  if (typeof data !== 'string' || data.length !== 4 * Math.ceil(bytes / 3) || !BASE64.test(data)) return undefined
  const decoded = decodeBase64(data)
  if (decoded === undefined || decoded.length !== bytes) return undefined
  const inspection = inspectImage(decoded)
  if (!inspection.ok || inspection.mediaType !== mediaType || inspection.width !== width || inspection.height !== height) return undefined
  if (!imageSizeAllowed(width, height)) return undefined
  return { mediaType: inspection.mediaType, bytes, width, height, sha256, name, data }
}

/**
 * Read the image envelope out of persisted `meta`. The bytes are decoded and
 * their header must agree with the recorded type and size.
 * @param value - arbitrary persisted meta.
 * @returns the canonical envelope, or undefined for foreign, unsupported or inconsistent meta.
 */
export function readImageMeta(value: unknown): ImageEnvelope | undefined {
  try {
    if (!isRecord(value)) return undefined
    if (value['kind'] !== IMAGE_META_KIND || value['envelopeVersion'] !== IMAGE_ENVELOPE_VERSION) return undefined
    const image = readImageData(value['image'])
    const alt = imageText(value['alt'], IMAGE_LIMITS.maxAltLength)
    const source = value['source']
    if (image === undefined || alt === undefined) return undefined
    if (typeof source !== 'string' || !(IMAGE_SOURCES as readonly string[]).includes(source)) return undefined
    const caption = value['caption'] === undefined ? undefined : imageText(value['caption'], IMAGE_LIMITS.maxCaptionLength)
    const sourceNote = value['sourceNote'] === undefined ? undefined : imageText(value['sourceNote'], IMAGE_LIMITS.maxSourceNoteLength)
    if ((value['caption'] !== undefined && caption === undefined) || (value['sourceNote'] !== undefined && sourceNote === undefined)) return undefined
    return {
      kind: IMAGE_META_KIND,
      envelopeVersion: IMAGE_ENVELOPE_VERSION,
      image,
      alt,
      ...caption === undefined ? {} : { caption },
      source: source as ImageSource,
      ...sourceNote === undefined ? {} : { sourceNote },
    }
  } catch {
    return undefined
  }
}
