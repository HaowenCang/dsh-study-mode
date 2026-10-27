/**
 * TOOLS-01: the model-facing schemas of rich_render and rich_heatmap describe the
 * whole payload, so a model can build a valid card on the first call. The two
 * payloads that failed in the first real-model session must violate the schema.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRichRenderTool } from '../../src/host/tools/rich-render'
import { createHeatmapTool } from '../../src/host/tools/rich-heatmap'
import { RICH_CONTENT_TYPES, validateRichContent } from '../../src/shared/index'
import { validateHeatmap } from '../../src/shared/heatmap'

type Schema = Record<string, unknown>

/** Minimal checker for the raw subset DSH forwards: type, properties, required, items, enum. */
function violations(schema: Schema, value: unknown, path = '$'): string[] {
  const type = schema['type']
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (type === 'integer' ? !Number.isInteger(value) : type !== undefined && type !== kind) return [`${path}: expected ${String(type)}`]
  if (Array.isArray(schema['enum']) && !(schema['enum'] as unknown[]).includes(value)) return [`${path}: not in enum`]
  const out: string[] = []
  if (kind === 'object') {
    const record = value as Record<string, unknown>
    for (const key of (schema['required'] as string[] | undefined) ?? []) if (!(key in record)) out.push(`${path}.${key}: required`)
    const properties = (schema['properties'] as Record<string, Schema> | undefined) ?? {}
    for (const [key, child] of Object.entries(record)) if (properties[key] !== undefined) out.push(...violations(properties[key], child, `${path}.${key}`))
  }
  if (kind === 'array' && schema['items'] !== undefined) (value as unknown[]).forEach((item, index) => out.push(...violations(schema['items'] as Schema, item, `${path}[${String(index)}]`)))
  return out
}

const contentSchema = (tool: { parameters: Schema }): Schema =>
  ((tool.parameters['properties'] as Record<string, Schema>)['content']) as Schema

const LINE = {
  schemaVersion: 1, type: 'line_plot', title: 'x(t)', subtitle: 'phi = 0',
  data: { series: [{ name: 'x/A', points: [{ x: 0, y: 1 }, { x: 1.57, y: 0 }] }], xAxis: { label: 't', unit: 's' }, yAxis: { label: 'x/A' } },
}
const DIAGRAM = {
  schemaVersion: 1, type: 'basic_diagram', title: 'chain',
  data: { nodes: [{ id: 'A', label: 'start', x: 100, y: 100 }, { id: 'B', label: 'end', x: 500, y: 100, shape: 'rounded' }], edges: [{ from: 'A', to: 'B', label: 'then' }] },
}
const CARD = { schemaVersion: 1, type: 'message_card', title: 'Check', body: 'Ready?', actions: [{ id: 'yes', label: 'Yes', submitText: 'yes' }] }

describe('TOOLS-01 model-facing schemas', () => {
  it('rich_render declares the content type, series, axes, nodes, edges and card fields', () => {
    const schema = contentSchema(createRichRenderTool())
    const properties = schema['properties'] as Record<string, Schema>
    assert.deepEqual(properties['type']?.['enum'], [...RICH_CONTENT_TYPES])
    assert.deepEqual(schema['required'], ['schemaVersion', 'type', 'title'])
    const data = properties['data']?.['properties'] as Record<string, Schema>
    const series = data['series']?.['items'] as Schema
    assert.deepEqual(series['required'], ['name', 'points'])
    assert.deepEqual(((data['nodes']?.['items'] as Schema)['required']), ['id', 'label', 'x', 'y'])
    assert.deepEqual(((data['edges']?.['items'] as Schema)['required']), ['from', 'to'])
    assert.ok(data['xAxis'] !== undefined && data['yAxis'] !== undefined)
    assert.ok(properties['body'] !== undefined && properties['actions'] !== undefined)
  })

  it('valid payloads satisfy both the schema and the validator', () => {
    const schema = contentSchema(createRichRenderTool())
    for (const payload of [LINE, DIAGRAM, CARD]) {
      assert.deepEqual(violations(schema, payload), [], payload.type)
      assert.equal(validateRichContent(payload).ok, true, payload.type)
    }
  })

  it('the two payloads that failed in the first real-model session violate the schema', () => {
    const schema = contentSchema(createRichRenderTool())
    const dataArray = { schemaVersion: 1, type: 'line_plot', title: 't', data: [{ series: 'x', points: [{ x: 0, y: 1 }] }] }
    const labelNotName = { schemaVersion: 1, type: 'line_plot', title: 't', data: { series: [{ label: 'x', points: [{ x: 0, y: 1 }] }] } }
    assert.ok(violations(schema, dataArray).some(v => v.startsWith('$.data: expected object')))
    assert.ok(violations(schema, labelNotName).includes('$.data.series[0].name: required'))
  })

  it('rich_heatmap declares values, origin, axes and the color scale', () => {
    const schema = contentSchema(createHeatmapTool())
    const properties = schema['properties'] as Record<string, Schema>
    assert.deepEqual(schema['required'], ['schemaVersion', 'title', 'values'])
    assert.equal((properties['values']?.['items'] as Schema)['type'], 'array')
    assert.deepEqual(properties['origin']?.['enum'], ['lower', 'upper'])
    assert.deepEqual((properties['colorScale']?.['properties'] as Record<string, Schema>)['palette']?.['enum'], ['sequential', 'diverging'])
    const payload = { schemaVersion: 1, title: 'field', values: [[0, 1], [2, 3]], origin: 'upper', colorScale: { palette: 'sequential' } }
    assert.deepEqual(violations(schema, payload), [])
    assert.equal(validateHeatmap(payload).ok, true)
  })
})
