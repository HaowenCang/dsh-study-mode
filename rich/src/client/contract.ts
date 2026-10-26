/**
 * Structural Client contracts for this plugin.
 *
 * These mirror the verified 0.2.1-rc.2 slot contract (`tool.call.toolview`,
 * keyed, session scope) and the official client services the plugin touches.
 * The fixed source references are recorded in docs/host-client-api.md; no
 * harness runtime package is imported, so the bundle carries only React.
 */

/** One remote-transport result. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** One command outcome produced by the Host executor. */
export interface CommandResultLike {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** Value of `remote.commands.execute`. */
export interface CommandExecuteValue {
  readonly result: CommandResultLike
}

/** Official remote command face addressed by session id. */
export interface RemoteCommandsFace {
  execute(
    sessionId: string,
    line: string,
    attachments?: readonly unknown[],
  ): Promise<RemoteResult<CommandExecuteValue>>
}

/** RC.3 session-controller prompt contract, restricted to text queued by a card. */
export interface RemoteSessionFace {
  prompt(request: {
    readonly requestId: string
    readonly sessionId: string
    readonly mode: 'queue'
    readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  }, signal?: AbortSignal): Promise<RemoteResult<{ readonly accepted: true }>>
}

/** Official client session controller face (subset used as a capability probe). */
export interface SessionsFace {
  create(options?: { sessionId?: string }): Promise<string>
}

/** One keyed-slot registration spec. */
export interface SlotRegistrationSpec {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
}

/** Slot registry face (`ctx.slots`). */
export interface SlotsFace {
  inject(key: string, callback: () => undefined | (() => void)): void
  register(spec: SlotRegistrationSpec, component: unknown): () => void
}

/** Client-side logger face. */
export interface ClientLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** The client plugin's Cordis context slice. */
export interface ClientContext {
  readonly slots: SlotsFace
  readonly remote: { readonly commands: RemoteCommandsFace; readonly session?: RemoteSessionFace }
  readonly sessions?: SessionsFace
  readonly logger: ClientLogger
  effect?(callback: () => undefined | (() => void)): void
}

/** One lazy argument reader supplied by the Chat layer. */
export interface ToolArgsReader {
  keys?(): readonly string[]
}

/** Identity and placement shared by the two running stages. */
interface RunningToolCallHead {
  readonly callId: string
  readonly name: string
  readonly turn: number
  readonly step: number
  readonly time: number
  readonly args: ToolArgsReader
  readonly subCalls: readonly unknown[]
}

/** Stage data of a call whose arguments are still streaming. */
export interface PreparingToolCallBlock extends RunningToolCallHead {
  readonly phase: 'preparing'
}

/** Stage data of a dispatched call without a result yet. */
export interface StartedToolCallBlock extends RunningToolCallHead {
  readonly phase: 'start'
  readonly argsRaw: string
}

/** One content block in a durable tool result. */
export interface ContentBlockLike {
  readonly type: string
  readonly text?: string
}

/** Stage data of a settled call. */
export interface ToolResultBlock {
  readonly kind: 'tool-result'
  readonly seq: number
  readonly time: number
  readonly callId: string
  readonly name: string
  readonly content: readonly ContentBlockLike[]
  readonly isError: boolean
  readonly error?: { readonly name: string; readonly code: string; readonly reason?: string }
  readonly meta?: unknown
  readonly call: { readonly name: string; readonly argsRaw: string } | null
  readonly subCalls: readonly unknown[]
}

/** Public input action face supplied to every session-scope slot component. */
export interface InputActionsFace {
  setDraft(text: string): void
  submit(): void
}

/**
 * Standard session-scope props plus the keyed Tool view owner props.
 * `tool.call.toolview` is `{ kind: 'keyed', scope: 'session' }`, so the
 * component receives the bound session id and the official input actions.
 */
export interface ToolViewProps {
  readonly sessionId: string
  readonly callId: string
  readonly toolName: string
  readonly cwd?: string
  readonly inputActions?: InputActionsFace
  readonly phase: 'preparing' | 'start' | 'result'
  readonly block: PreparingToolCallBlock | StartedToolCallBlock | ToolResultBlock
}
