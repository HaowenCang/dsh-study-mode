/**
 * Phase 1 session-switch case (Lead-owned supplementary probe).
 *
 * Two sessions each own a rich_render card. The probe switches sessions through
 * the real sidebar and asserts the rendered card always belongs to the currently
 * selected session (data-dsh-rich-session), including a fast A -> B -> A switch.
 * This covers the "rendering a card with another session's data" risk.
 *
 * Usage:
 *   node tests/e2e/case-session-switch.mjs <p1-root>
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import {
  ensureCaseDir, launchContext, loadP1State, openApp, revealCards, screenshot,
  sha256OfFile, snapshotUi, writeArtifact,
} from './_harness.mjs'

const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const repoRoot = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const state = loadP1State(p1Root)
const caseDir = ensureCaseDir(p1Root, 'case-S')

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

/** Click one sidebar session row by its visible title. */
async function clickSidebarSession(page, title) {
  const clicked = await page.evaluate((wanted) => {
    const isSidebar = (element) => element.closest('aside, nav, [class*="sidebar" i]') !== null
    const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], [tabindex], div'))
    const matches = candidates.filter((element) => {
      if (!isSidebar(element)) return false
      const text = (element.innerText ?? '').trim()
      if (!text.startsWith(wanted)) return false
      // Prefer the clickable row over an inner span.
      return element.querySelector('[aria-label^="Session actions for"]') !== null || element.getAttribute('role') === 'button' || element.tagName === 'A' || element.tagName === 'BUTTON'
    })
    const target = matches[0] ?? null
    if (target === null) return false
    target.click()
    return true
  }, title)
  await page.waitForTimeout(1600)
  return clicked
}

async function currentCards(page) {
  await revealCards(page)
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-dsh-rich="tool-card"]')).map((card) => ({
    session: card.getAttribute('data-dsh-rich-session'),
    callId: card.getAttribute('data-dsh-rich-call-id'),
    status: card.getAttribute('data-dsh-rich-status'),
    text: (card.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
  })))
}

activateScenario('r-rich-render')
const { context, page, diagnostics } = await launchContext(p1Root)
let artifact = null
try {
  await openApp({ page }, state)
  const promptA = 'Alpha session card please'
  const promptB = 'Beta session card please'

  await newSession(page)
  await sendMessage(page, promptA)
  const sessionA = waitForOwningSession(promptA)
  record('S.sessionA.found', sessionA !== null, `session=${sessionA?.sessionId ?? 'none'}`)
  waitForTurnEnds(sessionA?.sessionId, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)
  const cardsA = await currentCards(page)
  const shotA = await screenshot(page, caseDir, 'S-session-A')

  activateScenario('r-rich-render')
  await newSession(page)
  await sendMessage(page, promptB)
  const sessionB = waitForOwningSession(promptB)
  record('S.sessionB.found', sessionB !== null, `session=${sessionB?.sessionId ?? 'none'}`)
  waitForTurnEnds(sessionB?.sessionId, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1200)
  const cardsB = await currentCards(page)
  const shotB = await screenshot(page, caseDir, 'S-session-B')

  record('S.a.distinctSessions', sessionA !== null && sessionB !== null && sessionA.sessionId !== sessionB.sessionId,
    `A=${sessionA?.sessionId} B=${sessionB?.sessionId}`)
  record('S.b.cardMatchesSession', cardsB.length >= 1 && cardsB.every(card => card.session === sessionB?.sessionId),
    `cards=${JSON.stringify(cardsB.map(card => card.session))} expected=${sessionB?.sessionId}`)
  record('S.a.cardMatchesSession', cardsA.length >= 1 && cardsA.every(card => card.session === sessionA?.sessionId),
    `cards=${JSON.stringify(cardsA.map(card => card.session))} expected=${sessionA?.sessionId}`)

  // Fast switch B -> A -> B -> A and assert the final visible card is A's.
  const titleA = 'Alpha session card please'
  const titleB = 'Beta session card please'
  const clickA1 = await clickSidebarSession(page, titleA)
  const afterA1 = await currentCards(page)
  const clickB = await clickSidebarSession(page, titleB)
  const afterB = await currentCards(page)
  const clickA2 = await clickSidebarSession(page, titleA)
  await page.waitForTimeout(600)
  const afterA2 = await currentCards(page)
  const shotSwitch = await screenshot(page, caseDir, 'S-fast-switch-back-to-A')

  record('S.ui.sidebarClicks', clickA1 && clickB && clickA2, `A1=${clickA1} B=${clickB} A2=${clickA2}`)
  record('S.switch.toA', afterA1.length >= 1 && afterA1.every(card => card.session === sessionA?.sessionId),
    `after=${JSON.stringify(afterA1.map(card => card.session))}`)
  record('S.switch.toB', afterB.length >= 1 && afterB.every(card => card.session === sessionB?.sessionId),
    `after=${JSON.stringify(afterB.map(card => card.session))}`)
  record('S.switch.fastBackToA', afterA2.length >= 1 && afterA2.every(card => card.session === sessionA?.sessionId),
    `after=${JSON.stringify(afterA2.map(card => card.session))}`)
  record('S.switch.cardIdsDistinct', cardsA[0]?.callId !== cardsB[0]?.callId,
    `A=${cardsA[0]?.callId} B=${cardsB[0]?.callId}`)
  record('S.ui.noConsoleErrors', diagnostics.consoleErrors.length === 0 && diagnostics.pageErrors.length === 0,
    `console=${JSON.stringify(diagnostics.consoleErrors.slice(0, 3))} page=${JSON.stringify(diagnostics.pageErrors.slice(0, 3))}`)

  const snapshot = await snapshotUi(page)
  artifact = {
    case: 'S',
    purpose: 'Two sessions own one rich card each; sidebar switching never renders another session data',
    startedAt: new Date().toISOString(),
    sessions: { A: sessionA?.sessionId ?? null, B: sessionB?.sessionId ?? null },
    cardsA,
    cardsB,
    switchSequence: {
      toA: afterA1,
      toB: afterB,
      fastBackToA: afterA2,
      clicks: { A1: clickA1, B: clickB, A2: clickA2 },
    },
    screenshots: [shotA, shotB, shotSwitch],
    snapshot,
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
    checks: results,
    failCount: results.filter(entry => entry.status === 'FAIL').length,
  }
  artifact.verdict = artifact.failCount === 0 ? 'ALL_PASS' : 'HAS_FAILURES'
  const artifactPath = writeArtifact(caseDir, 'case-S', artifact)
  console.log('')
  console.log(`SUMMARY ${artifact.verdict} fail=${artifact.failCount} -> ${artifactPath}`)
  console.log(`evidence sha256: ${sha256OfFile(artifactPath)}`)
} finally {
  await context.close()
}
if (artifact === null || artifact.failCount !== 0) process.exit(1)
