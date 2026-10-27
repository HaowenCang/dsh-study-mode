/**
 * `rich_svg` Tool view.
 *
 * The persisted `rich-svg` envelope holds the Host-rebuilt figure card. It is
 * shown through an <img> with a `data:` URL, so SVG markup never enters the page
 * DOM and cannot run script or load resources. The same card is the figure file
 * that the answer embeds inline; this view is its copy in the tool record.
 */
import type { ReactElement } from 'react'
import { readSvgMeta, type SvgEnvelope } from '../shared/svg-sanitize'
import type { ToolResultBlock, ToolViewProps } from './contract'
import { DSW, noteStyle } from './dsw'

/** Stateless figure for one envelope. */
export function SvgFigure({ envelope }: { readonly envelope: SvgEnvelope }): ReactElement {
  return (
    <figure data-dsh-rich="svg-card" style={{ margin: '6px 0', maxWidth: '100%' }}>
      <img
        data-dsh-rich="svg-image"
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(envelope.svg)}`}
        alt={envelope.title}
        style={{ display: 'block', maxWidth: 'min(100%, 640px)', height: 'auto', borderRadius: DSW.radius }}
      />
    </figure>
  )
}

/** The registered `rich_svg` Tool view. */
export function SvgToolView(props: ToolViewProps): ReactElement {
  if (props.phase !== 'result') return <p data-dsh-rich="svg-preparing" style={noteStyle}>正在绘制图形…</p>
  const block = props.block as ToolResultBlock
  if (block.isError) {
    const detail = block.content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text as string).join('\n').slice(0, 600)
    return <div role="alert" data-dsh-rich="svg-error" style={{ ...noteStyle, color: DSW.error, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>图形未通过检查：{detail}</div>
  }
  const envelope = readSvgMeta(block.meta)
  if (envelope === undefined) return <div role="alert" data-dsh-rich="svg-invalid" style={{ ...noteStyle, color: DSW.error }}>图形数据不可用或版本不受支持。</div>
  return <SvgFigure envelope={envelope} />
}
