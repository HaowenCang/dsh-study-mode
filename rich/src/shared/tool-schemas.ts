/**
 * Model-facing JSON Schemas for the payload tools (TOOLS-01).
 *
 * DSH forwards a plain tool's `parameters` to the provider unchanged, so these
 * schemas are what the model reads when it builds a card. They use only the raw
 * subset every provider accepts (type, properties, required, items, enum) and one
 * flat object per tool rather than `oneOf`, whose provider support varies. They
 * describe shape only: limits and cross-field rules stay in the Shared validators,
 * which remain authoritative and produce the error text a model can act on.
 */
import { RICH_CONTENT_SCHEMA_VERSION, RICH_CONTENT_TYPES, RICH_LIMITS } from './protocol'
import { HEATMAP_LIMITS } from './heatmap'

type Schema = Record<string, unknown>

const text = (description: string): Schema => ({ type: 'string', description })
const number = (description: string): Schema => ({ type: 'number', description })

const axis = (description: string): Schema => ({
  type: 'object',
  description,
  properties: {
    label: text('Axis title, plain text.'),
    unit: text('Unit appended to the axis title and tick labels, e.g. "s".'),
    min: number('Optional lower bound, given together with max.'),
    max: number('Optional upper bound, given together with min.'),
  },
})

/** `content` of rich_render: one RichContentV1 object. */
export const RICH_RENDER_CONTENT_SCHEMA: Schema = {
  type: 'object',
  description: 'RichContentV1. line_plot/scatter_plot use data.series (+ optional data.xAxis/data.yAxis); '
    + 'basic_diagram uses data.nodes and data.edges; message_card uses body and optional actions instead of data.',
  properties: {
    schemaVersion: { type: 'integer', enum: [RICH_CONTENT_SCHEMA_VERSION] },
    type: { type: 'string', enum: [...RICH_CONTENT_TYPES] },
    title: text(`Card title, at most ${String(RICH_LIMITS.maxTitleLength)} characters.`),
    subtitle: text('Optional one-line caption.'),
    data: {
      type: 'object',
      description: 'Plot or diagram data. Axes belong inside data, not at the top level.',
      properties: {
        series: {
          type: 'array',
          description: `Plot series, at most ${String(RICH_LIMITS.maxSeries)}, each with at most ${String(RICH_LIMITS.maxPointsPerSeries)} points.`,
          items: {
            type: 'object',
            properties: {
              name: text('Legend name of the series (required; not "label").'),
              points: {
                type: 'array',
                description: 'Finite coordinates; a line plot joins them in order.',
                items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              },
              color: text('Optional hex color "#rrggbb".'),
            },
            required: ['name', 'points'],
          },
        },
        xAxis: axis('Horizontal axis.'),
        yAxis: axis('Vertical axis.'),
        nodes: {
          type: 'array',
          description: `Diagram nodes, at most ${String(RICH_LIMITS.maxDiagramNodes)}, placed on a 0..1000 grid.`,
          items: {
            type: 'object',
            properties: {
              id: text('Unique node id, referenced by edges.'),
              label: text('Node text.'),
              x: { type: 'integer', description: 'Column on the 0..1000 grid.' },
              y: { type: 'integer', description: 'Row on the 0..1000 grid.' },
              shape: { type: 'string', enum: ['box', 'rounded', 'diamond', 'circle'] },
              tone: { type: 'string', enum: ['default', 'accent', 'muted'] },
            },
            required: ['id', 'label', 'x', 'y'],
          },
        },
        edges: {
          type: 'array',
          description: `Diagram edges, at most ${String(RICH_LIMITS.maxDiagramEdges)}.`,
          items: {
            type: 'object',
            properties: {
              from: text('Source node id.'),
              to: text('Target node id.'),
              label: text('Optional edge label.'),
              dashed: { type: 'boolean' },
            },
            required: ['from', 'to'],
          },
        },
      },
    },
    body: text('message_card text.'),
    questionId: text('Optional stable message_card question id.'),
    actions: {
      type: 'array',
      description: `Optional message_card buttons, at most ${String(RICH_LIMITS.maxCardActions)}.`,
      items: {
        type: 'object',
        properties: { id: text('Action id.'), label: text('Button text.'), submitText: text('Plain text sent back to this session when pressed.') },
        required: ['id', 'label', 'submitText'],
      },
    },
  },
  required: ['schemaVersion', 'type', 'title'],
}

/** `content` of rich_heatmap: one HeatmapV1 object. */
export const HEATMAP_CONTENT_SCHEMA: Schema = {
  type: 'object',
  description: 'HeatmapV1.',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    title: text(`Card title, at most ${String(HEATMAP_LIMITS.maxTitleLength)} characters.`),
    subtitle: text('Optional one-line caption.'),
    values: {
      type: 'array',
      description: `Row-major rectangular matrix values[row][column], at most ${String(HEATMAP_LIMITS.maxRows)}x${String(HEATMAP_LIMITS.maxColumns)} and ${String(HEATMAP_LIMITS.maxCells)} cells.`,
      items: { type: 'array', items: { type: 'number' } },
    },
    origin: { type: 'string', enum: ['lower', 'upper'], description: '"lower" (default): values[0] is the bottom row; "upper": the top row.' },
    xAxis: axis('Columns; min/max are the coordinates of the outer grid edges.'),
    yAxis: axis('Rows; min/max run bottom to top.'),
    colorScale: {
      type: 'object',
      properties: {
        palette: { type: 'string', enum: ['sequential', 'diverging'] },
        label: text('Color bar title.'),
        unit: text('Color bar unit.'),
        min: number('Optional lower bound; must not exceed the smallest value.'),
        max: number('Optional upper bound; must not be below the largest value.'),
      },
    },
  },
  required: ['schemaVersion', 'title', 'values'],
}
