/**
 * `scatter_plot` renderer: one circle per data point over the shared chart
 * surface (same axes, ticks, clipping and hover behaviour as the line plot).
 *
 * Duplicate x values are preserved: every point keeps its own circle, React
 * keys are `(series, index)` so identical x values never collide.
 */
import type { ReactElement, ReactNode } from 'react'
import type { ScatterPlotContent } from '../../shared/index'
import type { RendererTheme, RichRendererProps } from './types'
import { ChartSurface, type ChartRenderContext } from './chart/surface'
import { formatCoordinate } from './chart/scale'
import { useContainerWidth } from './chart/use-width'

/** Radius of one scatter dot in SVG px. */
export const SCATTER_POINT_RADIUS = 3.5

function chartAriaLabel(content: ScatterPlotContent): string {
  const count = content.data.series.reduce((sum, item) => sum + item.points.length, 0)
  const units: string[] = []
  if (content.data.xAxis?.unit !== undefined) units.push(`x unit ${content.data.xAxis.unit}`)
  if (content.data.yAxis?.unit !== undefined) units.push(`y unit ${content.data.yAxis.unit}`)
  return `Scatter plot ${content.title}: ${String(content.data.series.length)} series, ${String(count)} points${units.length > 0 ? `; ${units.join(', ')}` : ''}`
}

function renderMarks(context: ChartRenderContext): ReactNode {
  const { model } = context
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
          {series.marks.map(mark => (
            <circle
              key={mark.index}
              data-dsh-rich="point"
              data-dsh-rich-series-index={series.index}
              data-dsh-rich-point-index={mark.index}
              data-dsh-rich-point-x={mark.point.x}
              data-dsh-rich-point-y={mark.point.y}
              cx={formatCoordinate(mark.pixel.x)}
              cy={formatCoordinate(mark.pixel.y)}
              r={SCATTER_POINT_RADIUS}
              fill={series.color}
              fillOpacity={0.85}
            />
          ))}
        </g>
      ))}
    </g>
  )
}

/** Props of the stateless scatter body (used by tests for a fixed width). */
export interface ScatterPlotViewProps extends RichRendererProps<ScatterPlotContent> {
  readonly width: number
  readonly height?: number
}

/** Stateless scatter plot with an explicit width. */
export function ScatterPlotView({ content, theme, width, height }: ScatterPlotViewProps): ReactElement {
  return (
    <ChartSurface
      kind="scatter-plot"
      title={content.title}
      subtitle={content.subtitle}
      data={content.data}
      theme={theme}
      width={width}
      height={height}
      ariaLabel={chartAriaLabel(content)}
      emptyMessage="No data points to plot."
      renderSeries={context => renderMarks(context)}
    />
  )
}

/** Responsive scatter plot registered with the renderer dispatcher. */
export function ScatterPlot({ content, theme }: RichRendererProps<ScatterPlotContent>): ReactElement {
  const { ref, width } = useContainerWidth()
  return (
    <div ref={ref} data-dsh-rich-container="scatter-plot" style={{ width: '100%', minWidth: 0 }}>
      <ScatterPlotView content={content} theme={theme} width={width} />
    </div>
  )
}
