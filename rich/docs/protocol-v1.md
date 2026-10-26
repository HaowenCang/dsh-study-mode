# RichContentV1 — protocol specification

| | |
|---|---|
| Status | Phase 1, implemented |
| Target harness | DeepSeek Harness `0.2.1-rc.2` (fixed tag `dsh-v0.2.1-rc.2`) |
| Content schema version | `1` (`RICH_CONTENT_SCHEMA_VERSION`) |
| Persisted meta envelope version | `1` (`RICH_META_ENVELOPE_VERSION`) |
| Interaction protocol marker | `rich-interaction-v1` (`RICH_INTERACTION_PROTOCOL`) |
| Implementation | `src/shared/protocol.ts`, `src/shared/validation.ts`, `src/shared/interaction.ts` |
| Threat model | [security-model.md](security-model.md) |

`RichContentV1` is the single declarative payload rendered by this plugin. It is
emitted as the JSON argument of the `rich_render` tool, validated by the Host
before persistence, validated again by the Client before React, and stored
verbatim in the tool result's durable `meta` so that a reload or history replay
rebuilds the identical static visual.

Every payload is untrusted model output. The protocol therefore admits only
bounded, finite, lossless JSON data: **no HTML, no SVG source, no URLs, no
executable expressions, no file paths, and no color strings other than hex
literals.**

## 1. Persistence and rendering contract

1. The model calls `rich_render` with `{ "content": <RichContentV1> }`.
2. The Host validates `content` with `validateRichContent()`. On failure the
   tool call fails with a bounded diagnostic listing the stable issue codes; the
   model can correct and retry.
3. On success the canonical tool value is `{ content, summary }` and is
   persisted as the `tool/result` value. `content` is the **normalized**
   payload (see §3); `summary` is a short human-readable string (for example
   `line_plot "Sine wave": 1 series, 9 points`) and is the only part that ever
   reaches the model-facing tool content.
4. `output.presentationMeta` projects the durable envelope into the persisted
   `meta` field:

   ```json envelope
   {
     "kind": "rich-response",
     "envelopeVersion": 1,
     "content": {
       "schemaVersion": 1,
       "type": "message_card",
       "title": "Deploy to staging?",
       "body": "The build passed all unit tests."
     }
   }
   ```

   `meta` is the **only** source of the visual after a reload. The Client reads
   it through `readRichMeta()`, which returns `undefined` for foreign, malformed,
   or unsupported-version meta. The Client then falls back to a bounded
   diagnostic card — it never renders unvalidated data.
5. **Interaction state is explicitly separate.** Nothing about clicks, attempts,
   or settled actions is stored in the payload. A replayed card is a fresh
   static visual; a click produces a separate Host command invocation and an
   operator-configured audit record (§10). This keeps history replay pure: the
   same `meta` always rebuilds the same pixels.
6. If `meta` carries a content object whose `schemaVersion` is present but not
   `1`, the Client shows an explicit "unsupported rich content version" fallback
   and does not render it. Missing `schemaVersion` is a validation failure.

## 2. JSON conventions

* The payload must be a plain JSON object (not `null`, not an array, not a
  primitive). Objects are accepted only with `Object.prototype` or a null
  prototype; class instances and `__proto__` carriers are rejected.
* All text is UTF-8 JSON. String fields are trimmed before storage; a field that
  is only whitespace is rejected.
* Unknown/extra object keys are ignored: they are dropped from the canonical
  value and are not persisted. They are never copied into output objects.
* Numbers must be finite canonical JSON numbers. `NaN`, `+Infinity`,
  `-Infinity`, and `-0` are rejected (`-0` is not canonical: `JSON.stringify(-0)`
  is `"0"`). Coordinates and explicit axis bounds must satisfy
  `|value| <= 10000000`.
* Colors, where accepted, must match `#rgb` or `#rrggbb` (case-insensitive hex).
* Identities (`questionId`, diagram node ids, action ids) must match
  `[A-Za-z0-9._:-]{1,64}`.
* Validation never mutates its input and accepts deeply frozen payloads.

### Validation order

Validation is deliberately ordered so adversarial sizes fail fast:

1. top-level object check (`NOT_AN_OBJECT`);
2. `schemaVersion` check (`UNSUPPORTED_SCHEMA_VERSION`);
3. `type` check (`UNKNOWN_TYPE`);
4. type-specific **cardinality pre-scan** that reads only container lengths
   (`TOO_MANY_SERIES`, `TOO_MANY_POINTS`, `TOO_MANY_TOTAL_POINTS`,
   `TOO_MANY_NODES`, `TOO_MANY_EDGES`, `TOO_MANY_ACTIONS`);
5. whole-payload UTF-8 byte size (`PAYLOAD_TOO_LARGE`);
6. title/subtitle plus deep type-specific validation (points, colors, axes,
   node/edge references, actions).

A 100k-point payload is therefore rejected by array length (`TOO_MANY_POINTS`)
without serializing it or touching an element. A structurally valid payload that
is merely padded past the byte limit is rejected as `PAYLOAD_TOO_LARGE`.

## 3. Normalization

A successfully validated payload is returned as a freshly built canonical
object:

* `schemaVersion` is always `1`; `type` is the validated discriminant;
* title/subtitle/body/name/label/unit/submitText are trimmed;
* optional fields are omitted, not set to `undefined` (deep equality is stable);
* object keys in the canonical value follow the interface order;
* unknown keys are dropped;
* the canonical value round-trips losslessly through `JSON.stringify()` /
  `JSON.parse()` byte-identically.

## 4. Common fields

| Field | Type | Required | Rule |
|---|---|---|---|
| `schemaVersion` | number | yes | exactly `1`; any other value or a missing value is `UNSUPPORTED_SCHEMA_VERSION` |
| `type` | string | yes | one of `line_plot`, `scatter_plot`, `basic_diagram`, `message_card` |
| `title` | string | yes | trimmed, 1..200 characters |
| `subtitle` | string | no | trimmed, 1..500 characters when present |

## 5. `line_plot`

A piecewise-linear function curve or multi-series line chart.

```ts
interface LinePlotContent {
  schemaVersion: 1
  type: 'line_plot'
  title: string
  subtitle?: string
  data: PlotData
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `data` | object | yes | contains `series` and optional axes |
| `data.series` | array | yes | non-empty, at most 8 entries |
| `data.series[i].name` | string | yes | trimmed, 1..80 characters |
| `data.series[i].color` | string | no | `#rgb` or `#rrggbb`; renderers otherwise use their palette |
| `data.series[i].points` | array | yes | at most 2048 points; at most 8192 points across all series |
| `data.series[i].points[j].x` | number | yes | finite canonical JSON number, `|x| <= 1e7` |
| `data.series[i].points[j].y` | number | yes | finite canonical JSON number, `|y| <= 1e7` |
| `data.xAxis`, `data.yAxis` | object | no | see the axis table below |

Axis object (`AxisSpec`):

| Field | Type | Required | Rule |
|---|---|---|---|
| `label` | string | no | trimmed, 1..80 characters |
| `unit` | string | no | trimmed, 1..80 characters |
| `min` | number | no | finite canonical JSON number |
| `max` | number | no | finite canonical JSON number; when both are present, `min < max` strictly (`INVALID_AXIS_RANGE`) |

There is no requirement that points are sorted or unique by `x`; duplicate `x`
values are valid (and meaningful for scatter plots).

## 6. `scatter_plot`

Identical field layout and limits to `line_plot`; only the rendering differs
(points are drawn individually instead of connected).

```ts
interface ScatterPlotContent {
  schemaVersion: 1
  type: 'scatter_plot'
  title: string
  subtitle?: string
  data: PlotData  // same series/axis model as line_plot
}
```

## 7. `basic_diagram`

A simple flow/relationship diagram assembled from restricted primitives on a
virtual integer grid. The renderer builds the SVG itself from node/edge
geometry; the payload never contains SVG paths, transforms, or CSS.

```ts
interface BasicDiagramContent {
  schemaVersion: 1
  type: 'basic_diagram'
  title: string
  subtitle?: string
  data: { nodes: DiagramNode[]; edges: DiagramEdge[] }
}
```

Node:

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | yes | unique, `[A-Za-z0-9._:-]{1,64}`; duplicate ids are `DUPLICATE_NODE_ID` |
| `label` | string | yes | trimmed, 1..120 characters |
| `x` | number | yes | integer in `[0, 1000]` (virtual grid column) |
| `y` | number | yes | integer in `[0, 1000]` (virtual grid row) |
| `shape` | string | no | `box` \| `rounded` \| `diamond` \| `circle` |
| `tone` | string | no | `default` \| `accent` \| `muted` |

Edge:

| Field | Type | Required | Rule |
|---|---|---|---|
| `from` | string | yes | must name a declared node id (`UNKNOWN_EDGE_REF`) |
| `to` | string | yes | must name a declared node id and differ from `from` (self edges are rejected) |
| `label` | string | no | trimmed, 1..80 characters |
| `dashed` | boolean | no | render style only |

`data.nodes` must be a non-empty array of at most 60 nodes; `data.edges` may be
omitted (defaults to `[]`) and holds at most 120 edges.

## 8. `message_card`

A small interactive card — the Phase 1 interaction proof.

```ts
interface MessageCardContent {
  schemaVersion: 1
  type: 'message_card'
  title: string
  subtitle?: string
  questionId?: string
  body: string
  actions?: MessageCardAction[]
}
```

| Field | Type | Required | Rule |
|---|---|---|---|
| `body` | string | yes | trimmed, 1..4000 characters |
| `questionId` | string | no | stable producer identity, `[A-Za-z0-9._:-]{1,64}`; echoed in interactions |
| `actions` | array | no | when present: non-empty, at most 5 entries |

Action:

| Field | Type | Required | Rule |
|---|---|---|---|
| `id` | string | yes | unique within the card, `[A-Za-z0-9._:-]{1,64}` |
| `label` | string | yes | trimmed, 1..120 characters |
| `submitText` | string | yes | trimmed, 1..2000 characters; plain text submitted into the originating session, never a URL or markup |

Pressing an action does **not** mutate the persisted payload. It submits the
separate interaction payload described in §10, and the chosen `submitText` (if
the client surfaces a follow-up) is a normal user message in the originating
session.

## 9. Limits

All limits are exported as `RICH_LIMITS` and enforced by the same shared
validator in the Host and the Client.

| Limit key | Value | Applies to |
|---|---|---|
| `maxSerializedBytes` | 262144 | UTF-8 byte length of the whole serialized payload (256 KiB) |
| `maxTitleLength` | 200 | `title` (characters, after trim) |
| `maxSubtitleLength` | 500 | `subtitle` |
| `maxSeries` | 8 | plot `data.series` length |
| `maxPointsPerSeries` | 2048 | `data.series[i].points` length |
| `maxTotalPoints` | 8192 | sum of points across all series |
| `maxAxisLabelLength` | 80 | axis `label` and `unit`, series `name` |
| `maxDiagramNodes` | 60 | `data.nodes` length |
| `maxDiagramEdges` | 120 | `data.edges` length |
| `maxNodeIdLength` | 64 | node `id` |
| `maxNodeLabelLength` | 120 | node `label` |
| `maxEdgeLabelLength` | 80 | edge `label` |
| `maxCardBodyLength` | 4000 | card `body` |
| `maxCardActions` | 5 | card `actions` length |
| `maxActionIdLength` | 64 | action `id` |
| `maxActionLabelLength` | 120 | action `label` |
| `maxSubmitTextLength` | 2000 | action `submitText` |
| `maxQuestionIdLength` | 64 | card `questionId` |
| `maxAbsCoordinate` | 10000000 | absolute value of any plot coordinate or axis bound (`1e7`) |

The 256 KiB limit is measured on the serialized candidate (UTF-8 bytes), not on
the normalized value, so it also bounds junk fields.

## 10. Validation error codes

Every failure returns `{ ok: false, issues: [...] }`; each issue is
`{ code, path, detail }`. `path` is a bounded JSON-pointer-ish path such as
`data.series[2].points[7].y` and `detail` is a short fixed English phrase. The
top-level failure paths may be empty (`""`, rendered as `<root>` by
`formatValidationIssues`). Diagnostics are bounded to the first 8 issues plus a
`(+N more)` suffix.

| Code | Meaning |
|---|---|
| `NOT_AN_OBJECT` | the payload is not a readable plain JSON object |
| `PAYLOAD_TOO_LARGE` | serialized payload exceeds `maxSerializedBytes` (or is not serializable at all) |
| `UNSUPPORTED_SCHEMA_VERSION` | `schemaVersion` is missing or is not exactly `1` |
| `UNKNOWN_TYPE` | `type` is missing or not one of the four v1 types |
| `INVALID_TITLE` | `title` missing, not a string, empty, or too long |
| `INVALID_SUBTITLE` | `subtitle` not a string, empty, or too long |
| `INVALID_BODY` | card `body` missing, not a string, empty, or too long |
| `INVALID_QUESTION_ID` | `questionId` fails the safe-id charset/length |
| `INVALID_SERIES` | `data`/`data.series` missing, not a non-empty array, or a series is not an object; series `name` invalid |
| `TOO_MANY_SERIES` | more than `maxSeries` series |
| `TOO_MANY_POINTS` | a single series exceeds `maxPointsPerSeries` |
| `TOO_MANY_TOTAL_POINTS` | total points across series exceed `maxTotalPoints` |
| `INVALID_POINT` | a plot point is not an object, or `points` is not an array |
| `NON_FINITE_NUMBER` | a number field holds `NaN`, `±Infinity`, `-0`, or is not a number |
| `COORDINATE_OUT_OF_RANGE` | a coordinate or axis bound has `|value| > maxAbsCoordinate` |
| `INVALID_AXIS` | an axis is not an object, or its label/unit is invalid |
| `INVALID_AXIS_RANGE` | explicit `min` and `max` are present but `min >= max` |
| `INVALID_COLOR` | a series color is not a `#rgb`/`#rrggbb` literal |
| `INVALID_SHAPE` | a node `shape` or `tone` is not one of the allowed literals |
| `TOO_MANY_NODES` | more than `maxDiagramNodes` nodes |
| `TOO_MANY_EDGES` | more than `maxDiagramEdges` edges |
| `INVALID_NODE` | `data`/`data.nodes` invalid, or a node id/label/coordinate is invalid |
| `DUPLICATE_NODE_ID` | two nodes share the same `id` |
| `INVALID_EDGE` | `data.edges` is not an array, an edge is not an object, or it is a self edge |
| `UNKNOWN_EDGE_REF` | an edge `from`/`to` does not name a declared node |
| `INVALID_ACTION` | `actions` invalid, an action id/label/submitText invalid, or duplicate action id |
| `TOO_MANY_ACTIONS` | more than `maxCardActions` actions |

## 11. Versioning and compatibility policy

* **v1 is the only understood content schema.** A payload with a missing
  `schemaVersion` or any value other than `1` fails validation with
  `UNSUPPORTED_SCHEMA_VERSION`.
* A missing or foreign persisted `meta` envelope is ignored (the generic tool
  card is shown). A persisted envelope with `kind: "rich-response"` but a
  `content.schemaVersion` other than `1` produces an explicit
  "unsupported rich content version" card. Such content is **never rendered**,
  not even partially.
* `envelopeVersion` is versioned independently of the content schema but only
  `1` is read.
* Any future schema change is a new `schemaVersion` value. Additive keys must
  not be silently interpreted by v1 clients; v1 ignores unknown keys on input
  but never upgrades a payload.
* Old persisted payloads are expected to remain valid forever: v1 limits and
  semantics are frozen for the Phase 1 line. New visual types require a new
  schema version and therefore a new fallback path.

## 12. Interaction payload (separate protocol)

Interactions are **not** part of `RichContentV1`. They travel as the raw input of
the Host command `/rich-interaction <json>` and are described by
`RichInteractionPayloadV1`. The full defense (session binding, staleness,
dedupe) is in [security-model.md](security-model.md).

| Field | Type | Required | Rule |
|---|---|---|---|
| `protocol` | string | yes | exactly `rich-interaction-v1` |
| `protocolVersion` | number | yes | exactly `1` |
| `sessionId` | string | yes | must equal the receiving agent id (the session id in 0.2.1-rc.2), 1..128 chars |
| `callId` | string | yes | originating tool call, 1..128 chars |
| `cardKey` | string | yes | must equal `cardKeyFor(callId, questionId)`, 1..200 chars |
| `questionId` | string | no | card `questionId`, safe-id charset |
| `actionId` | string | yes | safe-id charset, 1..64 chars |
| `attemptId` | string | yes | unique per click, 1..128 chars |
| `submittedAt` | string | yes | strict ISO-8601 UTC instant (`2026-01-01T12:00:00.000Z`) |
| `answer` | string | no | selected answer text, 1..2000 chars |

The raw command input is bounded to 8192 characters; larger input is rejected
before JSON parsing.

```json interaction
{
  "protocol": "rich-interaction-v1",
  "protocolVersion": 1,
  "sessionId": "session-01",
  "callId": "call-42",
  "cardKey": "call-42#deploy-staging-1",
  "questionId": "deploy-staging-1",
  "actionId": "approve",
  "attemptId": "9f1c2b7e-4d3a-4f7e-9b2c-6a1d8e0f3c55",
  "submittedAt": "2026-10-23T08:30:00.000Z",
  "answer": "Approved: deploy the current build to staging."
}
```

## 13. Worked examples (valid)

Each block below is validated by `tests/unit/protocol-docs.test.ts`.

### 13.1 Sine curve (`line_plot`)

```json valid
{
  "schemaVersion": 1,
  "type": "line_plot",
  "title": "Sine wave",
  "subtitle": "y = sin(x) over [0, 2*pi]",
  "data": {
    "series": [
      {
        "name": "sin(x)",
        "color": "#247bbf",
        "points": [
          { "x": 0, "y": 0 },
          { "x": 0.785398, "y": 0.707107 },
          { "x": 1.570796, "y": 1 },
          { "x": 2.356194, "y": 0.707107 },
          { "x": 3.141593, "y": 0 },
          { "x": 3.926991, "y": -0.707107 },
          { "x": 4.712389, "y": -1 },
          { "x": 5.497787, "y": -0.707107 },
          { "x": 6.283185, "y": 0 }
        ]
      }
    ],
    "xAxis": { "label": "x", "min": 0, "max": 6.283185 },
    "yAxis": { "label": "sin(x)", "min": -1, "max": 1 }
  }
}
```

### 13.2 Quadratic growth and normalized wave (`line_plot`, two series)

```json valid
{
  "schemaVersion": 1,
  "type": "line_plot",
  "title": "Quadratic growth and normalized wave",
  "data": {
    "series": [
      {
        "name": "x^2",
        "color": "#d94f2b",
        "points": [
          { "x": 0, "y": 0 },
          { "x": 1, "y": 1 },
          { "x": 2, "y": 4 },
          { "x": 3, "y": 9 },
          { "x": 4, "y": 16 }
        ]
      },
      {
        "name": "normalized wave",
        "color": "#247bbf",
        "points": [
          { "x": 0, "y": 0.5 },
          { "x": 1, "y": 0.75 },
          { "x": 2, "y": 1 },
          { "x": 3, "y": 0.75 },
          { "x": 4, "y": 0.5 }
        ]
      }
    ],
    "xAxis": { "label": "step", "unit": "s" },
    "yAxis": { "label": "value" }
  }
}
```

### 13.3 Scatter with two series and duplicate x values (`scatter_plot`)

```json valid
{
  "schemaVersion": 1,
  "type": "scatter_plot",
  "title": "Latency samples",
  "subtitle": "two clusters; duplicate x values are allowed",
  "data": {
    "series": [
      {
        "name": "baseline",
        "color": "#1a7f37",
        "points": [
          { "x": 1, "y": 12 },
          { "x": 2, "y": 9 },
          { "x": 2, "y": 11 },
          { "x": 3, "y": 15 }
        ]
      },
      {
        "name": "optimized",
        "color": "#8e44ad",
        "points": [
          { "x": 1, "y": 8 },
          { "x": 2, "y": 7 },
          { "x": 3, "y": 9 }
        ]
      }
    ],
    "xAxis": { "label": "run" },
    "yAxis": { "label": "ms" }
  }
}
```

### 13.4 Request-flow diagram (`basic_diagram`)

```json valid
{
  "schemaVersion": 1,
  "type": "basic_diagram",
  "title": "Request flow",
  "data": {
    "nodes": [
      { "id": "client", "label": "Browser", "x": 0, "y": 0, "shape": "rounded", "tone": "accent" },
      { "id": "host", "label": "DSH Host", "x": 400, "y": 0, "shape": "box" },
      { "id": "model", "label": "Model", "x": 800, "y": 0, "shape": "diamond", "tone": "muted" },
      { "id": "session", "label": "Session store", "x": 400, "y": 300, "shape": "circle" }
    ],
    "edges": [
      { "from": "client", "to": "host", "label": "command" },
      { "from": "host", "to": "model", "label": "request" },
      { "from": "model", "to": "host", "dashed": true },
      { "from": "host", "to": "session", "label": "append" }
    ]
  }
}
```

### 13.5 Interactive card (`message_card`)

```json valid
{
  "schemaVersion": 1,
  "type": "message_card",
  "title": "Deploy to staging?",
  "subtitle": "Phase 1 interaction proof",
  "questionId": "deploy-staging-1",
  "body": "The build passed all unit tests. Choose how to continue.",
  "actions": [
    {
      "id": "approve",
      "label": "Approve",
      "submitText": "Approved: deploy the current build to staging."
    },
    {
      "id": "hold",
      "label": "Hold",
      "submitText": "Hold the deploy and show me the failing checks."
    }
  ]
}
```

## 14. Rejected examples

### 14.1 Unsupported schema version

```json invalid UNSUPPORTED_SCHEMA_VERSION
{
  "schemaVersion": 2,
  "type": "line_plot",
  "title": "Future schema",
  "data": {
    "series": [
      { "name": "s", "points": [{ "x": 0, "y": 0 }] }
    ]
  }
}
```

The Host refuses to persist it and the Client refuses to render it; an unknown
version is never interpreted by v1 code.

### 14.2 CSS/URL injection attempt in a color

```json invalid INVALID_COLOR
{
  "schemaVersion": 1,
  "type": "scatter_plot",
  "title": "Injected color",
  "data": {
    "series": [
      {
        "name": "s",
        "color": "red;background:url(javascript:alert(1))",
        "points": [{ "x": 0, "y": 0 }]
      }
    ]
  }
}
```

Only `#rgb`/`#rrggbb` literals are accepted; no CSS value, URL, or function
syntax can enter the style system.

### 14.3 Negative zero is not canonical JSON

```json invalid NON_FINITE_NUMBER
{
  "schemaVersion": 1,
  "type": "line_plot",
  "title": "Negative zero",
  "data": {
    "series": [
      { "name": "s", "points": [{ "x": -0, "y": 0 }] }
    ]
  }
}
```

`-0` cannot survive `JSON.stringify`/`JSON.parse` unchanged, so the protocol
rejects it instead of silently normalizing persisted bytes.

## 15. Conformance

`npm run test:unit` exercises this specification:

* `tests/unit/protocol-validation.test.ts` — accepted/normalized payloads, the
  full rejection matrix, hostile JavaScript values, prototype-pollution safety.
* `tests/unit/protocol-envelope.test.ts` — envelope guards, JSON round-tripping,
  bounded diagnostics, UTF-8 byte measurement.
* `tests/unit/protocol-dos.test.ts` — bounded validation of oversized inputs.
* `tests/unit/protocol-docs.test.ts` — every JSON example in this document.
* `tests/unit/interaction.test.ts`, `tests/unit/host.test.ts` — interaction
  payload and Host tool/command contracts.
