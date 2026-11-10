/**
 * Lazy access to the shared platform module `@deepseek-ai/dsh-client-ui-primitives`.
 *
 * The client bundle is CJS inside the `__ModuleLoader__` factory, whose `require` reads the browser
 * module table (PLATFORM_MODULES, unchanged dsh-v0.2.2-rc.1 -> master fcc0ad4621). The import is
 * lazy and checked so a host without the module (or with a changed export surface) keeps the rest
 * of the plugin working and simply leaves the built-in assistant renderer in place.
 */
import type { Primitives } from './types'

// Module-local: the factory parameter in the shipped bundle, absent in unit-test bundles.
declare const require: (specifier: string) => unknown

export const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

const isComponent = (value: unknown): boolean =>
  typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value)

/** Validate a primitives module shape; returns the missing required exports. */
export function checkPrimitives(mod: unknown): { primitives?: Primitives; missing: string[] } {
  if (typeof mod !== 'object' || mod === null) return { missing: ['module'] }
  const m = mod as Record<string, unknown>
  const missing = (['MarkdownText', 'CodeBlock'] as const).filter(name => !isComponent(m[name]))
  if (missing.length > 0) return { missing }
  const optional = (name: string): unknown => isComponent(m[name]) ? m[name] : undefined
  return {
    missing,
    primitives: {
      MarkdownText: m['MarkdownText'] as Primitives['MarkdownText'],
      CodeBlock: m['CodeBlock'] as Primitives['CodeBlock'],
      JsonBlock: optional('JsonBlock') as Primitives['JsonBlock'],
      DisclosureRow: optional('DisclosureRow') as Primitives['DisclosureRow'],
      TextShimmer: optional('TextShimmer') as Primitives['TextShimmer'],
      IconThinkOutlineRegular: optional('IconThinkOutlineRegular') as Primitives['IconThinkOutlineRegular'],
    },
  }
}

/** Load the shared primitives from the module table, or report why not. */
export function loadPrimitives(): { primitives?: Primitives; missing: string[] } {
  let mod: unknown
  try { mod = require('@deepseek-ai/dsh-client-ui-primitives') } catch { return { missing: ['module'] } }
  return checkPrimitives(mod)
}
