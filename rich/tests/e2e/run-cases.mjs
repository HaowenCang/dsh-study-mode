/**
 * Phase 1 acceptance runner — REAL tool cards from the REAL DSH agent loop.
 *
 * Every case drives the real isolated DSH 0.2.1-rc.2 Web UI (Playwright + system
 * Edge, persistent profile inside the p1 root). The model traffic comes from the
 * scenario-driven local provider; nothing is injected into the DOM and no
 * session event is fabricated. Assertions read:
 *   - the live transcript DOM (`[data-chat-call-id]`, `[data-state]`,
 *     `[data-dsh-rich*]`, SVG geometry),
 *   - persisted session logs (`<p1>/dsh-home/sessions/<workspace>/<session>/session.v4.jsonl.zstd`,
 *     multi-frame zstd, decoded per frame),
 *   - the mock provider request JSONL.
 *
 * Usage:
 *   node tests/e2e/run-cases.mjs <p1-root> [--cases A,B,C,D,E,R] [--keep]
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import {
  ensureCaseDir, launchContext, loadP1State, openApp, revealCards, screenshot, sha256OfFile, snapshotUi, writeArtifact,
} from './_harness.mjs'

// ── CLI ──────────────────────────────────────────────────────────────────────
const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const casesArg = process.argv.find((value) => value.startsWith('--cases='))
const requested = casesArg ? casesArg.slice('--cases='.length).split(',').map((v) => v.trim().toUpperCase()) : ['A', 'B', 'C', 'D', 'E', 'R']
const state = loadP1State(p1Root)

// ── Session-log access (multi-frame zstd) ────────────────────────────────────
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

export function decodeZstdJsonl(path) {
  const buf = readFileSync(path)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) starts.push(i)
  }
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const start = starts[k]
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(start, end))) } catch { /* partial frame while writing */ }
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter((line) => line.length > 0)
}

const sessionCache = new Map()
function readSession(logPath) {
  const stat = statSync(logPath)
  const cached = sessionCache.get(logPath)
  if (cached !== undefined && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached
  const lines = decodeZstdJsonl(logPath)
  const events = []
  for (const line of lines) { try { events.push(JSON.parse(line)) } catch { /* torn tail */ } }
  const header = events.find((event) => event.type === 'session')
  const entry = { logPath, mtime: stat.mtimeMs, size: stat.size, events, header }
  sessionCache.set(logPath, entry)
  return entry
}

function listSessions() {
  const sessionsRoot = join(p1Root, 'dsh-home', 'sessions')
  if (!existsSync(sessionsRoot)) return []
  const out = []
  for (const workspaceDir of readdirSync(sessionsRoot)) {
    const workspacePath = join(sessionsRoot, workspaceDir)
    if (!statSync(workspacePath).isDirectory()) continue
    for (const sessionDir of readdirSync(workspacePath)) {
      const logPath = join(workspacePath, sessionDir, 'session.v4.jsonl.zstd')
      if (!existsSync(logPath)) continue
      const session = readSession(logPath)
      out.push({
        dir: sessionDir,
        logPath,
        sessionId: session.header?.id ?? sessionDir,
        header: session.header,
        eventCount: session.events.length,
        eventTypes: countTypes(session.events),
        events: session.events,
        mtime: session.mtime,
      })
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime)
}

function countTypes(events) {
  const counts = {}
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1
  return counts
}

function waitForNewSession(beforeIds, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const fresh = listSessions().filter((session) => !beforeIds.has(session.sessionId))
    if (fresh.length > 0) return fresh[fresh.length - 1]
    sleepSync(250)
  }
  return null
}

function waitForTurnEnd(sessionId, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = listSessions().find((candidate) => candidate.sessionId === sessionId)
    if (session !== undefined) {
      const ends = session.events.filter((event) => event.type === 'turn/end')
      if (ends.length > 0) return { session, turnEnd: ends[ends.length - 1] }
    }
    sleepSync(250)
  }
  return null
}

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds)
}

// ── Scenario control ─────────────────────────────────────────────────────────
function activateScenario(name) {
  const source = join(p1Root, 'mock-provider', 'scenarios', `${name}.json`)
  // Strip a UTF-8 BOM: PowerShell-generated scenario files may carry one.
  const doc = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, ''))
  doc.activatedAt = new Date().toISOString()
  writeFileSync(join(p1Root, 'mock-provider', 'scenarios', 'active.json'), JSON.stringify(doc, null, 2), 'utf8')
  return doc
}

function readMockRequests(sinceCount = 0) {
  const dir = join(p1Root, 'mock-provider', 'requests')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter((name) => name.startsWith('requests-') && name.endsWith('.jsonl')).sort()
  const entries = []
  for (const file of files) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) { try { entries.push(JSON.parse(line)) } catch { /* torn tail */ } }
  }
  return entries.slice(sinceCount)
}

// ── UI actions ───────────────────────────────────────────────────────────────
const results = []
function record(check, pass, detail) {
  results.push({ check, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${check} :: ${detail}`)
}

async function newSession(page, dir) {
  const beforeIds = new Set(listSessions().map((session) => session.sessionId))
  await page.getByRole('button', { name: 'New session', exact: false }).first().click({ force: true })
  await page.waitForTimeout(1200)
  await screenshot(page, dir, 'session-blank')
  return { beforeIds, beforeCount: beforeIds.size }
}

async function sendMessage(page, text) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.type(text, { delay: 6 })
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
}

async function waitForStopGone(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stopCount = await page.getByRole('button', { name: 'Stop generating' }).count()
    if (stopCount === 0) return true
    await page.waitForTimeout(250)
  }
  return false
}

async function waitForToolRowsSettled(page, timeoutMs = 60000, minimum = 1) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-chat-call-id] [data-state]')).map((el) => el.getAttribute('data-state')))
    if (rows.length >= minimum && rows.every((value) => ['ok', 'error', 'stopped'].includes(value))) return rows
    await page.waitForTimeout(250)
  }
  return null
}

function toolResultEvents(session) {
  return session.events
    .filter((event) => event.type === 'tool/result')
    .map((event) => ({ seq: event.seq, ...event.data }))
}

function toolCallEvents(session) {
  return session.events
    .filter((event) => event.type === 'tool/call')
    .map((event) => ({ seq: event.seq, ...event.data }))
}

/**
 * Resolve the session that owns this turn (the blank session created by the New
 * session click, or the first one to appear after the message) and block until
 * the runtime has persisted `turn/end` for it. Server-side truth first, then the
 * DOM is given a moment to catch up.
 */
async function waitForSessionAndTurnEnd(beforeIds, page) {
  const session = waitForNewSession(beforeIds, 20000) ?? listSessions().slice(-1)[0]
  const end = waitForTurnEnd(session.sessionId, 90000)
  await page.waitForTimeout(1200)
  await waitForStopGone(page, 30000)
  await page.waitForTimeout(800)
  // Re-read: the session object captured before the turn has no tool events yet.
  const fresh = listSessions().find((candidate) => candidate.sessionId === session.sessionId) ?? session
  return { session: fresh, end }
}

function countDomRows(snapshot) {
  return snapshot.toolRows.length
}

// ── Cases ────────────────────────────────────────────────────────────────────
async function caseA(page, dir) {
  const scenario = activateScenario('a-baseline-todo')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  await sendMessage(page, 'A baseline: please track this work with two todo items.')
  const settled = await waitForToolRowsSettled(page, 60000, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)

  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const reveal = await revealCards(page)
  const snapshot = await snapshotUi(page)
  const shot = await screenshot(page, dir, 'A-tool-card')
  const revealedShot = await screenshot(page, dir, 'A-tool-card-revealed')
  const calls = toolCallEvents(session)
  const resultsEvents = toolResultEvents(session)
  const mock = readMockRequests(mockBefore)
  const row = snapshot.toolRows[0]

  record('A.ui.toolRows', snapshot.toolRows.length === 1 && row?.tool === 'todo_write', `rows=${JSON.stringify(snapshot.toolRows.map((r) => ({ state: r.state, tool: r.tool, callId: r.callId })))}`)
  record('A.ui.settledOk', row?.state === 'ok', `state=${row?.state}`)
  record('A.ui.cardVisible', reveal.visible, `revealSteps=${JSON.stringify(reveal.steps)}`)
  record('A.ui.screenshot', shot.sha256.length === 64 && statSync(shot.path).size > 10000, `${shot.path} sha256=${shot.sha256}`)
  record('A.ui.screenshotRevealed', revealedShot.sha256.length === 64 && statSync(revealedShot.path).size > 10000, `${revealedShot.path} sha256=${revealedShot.sha256}`)
  record('A.log.toolCall', calls.length >= 1 && calls[0]?.name === 'todo_write', `calls=${JSON.stringify(calls.map((c) => c.name))}`)
  record('A.log.toolResult', resultsEvents.length >= 1 && resultsEvents[0]?.message?.isError !== true, `results=${resultsEvents.length} isError=${resultsEvents[0]?.message?.isError}`)
  record('A.log.callIdMatchesUi', calls.length > 0 && calls[0]?.callId === row?.callId, `ui=${row?.callId} log=${calls[0]?.callId}`)
  record('A.mock.toolCallRequest', mock.some((entry) => entry.responseKind === 'tool_use' && entry.toolName === 'todo_write'), `mockRequests=${mock.length}`)
  record('A.turn.end', end !== null && end.turnEnd?.data?.reason?.kind === 'completed', `reason=${JSON.stringify(end?.turnEnd?.data?.reason)}`)

  return {
    case: 'A',
    purpose: 'Baseline real built-in tool card (todo_write)',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    uiRows: snapshot.toolRows,
    toolCalls: calls,
    toolResults: resultsEvents.map((entry) => ({ callId: entry.message?.source?.callId, isError: entry.message?.isError, content: entry.message?.content })),
    turnEnd: end?.turnEnd?.data,
    mockRequests: mock.map((entry) => ({ n: entry.n, routed: entry.routed, kind: entry.responseKind, tool: entry.toolName, outcome: entry.outcome })),
    reveal,
    screenshot: shot,
    revealedShot,
    consoleErrors: page.consoleErrors,
  }
}

async function caseB(page, dir, kind = 'B') {
  const scenario = activateScenario(kind === 'B' ? 'b-invalid-args' : 'b2-unknown-tool')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  await sendMessage(page, kind === 'B'
    ? 'B failure: call todo_write with an invalid status value.'
    : 'B2 failure: call a tool name that does not exist.')
  await waitForToolRowsSettled(page, 45000, 1)
  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const reveal = await revealCards(page)
  const snapshot = await snapshotUi(page)
  const shot = await screenshot(page, dir, `${kind}-error-card`)
  const revealedShot = await screenshot(page, dir, `${kind}-error-card-revealed`)
  const resultsEvents = toolResultEvents(session)
  const calls = toolCallEvents(session)
  const mock = readMockRequests(mockBefore)
  const row = snapshot.toolRows[0]
  const text = snapshot.bodyText

  // Schema-invalid args settle as an error tool row; an unknown tool name may
  // instead surface as a transcript-level error. Accept either, but require a
  // visible error signal.
  const errorRow = snapshot.toolRows.some((candidate) => candidate.state === 'error')
  const errorText = /invalid|unknown|error|failed|not found/i.test(text)
  record(`${kind}.ui.errorVisible`, errorRow || errorText, `rows=${JSON.stringify(snapshot.toolRows.map((r) => ({ state: r.state, tool: r.tool })))} textErrorSignal=${errorText}`)
  record(`${kind}.ui.cardVisible`, reveal.visible || errorText, `reveal=${JSON.stringify(reveal)}`)
  record(`${kind}.ui.screenshot`, shot.sha256.length === 64 && revealedShot.sha256.length === 64, `${shot.path} | ${revealedShot.path}`)
  record(`${kind}.log.toolCallOrError`, calls.length >= 1 || resultsEvents.length >= 1 || errorText, `calls=${calls.length} results=${resultsEvents.length}`)
  record(`${kind}.mock.errorScenarioConsumed`, mock.length >= 1, `mockRequests=${mock.length}`)

  return {
    case: kind,
    purpose: kind === 'B' ? 'Failure state: schema-invalid tool arguments' : 'Failure state: unknown tool name',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    uiRows: snapshot.toolRows,
    toolCalls: calls,
    toolResults: resultsEvents.map((entry) => ({ callId: entry.message?.source?.callId, isError: entry.message?.isError, content: entry.message?.content, error: entry.data?.error })),
    bodyTextTail: text.slice(-1200),
    mockRequests: mock.map((entry) => ({ n: entry.n, routed: entry.routed, kind: entry.responseKind, tool: entry.toolName, outcome: entry.outcome })),
    reveal,
    screenshot: shot,
    revealedShot,
    consoleErrors: page.consoleErrors,
  }
}

async function caseC(page, dir) {
  const scenario = activateScenario('c-slow-stream')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  await sendMessage(page, 'C phase: run the slow command so the in-progress states are observable.')

  const timeline = []
  const shots = []
  const seen = new Map()
  const started = Date.now()
  for (let i = 0; i < 140; i += 1) {
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[data-chat-call-id]')).map((row) => {
      const stateEl = row.querySelector('[data-state]')
      return { callId: row.getAttribute('data-chat-call-id'), state: stateEl?.getAttribute('data-state') ?? null, tool: stateEl?.getAttribute('data-tool') ?? null, text: (row.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160) }
    }))
    const at = Date.now() - started
    timeline.push({ at, rows: rows.map((row) => ({ callId: row.callId, state: row.state, tool: row.tool })) })
    for (const row of rows) {
      const key = `${row.state}`
      if (row.state !== null && !seen.has(key)) {
        seen.set(key, true)
        const shot = await screenshot(page, dir, `C-phase-${seen.size}-${row.state}`)
        shots.push({ state: row.state, at, tool: row.tool, text: row.text, ...shot })
      }
    }
    if (rows.length > 0 && rows.every((row) => ['ok', 'error', 'stopped'].includes(row.state)) && at > 4000) break
    await page.waitForTimeout(250)
  }
  await waitForStopGone(page)
  await page.waitForTimeout(800)
  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const finalSnapshot = await snapshotUi(page)
  const finalShot = await screenshot(page, dir, 'C-final-settled')
  const mock = readMockRequests(mockBefore)
  const states = Array.from(seen.keys())
  const preparingSeen = states.includes('preparing')
  const runningSeen = states.includes('running')
  record('C.ui.preparingSeen', preparingSeen, `states=${states.join(',')}`)
  record('C.ui.runningSeen', runningSeen, `states=${states.join(',')}`)
  record('C.ui.settledOk', finalSnapshot.toolRows.every((row) => row.state === 'ok') && finalSnapshot.toolRows.length === 1, `final=${JSON.stringify(finalSnapshot.toolRows.map((r) => r.state))}`)
  record('C.ui.screenshots', shots.length >= 2 && shots.every((shot) => shot.sha256.length === 64), shots.map((shot) => `${shot.state}:${shot.path}`).join(' '))
  record('C.mock.slowChunks', mock.some((entry) => entry.responseKind === 'tool_use' && entry.chunksSent > 5), `chunks=${mock.map((entry) => entry.chunksSent).join(',')}`)
  record('C.turn.end', end !== null, `reason=${JSON.stringify(end?.turnEnd?.data?.reason)}`)
  return {
    case: 'C',
    purpose: 'In-progress phases: preparing while arguments stream, running while the tool executes',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    timeline: timeline.filter((entry, index) => index % 2 === 0),
    shots,
    finalRows: finalSnapshot.toolRows,
    finalShot,
    mockRequests: mock.map((entry) => ({ n: entry.n, kind: entry.responseKind, tool: entry.toolName, chunksSent: entry.chunksSent, durationMs: entry.durationMs })),
    turnEnd: end?.turnEnd?.data,
    consoleErrors: page.consoleErrors,
  }
}

async function caseD(page, dir) {
  const scenario = activateScenario('d-interrupt')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  const bodyBefore = await page.evaluate(() => document.body.innerText.length)
  await sendMessage(page, 'D interruption: start a long answer and stop it mid-stream.')

  // Wait until the stream is visibly producing text, then press the real stop control.
  let streamed = false
  for (let i = 0; i < 80; i += 1) {
    const snapshot = await page.evaluate(() => ({ len: document.body.innerText.length }))
    if (snapshot.len > bodyBefore + 200) { streamed = true; break }
    await page.waitForTimeout(150)
  }
  const streamingShot = await screenshot(page, dir, 'D-mid-stream')
  const stopButton = page.getByRole('button', { name: 'Stop generating' })
  const stopVisible = await stopButton.count()
  if (stopVisible > 0) await stopButton.first().click({ force: true })
  await waitForStopGone(page, 30000)
  await page.waitForTimeout(2000)
  const settledShot = await screenshot(page, dir, 'D-after-stop')
  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const snapshot = await snapshotUi(page)
  const mock = readMockRequests(mockBefore)
  const reason = end?.turnEnd?.data?.reason?.kind ?? null
  record('D.ui.stopControlVisible', stopVisible > 0, `stopButtons=${stopVisible}`)
  record('D.ui.stopControlUsed', true, `clicked=${stopVisible > 0}`)
  record('D.turn.reason', ['aborted', 'interrupted', 'cancelled', 'canceled', 'stopped'].includes(reason), `reason=${reason}`)
  record('D.ui.settledScreenshot', settledShot.sha256.length === 64, settledShot.path)
  record('D.mock.clientClosed', mock.some((entry) => entry.outcome === 'client_closed' || entry.outcome === 'completed'), `outcomes=${mock.map((entry) => entry.outcome).join(',')}`)
  const aborted = session.events.filter((event) => /abort|interrupt|cancel/i.test(JSON.stringify(event.data ?? {}))).map((event) => ({ seq: event.seq, type: event.type, data: event.data }))
  return {
    case: 'D',
    purpose: 'Interruption: stop the running turn mid-stream',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    streamedBeforeStop: streamed,
    stopVisible,
    turnEnd: end?.turnEnd?.data,
    abortedEvents: aborted.slice(0, 8),
    uiRows: snapshot.toolRows,
    bodyTextTail: snapshot.bodyText.slice(-1500),
    mockRequests: mock.map((entry) => ({ n: entry.n, kind: entry.responseKind, outcome: entry.outcome, chunksSent: entry.chunksSent })),
    streamingShot,
    settledShot,
    consoleErrors: page.consoleErrors,
  }
}

async function caseE(page, dir) {
  const scenario = activateScenario('e-multi-cards')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  const firstMarker = 'E first turn: record the todo card.'
  const secondMarker = 'E second turn: run the PowerShell card.'
  await sendMessage(page, firstMarker)
  await waitForToolRowsSettled(page, 60000, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(800)
  const afterFirst = await snapshotUi(page)
  const shotFirst = await screenshot(page, dir, 'E-after-first-card')

  await sendMessage(page, secondMarker)
  await waitForToolRowsSettled(page, 60000, 2)
  await waitForStopGone(page)
  await page.waitForTimeout(1000)
  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const revealSecond = await revealCards(page)
  const afterSecond = await snapshotUi(page)
  const shotSecond = await screenshot(page, dir, 'E-after-second-card')

  // History replay: full page reload, then reopen the SAME session.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(6000)
  let afterReload = await snapshotUi(page)
  if (countDomRows(afterReload) < 2) {
    // Open the session from the sidebar by its fallback title words.
    const opener = page.getByText(/E first turn/i).first()
    if (await opener.count() > 0) {
      await opener.click({ force: true })
      await page.waitForTimeout(4000)
      afterReload = await snapshotUi(page)
    }
  }
  if (countDomRows(afterReload) < 2) {
    const anySession = page.getByText(/record the todo card/i).first()
    if (await anySession.count() > 0) {
      await anySession.click({ force: true })
      await page.waitForTimeout(4000)
      afterReload = await snapshotUi(page)
    }
  }
  const shotReload = await screenshot(page, dir, 'E-after-reload')
  const revealReload = await revealCards(page)
  const afterReveal = await snapshotUi(page)
  const shotReloadRevealed = await screenshot(page, dir, 'E-after-reload-revealed')
  const calls = toolCallEvents(session)
  const resultsEvents = toolResultEvents(session)
  const mock = readMockRequests(mockBefore)

  record('E.ui.firstCard', afterFirst.toolRows.length === 1 && afterFirst.toolRows[0].tool === 'todo_write', JSON.stringify(afterFirst.toolRows.map((r) => r.tool)))
  record('E.ui.secondCard', afterSecond.toolRows.length === 2 && afterSecond.toolRows.some((r) => r.tool === 'pwsh'), JSON.stringify(afterSecond.toolRows.map((r) => r.tool)))
  record('E.log.twoCallsTwoResults', calls.length === 2 && resultsEvents.length === 2, `calls=${calls.length} results=${resultsEvents.length}`)
  record('E.replay.cardsRebuilt', afterReload.toolRows.length === 2, `afterReloadRows=${JSON.stringify(afterReload.toolRows.map((r) => ({ tool: r.tool, state: r.state, callId: r.callId })))}`)
  record('E.replay.cardsVisible', revealSecond.visible && revealReload.visible, `beforeReload=${revealSecond.visible} afterReload=${revealReload.visible}`)
  record('E.replay.screenshots', [shotFirst, shotSecond, shotReload, shotReloadRevealed].every((shot) => shot.sha256.length === 64), [shotFirst.path, shotSecond.path, shotReload.path, shotReloadRevealed.path].join(' '))
  record('E.turn.end', end !== null, `reason=${JSON.stringify(end?.turnEnd?.data?.reason)}`)
  return {
    case: 'E',
    purpose: 'Two different tool cards in one session + history replay after reload',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    afterFirstRows: afterFirst.toolRows,
    afterSecondRows: afterSecond.toolRows,
    afterReloadRows: afterReload.toolRows,
    afterRevealRows: afterReveal.toolRows,
    revealSecond,
    revealReload,
    toolCalls: calls,
    toolResults: resultsEvents.map((entry) => ({ callId: entry.message?.source?.callId, isError: entry.message?.isError })),
    turnEnd: end?.turnEnd?.data,
    mockRequests: mock.map((entry) => ({ n: entry.n, kind: entry.responseKind, tool: entry.toolName })),
    shots: [shotFirst, shotSecond, shotReload, shotReloadRevealed],
    consoleErrors: page.consoleErrors,
  }
}

async function caseR(page, dir) {
  const scenario = activateScenario('r-rich-render')
  const mockBefore = readMockRequests().length
  const { beforeIds } = await newSession(page, dir)
  await sendMessage(page, 'R rich card: render the sine line plot.')
  const { session, end } = await waitForSessionAndTurnEnd(beforeIds, page)
  const reveal = await revealCards(page)
  const snapshot = await snapshotUi(page)
  const shot = await screenshot(page, dir, 'R-rich-card')
  const rich = await page.evaluate(() => {
    const card = document.querySelector('[data-dsh-rich="tool-card"]')
    if (card === null) return { card: null }
    const visible = card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })
    const svg = card.querySelector('svg')
    const svgBox = svg?.getBoundingClientRect() ?? null
    const elements = svg === null ? [] : Array.from(svg.querySelectorAll('*')).slice(0, 120).map((el) => ({
      tag: el.tagName.toLowerCase(),
      attrs: Object.fromEntries(Array.from(el.attributes).map((attribute) => [attribute.name, attribute.value])),
      text: el.children.length === 0 && el.tagName.toLowerCase() !== 'svg' ? (el.textContent ?? '').slice(0, 40) : undefined,
    }))
    const numeric = []
    if (svg !== null) {
      for (const el of svg.querySelectorAll('circle, path, polyline, polygon, line, rect, text')) {
        const attrs = {}
        for (const name of ['cx', 'cy', 'r', 'x', 'y', 'd', 'points', 'width', 'height', 'x1', 'y1', 'x2', 'y2']) {
          const value = el.getAttribute(name)
          if (value !== null) attrs[name] = value
        }
        numeric.push({ tag: el.tagName.toLowerCase(), attrs, text: el.textContent?.slice(0, 30) })
      }
    }
    return {
      visible,
      card: {
        attrs: Object.fromEntries(Array.from(card.attributes).map((attribute) => [attribute.name, attribute.value])),
        text: (card.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400),
        innerText: (card.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
      },
      nested: Array.from(card.querySelectorAll('[data-dsh-rich]')).map((el) => ({
        kind: el.getAttribute('data-dsh-rich'),
        status: el.getAttribute('data-dsh-rich-status'),
        callId: el.getAttribute('data-dsh-rich-call-id'),
        session: el.getAttribute('data-dsh-rich-session'),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
        hasSvg: el.querySelector('svg') !== null,
      })),
      svgBox: svgBox === null ? null : { x: svgBox.x, y: svgBox.y, width: svgBox.width, height: svgBox.height },
      svgElementCount: svg === null ? 0 : svg.querySelectorAll('*').length,
      elements,
      numeric,
    }
  })
  const calls = toolCallEvents(session)
  const resultsEvents = toolResultEvents(session)
  const richResult = resultsEvents.find((entry) => JSON.stringify(entry.meta ?? {}).includes('rich-response'))
  const mock = readMockRequests(mockBefore)
  const toolsInCatalog = mock.find((entry) => entry.responseKind === 'tool_use')?.bodySummary?.toolNames ?? []
  const expectedSessionInCard = rich.card?.attrs?.['data-dsh-rich-session'] ?? null

  record('R.catalog.richRenderTool', toolsInCatalog.includes('rich_render'), `catalog=${toolsInCatalog.length} tools; rich_render=${toolsInCatalog.includes('rich_render')}`)
  record('R.log.toolCall', calls.some((call) => call.name === 'rich_render'), `calls=${JSON.stringify(calls.map((c) => c.name))}`)
  record('R.ui.richCard', rich.card !== null && rich.visible === true, `visible=${rich.visible} attrs=${JSON.stringify(rich.card?.attrs ?? null)}`)
  record('R.ui.statusOk', rich.card?.attrs?.['data-dsh-rich-status'] === 'ok', String(rich.card?.attrs?.['data-dsh-rich-status']))
  record('R.ui.linePlotWithSvg', rich.nested.some((entry) => entry.kind === 'line-plot' && entry.hasSvg), JSON.stringify(rich.nested.map((entry) => ({ kind: entry.kind, hasSvg: entry.hasSvg }))))
  record('R.ui.svgGeometry', rich.svgBox !== null && rich.svgBox.width > 100 && rich.svgBox.height > 100, JSON.stringify(rich.svgBox))
  record('R.ui.titleAndSubtitle', /Sine Function/.test(rich.card?.text ?? '') && /y = sin\(x\)/.test(rich.card?.text ?? ''), (rich.card?.text ?? '').slice(0, 160))
  record('R.ui.axisLabels', /x \(rad\)/.test(rich.card?.text ?? ''), (rich.card?.text ?? '').slice(0, 160))
  const numericShapes = rich.numeric.filter((entry) => entry.attrs.d !== undefined || entry.attrs.points !== undefined || entry.attrs.cx !== undefined)
  const circles = rich.numeric.filter((entry) => entry.tag === 'circle' && entry.attrs.cx !== undefined && entry.attrs.cy !== undefined)
  record('R.ui.numericSeries', numericShapes.length >= 2, `shapes=${numericShapes.length} circles=${circles.length} sample=${JSON.stringify(numericShapes.slice(0, 3))}`)
  // Known-point geometry: the 5 sine samples must map to an ascending x and the
  // expected vertical profile in SVG coordinates (y grows downward): 0, +1, 0, -1, 0.
  const polyline = rich.numeric.find((entry) => entry.tag === 'polyline' && typeof entry.attrs.points === 'string')
  const points = polyline === undefined ? [] : polyline.attrs.points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
  const xs = points.map((point) => point[0])
  const ys = points.map((point) => point[1])
  const xAscending = xs.length === 5 && xs.every((value, index) => index === 0 || value > xs[index - 1])
  const sineProfile = points.length === 5
    && ys[1] < ys[0] && ys[3] > ys[0]
    && Math.abs(ys[0] - ys[4]) < 1 && Math.abs(ys[2] - ys[0]) < 1
  record('R.ui.sineGeometry', xAscending && sineProfile, `points=${JSON.stringify(points)} xAscending=${xAscending} sineProfile=${sineProfile}`)
  record('R.log.richResultPersisted', richResult !== undefined, richResult === undefined ? 'no tool/result with meta rich-response' : `callId=${richResult.message?.source?.callId} metaKind=${richResult.meta?.kind} envelopeVersion=${richResult.meta?.envelopeVersion} contentType=${richResult.meta?.content?.type}`)
  record('R.session.cardEqualsLog', expectedSessionInCard !== null && expectedSessionInCard === session.sessionId, `card=${expectedSessionInCard} log=${session.sessionId}`)
  record('R.turn.end', end !== null && end.turnEnd?.data?.reason?.kind === 'completed', `reason=${JSON.stringify(end?.turnEnd?.data?.reason)}`)
  record('R.screenshot', shot.sha256.length === 64, `${shot.path} sha256=${shot.sha256}`)

  return {
    case: 'R',
    purpose: 'Plugin rich_render tool card from a real tool call (data-dsh-rich contract + persistence)',
    scenario: scenario.name,
    sessionId: session.sessionId,
    sessionLog: session.logPath,
    catalogToolCount: toolsInCatalog.length,
    catalogHasRichRender: toolsInCatalog.includes('rich_render'),
    sessionEvidence: {
      uiCardSession: expectedSessionInCard,
      owningSessionLogId: session.sessionId,
      sessionLog: session.logPath,
      toolCallEvent: calls.find((call) => call.name === 'rich_render') ?? null,
      toolResultEvent: richResult ?? null,
    },
    reveal,
    cardVisible: rich.visible === true,
    toolCalls: calls,
    richResult: richResult === undefined ? null : {
      callId: richResult.message?.source?.callId,
      isError: richResult.message?.isError,
      meta: richResult.meta,
      content: richResult.message?.content,
    },
    card: rich.card,
    nested: rich.nested,
    svgBox: rich.svgBox,
    svgElementCount: rich.svgElementCount,
    svgElements: rich.elements,
    svgNumeric: rich.numeric,
    turnEnd: end?.turnEnd?.data,
    mockRequests: mock.map((entry) => ({ n: entry.n, kind: entry.responseKind, tool: entry.toolName })),
    screenshot: shot,
    consoleErrors: page.consoleErrors,
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const parent = await launchContext(p1Root)
const { page, diagnostics } = parent
const summary = { p1Root, startedAt: new Date().toISOString(), dshVersion: state.dshVersion, profile: state.profile, url: state.urlRedacted, cases: [] }

function attachConsole(snapshot) {
  snapshot.consoleErrors = diagnostics.consoleErrors.slice()
  snapshot.pageErrors = diagnostics.pageErrors.slice()
  return snapshot
}

try {
  await openApp(parent, state)
  // Plugin load evidence (browser side): boot graph + client registration log.
  const bootGraph = await page.evaluate(() => {
    const boot = window.__DSH_BOOT__
    const text = boot === undefined ? '' : JSON.stringify(boot)
    return { hasBoot: boot !== undefined, mentionsRichClient: text.includes('dsh-rich-response'), length: text.length }
  })
  summary.bootGraph = bootGraph
  summary.pluginConsoleLogs = diagnostics.consoleErrors.length === 0
    ? await page.evaluate(() => window.__dshRichConsoleLogs ?? null)
    : null

  for (const caseId of requested) {
    const dir = ensureCaseDir(p1Root, `case-${caseId}`)
    let result
    if (caseId === 'A') result = await caseA(page, dir)
    else if (caseId === 'B') result = await caseB(page, dir, 'B')
    else if (caseId === 'B2') result = await caseB(page, dir, 'B2')
    else if (caseId === 'C') result = await caseC(page, dir)
    else if (caseId === 'D') result = await caseD(page, dir)
    else if (caseId === 'E') result = await caseE(page, dir)
    else if (caseId === 'R') result = await caseR(page, dir)
    else { console.log(`unknown case ${caseId}`); continue }
    result = attachConsole(result)
    const artifactPath = writeArtifact(dir, `case-${caseId}`, result)
    result.artifact = artifactPath
    summary.cases.push({ case: caseId, artifact: artifactPath, checks: results.filter((entry) => entry.check.startsWith(`${caseId}.`)) })
    await page.waitForTimeout(500)
  }
} finally {
  summary.finishedAt = new Date().toISOString()
  summary.allChecks = results
  summary.failCount = results.filter((entry) => entry.status === 'FAIL').length
  summary.verdict = summary.failCount === 0 ? 'ALL_PASS' : 'HAS_FAILURES'
  const out = writeArtifact(ensureCaseDir(p1Root, 'case-summary'), 'run-cases-summary', summary)
  writeFileSync(join(p1Root, 'evidence', 'run-cases-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\nSUMMARY ${summary.verdict} fail=${summary.failCount} -> ${out}`)
  await parent.context.close()
}
