# Security model — dsh-rich-response (Phase 1)

| | |
|---|---|
| Scope | Host half (`rich_render` tool, `/rich-interaction` command), Shared validator, Client tool view and SVG renderers |
| Target harness | DeepSeek Harness `0.2.1-rc.2` |
| Protocol | [protocol-v1.md](protocol-v1.md) |
| Status | Phase 1 security review, 2026-10 |

## 1. Trust boundary

**Model output is untrusted data.** A `RichContentV1` payload is produced by the
language model and persists into the session transcript, browser storage, and
(replayed) history. It is treated like any other untrusted input:

* the **Host** validates it before the tool call succeeds and before anything is
  persisted (`createRichRenderTool` → `validateRichContent`);
* the **Client** validates the persisted `meta` envelope again before anything
  reaches React (`readRichMeta` → `validateRichContent` → renderer);
* the renderer treats the already-validated payload as structured numbers,
  enums, and plain text only.

Second trust boundary: **persisted data may be stale or tampered with.**
`tool/result.meta` is plain JSON in the session store. A user or operator with
access to that store can modify it; the Client therefore never trusts it and
re-validates the complete envelope. Invalid or foreign meta degrades to a
bounded diagnostic card.

Non-boundary: the Client bundle executes as same-origin JavaScript inside the
DSH web client. It is not a sandbox against malicious same-page scripts, and it
does not try to be. Its job is to keep *model-authored data* and *persisted
data* from becoming markup, script, or network requests in the trusted page.

## 2. Structurally impossible in v1

The protocol's data model has no representation for the following, so no
validation bypass can introduce them:

In short: a valid payload can express **no HTML source, no SVG source, no URLs,
no executable code, no external resources, and no file paths**; it is bounded
text, allow-listed enums, and finite numbers.

| Capability | Why it is impossible |
|---|---|
| HTML source (`innerHTML`, `dangerouslySetInnerHTML`) | no renderer uses it; payload has no markup field |
| SVG source / arbitrary SVG attributes | renderers build `<svg>`, `<g>`, `<polyline>`, `<circle>`, `<text>`, … as JSX; no payload string is used as an element or attribute name |
| URLs / hyperlinks / remote images | no `href`, `src`, `xlink:href`, `<image>`, or `<use>` is ever emitted; no payload field accepts a URL |
| Executable code (`eval`, `Function`, `import()`) | no dynamic code evaluation exists in the plugin; payload values only flow into React props/children |
| CSS values / CSS functions | colors are restricted to `#rgb`/`#rrggbb`; the only style values are fixed literals and validated colors |
| File paths / filesystem access | the client has no filesystem API; the Host only writes an operator-configured audit path (§7) |
| External resources / network calls | the client makes no `fetch`/`XHR`/websocket calls; the only network face used is the official `remote.commands.execute` for the interaction command |
| Event-handler attributes (`onerror`, `onclick`, …) | React attaches handlers from the renderer's own function props, never from payload strings |
| Data exfiltration channels | rendering one card performs no request; the interaction command sends only the bounded payload in §10 of the protocol |

## 3. XSS / SVG-injection defense in depth

1. **Schema-level typing.** Titles, labels, body, and names are plain strings
   (bounded and trimmed). No field accepts markup. Enums (`shape`, `tone`,
   `type`) and numeric geometry are allow-listed.
2. **Color allow-list.** `HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`.
   Values such as `url(javascript:…)`, `red;background:url(…)`,
   `expression(…)`, or `rgb(…)` are rejected with `INVALID_COLOR` before
   rendering (covered by `protocol-validation.test.ts`).
3. **React text nodes.** Model text reaches the DOM only as JSX children
   (`{content.title}`, `{label}`, …). React escapes it; it cannot become markup
   or attribute syntax. Attributes that carry model text (`aria-label`,
   `data-dsh-rich-*` diagnostics) are set through React props, which are also
   escaped/serialized by React.
4. **Renderer-built SVG.** Charts and diagrams compute geometry from validated
   finite numbers (`formatCoordinate`, integer grid) and emit only fixed element
   types. There is no path where a payload controls an element name, an
   attribute name, an URL, or raw SVG text.
5. **Error containment.** Each card body is wrapped in a React error boundary;
   if a renderer throws, the conversation shows a bounded failure card instead
   of a broken transcript.
6. **Re-validation on replay.** The tool view reads the durable
   `meta.kind === 'rich-response'` envelope, then `validateRichContent(content)`.
   Foreign meta, invalid content, and unsupported versions render explicit
   diagnostic/fallback states and never the raw visual.

## 4. Resource limits and denial of service

The payload cap is enforced on the whole serialized candidate; the Host executes
`execute()` on the model's arguments and therefore the first validation is a
hard gate. Limits are listed exactly in [protocol-v1.md §9](protocol-v1.md#9-limits).

Defenses:

* **Cheap cardinality gate first.** Series count, per-series point count, total
  points, node/edge/action counts are checked from array length before the byte
  serialization and before any per-element work. A 100k-point payload is
  rejected by `TOO_MANY_POINTS` in microseconds; a 100k-series payload by
  `TOO_MANY_SERIES`; the elements are never read
  (`protocol-dos.test.ts` uses throwing proxy elements to prove this).
* **UTF-8 byte cap.** 256 KiB measured with `TextEncoder`; multibyte padding is
  counted correctly.
* **Total validation is bounded.** Maximum allowed payload = 8 series × 8192
  points, bounded by the byte cap; observed validation time is a few
  milliseconds.
* **Total by construction.** Validation never throws: cyclic graphs, BigInt,
  symbols, functions, throwing accessors, and proxies all produce a normal
  `{ ok: false }` / `undefined` result (hostile-value tests). `serializedByteSize`
  returns `Infinity` for non-JSON values and the caller reports
  `PAYLOAD_TOO_LARGE`.
* **Diagnostics bounded.** At most 8 issues + `(+N more)` and short fixed
  details; no unbounded model text is echoed into logs.
* **Command input bounded.** The raw `/rich-interaction` payload is capped at
  8192 characters before `JSON.parse`.
* **Renderer DOM bounded.** At most 8 × 2048 marks; interactive hit targets are
  capped (`MAX_LINE_HIT_TARGETS = 500` for line charts), keeping the DOM
  proportional to validated input and no larger.
* **Duplicate-attempt memory bounded.** `AttemptTracker` retains at most
  `maxTrackedAttempts` (default 512) identities.

## 5. Cross-session submission defense

An action click does two things: (1) submits the interaction payload to the Host
command addressed to the **originating session**, (2) optionally submits the
action's `submitText` as a normal user message through the official
session-scoped input face. The Host command re-checks every property:

| Defense | Implementation |
|---|---|
| Session binding | `payload.sessionId` must equal `invocation.agent.id` (the session id in 0.2.1-rc.2); a payload from another card/session is rejected with `session mismatch` before recording |
| Card binding | `payload.cardKey` must equal `cardKeyFor(callId, questionId)` recomputed Host-side; a mismatched identity is rejected |
| Freshness | `submittedAt` must be a strict ISO-8601 UTC instant; `abs(now − submittedAt) > 10 min` is rejected as stale (future-dated clicks included) |
| Replay/duplicate visibility | `attemptId` is unique per click (`crypto.randomUUID` where available); the Host returns success with `(duplicate)` when it has already observed the attempt, and records `duplicate: true` in the audit log |
| Shape validation | full shared payload validation (protocol marker/version, safe-id actionId/questionId, bounded strings, timestamp format) before any identity check |
| Command input bound | 8192-character raw input cap |
| Client pre-check | the client refuses to send when the payload's session id differs from its bound session, and validates locally before the round-trip |

The card's rendered action list comes only from validated, bounded action ids;
the choice submitted is the id, and the follow-up text is that action's
validated `submitText`.

## 6. Persistence tampering

* Persisted `meta` is data, not code. A tampered payload still has to pass the
  full validator; malformed values produce a fallback card.
* A tampered but *valid* payload can change what the card displays (title,
  numbers, action labels) to anyone opening that session. This is the same trust
  domain as the transcript itself: anyone who can rewrite the session store can
  rewrite ordinary messages too. The plugin does not claim integrity of the
  session store.
* History replay is deterministic: the same envelope always rebuilds the same
  static visual because the complete normalized payload is persisted; the client
  renders nothing from live state.
* Interaction state is intentionally **not** persisted in the payload. A
  replayed card therefore looks clickable again; duplicate clicks are made
  observable by `attemptId` dedupe rather than by hiding buttons. This is a
  usability/consistency trade-off, not a privilege issue.
* A persisted envelope with `kind: "rich-response"` but an unknown content
  schema version is explicitly rejected by the client and never rendered.

## 7. Host audit-log write path

The optional JSONL audit sink is **operator-configured only**: it comes from
`HostConfig.auditLog` in the profile patch (`cordis.patch.yml`), never from
model output, tool arguments, or card payloads.

* Directory creation + append are best-effort: any filesystem error is caught,
  logged as a warning, and the user-visible command outcome stays `success`
  (an audit outage is not a user-facing failure). Covered by the
  "unwritable path" host test.
* Each line is `JSON.stringify(record) + "\n"`, so payload text cannot break out
  of the JSON structure or inject extra lines.
* The record contains the interaction payload plus `receivedAt`, `agentId`, and
  `duplicate`. It carries nothing beyond what the user already saw on the card
  plus the follow-up text they chose.
* File permissions, rotation, retention, and remote shipping are the operator's
  responsibility; the plugin only appends.

## 8. Dependency surface and supply chain

* **Zero runtime dependencies.** `package.json` has no `dependencies` field.
  The Host bundle imports only `node:fs` and `node:path`; the Shared validator
  uses only language built-ins (`JSON`, `TextEncoder`, `Object`, `Number`).
* React is provided by the Host web client at runtime: the client bundle leaves
  `react` / `react/jsx-runtime` external and obtains them from the harness
  module table. No `react-dom` is required by this plugin.
* Development-time tooling is pinned exactly (`typescript`, `esbuild`,
  `@types/*`, `react` for tests) in `devDependencies`; there is no runtime
  dependency tree to audit, no post-install execution surface in production, and
  no network access at load time.
* The Host plugin never imports harness runtime packages; it consumes a
  documented structural slice of the Cordis context (`src/host/types.ts`), which
  keeps the installed artifact small and avoids version-coupling surprises.

## 9. Residual risks

Severity reflects impact × likelihood inside the DSH desktop/web trust model.
All are accepted for Phase 1 unless stated otherwise.

| ID | Severity | Risk | Status / rationale |
|---|---|---|---|
| R1 | Medium | A compromised same-origin script in the web client can call the interaction command directly with arbitrary valid-looking payloads (it can mint `sessionId`, `attemptId`, `submitText`). Session binding prevents *cross-session* writes, but a script inside the same page already belongs to the trusted UI. | Accepted: same-origin scripts are outside the threat boundary; the command still enforces shape, identity, freshness, dedupe, and audit. |
| R2 | Low | The model can place sensitive-looking or misleading text into a card body/title/labels, which then persists in the transcript. | Accepted: this is ordinary model text output; no new exfiltration channel is added (no URL, no request, no file access). |
| R3 | Low | Audit append is best-effort: an unwritable/full path silently loses audit records (warning only). | Accepted: audit must never break the user flow; operators monitoring the log path should alert on the warning. |
| R4 | Low | Duplicate detection is a bounded FIFO (default 512 attempts). A replay outside the window is recorded as a new interaction. | Accepted: a duplicate is a UX signal, not a privileged action; the follow-up message is still a normal user message. |
| R5 | Low | A valid-but-tampered payload in the session store can change what a historical card displays. | Accepted: same trust domain as the transcript; structural validation prevents code/markup injection. |
| R6 | Low | Staleness uses the client-minted `submittedAt`; a heavily skewed client clock causes rejection (availability), and a forged fresh timestamp is accepted. | Accepted: the timestamp only bounds how long a click can be replayed; identity binding is the security control. |
| R7 | Low | Rendering the maximum allowed chart (8 × 2048 points) is CPU/GPU work on low-end devices. | Mitigated: byte/series/point caps, hit-target caps, and memoized models keep work bounded and predictable. |
| R8 | Low | A future renderer change could accidentally introduce an unsafe sink (e.g. a payload string used as an href or raw HTML). | Mitigated by review + tests: the client source currently contains no `dangerouslySetInnerHTML`/`innerHTML`/`href`/`src`/`eval`/`new Function`; the renderer contract is "fixed primitives + escaped text only". |
| R9 | Low | Dev-time dependency compromise (esbuild/typescript/@types) could alter build output. | Mitigated by exact version pins and a zero-runtime-dependency artifact; full supply-chain provenance is out of Phase 1 scope. |
| R10 | Info | `-0` and unknown extra keys are normalized/rejected rather than preserved; not a security issue, documented for interoperability. | Accepted, documented in the protocol. |

## 10. Verification map

| Claim | Test |
|---|---|
| Untrusted payloads never throw (cyclic, BigInt, proxies, accessors) | `tests/unit/protocol-validation.test.ts` |
| Rejection matrix, codes, bounded paths, color/CSS injection | `tests/unit/protocol-validation.test.ts` |
| Envelope guards, foreign meta, JSON replay determinism | `tests/unit/protocol-envelope.test.ts` |
| Oversized/100k-element inputs fail fast without per-element work | `tests/unit/protocol-dos.test.ts` |
| Documented examples and limits/codes stay in sync with the code | `tests/unit/protocol-docs.test.ts` |
| Interaction payload shape/safe-id/ISO-time rules | `tests/unit/interaction.test.ts` |
| Session mismatch, staleness, cardKey, duplicate, oversized input, audit best-effort | `tests/unit/host.test.ts` |
