/**
 * `rich_heatmap` Tool view and SVG renderer.
 *
 * The persisted `rich-heatmap` envelope is the only source of the picture and
 * is revalidated before rendering. All colors are literals from the shared
 * palettes, so the on-screen SVG and its export are identical and
 * self-contained; model text enters the DOM only as text nodes.
 */
import { useRef, useState, type ReactElement } from 'react'
import {
  formatHeatmapNumber,
  formatHeatmapNumbers,
  heatmapColor,
  heatmapExtent,
  readHeatmapMeta,
  resolveHeatmapScale,
  type HeatmapAxis,
  type HeatmapContent,
} from '../shared/heatmap'
import type { ToolResultBlock, ToolViewProps } from './contract'
import { axisTitleText, clamp, niceTicks, normalizeChartWidth } from './renderers/chart/scale'
import { useContainerWidth } from './renderers/chart/use-width'
import { PHYSICS_SVG_THEME } from './physics-export'
import { buttonStyle, cardStyle, DSW, noteStyle } from './dsw'

const theme = PHYSICS_SVG_THEME
const MARGIN = { top: 30, right: 92, bottom: 44, left: 60 } as const
const LEGEND_WIDTH = 14
const LEGEND_STEPS = 32
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

function px(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

function withUnit(value: number, unit: string | undefined): string {
  return unit === undefined ? formatHeatmapNumber(value) : `${formatHeatmapNumber(value)} ${unit}`
}

interface AxisTick {
  readonly offset: number
  readonly label: string
}

/**
 * Nice tick values inside `[min, max]` with distinct labels; the two range ends
 * when the span is too small or too far from zero for nice steps.
 */
function rangeTicks(min: number, max: number, target: number): Array<{ readonly value: number; readonly label: string }> {
  const tolerance = (max - min) * 1e-9
  const inside = [...new Set(niceTicks(min, max, target).filter(value => value >= min - tolerance && value <= max + tolerance))]
  const values = inside.length >= 2 ? inside : [min, max]
  const labels = formatHeatmapNumbers(values)
  const seen = new Set<string>()
  return values.flatMap((value, index) => {
    const label = labels[index] ?? ''
    if (seen.has(label)) return []
    seen.add(label)
    return [{ value: Math.min(max, Math.max(min, value)), label }]
  })
}

/** Ticks along one axis: nice coordinates when the edges are given, else cell indices at cell centers. */
function axisTicks(axis: HeatmapAxis | undefined, count: number, length: number): AxisTick[] {
  if (axis?.min !== undefined && axis.max !== undefined) {
    const { min, max } = axis
    return rangeTicks(min, max, 6).map(tick => ({ offset: ((tick.value - min) / (max - min)) * length, label: tick.label }))
  }
  const step = Math.max(1, Math.ceil(count / 8))
  const ticks: AxisTick[] = []
  for (let index = 0; index < count; index += step) ticks.push({ offset: ((index + 0.5) / count) * length, label: String(index) })
  return ticks
}

/** Coordinate of the center of cell `index` counted from `axis.min`. */
function cellCenter(axis: HeatmapAxis | undefined, index: number, count: number): number | undefined {
  if (axis?.min === undefined || axis.max === undefined) return undefined
  return axis.min + ((index + 0.5) * (axis.max - axis.min)) / count
}

/** Props of the stateless heatmap SVG (tests pass a fixed width). */
export interface HeatmapViewProps {
  readonly content: HeatmapContent
  readonly width: number
}

/** Stateless heatmap SVG with an explicit width. */
export function HeatmapView({ content, width }: HeatmapViewProps): ReactElement {
  const rows = content.values.length
  const columns = content.values[0]?.length ?? 0
  const scale = resolveHeatmapScale(content)
  const extent = heatmapExtent(content)
  const unit = content.colorScale.unit
  const totalWidth = normalizeChartWidth(width)
  const plotWidth = totalWidth - MARGIN.left - MARGIN.right
  const plotHeight = clamp((plotWidth * rows) / columns, 120, 360)
  const totalHeight = MARGIN.top + plotHeight + MARGIN.bottom
  const cellWidth = plotWidth / columns
  const cellHeight = plotHeight / rows
  const rowTop = (row: number): number => MARGIN.top + (content.origin === 'lower' ? rows - 1 - row : row) * cellHeight
  const xTicks = axisTicks(content.xAxis, columns, plotWidth)
  // Coordinate ticks grow upward; index ticks follow the drawing order of rows.
  const yTicks = axisTicks(content.yAxis, rows, plotHeight).map(tick => ({
    ...tick,
    y: content.yAxis?.min !== undefined || content.origin === 'lower' ? MARGIN.top + plotHeight - tick.offset : MARGIN.top + tick.offset,
  }))
  const legendX = MARGIN.left + plotWidth + 18
  const legendTicks = scale.constant
    ? [{ value: scale.min, label: formatHeatmapNumber(scale.min), y: MARGIN.top + plotHeight / 2 }]
    : rangeTicks(scale.min, scale.max, 5).map(tick => ({ ...tick, y: MARGIN.top + plotHeight - ((tick.value - scale.min) / (scale.max - scale.min)) * plotHeight }))
  const legendTitle = axisTitleText(content.colorScale.label, unit)
  const xTitle = axisTitleText(content.xAxis?.label, content.xAxis?.unit)
  const yTitle = axisTitleText(content.yAxis?.label, content.yAxis?.unit)
  const [extentLow, extentHigh] = formatHeatmapNumbers([extent.min, extent.max])
  const ariaLabel = `Heatmap ${content.title}: ${String(rows)} rows x ${String(columns)} columns, values ${String(extentLow)} to ${String(extentHigh)}${unit === undefined ? '' : ` ${unit}`}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      data-dsh-rich="heatmap"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${String(totalWidth)} ${px(totalHeight)}`}
      width="100%"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      fontFamily={FONT}
    >
      <rect x={0} y={0} width={totalWidth} height={px(totalHeight)} fill="#ffffff" />
      <text x={MARGIN.left} y={18} fontSize={13} fontWeight={600} fill={theme.text}>{content.title}</text>
      <g data-dsh-rich="heatmap-cells" shapeRendering="crispEdges">
        {content.values.map((row, r) => row.map((value, c) => {
          const x = cellCenter(content.xAxis, c, columns)
          // Coordinates grow upward for both origins; origin upper puts row 0 at yAxis.max.
          const y = cellCenter(content.yAxis, content.origin === 'upper' ? rows - 1 - r : r, rows)
          const where = x === undefined || y === undefined ? '' : ` (x=${formatHeatmapNumber(x)}, y=${formatHeatmapNumber(y)})`
          return (
            <rect
              key={`${String(r)}:${String(c)}`}
              data-dsh-rich="heatmap-cell"
              data-dsh-rich-row={r}
              data-dsh-rich-column={c}
              data-dsh-rich-value={value}
              x={px(MARGIN.left + c * cellWidth)}
              y={px(rowTop(r))}
              width={px(cellWidth)}
              height={px(cellHeight)}
              fill={heatmapColor(content.colorScale.palette, scale, value)}
            >
              <title>{`row ${String(r)}, column ${String(c)}${where}: ${withUnit(value, unit)}`}</title>
            </rect>
          )
        }))}
      </g>
      <rect x={MARGIN.left} y={MARGIN.top} width={px(plotWidth)} height={px(plotHeight)} fill="none" stroke={theme.border} />
      <g data-dsh-rich="heatmap-x-axis" fontSize={10} fill={theme.muted} textAnchor="middle">
        {xTicks.map((tick, index) => (
          <text key={index} x={px(MARGIN.left + tick.offset)} y={px(MARGIN.top + plotHeight + 14)}>{tick.label}</text>
        ))}
        {xTitle.length > 0 ? <text x={px(MARGIN.left + plotWidth / 2)} y={px(MARGIN.top + plotHeight + 34)} fontSize={11} fill={theme.text}>{xTitle}</text> : null}
      </g>
      <g data-dsh-rich="heatmap-y-axis" fontSize={10} fill={theme.muted} textAnchor="end">
        {yTicks.map((tick, index) => (
          <text key={index} x={MARGIN.left - 6} y={px(tick.y + 3)}>{tick.label}</text>
        ))}
        {yTitle.length > 0 ? (
          <text x={14} y={px(MARGIN.top + plotHeight / 2)} fontSize={11} fill={theme.text} textAnchor="middle" transform={`rotate(-90 14 ${px(MARGIN.top + plotHeight / 2)})`}>{yTitle}</text>
        ) : null}
      </g>
      <g data-dsh-rich="heatmap-legend" shapeRendering="crispEdges">
        {Array.from({ length: LEGEND_STEPS }, (_unused, step) => {
          const value = scale.constant ? scale.min : scale.min + ((step + 0.5) / LEGEND_STEPS) * (scale.max - scale.min)
          const height = plotHeight / LEGEND_STEPS
          return (
            <rect
              key={step}
              data-dsh-rich="heatmap-legend-step"
              x={legendX}
              y={px(MARGIN.top + plotHeight - (step + 1) * height)}
              width={LEGEND_WIDTH}
              height={px(height + 0.5)}
              fill={heatmapColor(content.colorScale.palette, scale, value)}
            />
          )
        })}
        <rect x={legendX} y={MARGIN.top} width={LEGEND_WIDTH} height={px(plotHeight)} fill="none" stroke={theme.border} />
        {legendTicks.map((tick, index) => (
          <text key={index} x={legendX + LEGEND_WIDTH + 4} y={px(tick.y + 3)} fontSize={10} fill={theme.muted}>{tick.label}</text>
        ))}
        {legendTitle.length > 0 ? <text x={legendX} y={MARGIN.top - 8} fontSize={10} fill={theme.text}>{legendTitle}</text> : null}
      </g>
    </svg>
  )
}

/** Responsive heatmap that follows its container width. */
function Heatmap({ content }: { readonly content: HeatmapContent }): ReactElement {
  const { ref, width } = useContainerWidth()
  return (
    <div ref={ref} data-dsh-rich-container="heatmap" style={{ width: '100%', minWidth: 0 }}>
      <HeatmapView content={content} width={width} />
    </div>
  )
}

function HeatmapCard({ content }: { readonly content: HeatmapContent }): ReactElement {
  const root = useRef<HTMLElement>(null)
  const [notice, setNotice] = useState('')
  function exportSvg(): void {
    const svg = root.current?.querySelector('svg[data-dsh-rich="heatmap"]')
    if (svg === null || svg === undefined) {
      setNotice('图形尚未准备好。')
      return
    }
    try {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'heatmap.svg'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice('已导出当前 SVG。')
    } catch {
      setNotice('当前浏览器无法导出 SVG。')
    }
  }
  const scale = resolveHeatmapScale(content)
  return (
    <section ref={root} data-dsh-rich="heatmap-card" style={cardStyle}>
      {content.subtitle === undefined ? null : <p style={{ ...noteStyle, marginBottom: 6 }}>{content.subtitle}</p>}
      <Heatmap content={content} />
      <p style={{ ...noteStyle, margin: '6px 0' }}>
        {`${content.colorScale.palette === 'diverging' ? '发散色标，中点' : '顺序色标，范围'} ${formatHeatmapNumber(content.colorScale.palette === 'diverging' ? (scale.min + scale.max) / 2 : scale.min)}${content.colorScale.palette === 'diverging' ? '' : ` 至 ${formatHeatmapNumber(scale.max)}`}；${content.origin === 'lower' ? '第 0 行在底部' : '第 0 行在顶部'}；悬停格子可查看数值。`}
      </p>
      <footer style={{ display: 'flex', gap: 8 }}><button type="button" style={buttonStyle} onClick={exportSvg}>导出 SVG</button></footer>
      <p role="status" aria-live="polite" style={{ ...noteStyle, color: DSW.muted }}>{notice}</p>
    </section>
  )
}

/** The registered `rich_heatmap` Tool view. */
export function HeatmapToolView(props: ToolViewProps): ReactElement {
  if (props.phase !== 'result') return <p data-dsh-rich="heatmap-preparing">正在准备热力图…</p>
  const block = props.block as ToolResultBlock
  if (block.isError) {
    const detail = block.content.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text as string).join('\n').slice(0, 600)
    return <div role="alert" data-dsh-rich="heatmap-error">热力图生成失败：{detail}</div>
  }
  const envelope = readHeatmapMeta(block.meta)
  if (envelope === undefined) return <div role="alert" data-dsh-rich="heatmap-invalid">热力图数据不可用或版本不受支持。</div>
  return <HeatmapCard content={envelope.content} />
}
