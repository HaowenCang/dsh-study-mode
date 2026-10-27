/**
 * Client plugin entry: one keyed Tool view registration.
 *
 * `tool.call.toolview` is a keyed, session-scoped slot owned by ui-tool. The
 * key is the exact wire tool name, so a typo never renders and the built-in
 * generic row remains for every other tool.
 */
import type { ClientContext } from './contract'
import { createToolView } from './toolview'
import { PhysicsToolView } from './physics-view'
import { HeatmapToolView } from './heatmap-view'
import { ImageToolView } from './image-view'

/** Register the Client half through the official slot registry. */
export function apply(ctx: ClientContext): void {
  const ToolView = createToolView(ctx)
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'rich_render',
  }, ToolView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'rich_physics_demo',
  }, PhysicsToolView))
  // Mermaid results persist an ordinary basic_diagram envelope; the view skips argument previews.
  const MermaidToolView = createToolView(ctx, { previewArgs: false })
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'rich_mermaid',
  }, MermaidToolView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'rich_heatmap',
  }, HeatmapToolView))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'rich_image',
  }, ImageToolView))
  ctx.logger.info('rich-response: client half registered tool.call.toolview keys=rich_render,rich_physics_demo,rich_mermaid,rich_heatmap,rich_image')
}
