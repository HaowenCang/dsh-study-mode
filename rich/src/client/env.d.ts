/**
 * Browser module-table contract of DSH 0.2.1-rc.2.
 *
 * A client plugin bundle is a plain script that registers one lazy factory:
 * `window.__ModuleLoader__.load({ id, factory(require) })`. The factory's
 * `require` reads the shipped browser module table (react, react/jsx-runtime,
 * and the harness client packages that declared a boot row).
 */
interface DshModuleLoader {
  load(registration: {
    id: string
    chunk?: string
    factory: (require: (specifier: string) => unknown) => unknown
  }): void
}

interface Window {
  __ModuleLoader__?: DshModuleLoader
}
