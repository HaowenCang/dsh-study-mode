/**
 * dsh-rich-response -Host half.
 *
 * Registers, through the documented 0.2.1-rc.2 Host extension points only:
 *   * the `rich_render` agent tool (validated RichContentV1 payloads);
 *   * the figure tools `rich_mermaid`, `rich_heatmap`, `rich_image` and `rich_svg`,
 *     which also write a figure file the answer embeds with one Markdown line;
 *   * the `rich-interaction` human command (original-session audit record).
 *
 * No harness runtime package is imported: the bundle lives inside a profile
 * whose node_modules holds only this package and the DSH release itself.
 * Diagnostics are bounded and never include full model payloads.
 */
import { AttemptTracker } from './audit'
import { createRichInteractionCommand } from './tools/rich-interaction'
import { createRichRenderTool } from './tools/rich-render'
import { createPhysicsTool } from './tools/physics-demo'
import { createMermaidTool } from './tools/rich-mermaid'
import { createHeatmapTool } from './tools/rich-heatmap'
import { createImageTool, type ImageToolServices } from './tools/rich-image'
import { createSvgTool } from './tools/rich-svg'
import { createCheckFigureTool } from './tools/rich-check-figure'
import { createFigureStore, defaultFiguresDir } from './figures'
import type { FigureStore } from './figures'
import type { HostConfig, HostContext } from './types'

export const name = 'dsh-rich-response'

/** Cordis services this plugin needs before `apply` runs. */
export const inject = ['tools', 'commands']

/**
 * Whether answers draw figures inline. `auto` follows the Host: DSH 0.2.2 added `tools.setExecutor`
 * in the same release whose client this plugin shadows, so its presence marks a Host where inline
 * fences render (0.2.1 lacks it and keeps the figure-file route).
 */
export function inlineActive(tools: { readonly setExecutor?: unknown }, mode: HostConfig['inline']): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  return typeof tools.setExecutor === 'function'
}

/** Register both Host contributions under one effect-owned lifetime. */
export function apply(ctx: HostContext, config?: HostConfig): void {
  const tracker = new AttemptTracker(config?.maxTrackedAttempts ?? 512)
  const auditLog = typeof config?.auditLog === 'string' && config.auditLog.length > 0
    ? config.auditLog
    : undefined

  const figuresDir = typeof config?.figuresDir === 'string' && config.figuresDir.length > 0 ? config.figuresDir : defaultFiguresDir()
  const inline = inlineActive(ctx.tools, config?.inline)
  // Inline answers draw fences: no figure file, no image line, no copy-the-line note.
  const figures: FigureStore | undefined = inline ? undefined : createFigureStore(figuresDir)

  ctx.effect(() => ctx.tools.register(createRichRenderTool({ figures })))
  ctx.effect(() => ctx.tools.register(createPhysicsTool()))
  ctx.effect(() => ctx.tools.register(createMermaidTool({ figures })))
  ctx.effect(() => ctx.tools.register(createHeatmapTool({ figures })))
  ctx.effect(() => ctx.tools.register(createSvgTool({ figures })))
  if (inline) ctx.effect(() => ctx.tools.register(createCheckFigureTool()))
  const imageTool = createImageTool({
    services: () => ({
      fs: ctx.get?.('fs') as ImageToolServices['fs'],
      workingDirectory: ctx.get?.('workingDirectory') as ImageToolServices['workingDirectory'],
    }),
    ...config?.maxImageBytes === undefined ? {} : { maxImageBytes: config.maxImageBytes },
    figures,
  })
  ctx.effect(() => ctx.tools.register(imageTool))
  ctx.effect(() => ctx.commands.register(createRichInteractionCommand({
    logger: ctx.logger,
    tracker,
    ...auditLog === undefined ? {} : { auditLog },
  })))

  ctx.logger.info(
    'rich-response: host half registered (rich_render, rich_physics_demo, rich_mermaid, rich_heatmap, rich_image, rich_svg%s tools, rich-interaction command, inline=%s, auditLog=%s, figuresDir=%s)',
    inline ? ', rich_check_figure' : '',
    inline ? 'on' : 'off',
    auditLog ?? '<none>',
    inline ? '<unused>' : figuresDir,
  )
}

export type { HostConfig } from './types'
