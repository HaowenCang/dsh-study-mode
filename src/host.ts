/**
 * dsh-study-tutor Host entry.
 *
 * RC.3 serves one browser module per package and rejects two active Loader rows
 * that resolve to the same package, so this single row mounts the Study Core
 * and Rich Response Host plugins as child plugins. Each child keeps its own
 * `inject` list, configuration and effect-owned registrations.
 */
import * as studyCore from '../core/src/host/index.ts'
import * as richResponse from '../rich/src/host/index.ts'

export const name = 'dsh-study-tutor'

/** Row configuration: each child plugin's own configuration, unchanged. */
export interface Config {
  readonly core?: studyCore.Config
  readonly rich?: richResponse.HostConfig
}

/** The part of the Cordis context this entry uses. */
export interface HostContext {
  plugin(plugin: object, config?: unknown): unknown
}

/**
 * Mount both Host halves; disposing this row's fiber disposes both children.
 * @param ctx - Cordis context of this Loader row.
 * @param config - per-child configuration from cordis.patch.yml.
 */
export function apply(ctx: HostContext, config: Config = {}): void {
  ctx.plugin(studyCore, config.core ?? {})
  ctx.plugin(richResponse, config.rich ?? {})
}
