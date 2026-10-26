/**
 * Shared SVG chrome of the chart renderers: title/subtitle, legend, axes,
 * ticks, grid, clip path, hover tooltip and pointer handling.
 *
 * The module deliberately owns no chart marks: `line_plot` and `scatter_plot`
 * pass a `renderSeries` callback so each chart draws its own primitives inside
 * the clipped plotting area while sharing every axis and interaction rule.
 */
import {
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { PlotData } from '../../../shared/index'
import type { RendererTheme } from '../types'
import {
  axisTitleText,
  clamp,
  createChartModel,
  formatCoordinate,
  formatTickLabel,
  nearestPoint,
  TICK_FONT_SIZE,
  type ChartModel,
  type ChartSeriesModel,
  type NearestPoint,
  type PlotRect,
} from './scale'

/** Context handed to the series renderer of each chart type. */
export interface ChartRenderContext {
  readonly model: ChartModel
  readonly plot: PlotRect
  /** Unique clipPath id; marks should live inside `<g clipPath=...>`. */
  readonly clipId: string
}

/** Props of the shared chart surface. */
export interface ChartSurfaceProps {
  readonly kind: 'line-plot' | 'scatter-plot'
  readonly title: string
  readonly subtitle?: string | undefined
  readonly data: PlotData
  readonly theme: RendererTheme
  readonly width: number
  readonly height?: number | undefined
  /** Accessible summary of the whole figure. */
  readonly ariaLabel: string
  /** Message shown when no series carries a single finite point. */
  readonly emptyMessage: string
  /** Draw the chart marks; called only when at least one point exists. */
  readonly renderSeries: (context: ChartRenderContext) => ReactNode
}

interface TooltipRow {
  readonly text: string
  readonly strong: boolean
}

function Legend({ series, theme }: { readonly series: readonly ChartSeriesModel[]; readonly theme: RendererTheme }): ReactElement {
  return (
    <div
      data-dsh-rich="legend"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: '12px', color: theme.muted }}
    >
      {series.map(item => (
        <span
          key={item.index}
          data-dsh-rich="legend-item"
          data-dsh-rich-series-index={item.index}
          data-dsh-rich-series-name={item.name}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <span
            data-dsh-rich="legend-swatch"
            aria-hidden="true"
            style={{ width: '10px', height: '10px', borderRadius: '2px', background: item.color, display: 'inline-block' }}
          />
          {item.name}
        </span>
      ))}
    </div>
  )
}

function Tooltip({ hover, model, theme }: {
  readonly hover: NearestPoint
  readonly model: ChartModel
  readonly theme: RendererTheme
}): ReactElement {
  const rows: TooltipRow[] = [
    { text: hover.series.name, strong: true },
    { text: `x: ${formatTickLabel(hover.point.x, model.xTicks.decimals, model.xUnit)}`, strong: false },
    { text: `y: ${formatTickLabel(hover.point.y, model.yTicks.decimals, model.yUnit)}`, strong: false },
  ]
  const longest = rows.reduce((max, row) => Math.max(max, row.text.length), 0)
  const boxWidth = Math.min(240, Math.max(96, longest * 6.2 + 18))
  const boxHeight = rows.length * 14 + 10
  const x = clamp(hover.pixel.x + 12, 2, Math.max(2, model.layout.width - boxWidth - 2))
  const y = clamp(hover.pixel.y - boxHeight - 10, 2, Math.max(2, model.layout.height - boxHeight - 2))
  return (
    <g data-dsh-rich="tooltip" pointerEvents="none" transform={`translate(${formatCoordinate(x)},${formatCoordinate(y)})`}>
      <rect
        data-dsh-rich="tooltip-box"
        x={0}
        y={0}
        width={boxWidth}
        height={boxHeight}
        rx={4}
        fill={theme.surface}
        stroke={theme.border}
        strokeWidth={1}
        opacity={0.97}
      />
      {rows.map((row, index) => (
        <text
          key={index}
          data-dsh-rich="tooltip-row"
          x={8}
          y={14 + index * 14}
          fontSize={10}
          fill={row.strong ? theme.text : theme.muted}
          fontWeight={row.strong ? 600 : 400}
        >
          {row.text}
        </text>
      ))}
    </g>
  )
}

function AxisTicks({ model, theme }: { readonly model: ChartModel; readonly theme: RendererTheme }): ReactElement {
  const { plot } = model
  const xLabel = axisTitleText(model.xLabel, model.xUnit)
  const yLabel = axisTitleText(model.yLabel, model.yUnit)
  const xTickY = plot.top + plot.height
  const yTickX = plot.left
  return (
    <g data-dsh-rich="axes">
      <line
        data-dsh-rich="axis-line"
        data-dsh-rich-axis="x"
        x1={plot.left}
        y1={xTickY}
        x2={plot.left + plot.width}
        y2={xTickY}
        stroke={theme.border}
        strokeWidth={1}
      />
      <line
        data-dsh-rich="axis-line"
        data-dsh-rich-axis="y"
        x1={yTickX}
        y1={plot.top}
        x2={yTickX}
        y2={plot.top + plot.height}
        stroke={theme.border}
        strokeWidth={1}
      />
      {model.xTicks.ticks.map(tick => {
        const position = formatCoordinate(model.xScale.map(tick.value))
        return (
          <g key={`x-${String(tick.value)}`} data-dsh-rich="tick" data-dsh-rich-axis="x" data-dsh-rich-tick-value={tick.value}>
            <line x1={position} y1={xTickY} x2={position} y2={xTickY + 4} stroke={theme.border} strokeWidth={1} />
            <text x={position} y={xTickY + 14} fontSize={TICK_FONT_SIZE} fill={theme.muted} textAnchor="middle">
              {tick.label}
            </text>
          </g>
        )
      })}
      {model.yTicks.ticks.map(tick => {
        const position = formatCoordinate(model.yScale.map(tick.value))
        const label = formatTickLabel(tick.value, model.yTicks.decimals, model.yUnit)
        return (
          <g key={`y-${String(tick.value)}`} data-dsh-rich="tick" data-dsh-rich-axis="y" data-dsh-rich-tick-value={tick.value}>
            <line x1={yTickX - 4} y1={position} x2={yTickX} y2={position} stroke={theme.border} strokeWidth={1} />
            <text x={yTickX - 8} y={position} dy="0.32em" fontSize={TICK_FONT_SIZE} fill={theme.muted} textAnchor="end">
              {label}
            </text>
          </g>
        )
      })}
      {xLabel.length > 0 ? (
        <text
          data-dsh-rich="axis-title"
          data-dsh-rich-axis="x"
          x={plot.left + plot.width / 2}
          y={model.layout.height - 8}
          fontSize={11}
          fill={theme.muted}
          textAnchor="middle"
        >
          {xLabel}
        </text>
      ) : null}
      {yLabel.length > 0 ? (
        <text
          data-dsh-rich="axis-title"
          data-dsh-rich-axis="y"
          x={14}
          y={plot.top + plot.height / 2}
          fontSize={11}
          fill={theme.muted}
          textAnchor="middle"
          transform={`rotate(-90 14 ${formatCoordinate(plot.top + plot.height / 2)})`}
        >
          {yLabel}
        </text>
      ) : null}
    </g>
  )
}

function GridLines({ model, theme }: { readonly model: ChartModel; readonly theme: RendererTheme }): ReactElement {
  const { plot } = model
  return (
    <g data-dsh-rich="grid">
      {model.yTicks.ticks.map(tick => {
        const position = formatCoordinate(model.yScale.map(tick.value))
        return (
          <line
            key={`gy-${String(tick.value)}`}
            data-dsh-rich="grid-line"
            data-dsh-rich-axis="y"
            x1={plot.left}
            y1={position}
            x2={plot.left + plot.width}
            y2={position}
            stroke={theme.border}
            strokeWidth={1}
            opacity={0.45}
          />
        )
      })}
      {model.xTicks.ticks.map(tick => {
        const position = formatCoordinate(model.xScale.map(tick.value))
        return (
          <line
            key={`gx-${String(tick.value)}`}
            data-dsh-rich="grid-line"
            data-dsh-rich-axis="x"
            x1={position}
            y1={plot.top}
            x2={position}
            y2={plot.top + plot.height}
            stroke={theme.border}
            strokeWidth={1}
            opacity={0.22}
          />
        )
      })}
    </g>
  )
}

/**
 * One responsive chart frame. The SVG is sized to the measured container width
 * (`width` prop) and draws with a 1:1 viewBox, so pointer math is a simple
 * bounding-rect ratio and the coordinates in the DOM are the model pixels.
 */
export function ChartSurface(props: ChartSurfaceProps): ReactElement {
  const { data, theme } = props
  const rawId = useId()
  const clipId = `dsh-rich-clip-${rawId.replace(/[^A-Za-z0-9_-]/g, '') || 'chart'}`
  const model = useMemo(
    () => createChartModel(data, { width: props.width, height: props.height, palette: theme.series }),
    [data, props.width, props.height, theme.series],
  )
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<NearestPoint | null>(null)

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current
    if (svg === null) return
    const bounds = svg.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    const px = ((event.clientX - bounds.left) / bounds.width) * model.layout.width
    const py = ((event.clientY - bounds.top) / bounds.height) * model.layout.height
    const next = nearestPoint(model.series, px, py)
    setHover(current => {
      if (next === undefined) return current === null ? current : null
      if (current !== null && current.seriesIndex === next.seriesIndex && current.pointIndex === next.pointIndex) return current
      return next
    })
  }

  const handlePointerLeave = (): void => {
    setHover(current => (current === null ? current : null))
  }

  return (
    <div
      data-dsh-rich={props.kind}
      data-dsh-rich-series-count={model.series.length}
      data-dsh-rich-point-count={model.totalPoints}
      style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, color: theme.text }}
    >
      <div data-dsh-rich="chart-header" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <div data-dsh-rich="chart-title" style={{ fontWeight: 600, fontSize: '13px' }}>{props.title}</div>
        {props.subtitle !== undefined && props.subtitle.length > 0 ? (
          <div data-dsh-rich="chart-subtitle" style={{ color: theme.muted, fontSize: '12px' }}>{props.subtitle}</div>
        ) : null}
      </div>
      {model.series.length > 1 ? <Legend series={model.series} theme={theme} /> : null}
      {!model.hasData ? (
        <div
          data-dsh-rich="empty"
          role="status"
          style={{
            padding: '14px 12px',
            border: `1px dashed ${theme.border}`,
            borderRadius: '8px',
            color: theme.muted,
            fontSize: '12px',
          }}
        >
          {props.emptyMessage}
        </div>
      ) : (
        <svg
          ref={svgRef}
          data-dsh-rich-chart={props.kind}
          role="img"
          aria-label={props.ariaLabel}
          width={model.layout.width}
          height={model.layout.height}
          viewBox={`0 0 ${String(model.layout.width)} ${String(model.layout.height)}`}
          style={{ width: '100%', maxWidth: `${String(model.layout.width)}px`, height: 'auto', display: 'block', overflow: 'visible' }}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={model.plot.left} y={model.plot.top} width={model.plot.width} height={model.plot.height} />
            </clipPath>
          </defs>
          <GridLines model={model} theme={theme} />
          <AxisTicks model={model} theme={theme} />
          <g data-dsh-rich="plot-area" clipPath={`url(#${clipId})`}>
            {props.renderSeries({ model, plot: model.plot, clipId })}
          </g>
          {hover !== null ? <Tooltip hover={hover} model={model} theme={theme} /> : null}
        </svg>
      )}
    </div>
  )
}
