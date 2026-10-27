/**
 * Phase 1 render-variant cases (Lead-owned supplementary probe).
 *
 * F: the model sends an INVALID rich_render payload. The Host validator must
 *    fail the tool call (isError in the durable log) and the registered Tool
 *    view must render its explicit error card, not crash or fall back silently.
 * V: two valid variants rendered in the real UI from real tool results:
 *    a two-series scatter plot with duplicate x values, and a basic diagram.
 *
 * Usage:
 *   node tests/e2e/case-variants.mjs <p1-root>
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import {
  dismissOverlays, ensureCaseDir, launchContext, loadP1State, openApp, pageText,
  revealCards, screenshot, sha256OfFile, snapshotUi, writeArtifact,
} from './_harness.mjs'

const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const repoRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const state = loadP1State(p1Root)
const caseDir = ensureCaseDir(p1Root, 'case-V')

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const results = []
function record(check, pass, detail) {
  results.push({ check, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${check} :: ${detail}`)
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

function decodeZstdJsonl(path) {
  const buf = readFileSync(path)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) starts.push(i)
  }
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(starts[k], end))) } catch { /* torn */ }
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)
}

function listSessions() {
  const root = join(p1Root, 'dsh-home', 'sessions')
  const out = []
  if (!existsSync(root)) return out
  for (const workspace of readdirSync(root)) {
    const workspacePath = join(root, workspace)
    if (!statSync(workspacePath).isDirectory()) continue
    for (const sessionDir of readdirSync(workspacePath)) {
      const logPath = join(workspacePath, sessionDir, 'session.v4.jsonl.zstd')
      if (!existsSync(logPath)) continue
      const events = []
      for (const line of decodeZstdJsonl(logPath)) { try { events.push(JSON.parse(line)) } catch { /* torn */ } }
      const header = events.find((event) => event.type === 'session')
      out.push({ sessionId: header?.id ?? sessionDir, events, mtime: statSync(logPath).mtimeMs })
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime)
}

function waitForOwningSession(text, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = listSessions().find((session) => session.events.some((event) =>
      event.type === 'user/message' && JSON.stringify(event.data ?? {}).includes(text)))
    if (match !== undefined) return match
    sleepSync(250)
  }
  return null
}

function waitForTurnEnds(sessionId, count, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = listSessions().find((candidate) => candidate.sessionId === sessionId)
    if (session !== undefined && session.events.filter((event) => event.type === 'turn/end').length >= count) return session
    sleepSync(250)
  }
  return null
}

function activateScenario(name) {
  const doc = JSON.parse(readFileSync(join(repoRoot, 'tests', 'fixtures', 'scenarios', `${name}.json`), 'utf8').replace(/^\uFEFF/, ''))
  doc.activatedAt = new Date().toISOString()
  writeFileSync(join(p1Root, 'mock-provider', 'scenarios', 'active.json'), JSON.stringify(doc, null, 2), 'utf8')
}

async function waitForStopGone(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.getByRole('button', { name: 'Stop generating' }).count() === 0) return true
    await page.waitForTimeout(250)
  }
  return false
}

async function sendMessage(page, text) {
  await dismissOverlays(page)
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.type(text, { delay: 5 })
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
}

async function newSession(page) {
  await page.getByRole('button', { name: 'New session', exact: false }).first().click({ force: true })
  await page.waitForTimeout(1200)
}

/** Expand every collapsed transcript disclosure (each turn has its own). */
async function expandAllDisclosures(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const clicked = await page.evaluate(() => {
      // Only transcript disclosure headers; unrelated aria-expanded controls
      // (usage panels, menus) would open dialogs and block later clicks.
      const disclosure = /^(Completed in \d|Called tools|Updated the plan|Failed in \d|Stopped|Running for|Worked for|Thought for)/
      const list = Array.from(document.querySelectorAll('[aria-expanded="false"]'))
        .filter((element) => disclosure.test((element.innerText ?? '').trim()))
      list.slice(0, 6).forEach((element) => element.click())
      return list.length
    })
    if (clicked === 0) return
    await page.waitForTimeout(600)
  }
}

async function cards(page) {
  await expandAllDisclosures(page)
  await revealCards(page)
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-dsh-rich="tool-card"]')).map((card) => {
    const attrs = Object.fromEntries(Array.from(card.attributes).map((attribute) => [attribute.name, attribute.value]))
    const kinds = Array.from(card.querySelectorAll('[data-dsh-rich]')).map((el) => el.getAttribute('data-dsh-rich'))
    const svg = card.querySelector('svg')
    const numeric = svg === null ? [] : Array.from(svg.querySelectorAll('circle,rect,polyline,path,text')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      cx: el.getAttribute('cx'),
      cy: el.getAttribute('cy'),
      x: el.getAttribute('x'),
      y: el.getAttribute('y'),
      points: el.getAttribute('points'),
      text: (el.textContent ?? '').slice(0, 30),
    }))
    return {
      visible: card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }),
      attrs,
      kinds,
      // textContent works even when the card is inside a collapsed
      // content-visibility group (innerText returns empty there).
      text: (card.textContent ?? '').replace(/\s+/g, ' ').slice(0, 500),
      hasSvg: svg !== null,
      circles: numeric.filter((entry) => entry.tag === 'circle' && entry.cx !== null).map((entry) => ({ cx: entry.cx, cy: entry.cy })),
      rects: numeric.filter((entry) => entry.tag === 'rect').map((entry) => ({ x: entry.x, y: entry.y })),
      labels: numeric.filter((entry) => entry.tag === 'text' && entry.text !== '').map((entry) => entry.text),
    }
  }))
}

activateScenario('f-rich-invalid')
const { context, page, diagnostics } = await launchContext(p1Root)
let artifact = null
try {
  await openApp({ page }, state)

  // ---- F: invalid payload must fail the tool call and render the error card ----
  await newSession(page)
  const promptF = 'F invalid rich payload please'
  await sendMessage(page, promptF)
  const sessionF = waitForOwningSession(promptF)
  record('F.session.found', sessionF !== null, `session=${sessionF?.sessionId ?? 'none'}`)
  const afterF = waitForTurnEnds(sessionF?.sessionId, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)
  const cardsF = await cards(page)
  const errorCard = cardsF.find((card) => card.kinds.includes('error-state'))
  const shotF = await screenshot(page, caseDir, 'F-invalid-payload-error-card')
  const freshF = sessionF === null ? null : listSessions().find((session) => session.sessionId === sessionF.sessionId)
  const toolResultsF = freshF === null ? [] : freshF.events.filter((event) => event.type === 'tool/result')
  const errorResult = toolResultsF.find((event) => event.data?.message?.isError === true)
  record('F.ui.errorCard', errorCard !== undefined, `cards=${JSON.stringify(cardsF.map((card) => card.kinds))}`)
  record('F.ui.statusError', errorCard?.attrs['data-dsh-rich-status'] === 'error', `status=${errorCard?.attrs['data-dsh-rich-status']}`)
  record('F.ui.errorText', /工具调用失败|tool call failed/i.test(errorCard?.text ?? ''), (errorCard?.text ?? '').slice(0, 200))
  record('F.log.toolResultIsError', errorResult !== undefined, `results=${toolResultsF.length} isError=${errorResult?.data?.message?.isError}`)
  record('F.log.validationCode', JSON.stringify(errorResult?.data ?? {}).includes('INVALID_TITLE')
    || JSON.stringify(errorResult?.data ?? {}).includes('NON_FINITE_NUMBER'),
    JSON.stringify(errorResult?.data?.message?.content ?? []).slice(0, 260))
  record('F.turn.end', afterF !== null, `turnEnds=${afterF?.events.filter((event) => event.type === 'turn/end').length ?? 0}`)

  // ---- V: scatter + diagram from real tool results ---------------------------
  activateScenario('v-scatter-and-diagram')
  await newSession(page)
  const promptV1 = 'V scatter chart please'
  await sendMessage(page, promptV1)
  const sessionV = waitForOwningSession(promptV1)
  record('V.session.found', sessionV !== null, `session=${sessionV?.sessionId ?? 'none'}`)
  waitForTurnEnds(sessionV?.sessionId, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)
  const cardsV1 = await cards(page)
  const scatterCard = cardsV1.find((card) => card.kinds.includes('scatter-plot'))
  const shotV1 = await screenshot(page, caseDir, 'V-scatter-card')
  record('V.ui.scatterCard', scatterCard !== undefined && scatterCard.visible === true, `kinds=${JSON.stringify(cardsV1.map((card) => card.kinds))}`)
  record('V.ui.scatterCircles', scatterCard !== undefined && scatterCard.circles.length === 7, `circles=${scatterCard?.circles.length}`)
  record('V.ui.scatterDuplicateX', scatterCard !== undefined && scatterCard.circles.length >= 3
    && scatterCard.circles[0].cx === scatterCard.circles[1].cx && scatterCard.circles[1].cx === scatterCard.circles[2].cx,
    JSON.stringify(scatterCard?.circles.slice(0, 4)))
  record('V.ui.scatterUnits', /time \(s\)/.test(scatterCard?.text ?? '') && /value/.test(scatterCard?.text ?? ''), (scatterCard?.text ?? '').slice(0, 200))

  const promptV2 = 'V diagram please'
  await sendMessage(page, promptV2)
  waitForOwningSession(promptV2)
  waitForTurnEnds(sessionV?.sessionId, 2)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)
  const cardsV2 = await cards(page)
  const diagramCard = cardsV2.find((card) => card.kinds.includes('basic-diagram'))
  const shotV2 = await screenshot(page, caseDir, 'V-diagram-card')
  record('V.ui.diagramCard', diagramCard !== undefined && diagramCard.attrs['data-dsh-rich-status'] === 'ok',
    `kinds=${JSON.stringify(cardsV2.map((card) => card.kinds))} status=${diagramCard?.attrs['data-dsh-rich-status']}`)
  record('V.ui.diagramNodes', diagramCard !== undefined
    && ['Question', 'Hint requested', 'Answer'].every(label => diagramCard.labels.includes(label)),
    `rects=${diagramCard?.rects.length} labels=${JSON.stringify(diagramCard?.labels)}`)
  record('V.ui.diagramEdges', diagramCard !== undefined
    && diagramCard.labels.some(label => label.includes('needs help'))
    && diagramCard.labels.some(label => label.includes('direct')),
    JSON.stringify(diagramCard?.labels))

  const snapshot = await snapshotUi(page)
  const pageTextAll = await pageText(page)
  record('V.ui.noConsoleErrors', diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0,
    `console=${JSON.stringify(diagnostics.consoleErrors.slice(0, 3))} page=${JSON.stringify(diagnostics.pageErrors.slice(0, 3))}`)

  artifact = {
    case: 'FV',
    purpose: 'Invalid rich payload fails safely; scatter and diagram render from real tool results',
    startedAt: new Date().toISOString(),
    invalidPayload: { sessionId: sessionF?.sessionId ?? null, cards: cardsF, toolResults: toolResultsF, screenshot: shotF },
    scatter: { sessionId: sessionV?.sessionId ?? null, card: scatterCard ?? null, screenshot: shotV1 },
    diagram: { card: diagramCard ?? null, screenshot: shotV2 },
    snapshot,
    pageTextTail: pageTextAll.slice(-800),
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
    checks: results,
    failCount: results.filter(entry => entry.status === 'FAIL').length,
  }
  artifact.verdict = artifact.failCount === 0 ? 'ALL_PASS' : 'HAS_FAILURES'
  const artifactPath = writeArtifact(caseDir, 'case-V', artifact)
  console.log('')
  console.log(`SUMMARY ${artifact.verdict} fail=${artifact.failCount} -> ${artifactPath}`)
  console.log(`evidence sha256: ${sha256OfFile(artifactPath)}`)
} finally {
  await context.close()
}
if (artifact === null || artifact.failCount !== 0) process.exit(1)
