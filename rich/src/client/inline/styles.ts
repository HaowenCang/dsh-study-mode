/**
 * Static stylesheet for the inline assistant renderer.
 *
 * Mirrors ui-chat `AssistantMarkdown.module.css` and `ReasoningRow.module.css` (dsh-v0.2.2-rc.1 =
 * master) under `data-dsh-inline-*` attribute selectors, plus the inline figure frame. The text is
 * a constant of this module (never model text) and is installed with `textContent`.
 */
export const INLINE_CSS = `
[data-dsh-inline-assistant]{display:flex;flex-direction:column;font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
[data-dsh-inline-body]{display:flex;flex-direction:column;gap:16px}
[data-dsh-inline-body] .md-table-wide{--dsh-table-spare:max(0px,calc((100cqw - var(--dsh-chat-content-width)) / 2));--dsh-table-lead:calc(var(--dsh-table-spare) + min(var(--dsh-chat-content-width),100cqw) - 100%);box-sizing:border-box;width:calc(100% + var(--dsh-table-lead) + var(--dsh-table-spare));max-width:none;margin-left:calc(-1 * var(--dsh-table-lead));padding-left:var(--dsh-table-lead)}
[data-dsh-inline-body] .md-table-wide>table{position:relative;z-index:1}
[data-dsh-inline-body]>[data-turn-process-inline][hidden]{margin-bottom:-16px}
[data-dsh-inline-stopped]{align-self:flex-start;padding:0 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}
[data-dsh-inline-think]{display:flex;flex-direction:column}
[data-dsh-inline-think]:not([data-expanded]){contain:size layout;height:calc(24px + var(--dsh-content-font-delta,0px))}
[data-dsh-inline-think] .dsh-inline-think-row{overflow:hidden}
[data-dsh-inline-think][data-expanded] [data-open] [data-disclosure-header]{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-base)}
[data-dsh-inline-think] .dsh-inline-think-leading{flex-shrink:0}
[data-dsh-inline-think] .dsh-inline-think-title{font-weight:400}
[data-dsh-inline-think] .dsh-inline-think-sep{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption)}
[data-dsh-inline-think] .dsh-inline-think-summary{min-width:0;overflow:hidden;flex:1 1 auto;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap}
[data-dsh-inline-think] .dsh-inline-think-text{display:block;overflow:hidden;text-overflow:ellipsis}
[data-dsh-inline-think] .dsh-inline-think-summary[data-streaming]{mask-image:linear-gradient(to right,black calc(100% - 48px),transparent)}
[data-dsh-inline-think] .dsh-inline-think-summary[data-streaming] .dsh-inline-think-text{overflow:visible;text-overflow:clip}
[data-dsh-inline-think]:not([data-preview]) .dsh-inline-think-sep,[data-dsh-inline-think]:not([data-preview]) .dsh-inline-think-summary{display:none}
[data-dsh-inline-think] .dsh-inline-think-body{padding:4px 0 4px calc(22px + var(--dsh-content-font-delta,0px));min-width:0}
[data-dsh-inline-hidden]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
[data-dsh-figure]{margin:0;display:flex;flex-direction:column;gap:6px;max-width:100%}
[data-dsh-figure] [data-dsh-figure-scroll]{overflow-x:auto;max-width:100%}
[data-dsh-figure] svg[data-dsh-figure-svg]{display:block;height:auto;color:var(--dsw-alias-label-primary,#1b1f24)}
[data-dsh-figure] [data-dsh-figure-bar]{display:flex;gap:8px;align-items:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a929e)}
[data-dsh-figure] [data-dsh-figure-bar] button{font:inherit;color:inherit;background:none;border:0;padding:0 4px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer}
[data-dsh-figure] [data-dsh-figure-bar] button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary,#5b6472)}
[data-dsh-figure] [data-dsh-figure-bar] button:focus-visible{outline:2px solid var(--dsw-alias-border-focus,#3b82f6);outline-offset:1px}
[data-dsh-figure-error]{border:0.5px solid var(--dsw-alias-border-l2,#d9dee7);border-radius:var(--dsw-radius-lg,12px);padding:10px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#5b6472)}
[data-dsh-figure-error] ol{margin:4px 0 0;padding-left:20px}
[data-dsh-figure-pending]{font-size:13px;color:var(--dsw-alias-label-tertiary,#8a929e)}
`

const STYLE_ID = 'dsh-rich-response-inline'

/** Install the stylesheet once; returns a disposer. */
export function installInlineStyles(doc: Document | undefined = globalThis.document): () => void {
  if (doc === undefined || doc.getElementById(STYLE_ID) !== null) return () => {}
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = INLINE_CSS
  doc.head.append(style)
  return () => { style.remove() }
}
