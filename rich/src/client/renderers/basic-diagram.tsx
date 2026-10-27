/**
 * `basic_diagram` renderer.
 *
 * The model can only name closed enums (`box`/`rounded`/`diamond`/`circle`,
 * `default`/`accent`/`muted`, dashed on/off) and integer grid coordinates; the
 * SVG elements, attributes, colours and arrow markers are all created by this
 * renderer. Model strings are rendered exclusively as escaped `<text>` children
 * (with the untruncated label kept in a `<title>`), never as markup.
 */
import { useId, useMemo, type ReactElement } from 'react'
import type { BasicDiagramContent } from '../../shared/index'
import type { RendererTheme, RichRendererProps } from './types'
import { formatCoordinate } from './chart/scale'
import {
  DIAGRAM_EDGE_LABEL_UNITS,
  DIAGRAM_FONT,
  DIAGRAM_MIN_RENDER_WIDTH,
  DIAGRAM_VIEW,
  buildDiagramGeometry,
  toneStyle,
  truncateLabel,
  type DiagramNodeGeometry,
} from './diagram/geometry'

function diagramAriaLabel(content: BasicDiagramContent): string {
  return `Diagram ${content.title}: ${String(content.data.nodes.length)} nodes, ${String(content.data.edges.length)} edges`
}

function NodeShape({ geometry, theme }: { readonly geometry: DiagramNodeGeometry; readonly theme: RendererTheme }): ReactElement {
  const tone = toneStyle(geometry.node.tone, theme)
  const { center, halfWidth, halfHeight } = geometry
  const label = typeof geometry.node.label === 'string' ? geometry.node.label : ''
  const shapeProps = {
    fill: tone.fill,
    stroke: tone.stroke,
    strokeWidth: 1.4,
    opacity: tone.opacity,
  }
  let shapeElement: ReactElement
  switch (geometry.shape) {
    case 'diamond':
      shapeElement = (
        <polygon
          data-dsh-rich="node-shape"
          points={[
            `${formatCoordinate(center.x)},${formatCoordinate(center.y - halfHeight)}`,
            `${formatCoordinate(center.x + halfWidth)},${formatCoordinate(center.y)}`,
            `${formatCoordinate(center.x)},${formatCoordinate(center.y + halfHeight)}`,
            `${formatCoordinate(center.x - halfWidth)},${formatCoordinate(center.y)}`,
          ].join(' ')}
          {...shapeProps}
        />
      )
      break
    case 'circle':
      shapeElement = (
        <circle
          data-dsh-rich="node-shape"
          cx={formatCoordinate(center.x)}
          cy={formatCoordinate(center.y)}
          r={geometry.radius}
          {...shapeProps}
        />
      )
      break
    case 'rounded':
      shapeElement = (
        <rect
          data-dsh-rich="node-shape"
          x={formatCoordinate(center.x - halfWidth)}
          y={formatCoordinate(center.y - halfHeight)}
          width={halfWidth * 2}
          height={halfHeight * 2}
          rx={14}
          {...shapeProps}
        />
      )
      break
    case 'box':
    default:
      shapeElement = (
        <rect
          data-dsh-rich="node-shape"
          x={formatCoordinate(center.x - halfWidth)}
          y={formatCoordinate(center.y - halfHeight)}
          width={halfWidth * 2}
          height={halfHeight * 2}
          rx={3}
          {...shapeProps}
        />
      )
      break
  }
  return (
    <g
      data-dsh-rich="node"
      data-dsh-rich-node-id={geometry.node.id}
      data-dsh-rich-node-shape={geometry.shape}
      data-dsh-rich-node-tone={geometry.node.tone ?? 'default'}
    >
      <title>{label}</title>
      {shapeElement}
      <text
        data-dsh-rich="node-label"
        x={formatCoordinate(center.x)}
        y={formatCoordinate(center.y)}
        dy="0.34em"
        textAnchor="middle"
        fontSize={DIAGRAM_FONT.node}
        fill={tone.text}
      >
        {truncateLabel(label, geometry.labelMaxChars)}
      </text>
    </g>
  )
}

/** Restricted primitive diagram renderer. */
export function BasicDiagram({ content, theme }: RichRendererProps<BasicDiagramContent>): ReactElement {
  const rawId = useId()
  const arrowId = `dsh-rich-arrow-${rawId.replace(/[^A-Za-z0-9_-]/g, '') || 'd'}`
  const geometry = useMemo(
    () => buildDiagramGeometry(content.data.nodes, content.data.edges),
    [content.data],
  )

  return (
    <div data-dsh-rich="basic-diagram" style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, color: theme.text }}>
      <div data-dsh-rich="diagram-header" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <div data-dsh-rich="diagram-title" style={{ fontWeight: 600, fontSize: '13px' }}>{content.title}</div>
        {content.subtitle !== undefined && content.subtitle.length > 0 ? (
          <div data-dsh-rich="diagram-subtitle" style={{ color: theme.muted, fontSize: '12px' }}>{content.subtitle}</div>
        ) : null}
      </div>
      {geometry.nodes.length === 0 ? (
        <div
          data-dsh-rich="empty"
          role="status"
          style={{ padding: '14px 12px', border: `1px dashed ${theme.border}`, borderRadius: '8px', color: theme.muted, fontSize: '12px' }}
        >
          No diagram nodes to draw.
        </div>
      ) : (
        // Narrow cards scroll horizontally rather than shrinking the labels (VIS-02).
        <div
          data-dsh-rich="diagram-scroll"
          role="region"
          aria-label={`Diagram ${content.title}, scroll horizontally when narrow`}
          tabIndex={0}
          style={{ overflowX: 'auto', maxWidth: '100%' }}
        >
          <svg
            data-dsh-rich-svg="basic-diagram"
            role="img"
            aria-label={diagramAriaLabel(content)}
            viewBox={`0 0 ${String(DIAGRAM_VIEW.width)} ${String(DIAGRAM_VIEW.height)}`}
            style={{ width: '100%', minWidth: `${String(DIAGRAM_MIN_RENDER_WIDTH)}px`, height: 'auto', display: 'block' }}
          >
            <defs>
              <marker
                id={arrowId}
                viewBox="0 0 10 7"
                markerWidth={10}
                markerHeight={7}
                refX={10}
                refY={3.5}
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M0,0 L10,3.5 L0,7 Z" fill={theme.muted} />
              </marker>
            </defs>
            <g data-dsh-rich="edges" data-dsh-rich-edge-count={geometry.edges.length} data-dsh-rich-dropped-edges={geometry.droppedEdges}>
              {geometry.edges.map((edge, index) => (
                <g
                  key={`${edge.edge.from}->${edge.edge.to}#${String(index)}`}
                  data-dsh-rich="edge"
                  data-dsh-rich-edge-from={edge.edge.from}
                  data-dsh-rich-edge-to={edge.edge.to}
                  data-dsh-rich-edge-dashed={edge.edge.dashed === true ? 'true' : 'false'}
                >
                  <line
                    data-dsh-rich="edge-line"
                    x1={formatCoordinate(edge.start.x)}
                    y1={formatCoordinate(edge.start.y)}
                    x2={formatCoordinate(edge.end.x)}
                    y2={formatCoordinate(edge.end.y)}
                    stroke={theme.muted}
                    strokeWidth={1.3}
                    strokeDasharray={edge.edge.dashed === true ? '7 5' : undefined}
                    markerEnd={`url(#${arrowId})`}
                  />
                  {edge.labelText.length > 0 ? (
                    <text
                      data-dsh-rich="edge-label"
                      x={formatCoordinate(edge.label.x)}
                      y={formatCoordinate(edge.label.y)}
                      textAnchor="middle"
                      fontSize={DIAGRAM_FONT.edge}
                      fill={theme.muted}
                      stroke={theme.surface}
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      <title>{edge.labelText}</title>
                      {truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS)}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>
            <g data-dsh-rich="nodes" data-dsh-rich-node-count={geometry.nodes.length}>
              {geometry.nodes.map(node => (
                <NodeShape key={node.node.id} geometry={node} theme={theme} />
              ))}
            </g>
          </svg>
        </div>
      )}
    </div>
  )
}
