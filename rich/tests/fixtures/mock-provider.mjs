#!/usr/bin/env node
/**
 * Scenario-driven local DeepSeek Messages provider for the isolated DSH
 * 0.2.1-rc.2 Phase 1 verification environment.
 *
 * WHY THIS EXISTS
 * ---------------
 * `DEEPSEEK_BASE_URL` is read from the inherited process environment in
 * 0.2.1-rc.2 (packages/llm/llm-deepseek/src/config.ts:300) and
 * `DEEPSEEK_API_KEY` resolves through credentials-local from the same process
 * environment (packages/credentials/credentials-local/src/index.ts:556-629).
 * Pointing those two variables at this server makes the REAL DSH agent loop
 * issue REAL model requests and execute REAL tool calls with a deterministic
 * wire script — no DOM injection, no faked session events.
 *
 * WIRE FRAMING
 * ------------
 * Mirrors packages/test-support/llm-mock-server/src/index.ts (`openSse`,
 * `writeSse`, `startMessage`, `startText`, `terminalChunk`, `toolCallChunks`,
 * `completeText`): SSE frames are `event: <type>\ndata: <json>\n\n`, with
 * Anthropic-Messages block events. Only `POST` on a path ending in
 * `/v1/messages` is answered; the adapter appends `/v1` to the base URL unless
 * it already ends in `/v1` (llm-deepseek/src/messages-api.ts:14-17).
 *
 * CLI
 * ---
 *   node mock-provider.mjs --scenario <file.json> [--port 0] [--host 127.0.0.1]
 *        [--log <requests.jsonl>] [--bodies <bodies.jsonl>] [--state <state.json>]
 *        [--require-key <key>] [--title-marker <substr>]
 *
 * The scenario file is re-read on EVERY request. When its bytes change, the
 * response cursor resets to 0, so a harness can switch cases without restarting
 * this process (and therefore without changing DEEPSEEK_BASE_URL or the Web app).
 * Progress is exposed at `GET /__state` for evidence.
 *
 * SCENARIO SCHEMA (JSON)
 * ----------------------
 * {
 *   "name": "A-baseline-todo",                  // evidence label
 *   "repeatLast": false,                        // default false: exhausted -> HTTP 500 MOCK_SCRIPT_EXHAUSTED
 *   "titleResponse": { "text": "Mock Session" },// optional canned reply for the LLM title call
 *   "titleSystemSubstring": "Create a concise title for an AI coding-assistant session",
 *   "responses": [                              // one entry consumed per real model request
 *     {
 *       "id": "r1",                             // optional evidence label
 *       "kind": "tool_use",                     // "text" | "tool_use" | "http_error" | "reset"
 *       "startDelayMs": 0,                      // delay before the first SSE byte
 *       "text": "Let me write the plan.",       // text kind: full text. tool_use kind: optional LEADING text block
 *       "textChunkSize": 24,                    // characters per text_delta
 *       "textChunkDelayMs": 0,                  // delay after each text_delta (slow stream)
 *       "toolName": "todo_write",               // tool_use kind: arbitrary wire name
 *       "toolInput": { "todos": [ ... ] },      // tool_use kind: arguments object OR a raw JSON string
 *       "toolCallId": "mock-call-1",            // optional fixed tool_use id
 *       "inputChunks": 2,                       // split the arguments JSON into N input_json_delta frames
 *       "inputChunkDelayMs": 0,                 // delay after each input_json_delta (holds `preparing`)
 *       "stopReason": "tool_use",               // override message_delta.stop_reason
 *       "holdOpenMs": 0,                        // keep the SSE stream open after the final block (interruption)
 *       "status": 400,                          // http_error kind: HTTP status
 *       "error": { "message": "...", "type": "invalid_request_error", "code": "invalid_request" }
 *     }
 *   ]
 * }
 *
 * Kinds:
 *   text        message_start + text block + message_stop (stopReason default `end_turn`)
 *   tool_use    optional leading text block, then one tool_use block whose `input_json_delta`
 *               fragments can be paced, then message_stop (stopReason default `tool_use`)
 *   http_error  plain HTTP JSON `{error:{...}}` before any SSE byte
 *   reset       destroy the socket without a response
 *
 * The canned title reply keeps the transcript deterministic even if the
 * first-prompt LLM title provider is mounted: title requests are detected from
 * the system prompt and answered without consuming the scenario cursor.
 */
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// ── CLI parsing ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (typeof args.scenario !== 'string') {
  process.stderr.write('mock-provider: --scenario <file.json> is required\n')
  process.exit(2)
}
const scenarioPath = resolve(args.scenario)
const host = typeof args.host === 'string' ? args.host : '127.0.0.1'
const requestedPort = Number(args.port ?? 0)
const logFile = typeof args.log === 'string' ? resolve(args.log) : null
const bodiesFile = typeof args.bodies === 'string' ? resolve(args.bodies) : null
const stateFile = typeof args.state === 'string' ? resolve(args.state) : null
const requireKey = typeof args['require-key'] === 'string' ? args['require-key'] : null
const DEFAULT_TITLE_MARKER = 'Create a concise title for an AI coding-assistant session'
const titleMarker = typeof args['title-marker'] === 'string' ? args['title-marker'] : DEFAULT_TITLE_MARKER

function ensureDir(file) {
  if (file === null) return
  mkdirSync(dirname(file), { recursive: true })
}
ensureDir(logFile)
ensureDir(bodiesFile)
ensureDir(stateFile)

function appendJsonl(file, value) {
  if (file === null) return
  appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8')
}

// ── Scenario loading (re-read per request; reset cursor on byte change) ───────
const scenarioCache = { key: null, doc: null }

function loadScenario() {
  const text = readFileSync(scenarioPath, 'utf8').replace(/^\uFEFF/, '')
  const key = `${text.length}:${text}`
  if (scenarioCache.key !== key) {
    const doc = JSON.parse(text)
    if (!Array.isArray(doc.responses) || doc.responses.length === 0) {
      throw new Error('scenario.responses must be a non-empty array')
    }
    scenarioCache.key = key
    scenarioCache.doc = doc
    cursor = 0
    scenarioLoads += 1
  }
  return scenarioCache.doc
}

let cursor = 0
let scenarioLoads = 1
let requestCount = 0
let clientClosed = 0
let scriptExhausted = 0

// ── SSE helpers (mirror llm-mock-server) ─────────────────────────────────────
function openSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  response.flushHeaders()
}

function writeSse(record, response, payload) {
  const frame = typeof payload === 'string' ? `data: ${payload}\n\n` : `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`
  response.write(frame)
  record.chunksSent += 1
}

function delay(ms, response) {
  if (ms <= 0) return Promise.resolve(!response.destroyed)
  return new Promise((resolveDelay) => {
    if (response.destroyed) { resolveDelay(false); return }
    const timer = setTimeout(() => { response.off('close', onClose); resolveDelay(!response.destroyed) }, ms)
    const onClose = () => { clearTimeout(timer); resolveDelay(false) }
    response.once('close', onClose)
  })
}

function splitChunks(text, size) {
  const points = Array.from(text)
  const chunks = []
  const width = Math.max(1, Number.isInteger(size) && size > 0 ? size : 24)
  for (let i = 0; i < points.length; i += width) chunks.push(points.slice(i, i + width).join(''))
  return chunks
}

function startMessage(record, response, model) {
  writeSse(record, response, {
    type: 'message_start',
    message: {
      id: `mock-message-${record.n}`,
      type: 'message',
      role: 'assistant',
      model: model ?? 'mock-model',
      content: [],
      usage: { input_tokens: 3, output_tokens: 0 },
    },
  })
}

function terminal(record, response, reason, outputTokens) {
  writeSse(record, response, {
    type: 'message_delta',
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  })
  writeSse(record, response, { type: 'message_stop' })
}

async function streamText(record, response, index, text, spec) {
  const textValue = typeof text === 'string' ? text : ''
  writeSse(record, response, { type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
  let wrote = 0
  for (const chunk of splitChunks(textValue, spec.textChunkSize ?? 24)) {
    writeSse(record, response, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: chunk } })
    wrote += chunk.length
    if (!await delay(Number(spec.textChunkDelayMs ?? 0), response)) return null
  }
  writeSse(record, response, { type: 'content_block_stop', index })
  return wrote
}

// ── Response kinds ───────────────────────────────────────────────────────────
async function runText(record, response, spec, model) {
  if (Number(spec.startDelayMs ?? 0) > 0 && !await delay(Number(spec.startDelayMs), response)) return 'client_closed'
  openSse(response)
  startMessage(record, response, model)
  const wrote = await streamText(record, response, 0, spec.text ?? '', spec)
  if (wrote === null) return 'client_closed'
  if (Number(spec.holdOpenMs ?? 0) > 0) {
    if (!await delay(Number(spec.holdOpenMs), response)) return 'client_closed'
  }
  terminal(record, response, spec.stopReason ?? 'end_turn', wrote)
  response.end()
  return 'completed'
}

async function runToolUse(record, response, spec, model) {
  if (Number(spec.startDelayMs ?? 0) > 0 && !await delay(Number(spec.startDelayMs), response)) return 'client_closed'
  openSse(response)
  startMessage(record, response, model)
  let index = 0
  let wrote = 0
  if (typeof spec.text === 'string' && spec.text !== '') {
    const textWrote = await streamText(record, response, index, spec.text, spec)
    if (textWrote === null) return 'client_closed'
    wrote += textWrote
    index += 1
  }
  const rawInput = typeof spec.toolInput === 'string' ? spec.toolInput : JSON.stringify(spec.toolInput ?? {})
  const callId = typeof spec.toolCallId === 'string' ? spec.toolCallId : `mock-call-${record.n}`
  writeSse(record, response, {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: callId, name: String(spec.toolName ?? 'mock_tool'), input: {} },
  })
  const fractions = Math.max(1, Number.isInteger(spec.inputChunks) ? spec.inputChunks : 2)
  const step = Math.max(1, Math.ceil(Array.from(rawInput).length / fractions))
  const chars = Array.from(rawInput)
  for (let i = 0; i < chars.length; i += step) {
    writeSse(record, response, {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: chars.slice(i, i + step).join('') },
    })
    wrote += step
    if (!await delay(Number(spec.inputChunkDelayMs ?? 0), response)) return 'client_closed'
  }
  writeSse(record, response, { type: 'content_block_stop', index })
  if (Number(spec.holdOpenMs ?? 0) > 0) {
    if (!await delay(Number(spec.holdOpenMs), response)) return 'client_closed'
  }
  terminal(record, response, spec.stopReason ?? 'tool_use', Math.max(1, wrote))
  response.end()
  return 'completed'
}

function runHttpError(response, spec) {
  const status = Number(spec.status ?? 400)
  const headers = { 'content-type': 'application/json' }
  if (spec.retryAfterSeconds !== undefined) headers['retry-after'] = String(spec.retryAfterSeconds)
  response.writeHead(status, headers)
  response.end(JSON.stringify({
    error: {
      message: String(spec.error?.message ?? 'mock provider error'),
      type: String(spec.error?.type ?? 'invalid_request_error'),
      code: String(spec.error?.code ?? 'mock_error'),
    },
  }))
  return 'completed'
}

async function runReset(record, response) {
  await delay(Number(record.spec?.startDelayMs ?? 0), response)
  response.destroy()
  return 'reset'
}

// ── Request handling ─────────────────────────────────────────────────────────
function summarizeBody(body) {
  const summary = {
    model: typeof body?.model === 'string' ? body.model : null,
    maxTokens: typeof body?.max_tokens === 'number' ? body.max_tokens : null,
    stream: body?.stream === true,
    messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
    toolsCount: Array.isArray(body?.tools) ? body.tools.length : null,
    toolNames: Array.isArray(body?.tools)
      ? body.tools.map((tool) => tool?.name ?? tool?.function?.name).filter((name) => typeof name === 'string')
      : [],
    systemLength: typeof body?.system === 'string' ? body.system.length : null,
    lastUserText: null,
    toolResultCount: 0,
  }
  if (Array.isArray(body?.messages)) {
    for (let i = body.messages.length - 1; i >= 0; i -= 1) {
      const message = body.messages[i]
      const content = message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'tool_result') summary.toolResultCount += 1
      }
      if (message?.role === 'user' && summary.lastUserText === null) {
        const text = content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
        if (text !== '') summary.lastUserText = text.slice(0, 800)
      }
    }
  }
  return summary
}

function isTitleRequest(body) {
  const systemText = typeof body?.system === 'string' ? body.system : JSON.stringify(body?.system ?? '')
  return systemText.includes(titleMarker)
}

function selectResponse(doc, summary) {
  const responses = doc.responses
  if (cursor >= responses.length) {
    if (doc.repeatLast === true) return { spec: responses[responses.length - 1], index: responses.length - 1 }
    return { spec: null, index: cursor }
  }
  const index = cursor
  cursor += 1
  return { spec: responses[index], index }
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://mock.invalid').pathname

  if (request.method === 'GET' && path === '/__state') {
    const scenario = scenarioCache.doc
    const payload = {
      pid: process.pid,
      baseURL,
      scenarioName: scenario?.name ?? null,
      scenarioPath,
      scenarioLoads,
      responses: scenario?.responses?.length ?? 0,
      cursor,
      requestCount,
      clientClosed,
      scriptExhausted,
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload, null, 2))
    return
  }
  if (request.method === 'GET' && path === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, pid: process.pid }))
    return
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' }).end()
    return
  }
  if (!path.endsWith('/v1/messages')) {
    response.writeHead(404).end()
    return
  }
  if (requireKey !== null && request.headers['x-api-key'] !== requireKey) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'invalid mock API key', code: 'invalid_api_key' } }))
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  let body
  try {
    const text = Buffer.concat(chunks).toString('utf8')
    body = text.length === 0 ? undefined : JSON.parse(text)
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'request body must be valid JSON', code: 'invalid_json' } }))
    return
  }

  requestCount += 1
  const record = { n: requestCount, chunksSent: 0, spec: null, path }
  response.once('close', () => {
    if (!response.writableFinished) clientClosed += 1
  })

  let doc
  try { doc = loadScenario() } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: `mock scenario invalid: ${String(error)}`, code: 'MOCK_SCENARIO_INVALID' } }))
    return
  }

  const summary = summarizeBody(body)
  const routed = isTitleRequest(body) ? 'title' : 'scenario'
  let spec = null
  let index = null
  let outcome = 'completed'
  let start = Date.now()

  if (routed === 'title') {
    spec = { kind: 'text', text: String(doc.titleResponse?.text ?? 'Mock Session') }
  } else {
    const selected = selectResponse(doc, summary)
    spec = selected.spec
    index = selected.index
    record.spec = spec
  }

  if (spec === null) {
    scriptExhausted += 1
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'mock script exhausted', code: 'MOCK_SCRIPT_EXHAUSTED' } }))
    outcome = 'script_exhausted'
  } else {
    try {
      switch (spec.kind ?? 'text') {
        case 'text': outcome = await runText(record, response, spec, summary.model); break
        case 'tool_use': outcome = await runToolUse(record, response, spec, summary.model); break
        case 'http_error': outcome = runHttpError(response, spec); break
        case 'reset': outcome = await runReset(record, response); break
        default:
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: `unknown mock response kind ${String(spec.kind)}`, code: 'MOCK_SCENARIO_INVALID' } }))
          outcome = 'invalid'
      }
    } catch (error) {
      outcome = 'handler_error'
      if (response.headersSent) response.destroy()
      else {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: { message: String(error), code: 'MOCK_HANDLER_FAILED' } }))
      }
    }
  }

  const entry = {
    ts: new Date().toISOString(),
    n: requestCount,
    path,
    routed,
    scenario: doc.name ?? null,
    scenarioIndex: index,
    responseId: spec?.id ?? null,
    responseKind: spec?.kind ?? null,
    toolName: spec?.toolName ?? null,
    outcome,
    chunksSent: record.chunksSent,
    durationMs: Date.now() - start,
    apiKeyHeader: request.headers['x-api-key'] === undefined ? null : '<redacted-present>',
    headers: {
      'content-type': request.headers['content-type'] ?? null,
      'anthropic-version': request.headers['anthropic-version'] ?? null,
      'user-agent': request.headers['user-agent'] ?? null,
    },
    bodySummary: summary,
  }
  appendJsonl(logFile, entry)
  appendJsonl(bodiesFile, { n: requestCount, ts: entry.ts, body })
  if (args.verbose) process.stdout.write(`mock-provider: #${requestCount} ${routed} ${entry.responseKind ?? 'exhausted'} ${outcome}\n`)
})

let baseURL = null
server.listen(requestedPort, host, () => {
  const address = server.address()
  const advertised = host.includes(':') ? `[${host}]` : host
  baseURL = `http://${advertised}:${address.port}`
  const state = {
    pid: process.pid,
    host,
    port: address.port,
    baseURL,
    scenarioPath,
    logFile,
    bodiesFile,
    startedUtc: new Date().toISOString(),
    nodeVersion: process.version,
  }
  if (stateFile !== null) writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8')
  process.stdout.write(`MOCK_READY ${JSON.stringify({ baseURL, port: address.port, pid: process.pid, scenario: scenarioCache.doc?.name ?? null })}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref() })
}
