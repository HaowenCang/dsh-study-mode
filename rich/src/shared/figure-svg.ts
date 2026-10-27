/**
 * Static figure SVG (VIS-03).
 *
 * The Host writes these strings to files that the answer embeds with a Markdown
 * image line, so the figure appears where the text refers to it. DSH shows such
 * an image through an <img>, which inherits no page colours or theme, so every
 * figure carries its own light card and literal colours. Markdown previews cap
 * images at 640x360 CSS pixels (larger ones open in a lightbox), so figures are
 * laid out for a 640-pixel width. Only model text enters as escaped text nodes
 * and attribute values; numbers are formatted by this module.
 */
import { axisTitleText, createChartModel, formatCoordinate, type ChartModel } from './chart-scale'
import { buildDiagramGeometry, DIAGRAM_EDGE_LABEL_UNITS, truncateLabel, type DiagramNodeGeometry } from './diagram-geometry'
import { heatmapColor, formatHeatmapNumbers, resolveHeatmapScale, type HeatmapContent } from './heatmap'
import type { BasicDiagramContent, LinePlotContent, RichContentV1, ScatterPlotContent } from './protocol'

/** Literal colours of the figure card (light; the card stays readable on dark pages). */
export const FIGURE_THEME = {
  background: '#ffffff', border: '#d0d7de', text: '#1f2328', muted: '#59636e', grid: '#e6eaef',
  node: '#f6f8fa', accent: '#247bbf',
} as const

export const FIGURE_WIDTH = 640
export const FIGURE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif"
const PAD = 20
const PLOT_HEIGHT = 260

/** Escape text for an XML text node or a double-quoted attribute value. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

const n = (value: number): string => formatCoordinate(value)

interface Header { readonly title: string; readonly subtitle?: string | undefined }

function headerHeight(header: Header): number {
  return header.subtitle !== undefined && header.subtitle.length > 0 ? 56 : 38
}

/**
 * Wrap a drawn body in the figure card: background, title, optional subtitle.
 * @param bodyWidth - width of the body's own coordinate system.
 * @param bodyHeight - height of the body's own coordinate system.
 * @param scale - display scale of the body inside the card.
 */
function card(header: Header, body: string, bodyWidth: number, bodyHeight: number, scale = 1): string {
  const top = headerHeight(header)
  const width = Math.max(FIGURE_WIDTH, Math.ceil(bodyWidth * scale + PAD * 2))
  const height = Math.ceil(top + bodyHeight * scale + PAD * 0.75)
  const subtitle = header.subtitle !== undefined && header.subtitle.length > 0
    ? `<text x="${String(PAD)}" y="46" font-size="13" fill="${FIGURE_THEME.muted}">${escapeXml(header.subtitle)}</text>`
    : ''
  const offsetX = (width - bodyWidth * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}" font-family="${escapeXml(FIGURE_FONT_FAMILY)}">`
    + `<title>${escapeXml(header.title)}</title>`
    + `<rect x="0.5" y="0.5" width="${String(width - 1)}" height="${String(height - 1)}" rx="12" fill="${FIGURE_THEME.background}" stroke="${FIGURE_THEME.border}"/>`
    + `<text x="${String(PAD)}" y="26" font-size="15" font-weight="600" fill="${FIGURE_THEME.text}">${escapeXml(header.title)}</text>${subtitle}`
    + `<g transform="translate(${n(offsetX)} ${String(top)}) scale(${n(scale)})">${body}</g></svg>`
}

function plotBody(model: ChartModel, scatter: boolean): string {
  const { plot } = model
  const parts: string[] = []
  for (const tick of model.yTicks.ticks) {
    const y = model.yScale.map(tick.value)
    parts.push(`<line x1="${n(plot.left)}" y1="${n(y)}" x2="${n(plot.left + plot.width)}" y2="${n(y)}" stroke="${FIGURE_THEME.grid}"/>`)
    parts.push(`<text x="${n(plot.left - 6)}" y="${n(y)}" dy="0.32em" text-anchor="end" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(tick.label)}</text>`)
  }
  for (const tick of model.xTicks.ticks) {
    const x = model.xScale.map(tick.value)
    parts.push(`<line x1="${n(x)}" y1="${n(plot.top)}" x2="${n(x)}" y2="${n(plot.top + plot.height)}" stroke="${FIGURE_THEME.grid}"/>`)
    parts.push(`<text x="${n(x)}" y="${n(plot.top + plot.height + 16)}" text-anchor="middle" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(tick.label)}</text>`)
  }
  parts.push(`<rect x="${n(plot.left)}" y="${n(plot.top)}" width="${n(plot.width)}" height="${n(plot.height)}" fill="none" stroke="${FIGURE_THEME.border}"/>`)
  for (const series of model.series) {
    if (scatter) {
      for (const mark of series.marks) parts.push(`<circle cx="${n(mark.pixel.x)}" cy="${n(mark.pixel.y)}" r="3" fill="${escapeXml(series.color)}"/>`)
    } else if (series.marks.length > 0) {
      parts.push(`<polyline points="${series.polyline}" fill="none" stroke="${escapeXml(series.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)
    }
  }
  const xTitle = axisTitleText(model.xLabel, model.xUnit)
  const yTitle = axisTitleText(model.yLabel, model.yUnit)
  if (xTitle.length > 0) parts.push(`<text x="${n(plot.left + plot.width / 2)}" y="${n(plot.top + plot.height + 34)}" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(xTitle)}</text>`)
  if (yTitle.length > 0) parts.push(`<text transform="translate(14 ${n(plot.top + plot.height / 2)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(yTitle)}</text>`)
  // Legend along the top edge of the plot, one entry per series.
  let x = plot.left
  for (const series of model.series) {
    parts.push(`<rect x="${n(x)}" y="${n(plot.top - 13)}" width="10" height="10" rx="2" fill="${escapeXml(series.color)}"/>`)
    parts.push(`<text x="${n(x + 14)}" y="${n(plot.top - 4)}" font-size="11" fill="${FIGURE_THEME.text}">${escapeXml(series.name)}</text>`)
    x += 30 + Math.min(series.name.length, 24) * 11
  }
  return parts.join('')
}

/** Line or scatter plot as a static figure. */
export function plotFigureSvg(content: LinePlotContent | ScatterPlotContent): string {
  const model = createChartModel(content.data, { width: FIGURE_WIDTH - PAD * 2, height: PLOT_HEIGHT })
  // Room above the plot for the legend row.
  return card(content, `<g transform="translate(0 16)">${plotBody(model, content.type === 'scatter_plot')}</g>`, model.layout.width, model.layout.height + 16)
}

function nodeShape(geometry: DiagramNodeGeometry): string {
  const { center, halfWidth, halfHeight } = geometry
  const tone = geometry.node.tone
  const fill = tone === 'accent' ? FIGURE_THEME.accent : FIGURE_THEME.node
  const stroke = tone === 'accent' ? FIGURE_THEME.accent : FIGURE_THEME.border
  const textFill = tone === 'accent' ? '#ffffff' : tone === 'muted' ? FIGURE_THEME.muted : FIGURE_THEME.text
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="1.4"`
  let shape: string
  switch (geometry.shape) {
    case 'diamond':
      shape = `<polygon points="${n(center.x)},${n(center.y - halfHeight)} ${n(center.x + halfWidth)},${n(center.y)} ${n(center.x)},${n(center.y + halfHeight)} ${n(center.x - halfWidth)},${n(center.y)}" ${paint}/>`
      break
    case 'circle':
      shape = `<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(geometry.radius)}" ${paint}/>`
      break
    default:
      shape = `<rect x="${n(center.x - halfWidth)}" y="${n(center.y - halfHeight)}" width="${n(halfWidth * 2)}" height="${n(halfHeight * 2)}" rx="${geometry.shape === 'rounded' ? '14' : '3'}" ${paint}/>`
  }
  return shape + `<text x="${n(center.x)}" y="${n(center.y)}" dy="0.34em" text-anchor="middle" font-size="12" fill="${textFill}">${escapeXml(truncateLabel(geometry.node.label, geometry.labelMaxChars))}</text>`
}

/** Node-and-edge diagram, cropped to the drawn nodes so sparse layouts do not waste the preview box. */
export function diagramFigureSvg(content: BasicDiagramContent): string {
  const geometry = buildDiagramGeometry(content.data.nodes, content.data.edges)
  if (geometry.nodes.length === 0) return card(content, '', FIGURE_WIDTH - PAD * 2, 24)
  const left = Math.min(...geometry.nodes.map(g => g.center.x - g.halfWidth)) - 12
  const right = Math.max(...geometry.nodes.map(g => g.center.x + g.halfWidth)) + 12
  const top = Math.min(...geometry.nodes.map(g => g.center.y - g.halfHeight)) - 12
  const bottom = Math.max(...geometry.nodes.map(g => g.center.y + g.halfHeight)) + 12
  const width = right - left, height = bottom - top
  // Never enlarge past the authored scale; shrink only to fit the 640-pixel card.
  const scale = Math.min(1, (FIGURE_WIDTH - PAD * 2) / width)
  const edges = geometry.edges.map(edge => {
    const dash = edge.edge.dashed === true ? ' stroke-dasharray="7 5"' : ''
    const label = edge.labelText.length > 0
      ? `<text x="${n(edge.label.x)}" y="${n(edge.label.y)}" text-anchor="middle" font-size="11" fill="${FIGURE_THEME.muted}" stroke="${FIGURE_THEME.background}" stroke-width="3" paint-order="stroke">${escapeXml(truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS))}</text>`
      : ''
    return `<line x1="${n(edge.start.x)}" y1="${n(edge.start.y)}" x2="${n(edge.end.x)}" y2="${n(edge.end.y)}" stroke="${FIGURE_THEME.muted}" stroke-width="1.4"${dash} marker-end="url(#arrow)"/>${label}`
  }).join('')
  const body = `<defs><marker id="arrow" viewBox="0 0 10 7" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,3.5 L0,7 Z" fill="${FIGURE_THEME.muted}"/></marker></defs>`
    + `<g transform="translate(${n(-left)} ${n(-top)})">${edges}${geometry.nodes.map(nodeShape).join('')}</g>`
  return card(content, body, width, height, scale)
}

/** Numeric matrix as coloured cells with a colour bar. */
export function heatmapFigureSvg(content: HeatmapContent): string {
  const rows = content.values.length, columns = content.values[0]?.length ?? 0
  const scale = resolveHeatmapScale(content)
  const gridLeft = 56, gridTop = 4, barWidth = 14, barGap = 18, labelRoom = 64
  const available = FIGURE_WIDTH - PAD * 2 - gridLeft - barGap - barWidth - labelRoom
  const cell = Math.max(2, Math.min(available / Math.max(columns, 1), 260 / Math.max(rows, 1)))
  const gridWidth = cell * columns, gridHeight = cell * rows
  const parts: string[] = []
  for (let row = 0; row < rows; row++) {
    // origin "lower" draws values[0] at the bottom.
    const drawRow = content.origin === 'upper' ? row : rows - 1 - row
    for (let column = 0; column < columns; column++) {
      const value = content.values[row]?.[column] ?? 0
      parts.push(`<rect x="${n(gridLeft + column * cell)}" y="${n(gridTop + drawRow * cell)}" width="${n(cell)}" height="${n(cell)}" fill="${heatmapColor(content.colorScale.palette, scale, value)}"/>`)
    }
  }
  parts.push(`<rect x="${n(gridLeft)}" y="${n(gridTop)}" width="${n(gridWidth)}" height="${n(gridHeight)}" fill="none" stroke="${FIGURE_THEME.border}"/>`)
  const barX = gridLeft + gridWidth + barGap, steps = 32
  for (let step = 0; step < steps; step++) {
    const value = scale.max - (scale.max - scale.min) * (step + 0.5) / steps
    parts.push(`<rect x="${n(barX)}" y="${n(gridTop + gridHeight * step / steps)}" width="${String(barWidth)}" height="${n(gridHeight / steps + 0.5)}" fill="${heatmapColor(content.colorScale.palette, scale, value)}"/>`)
  }
  const [maxLabel, minLabel] = formatHeatmapNumbers([scale.max, scale.min])
  parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + 10)}" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(maxLabel ?? '')}</text>`)
  parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + gridHeight)}" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(minLabel ?? '')}</text>`)
  const barTitle = axisTitleText(content.colorScale.label, content.colorScale.unit)
  if (barTitle.length > 0) parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + gridHeight / 2)}" font-size="11" fill="${FIGURE_THEME.text}">${escapeXml(barTitle)}</text>`)
  const xTitle = axisTitleText(content.xAxis?.label, content.xAxis?.unit)
  const yTitle = axisTitleText(content.yAxis?.label, content.yAxis?.unit)
  if (xTitle.length > 0) parts.push(`<text x="${n(gridLeft + gridWidth / 2)}" y="${n(gridTop + gridHeight + 20)}" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(xTitle)}</text>`)
  if (yTitle.length > 0) parts.push(`<text transform="translate(${String(gridLeft - 14)} ${n(gridTop + gridHeight / 2)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(yTitle)}</text>`)
  return card(content, parts.join(''), barX + barWidth + labelRoom, gridTop + gridHeight + 28)
}

/** Static figure for a rich_render payload; message cards have none. */
export function richContentFigureSvg(content: RichContentV1): string | undefined {
  switch (content.type) {
    case 'line_plot':
    case 'scatter_plot':
      return plotFigureSvg(content)
    case 'basic_diagram':
      return diagramFigureSvg(content)
    default:
      return undefined
  }
}

/** Card for an already-sanitized freeform drawing: the drawing keeps its own viewBox inside a nested <svg>. */
export function drawingFigureSvg(header: Header, viewBox: readonly [number, number, number, number], inner: string): string {
  const [, , width, height] = viewBox
  // Fit 600 px wide, but keep very tall drawings within about two preview heights.
  const scale = Math.min((FIGURE_WIDTH - PAD * 2) / width, 720 / height)
  const body = `<svg x="0" y="0" width="${n(width)}" height="${n(height)}" viewBox="${viewBox.map(n).join(' ')}" overflow="hidden">${inner}</svg>`
  return card(header, body, width, height, scale)
}
