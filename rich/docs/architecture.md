# dsh-rich-response architecture (Phase 1, DSH 0.2.1-rc.2)

Status: formal Phase 1 MVP. Fixed target: DeepSeek Harness `0.2.1-rc.2`
(tag `dsh-v0.2.1-rc.2`, commit `687f282e8625c6b8d11ff58211a90524be2e4317`).
No compatibility with older DSH releases is attempted.

## 1. Problem and constraint

DSH 0.2.1-rc.2 renders assistant text through a closed Markdown pipeline:
`AssistantBlock` is a closed union and `AssistantMarkdown` is a closed switch, so a
plugin cannot inject arbitrary React between Markdown blocks (Phase 0,
SOURCE_VERIFIED). The supported additive surface for a rich visual is therefore a
**tool result card**: a tool call in the transcript, rendered through the keyed
slot `tool.call.toolview`, dispatch keyed by the wire tool name.

This plugin is exactly that:

```
model -> tool call rich_render(payload) -> Host validates + persists canonical payload
      -> tool/result (content + meta)   -> Client keyed toolview rebuilds the visual
      -> user interaction               -> Host audit command + session message
```

No custom Chat node, no DOM scanning, no assistant-block replacement, no custom
Remote/Typert method (which is BLOCKED for third parties in 0.2.1-rc.2).

## 2. Layers

```
src/
  shared/                  dependency-free contracts used by BOTH halves
    protocol.ts            RichContentV1 types, limits, envelope, interaction types
    validation.ts          content validation + meta envelope reading + summaries
    interaction.ts         interaction payload validation, card keys, attempt ids
    index.ts               single import site
  host/                    Node side of the Cordis plugin
    index.ts               name/inject/apply; registers tool + command under effects
    tools/rich-render.ts   the `rich_render` agent tool
    tools/rich-interaction.ts  the `rich-interaction` audit command
    audit.ts               bounded attempt tracker + JSONL audit append
    types.ts               structural Host contracts (no harness runtime imports)
  client/                  browser side of the Cordis plugin
    index.ts               entry: name/inject/apply re-export (module-table factory)
    apply.ts               one keyed `tool.call.toolview` registration
    toolview.tsx           card shell + stage machine + interaction state machine
    interactions.ts        official session command + official session submission
    contract.ts            structural Client contracts (slot props, services)
    renderers/             line/scatter/diagram/message-card SVG renderers
```

Boundary rules:

* `shared` must stay runtime-dependency-free (it is bundled into both artifacts).
* `host` imports only `node:` builtins at runtime; harness packages are type-only
  in documentation terms and never imported (the bundle must resolve inside a
  profile whose node_modules contains only this package plus the DSH release).
* `client` imports only `react` and `react/jsx-runtime`, resolved from the DSH
  browser module table. It never imports another plugin's runtime values.
* Host and Client both validate the same payload with the same code; the Host is
  authoritative, the Client re-checks because persisted data is still untrusted.

## 3. Host half

### 3.1 Loading

`package.json` declares `dsh.bundle.patch: ./cordis.patch.yml` and `dsh.client`.
The bundle patch inserts one Loader row:

```yaml
- insert:
    - id: dsh-rich-response
      name: 'dsh-rich-response'
      config:
        auditLog: !!js process.env.DSH_RICH_RESPONSE_AUDIT_LOG
        maxTrackedAttempts: 512
```

`auditLog` is operator configuration. It is never derived from model output; when
unset the Host only uses the Cordis logger.

### 3.2 `rich_render` tool

Registered as a plain `ToolDefinition` (`ctx.tools.register`), not via
`defineTool`, so the bundle needs no harness runtime package:

* `parameters`: **raw model-facing JSON Schema** `{ content: object }`. A plain
  `ToolDefinition` forwards `parameters` straight to the provider; the author-side
  schema DSL is only compiled by `defineTool` and would be invalid on the wire.
* `output.schema`: raw JSON Schema for the canonical value `{ content, summary }`.
* `execute`: validates the candidate with `validateRichContent`; invalid input
  throws (the registry materializes a structured tool error, which the card shows
  as the failure state). Valid input returns the canonical, normalized payload.
* `output.render`: one bounded text block (`summarizeRichContent`) used as the
  model-facing result.
* `output.presentationMeta`: the durable envelope
  `{ kind: 'rich-response', envelopeVersion: 1, content }`. The registry persists
  it on the `tool/result` session event, which is what makes the card replayable.

### 3.3 `rich-interaction` command

A human command (`ctx.commands.register`) invoked by the card through the official
`remote.commands` face. It is not a model tool. It:

1. rejects oversized/malformed JSON and invalid payloads;
2. requires `payload.sessionId === invocation.agent.id` (in 0.2.1-rc.2 the agent id
   **is** the session id), so a card can never post into another session;
3. rejects submissions whose client timestamp is more than 10 minutes off (stale
   event) and whose `cardKey` does not match `(callId, questionId)`;
4. marks duplicate `attemptId`s (bounded FIFO set of 512) and reports
   `(duplicate)` in its ack;
5. appends one JSONL audit record when configured, and always writes a bounded
   Host log line.

The durable `command/run` / `command/done` events for the original session are the
primary evidence; the JSONL file is a convenience secondary record.

## 4. Client half

### 4.1 Artifact format

`lib/client.js` is a plain browser script produced by esbuild (CJS) and wrapped
verbatim in the documented module-table handoff:

```js
window.__ModuleLoader__.load({ id: "dsh-rich-response", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  /* bundled CJS body, require("react") / require("react/jsx-runtime") */
  return module.exports;
} });
```

The factory owns only React; the module exports `{ name, inject, apply }`, which
Cordis instantiates like any client plugin.

### 4.2 Slot registration

```ts
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({ name: 'tool.call.toolview', key: 'rich_render' }, ToolView))
```

`tool.call.toolview` is `kind: 'keyed'`, `scope: 'session'`: the keyed dispatch
value is the wire tool name, and the component receives the owning session id plus
the standard session props (`inputActions`, `useSession`, `useProjection`,
`useAccess`, `useConversation`, `useInput`). Registering the same key twice would
replace the cell; using `inject` ties the registration to the declaration lifetime
and removes it when the plugin is disabled.

### 4.3 Stage machine

| Stage | Data available | Card behaviour |
|---|---|---|
| `preparing` | `block.name`, lazy partial args | bounded "preparing rich content..." note; no partial JSON rendering |
| `start` | `block.argsRaw` (complete arguments) | parse + validate and render a live preview |
| `result` | `block.meta` = persisted envelope, `block.content`, `block.isError`, `block.error` | authoritative render |

Result-phase precedence:

1. `isError` -> error card with code/message (failure and interruption);
2. `meta.kind === 'rich-response'` and `schemaVersion !== 1` -> explicit
   "unsupported version" card with collapsed raw payload (never render it);
3. valid envelope -> renderer;
4. invalid payload -> bounded validation diagnostic (never throw);
5. foreign/missing meta -> generic "no rich payload" card.

A class error boundary isolates each renderer, so one broken card cannot take down
the transcript.

### 4.4 Persistence and replay

The visual is a pure function of the persisted `tool/result` event. There is no
localStorage, no React-memory-only state, and no Host temporary object in the
render path. Consequences:

* browser refresh, session switch, and history replay rebuild the same static card;
* interaction results (`interacted`, ack text) are **ephemeral UI state**; they are
  not persisted and are not presented as learning results;
* the durable interaction record lives on the Host (`command/run`/`command/done`,
  optional JSONL), keyed by `(sessionId, callId, cardKey, attemptId)`.

### 4.5 Interaction closure

A click on a `message_card` action performs two officially supported operations in
order:

1. `ctx.remote.commands.execute(originalSessionId, '/rich-interaction <json>', [])`
   — official Remote command namespace addressed to the original session;
2. `inputActions.setDraft(text)` + `inputActions.submit()` — the official
   per-session composer face, producing a real user message in the original
   session (never `sessions.create`).

The card disables itself while a submission is in flight and after success, keeps a
monotonic request sequence so a late callback cannot overwrite newer state, and
ignores state updates after unmount. `attemptId` makes duplicate delivery
observable instead of silently hidden.

## 5. Build chain

```
src/host/index.ts   --esbuild--> lib/index.js    Node ESM, node:* only
src/client/index.ts --esbuild--> lib/client.js   browser CJS + module-table wrapper
```

Why esbuild: one dependency, no config framework, native TS/TSX, explicit
externals, deterministic output, and the wrapper is a two-line banner/footer that we
control. The upstream monorepo uses `tsdown` with a repository-internal wrapper
plugin; reproducing that plugin is unnecessary for a third-party package.

Guarantees enforced by `scripts/build.mjs` on every build:

* the client bundle starts with the exact `__ModuleLoader__.load` handoff and ends
  with the factory close;
* exactly one entry id (`dsh-rich-response`);
* `module.exports = __toCommonJS(...)` survived the wrapper;
* only `react` / `react/jsx-runtime` are required from the module table, never
  `react-dom` or a harness package;
* the host bundle has no non-`node:` imports and no `@deepseek-ai/` specifiers;
* both artifact sizes and the client SHA-256 are printed for the record.

`package-lock.json` pins the toolchain (TypeScript 5.9.3, esbuild 0.28.2,
`@types/react` 18, React dev-only 18.3.1 for renderer tests). React is **never**
bundled into a shipped artifact.

## 6. Compatibility notes (0.2.1-rc.2)

* Model-facing schemas are raw JSON Schema; the author DS L is not used.
* The agent id used by the Host command equals the session id, which is what makes
  the cross-session check exact.
* The keyed slot receives `phase`/`block` shapes as documented in
  `docs/host-client-api.md`; no field beyond that contract is depended on.
* No custom `@Remote`/Typert method is defined (third-party generation is BLOCKED);
  only the published `remote.commands` namespace and the official session input
  face are used.

## 7. Related documents

* `docs/protocol-v1.md` — RichContentV1 data protocol and validation.
* `docs/host-client-api.md` — verified extension-point contract with source refs.
* `docs/security-model.md` — threat model and mitigations.
* `docs/integration-guide.md` — build, install, start, test, uninstall.
