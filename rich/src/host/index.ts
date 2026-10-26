/**
 * dsh-rich-response -Host half.
 *
 * Registers, through the documented 0.2.1-rc.2 Host extension points only:
 *   * the `rich_render` agent tool (validated RichContentV1 payloads);
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
import type { HostConfig, HostContext } from './types'

export const name = 'dsh-rich-response'

/** Cordis services this plugin needs before `apply` runs. */
export const inject = ['tools', 'commands']

/** Register both Host contributions under one effect-owned lifetime. */
export function apply(ctx: HostContext, config?: HostConfig): void {
  const tracker = new AttemptTracker(config?.maxTrackedAttempts ?? 512)
  const auditLog = typeof config?.auditLog === 'string' && config.auditLog.length > 0
    ? config.auditLog
    : undefined

  ctx.effect(() => ctx.tools.register(createRichRenderTool()))
  ctx.effect(() => ctx.tools.register(createPhysicsTool()))
  ctx.effect(() => ctx.tools.register(createMermaidTool()))
  ctx.effect(() => ctx.commands.register(createRichInteractionCommand({
    logger: ctx.logger,
    tracker,
    ...auditLog === undefined ? {} : { auditLog },
  })))

  ctx.logger.info(
    'rich-response: host half registered (rich_render, rich_physics_demo, rich_mermaid tools, rich-interaction command, auditLog=%s)',
    auditLog ?? '<none>',
  )
}

export type { HostConfig } from './types'
