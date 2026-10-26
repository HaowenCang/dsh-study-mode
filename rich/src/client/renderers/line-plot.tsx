/**
 * `line_plot` renderer: piecewise-linear curves over the shared chart surface.
 *
 * The component is responsive (container width via ResizeObserver, disconnected
 * on unmount) and draws only renderer-generated SVG; model text reaches the DOM
 * only as escaped `<text>` children.
 */
import type { ReactElement, ReactNode } from 'react'
import type { LinePlotContent } from '../../shared/index'
import type { RendererTheme, RichRendererProps } from './types'
import { ChartSurface, type ChartRenderContext } from './chart/surface'
import { formatCoordinate } from './chart/scale'
import { useContainerWidth } from './chart/use-width'

/** Above this total the per-point hit targets are skipped to keep the DOM light. */
export const MAX_LINE_HIT_TARGETS = 500

function chartAriaLabel(content: LinePlotContent): string {
  const count = content.data.series.reduce((sum, item) => sum + item.points.length, 0)
  const units: string[] = []
  if (content.data.xAxis?.unit !== undefined) units.push(`x unit ${content.data.xAxis.unit}`)
  if (content.data.yAxis?.unit !== undefined) units.push(`y unit ${content.data.yAxis.unit}`)
  return `Line plot ${content.title}: ${String(content.data.series.length)} series, ${String(count)} points${units.length > 0 ? `; ${units.join(', ')}` : ''}`
}

function renderMarks(context: ChartRenderContext, theme: RendererTheme): ReactNode {
  const { model } = context
  const drawHitTargets = model.totalPoints <= MAX_LINE_HIT_TARGETS
  return (
    <g data-dsh-rich="series-layer">
      {model.series.map(series => (
        <g
          key={series.index}
          data-dsh-rich-series={series.index}
          data-dsh-rich-series-name={series.name}
          data-dsh-rich-series-index={series.index}
          data-dsh-rich-series-color={series.color}
        >
          {series.marks.length > 1 && series.polyline.length > 0 ? (
            <polyline
              data-dsh-rich="line"
              data-dsh-rich-series-index={series.index}
              points={series.polyline}
              fill="none"
              stroke={series.color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {series.marks.length === 1 ? (
            <circle
              data-dsh-rich="point"
              data-dsh-rich-series-index={series.index}
              data-dsh-rich-point-index={0}
              cx={formatCoordinate(series.marks[0]?.pixel.x ?? 0)}
              cy={formatCoordinate(series.marks[0]?.pixel.y ?? 0)}
              r={3.5}
              fill={series.color}
            />
          ) : null}
          {drawHitTargets
            ? series.marks.map(mark => (
              <circle
                key={mark.index}
                data-dsh-rich="point-hit"
                data-dsh-rich-series-index={series.index}
                data-dsh-rich-point-index={mark.index}
                data-dsh-rich-point-x={mark.point.x}
                data-dsh-rich-point-y={mark.point.y}
                cx={formatCoordinate(mark.pixel.x)}
                cy={formatCoordinate(mark.pixel.y)}
                r={9}
                fill="transparent"
              />
            ))
            : null}
        </g>
      ))}
    </g>
  )
}

/** Props of the stateless line plot body (used by tests for a fixed width). */
export interface LinePlotViewProps extends RichRendererProps<LinePlotContent> {
  readonly width: number
  readonly height?: number
}

/** Stateless line plot with an explicit width. */
export function LinePlotView({ content, theme, width, height }: LinePlotViewProps): ReactElement {
  return (
    <ChartSurface
      kind="line-plot"
      title={content.title}
      subtitle={content.subtitle}
      data={content.data}
      theme={theme}
      width={width}
      height={height}
      ariaLabel={chartAriaLabel(content)}
      emptyMessage="No data points to plot."
      renderSeries={context => renderMarks(context, theme)}
    />
  )
}

/** Responsive line plot registered with the renderer dispatcher. */
export function LinePlot({ content, theme }: RichRendererProps<LinePlotContent>): ReactElement {
  const { ref, width } = useContainerWidth()
  return (
    <div ref={ref} data-dsh-rich-container="line-plot" style={{ width: '100%', minWidth: 0 }}>
      <LinePlotView content={content} theme={theme} width={width} />
    </div>
  )
}
