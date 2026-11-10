/**
 * Render-time contract check for the shadowed assistant renderer.
 *
 * A throw from the shadow makes the slot core retire this entry (`reportEntryError` with abdicate),
 * so the built-in ui-chat renderer takes over for every node: verified in P0 on 0.2.2-rc.1 and
 * 0.2.1-rc.5. The check is deliberately structural; it names what is missing so the one console
 * error explains why inline rendering stopped.
 */
import type { InlineNodeProps } from './types'

export class InlineContractError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`dsh-rich-response inline renderer: DSH chat node contract changed (${missing.join(', ')}); falling back to the built-in renderer`)
    this.name = 'InlineContractError'
  }
}

const isFn = (value: unknown): boolean => typeof value === 'function'

/** Throws {@link InlineContractError} when the node props do not match the verified contract. */
export function assertInlineContract(props: unknown): asserts props is InlineNodeProps {
  const p = props as Partial<InlineNodeProps> | null
  const missing: string[] = []
  if (p === null || typeof p !== 'object') throw new InlineContractError(['props'])
  const data = p.node?.data
  if (data === undefined || data === null || typeof data !== 'object') missing.push('node.data')
  else {
    if (!Array.isArray(data.blocks)) missing.push('node.data.blocks')
    if (typeof data.status !== 'string') missing.push('node.data.status')
    if (typeof data.step !== 'number') missing.push('node.data.step')
  }
  if (typeof p.sessionId !== 'string') missing.push('sessionId')
  for (const name of ['t', 'useDisclosure', 'useGroupAction', 'renderFactorySlot'] as const) if (!isFn(p[name])) missing.push(name)
  if (missing.length > 0) throw new InlineContractError(missing)
}
