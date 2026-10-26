/**
 * Structural Host-side contracts used by this plugin.
 *
 * The plugin deliberately declares the slice of the Cordis context it consumes
 * instead of importing harness runtime values: a profile-installed bundle must
 * resolve with no production dependency tree. These shapes are cross-checked
 * against the fixed 0.2.1-rc.2 source in docs/host-client-api.md.
 */

/** Subset of the Cordis logger used for bounded diagnostics. */
export interface HostLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** One agent tool definition (subset of `ToolDefinition`). */
export interface ToolDefinitionLike {
  readonly name: string
  readonly description: string
  /** Raw model-facing JSON Schema (a plain ToolDefinition forwards it to the provider). */
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    readonly render: (args: unknown, value: never) => readonly { type: 'text'; text: string }[]
    readonly presentationMeta?: (args: unknown, value: never) => unknown
  }
  readonly execute: (args: unknown, exec: { readonly signal: AbortSignal }) => Promise<unknown>
}

/** One human command definition (subset of `CommandDefinition`). */
export interface CommandDefinitionLike {
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string }
  readonly recordInput?: boolean
  readonly handler: (invocation: CommandInvocationLike) => CommandResultLike | Promise<CommandResultLike>
}

/** Invocation passed to a command handler. */
export interface CommandInvocationLike {
  /** Agent identity - in 0.2.1-rc.2 this is the session id (`Agent.id: SessionId`). */
  readonly agent: { readonly id: string }
  readonly rawInput: string
  readonly signal: AbortSignal
}

/** Direct command outcome rendered by the dispatching UI. */
export type CommandResultLike =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** Subset of the Cordis context this Host plugin consumes. */
export interface HostContext {
  effect(callback: () => undefined | (() => void)): void
  readonly tools: { register(definition: ToolDefinitionLike): () => void }
  readonly commands: { register(definition: CommandDefinitionLike): () => void }
  readonly logger: HostLogger
}

/** Profile-patch configuration of the Host half. */
export interface HostConfig {
  /**
   * Absolute path of the JSONL audit log appended by the interaction command.
   * When absent the Host records through the logger only. Operator-controlled
   * configuration; never derived from model output.
   */
  readonly auditLog?: string
  /** Maximum number of retained attempt ids used for duplicate detection (default 512). */
  readonly maxTrackedAttempts?: number
}
