# Host / Client extension contracts used by dsh-rich-response

Fixed source: `dsh-v0.2.1-rc.2` = `687f282e8625c6b8d11ff58211a90524be2e4317`.
All paths below are relative to the upstream repository root; the read-only
checkout used for this audit is
the DSH upstream source checkout.

Evidence grades: **SOURCE_VERIFIED** = read in the fixed source; **RUNTIME_VERIFIED**
= observed in a running isolated DSH 0.2.1-rc.2 (see reports/evidence);
**NOT_VERIFIED** = not yet demonstrated.

## 1. Client bundle handoff

| Fact | Evidence | Source |
|---|---|---|
| A client package declares `dsh.client` (`platform: 'web'`, optional `inject`/`immediately`) and exports its built bundle at `exports["./client"]` | SOURCE_VERIFIED | `docs/subsystems/client-modules.md` §The scan |
| Bundle is a plain script calling `window.__ModuleLoader__.load({ id, factory })`; `id` is the package name | SOURCE_VERIFIED | `docs/subsystems/client-modules.md` §The wire; `packages/client/tsdown.client.ts:664` |
| Factory receives `require(specifier)` resolved from the browser module table (baseline modules include `react`, `react/jsx-runtime`, shipped client packages) | SOURCE_VERIFIED | `packages/client/modules/src/client/system.ts`, shipped bundles (e.g. `@deepseek-ai/dsh-client-ui-tool/lib/client.js` line 1) |
| Exports of the factory module are the Cordis client plugin (`inject`, `apply`) | SOURCE_VERIFIED | shipped `lib/client.js` bundle tails |

This plugin emits exactly that shape; `scripts/build.mjs` asserts it on every build.

## 2. `tool.call.toolview` slot

| Fact | Evidence | Source |
|---|---|---|
| Declaration: `kind: 'keyed'`, `scope: 'session'`, owner `ToolCallOwnerProps` | SOURCE_VERIFIED | `packages/client/ui-tool/src/client/contract/slots.ts:26-30` |
| The dispatch key is the wire tool name (`entryKey: toolName`, fallback generic row) | SOURCE_VERIFIED | `packages/client/ui-tool/src/client/tool/ToolCallTree.tsx:44-57` |
| `ToolCallTree` derives the phase from `ToolCallBlock`: `kind` in block -> `result`, otherwise `preparing`/`start` | SOURCE_VERIFIED | `ToolCallTree.tsx:9-12`, `:20-58` |
| Owner props: `callId`, `toolName`, `cwd?`, `home?`, `openFile`, `loadImage`, `useDisclosure`, `inspect?`, plus the phase-discriminated `block` | SOURCE_VERIFIED | `slots.ts:59-85` |
| `preparing` block: `callId,name,turn,step,time,subCalls,args` (lazy partial reader) | SOURCE_VERIFIED | `packages/client/ui-conversation/src/client/contract/records.ts:270-307` |
| `start` block: same plus complete `argsRaw` | SOURCE_VERIFIED | `records.ts:303-307` |
| `result` block (`ToolResultNode`): `kind:'tool-result'`, `seq,time,callId,name,args,call,content,isError,error?,meta?,subCalls` | SOURCE_VERIFIED | `records.ts:160-183` |
| A session-scope slot additionally receives `sessionId`, `useSession`, `useProjection`, `useAccess`, `useConversation`, `useInput`, `inputActions` | SOURCE_VERIFIED | `packages/client/ui-conversation/src/client/contract/slots.ts:330-347`; `docs/subsystems/slots.md` §Framework-provided hooks |
| Registration uses `ctx.slots.inject(key, cb)` + `ctx.slots.register({ name, key }, Component)`; effects dispose with the declaration lifetime | SOURCE_VERIFIED | `docs/subsystems/slots.md` §Declaration and lifecycle |

Consequences used by this plugin:

* the registered component must be a plain React component function; it receives
  **owner props only** (no `ctx`), so the plugin keeps one `ctx` reference in the
  `apply` closure and passes it to the component factory;
* `block.args` is a lazy partial reader; this plugin only renders a bounded
  "preparing" note in that stage and never parses partial JSON;
* `block.meta` on the result stage is the only visual data source.

## 3. Tool result persistence

| Fact | Evidence | Source |
|---|---|---|
| `ToolOutputDefinition.presentationMeta?(args, value)` is a pure projection persisted with the session log | SOURCE_VERIFIED | `packages/core/tools/src/index.ts:214-222`; `docs/subsystems/tools.md` §ToolOutputDefinition |
| The registry materializes `meta` (snapshot + JSON validation) immediately before `tools/result` | SOURCE_VERIFIED | `packages/core/tools/src/index.ts:1853-1860` |
| The agent loop records the presentation meta on the durable `tool/result` event | SOURCE_VERIFIED | `packages/core/agent-loop/tests/coverage-edges.spec.ts:373` ("records a presentationMeta payload on the tool/result event") |
| A successful canonical value is execution-local only; the durable event carries `content`, `error`, and `meta` | SOURCE_VERIFIED | `docs/subsystems/tools.md` §Execution |
| A plain `ToolDefinition`'s `parameters` are passed through to the model-facing schema (author DSL is compiled only by `defineTool`) | SOURCE_VERIFIED | `packages/core/tools/src/index.ts:1290-1302`; `docs/subsystems/tools.md` §The unified JSON-value schema DSL |

Therefore the card is a pure function of the persisted `tool/result`. Refresh,
session switch, and replay rebuild it with no live state.

## 4. Interaction path

### 4.1 Remote command namespace

| Fact | Evidence | Source |
|---|---|---|
| `ctx.remote.commands.execute(sessionId, line, attachments)` returns a `RemoteResult` whose value is `{ result: CommandResult }` | SOURCE_VERIFIED | `packages/client/ui-commands/src/client/service.ts:418-433`; `packages/interaction/commands/src/types.ts` |
| Command lines are addressed to the session's agent; the Host durably logs `command/run`/`command/done` | SOURCE_VERIFIED | `service.ts:9-14` (comment), `docs/subsystems/commands.md` |
| `CommandInvocation.agent.id` is the session id | SOURCE_VERIFIED | `packages/core/agent/src/types.ts:14-18` (`Agent { readonly id: SessionId }`), `packages/interaction/commands/src/types.ts` |
| Host command registration: `ctx.commands.register({ name, description, input?, recordInput?, handler })` | SOURCE_VERIFIED | `packages/interaction/commands/src/index.ts`, `docs/subsystems/commands.md` |

This is the only cross-process channel used for interactions. No custom
`@Remote`/Typert method is generated (third-party generation is BLOCKED in
0.2.1-rc.2).

### 4.2 Same-session submission

| Fact | Evidence | Source |
|---|---|---|
| `inputActions` is the official input face supplied to every session-scope slot component: `setDraft`, `insertText`, `addAttachments`, `submit()` | SOURCE_VERIFIED | `packages/client/ui-conversation/src/client/contract/input.ts:241-269` |
| The client session face also exposes `ISession.prompt(content, mode, signal?, requestId?)` addressed by session id | SOURCE_VERIFIED (source) | `packages/api/session-controller/src/client/contract/session.ts:79-92` |
| Creating a new session is not required for a follow-up message | SOURCE_VERIFIED | same |

Phase 1 uses `inputActions.setDraft` + `submit()` because it is the face actually
provided to slot components; the follow-up message therefore belongs to the
rendered session by construction. The session id is additionally sent in the audit
payload and compared to the receiving agent id.

## 5. Host plugin loading

| Fact | Evidence | Source |
|---|---|---|
| A bundle's `dsh.bundle.patch` points at a YAML patch applied to the profile Loader | SOURCE_VERIFIED | Phase 0 PoC (REAL load), `docs/subsystems/boot.md` |
| `cordis.patch.yml` supports `- insert: [{ id, name, config }]`, `- id: <row>` config overrides and `disabled: true` | SOURCE_VERIFIED | Phase 0 PoC + profile bundle patches |
| `!!js` expressions are allowed in patch values and evaluate in the Loader process | SOURCE_VERIFIED | profile/user patch documentation; used for `process.env.DSH_RICH_RESPONSE_AUDIT_LOG` |
| A plugin without an exported `Config` schema receives its raw `config` object | SOURCE_VERIFIED (Phase 0 PoC runtime) | Phase 0 PoC `index.js` |

## 6. Data validation

| Fact | Evidence | Source |
|---|---|---|
| `output.schema` is enforced against every successful canonical value | SOURCE_VERIFIED | `docs/subsystems/tools.md` §ToolDefinition |
| Enforced raw JSON Schema subset: `type`, `oneOf`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, annotations. No numeric bounds. | SOURCE_VERIFIED | `packages/core/tools/src/schema.ts`; `docs/subsystems/tools.md` §The enforced raw JSON Schema subset |
| Invalid canonical output becomes a JSON-safe `isError` result | SOURCE_VERIFIED | `docs/subsystems/tools.md` §ToolDefinition |

Because the raw subset cannot express numeric bounds or collection caps, all
semantic limits live in `validateRichContent` (Shared), which runs in `execute`
before a value is returned.

## 7. Not verified in this document

* The exact keyed-slot re-registration behaviour during plugin disable/enable in
  the live Web client (Phase 0 observed overlay enable/disable; this plugin's
  lifecycle is covered by the Phase 1 e2e matrix where possible).
* `ISession.prompt` end-to-end from a slot component (source-verified only; the
  Phase 1 interaction uses `inputActions` instead).
* Model-driven tool calls (no production model credentials); a deterministic local
  Messages-compatible provider is used for the end-to-end runs. This is a test
  harness fact, not a plugin contract.
