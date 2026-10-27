/**
 * `rich_image` Tool view.
 *
 * The persisted `rich-image` envelope is the only source of the picture. Its
 * bytes are decoded and their header must match the recorded type and size,
 * and their SHA-256 must match the recorded digest, before an `<img>` receives
 * a `data:` URL of one of the four raster types; a digest mismatch replaces
 * the picture with an alert. Caption, alt text and provenance enter the DOM
 * only as text.
 */
import { useEffect, useState, type ReactElement } from 'react'
import { imageBytes, readImageMeta, type ImageData, type ImageEnvelope, type ImageSource } from '../shared/image'
import type { ToolResultBlock, ToolViewProps } from './contract'
import { PHYSICS_SVG_THEME } from './physics-export'

const theme = PHYSICS_SVG_THEME

const SOURCE_LABELS: Readonly<Record<ImageSource, string>> = {
  computed: '计算生成',
  user_provided: '用户提供',
}

const FORMAT_LABELS: Readonly<Record<ImageEnvelope['image']['mediaType'], string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

/** Digest check state: `unavailable` when the page has no Web Crypto (the picture is then shown as unchecked). */
export type ImageDigestState = 'pending' | 'verified' | 'mismatch' | 'unavailable'

const DIGEST_LABELS: Readonly<Record<Exclude<ImageDigestState, 'mismatch'>, string>> = {
  pending: '校验中',
  verified: '已校验',
  unavailable: '未校验',
}

/**
 * Compare the SHA-256 of the decoded bytes with the recorded digest.
 * @param image - image data of an envelope accepted by `readImageMeta`.
 * @returns `verified`, `mismatch`, or `unavailable` when Web Crypto is absent or fails.
 */
export async function verifyImageDigest(image: ImageData): Promise<Exclude<ImageDigestState, 'pending'>> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (subtle === undefined) return 'unavailable'
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', imageBytes(image)))
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
    return hex === image.sha256 ? 'verified' : 'mismatch'
  } catch {
    // A failing digest leaves the bytes unchecked; the header checks still hold.
    return 'unavailable'
  }
}

/** Props of the stateless figure (tests pass a fixed digest state). */
export interface ImageFigureProps {
  readonly envelope: ImageEnvelope
  readonly digest: ImageDigestState
}

/** Stateless figure for one envelope and digest state. */
export function ImageFigure({ envelope, digest }: ImageFigureProps): ReactElement {
  const { image } = envelope
  if (digest === 'mismatch') {
    return <div role="alert" data-dsh-rich="image-digest-mismatch">图片数据与记录的 SHA-256 不一致，已停止显示。</div>
  }
  const provenance = `来源（模型声明）：${SOURCE_LABELS[envelope.source]}${envelope.sourceNote === undefined ? '' : ` · ${envelope.sourceNote}`}`
  const facts = `${image.name} · ${FORMAT_LABELS[image.mediaType]} · ${String(image.width)}×${String(image.height)} px · ${formatBytes(image.bytes)} · sha256 ${image.sha256.slice(0, 12)}（${DIGEST_LABELS[digest]}）`
  return (
    <figure
      data-dsh-rich="image-card"
      style={{ margin: 0, padding: 12, border: `1px solid ${theme.border}`, borderRadius: 10, background: theme.surface, color: theme.text, maxWidth: '100%', overflow: 'hidden' }}
    >
      {digest === 'pending' ? (
        <p data-dsh-rich="image-verifying" style={{ margin: 0, padding: '24px 0', textAlign: 'center', color: theme.muted }}>正在校验图片…</p>
      ) : (
        <img
          data-dsh-rich="image"
          src={`data:${image.mediaType};base64,${image.data}`}
          alt={envelope.alt}
          width={image.width}
          height={image.height}
          style={{ display: 'block', maxWidth: '100%', maxHeight: 480, width: 'auto', height: 'auto', margin: '0 auto', objectFit: 'contain' }}
        />
      )}
      <figcaption style={{ marginTop: 8, fontSize: 12 }}>
        {envelope.caption === undefined ? null : <div style={{ color: theme.text, marginBottom: 4 }}>{envelope.caption}</div>}
        <div data-dsh-rich="image-provenance" style={{ color: theme.muted }}>{provenance}</div>
        <div data-dsh-rich="image-facts" style={{ color: theme.muted }}>{facts}</div>
        <div style={{ color: theme.muted }}>只有你能看到这张图片，模型看不到图片内容。</div>
      </figcaption>
    </figure>
  )
}

function ImageCard({ envelope }: { readonly envelope: ImageEnvelope }): ReactElement {
  const [checked, setChecked] = useState<{ readonly sha256: string; readonly data: string; readonly digest: ImageDigestState } | undefined>(undefined)
  const { sha256, data } = envelope.image
  useEffect(() => {
    let live = true
    void verifyImageDigest(envelope.image).then(digest => {
      if (live) setChecked({ sha256, data, digest })
    })
    return () => {
      live = false
    }
    // The envelope object is rebuilt on every render; the digest depends only on these two strings.
  }, [sha256, data])
  const digest = checked !== undefined && checked.sha256 === sha256 && checked.data === data ? checked.digest : 'pending'
  return <ImageFigure envelope={envelope} digest={digest} />
}

/** The registered `rich_image` Tool view. */
export function ImageToolView(props: ToolViewProps): ReactElement {
  if (props.phase !== 'result') return <p data-dsh-rich="image-preparing">正在读取图片…</p>
  const block = props.block as ToolResultBlock
  if (block.isError) {
    const detail = block.content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text as string).join('\n').slice(0, 600)
    return <div role="alert" data-dsh-rich="image-error">图片无法显示：{detail}</div>
  }
  const envelope = readImageMeta(block.meta)
  if (envelope === undefined) return <div role="alert" data-dsh-rich="image-invalid">图片数据不可用、不一致或版本不受支持。</div>
  return <ImageCard envelope={envelope} />
}
