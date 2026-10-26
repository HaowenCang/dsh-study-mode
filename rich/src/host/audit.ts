/** Bounded, operator-configured JSONL audit sink for interaction records. */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { RichInteractionRecord } from '../shared/index'
import type { HostLogger } from './types'

/** Bounded FIFO set used for duplicate-attempt detection. */
export class AttemptTracker {
  readonly #seen = new Set<string>()
  readonly #order: string[] = []
  readonly #limit: number

  constructor(limit: number) {
    this.#limit = Number.isInteger(limit) && limit > 0 ? limit : 512
  }

  /**
   * Record one attempt id.
   * @param attemptId - client-minted identity.
   * @returns true when this identity was already observed.
   */
  observe(attemptId: string): boolean {
    const duplicate = this.#seen.has(attemptId)
    if (!duplicate) {
      this.#seen.add(attemptId)
      this.#order.push(attemptId)
      while (this.#order.length > this.#limit) {
        const evicted = this.#order.shift()
        if (evicted !== undefined) this.#seen.delete(evicted)
      }
    }
    return duplicate
  }

  /** Current number of retained identities (diagnostics only). */
  get size(): number {
    return this.#seen.size
  }
}

/** Append one record to the configured JSONL audit file. */
export function appendAuditRecord(path: string, record: RichInteractionRecord, logger: HostLogger): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8' })
  } catch (error) {
    // Audit failure must never change the user-visible outcome; it is logged.
    logger.warn('rich-response: interaction audit append failed: %s', String(error))
  }
}
