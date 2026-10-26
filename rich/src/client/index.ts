/**
 * dsh-rich-response -Client half entry (browser module table).
 *
 * The packaged artifact is a script that calls
 * `window.__ModuleLoader__.load({ id: "dsh-rich-response", factory })`; the
 * factory returns this module's exports. Build wiring lives in
 * scripts/build.mjs and docs/architecture.md.
 */
import { apply } from './apply'

export const name = 'dsh-rich-response'

/** Cordis client services required before apply runs. */
export const inject = ['slots', 'remote', 'remote.commands', 'remote.session']

export { apply }
