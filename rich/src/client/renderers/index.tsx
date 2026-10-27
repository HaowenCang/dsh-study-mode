/** RichContentV1 dispatch and the renderer error boundary. */
import { Component, type ReactElement, type ReactNode } from 'react'
import type { RichContentV1 } from '../../shared/index'
import type { RendererTheme } from './types'
import { LinePlot } from './line-plot'
import { ScatterPlot } from './scatter-plot'
import { BasicDiagram } from './basic-diagram'
import { MessageCard, type MessageCardProps } from './message-card'

/** Interaction wiring forwarded from the card shell to the message-card renderer. */
export interface RouteRichContentProps {
  readonly content: RichContentV1
  readonly theme: RendererTheme
  readonly onAction: MessageCardProps['onAction']
  readonly busy?: boolean
  readonly feedback?: string
  readonly settledActionId?: string
}

/** Fallback shown when a renderer throws; keeps the rest of the transcript alive. */
function RenderFailure({ message, code }: { readonly message: string; readonly code: string }) {
  return (
    <div
      data-dsh-rich="render-error"
      role="alert"
      style={{ padding: '10px 12px', border: '0.5px solid var(--dsw-alias-state-error-primary, #c62828)', borderRadius: 'var(--dsw-radius-md, 8px)', color: 'var(--dsw-alias-state-error-primary, #c62828)' }}
    >
      <strong>图形无法显示。</strong>
      <div style={{ opacity: 0.8 }}>{code}: {message}</div>
    </div>
  )
}

interface BoundaryState {
  readonly failed: { message: string; code: string } | null
}

/** Renderer isolation: one broken card never takes down the conversation. */
class RendererBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    const message = error instanceof Error ? error.message : String(error)
    return { failed: { message: message.slice(0, 300), code: 'RENDER_THREW' } }
  }

  override render(): ReactNode {
    if (this.state.failed !== null) {
      return <RenderFailure message={this.state.failed.message} code={this.state.failed.code} />
    }
    return this.props.children
  }
}

/** Dispatch one validated payload to its renderer. */
export function RichContentView(props: RouteRichContentProps): ReactElement {
  let body: ReactElement
  switch (props.content.type) {
    case 'line_plot':
      body = <LinePlot content={props.content} theme={props.theme} />
      break
    case 'scatter_plot':
      body = <ScatterPlot content={props.content} theme={props.theme} />
      break
    case 'basic_diagram':
      body = <BasicDiagram content={props.content} theme={props.theme} />
      break
    case 'message_card':
      body = (
        <MessageCard
          content={props.content}
          theme={props.theme}
          onAction={props.onAction}
          busy={props.busy}
          feedback={props.feedback}
          settledActionId={props.settledActionId}
        />
      )
      break
  }
  return <RendererBoundary>{body}</RendererBoundary>
}
