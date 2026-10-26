/**
 * dsh-study-mode Client entry: the package's one browser module.
 *
 * The built artifact registers through
 * `window.__ModuleLoader__.load({ id: "dsh-study-mode", factory })` and mounts
 * the Study Core learning cards and the Rich Response Tool views as child
 * plugins, each with its own `inject` list.
 */
import * as studyCore from '../core/src/client/index.tsx'
import * as richResponse from '../rich/src/client/index.ts'

export const name = 'dsh-study-mode'

/** The part of the Cordis client context this entry uses. */
export interface ClientContext {
  plugin(plugin: object): unknown
}

/**
 * Mount both Client halves; disposing this entry disposes both children.
 * @param ctx - Cordis client context of this package's entry.
 */
export function apply(ctx: ClientContext): void {
  ctx.plugin(studyCore)
  ctx.plugin(richResponse)
}
