/**
 * `rich_image` - show one existing workspace raster image to the learner.
 *
 * The path is first checked lexically against the session working directory
 * (no filesystem access for a path outside it, a UNC, device or drive-relative
 * path); the file is then read through the session filesystem (`ctx.fs`), its
 * realpath must stay inside the working directory, and the final path
 * component must not be a symbolic link. A `run_code` sub-dispatch is refused
 * because its result value, which carries the bytes, reaches model code. The Host checks the header format,
 * extension, pixel size and byte limit, hashes the bytes and persists them in
 * the `rich-image` envelope. The model receives only a summary line: the image
 * never enters the model context. Provenance (`computed` or `user_provided`)
 * is declared by the model and shown as such.
 */
import { createHash } from 'node:crypto'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  IMAGE_ENVELOPE_VERSION,
  IMAGE_LIMITS,
  IMAGE_META_KIND,
  IMAGE_SOURCES,
  imageMediaTypeForExtension,
  imageSizeAllowed,
  imageText,
  inspectImage,
  type ImageData,
  type ImageEnvelope,
  type ImageSource,
} from '../../shared/image'
import { stripUnsafeText } from '../../shared/plain-text'
import { FIGURE_OUTPUT_PROPERTIES, FIGURE_TOOL_NOTE, figureInstruction, writeFigure, type FigureFields, type FigureStore } from '../figures'
import type { ToolDefinitionLike } from '../types'

/** A resolved filesystem target (subset of RC.3 `FsTarget`). */
export interface FsTargetLike {
  readonly targetKey: string
  readonly displayPath: string
}

/** The RC.3 `ctx.fs` and `ctx.workingDirectory` methods this tool calls. */
export interface ImageToolServices {
  readonly fs?: {
    resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
    contains(parent: FsTargetLike, child: FsTargetLike): boolean
    lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<{ readonly type: 'file' | 'directory' | 'symlink' | 'other'; readonly size?: number } | undefined>
    stat(target: FsTargetLike, signal?: AbortSignal): Promise<{ readonly type: 'file' | 'directory' | 'other'; readonly size?: number } | undefined>
    readBytes(target: FsTargetLike, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>
  }
  readonly workingDirectory?: {
    ensure(agent: never, signal?: AbortSignal): Promise<string>
  }
}

/** Tool construction options; `services` is read at each call so late-mounted services are seen. */
export interface ImageToolOptions {
  readonly services: () => ImageToolServices
  /** Per-image byte limit, an integer from 1024 to 2097152 (default 524288). */
  readonly maxImageBytes?: number
  /** Store that receives a copy of the verified bytes for the inline answer line. */
  readonly figures?: FigureStore
}

/** Canonical tool value persisted as the `tool/result` value. */
export interface RichImageValue extends FigureFields {
  readonly image: ImageData
  readonly alt: string
  readonly caption?: string
  readonly source: ImageSource
  readonly sourceNote?: string
  /** Resolved display path of the file that was read. */
  readonly path: string
  readonly summary: string
}

const ARG_KEYS = ['path', 'alt', 'caption', 'source', 'sourceNote']

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    image: { type: 'object' },
    alt: { type: 'string' },
    caption: { type: 'string' },
    source: { type: 'string', enum: [...IMAGE_SOURCES] },
    sourceNote: { type: 'string' },
    path: { type: 'string' },
    summary: { type: 'string' },
    ...FIGURE_OUTPUT_PROPERTIES,
  },
  required: ['image', 'alt', 'source', 'path', 'summary'],
  additionalProperties: false,
}

function valueOf(value: unknown): RichImageValue {
  return value as RichImageValue
}

function resolveByteLimit(value: number | undefined): number {
  if (value === undefined) return IMAGE_LIMITS.defaultMaxImageBytes
  if (!Number.isInteger(value) || value < IMAGE_LIMITS.minImageBytesLimit || value > IMAGE_LIMITS.maxImageBytesCeiling) {
    throw new Error(`rich_image: maxImageBytes must be an integer from ${String(IMAGE_LIMITS.minImageBytesLimit)} to ${String(IMAGE_LIMITS.maxImageBytesCeiling)}`)
  }
  return value
}

function optionalText(record: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  if (record[key] === undefined) return undefined
  const text = imageText(record[key], maxLength)
  if (text === undefined) throw new Error(`rich_image: ${key} must be 1..${String(maxLength)} characters of plain text`)
  return text
}

function readArgs(args: unknown): { path: string; alt: string; caption?: string; source: ImageSource; sourceNote?: string } {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('rich_image: arguments must be an object')
  const record = args as Record<string, unknown>
  const extra = Object.keys(record).filter(key => !ARG_KEYS.includes(key))
  if (extra.length > 0) throw new Error(`rich_image: unexpected argument ${extra.slice(0, 3).join(', ')}`)
  const path = imageText(record['path'], IMAGE_LIMITS.maxPathLength)
  if (path === undefined) throw new Error(`rich_image: path must be a non-empty path of at most ${String(IMAGE_LIMITS.maxPathLength)} characters`)
  const alt = imageText(record['alt'], IMAGE_LIMITS.maxAltLength)
  if (alt === undefined) throw new Error(`rich_image: alt must describe the image in 1..${String(IMAGE_LIMITS.maxAltLength)} characters of plain text`)
  const source = record['source']
  if (typeof source !== 'string' || !(IMAGE_SOURCES as readonly string[]).includes(source)) {
    throw new Error('rich_image: source must be computed or user_provided')
  }
  const caption = optionalText(record, 'caption', IMAGE_LIMITS.maxCaptionLength)
  const sourceNote = optionalText(record, 'sourceNote', IMAGE_LIMITS.maxSourceNoteLength)
  return {
    path,
    alt,
    ...caption === undefined ? {} : { caption },
    source: source as ImageSource,
    ...sourceNote === undefined ? {} : { sourceNote },
  }
}

function fileName(displayPath: string): string {
  const name = stripUnsafeText(basename(displayPath.replace(/\\/g, '/'))).trim()
  return name.length === 0 ? 'image' : name.slice(0, IMAGE_LIMITS.maxNameLength)
}

/** Figure-file extension of each verified media type. */
const FIGURE_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' } as const

/** UNC, device (`\\?\`, `\\.\`) and drive-relative (`C:file`) spellings, refused on every platform. */
const NON_LOCAL_PATH = /^(?:[\\/]{2}|[A-Za-z]:(?![\\/]))/

/**
 * Resolve `path` against `cwd` without filesystem access and refuse it unless
 * it stays inside `cwd`, so no model-chosen path outside the working directory
 * is probed (on Windows a UNC probe opens an outbound SMB connection).
 * @returns the normalized absolute path, free of `.` and `..` segments.
 */
function lexicalWorkspacePath(cwd: string, path: string, shown: string): string {
  if (NON_LOCAL_PATH.test(path)) {
    throw new Error(`rich_image: ${shown}: use a path inside the session working directory; network, device or drive-relative paths are refused`)
  }
  const absolute = resolve(cwd, path)
  const rel = relative(cwd, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`rich_image: ${shown}: the file is outside the session working directory`)
  return absolute
}

/** Build the agent tool definition; registration is the caller's effect. */
export function createImageTool(options: ImageToolOptions): ToolDefinitionLike {
  const maxBytes = resolveByteLimit(options.maxImageBytes)
  return {
    name: 'rich_image',
    description:
      'Show the learner one existing PNG, JPEG, GIF or WebP file from the session working directory, '
      + 'for example a figure your own code saved or an image the learner supplied. '
      + `The file must be inside the working directory, not a symbolic link, at most ${String(maxBytes)} bytes and ${String(IMAGE_LIMITS.maxDimension)} px per side. `
      + 'SVG and other formats are refused; use rich_render, rich_heatmap or rich_mermaid for data you can express directly. '
      + 'source is "computed" (made by code run for this task) or "user_provided"; never claim an origin you do not know, and never show a file you did not find or create. '
      + 'alt must describe what the image shows. Only the learner sees the image; you receive a summary line without the picture, '
      + 'and the bytes are stored in the session log. Call it directly, not from run_code.'
      + (options.figures === undefined ? '' : FIGURE_TOOL_NOTE),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Image file path, relative to the session working directory.' },
        alt: { type: 'string', description: 'Plain-text description of the image for screen readers.' },
        caption: { type: 'string', description: 'Optional plain-text caption shown under the image.' },
        source: { type: 'string', enum: [...IMAGE_SOURCES], description: 'Where the image came from.' },
        sourceNote: { type: 'string', description: 'Optional plain-text detail of the origin, e.g. the script or handout.' },
      },
      required: ['path', 'alt', 'source'],
      additionalProperties: false,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => [{ type: 'text', text: valueOf(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue): ImageEnvelope => {
        const value = valueOf(rawValue)
        return {
          kind: IMAGE_META_KIND,
          envelopeVersion: IMAGE_ENVELOPE_VERSION,
          image: value.image,
          alt: value.alt,
          ...value.caption === undefined ? {} : { caption: value.caption },
          source: value.source,
          ...value.sourceNote === undefined ? {} : { sourceNote: value.sourceNote },
        }
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('rich_image: aborted before dispatch')
      // A run_code sub-dispatch hands the tool value, bytes included, to model-visible code.
      if (exec.parent !== undefined) throw new Error('rich_image: call rich_image directly, not from run_code, so the image bytes stay out of the model context')
      const request = readArgs(args)
      const { fs, workingDirectory } = options.services()
      if (fs === undefined || workingDirectory === undefined || exec.agent === undefined) {
        throw new Error('rich_image: the session filesystem is not available')
      }
      const cwd = await workingDirectory.ensure(exec.agent as never, exec.signal)
      const shown = `cannot show "${request.path}"`
      const absolute = lexicalWorkspacePath(cwd, request.path, shown)
      const entry = await fs.lstat(absolute, { cwd }, exec.signal)
      if (entry === undefined) throw new Error(`rich_image: ${shown}: not found`)
      if (entry.type === 'symlink') throw new Error(`rich_image: ${shown}: the path is a symbolic link`)
      if (entry.type !== 'file') throw new Error(`rich_image: ${shown}: not a regular file`)
      const target = await fs.resolve(absolute, { cwd, signal: exec.signal })
      const root = await fs.resolve(cwd, { signal: exec.signal })
      if (!fs.contains(root, target)) throw new Error(`rich_image: ${shown}: the file is outside the session working directory`)
      const declared = imageMediaTypeForExtension(extname(target.displayPath))
      if (declared === null) {
        throw new Error(`rich_image: ${shown}: rich_image shows PNG, JPEG, GIF or WebP files, not ${extname(target.displayPath)} files`)
      }
      const info = await fs.stat(target, exec.signal)
      if (info === undefined || info.type !== 'file') throw new Error(`rich_image: ${shown}: not a regular file`)
      const tooLarge = `rich_image: ${shown}: the file exceeds the ${String(maxBytes)}-byte limit`
      if (info.size !== undefined && info.size > maxBytes) throw new Error(tooLarge)
      let data: Uint8Array
      try {
        data = await fs.readBytes(target, exec.signal, maxBytes)
      } catch (error: unknown) {
        if ((error as { code?: unknown } | null)?.code === 'FS_TOO_LARGE') throw new Error(tooLarge, { cause: error })
        throw error
      }
      const inspection = inspectImage(data)
      if (!inspection.ok) throw new Error(`rich_image: ${shown}: ${inspection.reason}; rich_image shows PNG, JPEG, GIF or WebP files`)
      if (declared !== undefined && declared !== inspection.mediaType) {
        throw new Error(`rich_image: ${shown}: the ${extname(target.displayPath)} extension declares ${declared}, but the file content is ${inspection.mediaType}`)
      }
      if (!imageSizeAllowed(inspection.width, inspection.height)) {
        throw new Error(`rich_image: ${shown}: the image is ${String(inspection.width)}x${String(inspection.height)} px; each side must be at most ${String(IMAGE_LIMITS.maxDimension)} px and the total at most ${String(IMAGE_LIMITS.maxPixels)} pixels`)
      }
      const sha256 = createHash('sha256').update(data).digest('hex')
      const name = fileName(target.displayPath)
      const image: ImageData = {
        mediaType: inspection.mediaType,
        bytes: data.length,
        width: inspection.width,
        height: inspection.height,
        sha256,
        name,
        data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
      }
      const summary = `Displayed image "${name}" to the learner (${image.mediaType}, ${String(image.width)}x${String(image.height)} px, ${String(image.bytes)} bytes, sha256 ${sha256.slice(0, 12)}). `
        + 'You cannot see this image; describe it only from how it was produced or what the learner told you.'
      return {
        image,
        alt: request.alt,
        ...request.caption === undefined ? {} : { caption: request.caption },
        source: request.source,
        ...request.sourceNote === undefined ? {} : { sourceNote: request.sourceNote },
        path: target.displayPath,
        summary,
        ...writeFigure(options.figures, exec, data, FIGURE_EXTENSIONS[inspection.mediaType], request.alt),
      } satisfies RichImageValue
    },
  }
}
