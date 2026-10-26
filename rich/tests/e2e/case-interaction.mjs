/**
 * Phase 1 interaction case (Lead-owned, supplementary to run-cases.mjs).
 *
 * Proves the interactive-card loop on the REAL isolated DSH 0.2.1-rc.2 runtime:
 *
 *   rich_render(message_card) tool result
 *     -> card rendered in the transcript (data-dsh-rich contract)
 *     -> click one action
 *     -> official remote.commands call `/rich-interaction <json>` in the SAME session
 *     -> Host audit record (JSONL + durable command events)
 *     -> official composer submission of a follow-up user message in the SAME session
 *     -> mock provider answers that follow-up (turn 2) in the SAME session
 *     -> no new session, no duplicate dispatch on a second click
 *
 * Usage:
 *   node tests/e2e/case-interaction.mjs <p1-root>
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
const caseDir = ensureCaseDir(p1Root, 'case-I')

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const results = []
function record(check, pass, detail) {
  results.push({ check, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${check} :: ${detail}`)
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function decodeZstdJsonl(path) {
  const buf = readFileSync(path)
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) starts.push(i)
  }
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const start = starts[k]
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    try { parts.push(zstdDecompressSync(buf.subarray(start, end))) } catch { /* torn tail while writing */ }
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
      out.push({
        sessionId: header?.id ?? sessionDir,
        dir: sessionDir,
        logPath,
        mtime: statSync(logPath).mtimeMs,
        events,
      })
    }
  }
  return out.sort((a, b) => a.mtime - b.mtime)
}

function readSession(sessionId) {
  return listSessions().find((session) => session.sessionId === sessionId) ?? null
}

function waitForSession(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = listSessions().find(predicate)
    if (match !== undefined) return match
    sleepSync(200)
  }
  return null
}

function waitForTurnEnds(sessionId, count, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const session = readSession(sessionId)
    if (session !== null) {
      const ends = session.events.filter((event) => event.type === 'turn/end')
      if (ends.length >= count) return session
    }
    sleepSync(250)
  }
  return null
}

function activateScenario(name) {
  const source = join(repoRoot, 'tests', 'fixtures', 'scenarios', `${name}.json`)
  const doc = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, ''))
  doc.activatedAt = new Date().toISOString()
  writeFileSync(join(p1Root, 'mock-provider', 'scenarios', 'active.json'), JSON.stringify(doc, null, 2), 'utf8')
  writeFileSync(join(p1Root, 'mock-provider', 'scenarios', `${name}.json`), JSON.stringify(doc, null, 2), 'utf8')
  return doc
}

function readAuditRecords() {
  const dir = join(p1Root, 'logs')
  if (!existsSync(dir)) return { files: [], records: [] }
  const files = readdirSync(dir).filter((name) => name.startsWith('rich-response-audit-') && name.endsWith('.jsonl')).sort()
  const records = []
  for (const file of files) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)) {
      try { records.push(JSON.parse(line)) } catch { /* torn */ }
    }
  }
  return { files, records }
}

async function waitForStopGone(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.getByRole('button', { name: 'Stop generating' }).count() === 0) return true
    await page.waitForTimeout(250)
  }
  return false
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

/** Click New session; the blank session may be reused, so the owning session is
 * identified after sending by its user/message content instead of by id novelty. */
async function newSession(page) {
  const before = new Set(listSessions().map((session) => session.sessionId))
  await page.getByRole('button', { name: 'New session', exact: false }).first().click({ force: true })
  await page.waitForTimeout(1500)
  return { before }
}

async function sendMessage(page, text) {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.type(text, { delay: 5 })
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
}

const scenario = activateScenario('i-message-card')
console.log(`scenario=${scenario.name} url=${state.url.replace(/token=[^&]+/, 'token=***')}`)

const { context, page, diagnostics } = await launchContext(p1Root)
let artifact = null
try {
  await openApp({ page }, state)
  const { before } = await newSession(page)
  const prompt = 'I interaction: show me the checkpoint card.'
  await sendMessage(page, prompt)
  const owning = waitForOwningSession(prompt)
  record('I.session.owningLogFound', owning !== null, `session=${owning?.sessionId ?? 'none'} preexisting=${before.size}`)
  let session = owning === null ? null : waitForTurnEnds(owning.sessionId, 1)
  await waitForStopGone(page)
  await page.waitForTimeout(1500)
  if (session === null) session = owning
  record('I.turn.firstCompleted', session !== null && session.events.some(event => event.type === 'turn/end'), `events=${session?.events.length ?? 0}`)

  const reveal = await revealCards(page)
  const beforeClickShot = await screenshot(page, caseDir, 'I-card-before-click')
  const cardInfo = await page.evaluate(() => {
    const card = document.querySelector('[data-dsh-rich="tool-card"]')
    if (card === null) return null
    const actions = Array.from(card.querySelectorAll('[data-dsh-rich-action]')).map((button) => ({
      actionId: button.getAttribute('data-dsh-rich-action'),
      text: (button.innerText ?? '').trim(),
      disabled: button.disabled,
    }))
    return {
      visible: card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }),
      attrs: Object.fromEntries(Array.from(card.attributes).map((attribute) => [attribute.name, attribute.value])),
      text: (card.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
      actions,
    }
  })
  record('I.ui.cardVisible', cardInfo !== null && cardInfo.visible === true, `visible=${cardInfo?.visible} attrs=${JSON.stringify(cardInfo?.attrs ?? null)}`)
  record('I.ui.messageCard', cardInfo?.attrs?.['data-dsh-rich-status'] === 'ok', `status=${cardInfo?.attrs?.['data-dsh-rich-status']}`)
  record('I.ui.twoActions', cardInfo !== null && cardInfo.actions.length === 2, JSON.stringify(cardInfo?.actions ?? []))
  record('I.ui.questionBody', /Checkpoint/.test(cardInfo?.text ?? '') && /derivative of sin/.test(cardInfo?.text ?? ''), (cardInfo?.text ?? '').slice(0, 160))

  const cardSessionId = cardInfo?.attrs?.['data-dsh-rich-session'] ?? null
  const cardCallId = cardInfo?.attrs?.['data-dsh-rich-call-id'] ?? null
  record('I.session.cardEqualsOwningLog', cardSessionId !== null && session !== null && cardSessionId === session.sessionId,
    `card=${cardSessionId} log=${session?.sessionId ?? 'none'}`)

  const commandsBefore = session === null ? 0 : session.events.filter(event => event.type === 'command/run').length
  const userMessagesBefore = session === null ? 0 : session.events.filter(event => event.type === 'user/message').length

  // One real click on a rendered action button.
  await page.locator('[data-dsh-rich-action="a1"]').first().click({ timeout: 15000 })
  await page.waitForSelector('[data-dsh-rich="action-ack"], [data-dsh-rich="action-error"]', { timeout: 30000 })
  await page.waitForTimeout(1200)
  const afterClickShot = await screenshot(page, caseDir, 'I-card-after-click')
  const ack = await page.evaluate(() => {
    const ackEl = document.querySelector('[data-dsh-rich="action-ack"]')
    const errorEl = document.querySelector('[data-dsh-rich="action-error"]')
    const card = document.querySelector('[data-dsh-rich="tool-card"]')
    return {
      ack: ackEl === null ? null : (ackEl.innerText ?? '').trim(),
      error: errorEl === null ? null : (errorEl.innerText ?? '').trim(),
      status: card?.getAttribute('data-dsh-rich-status') ?? null,
      buttons: Array.from(document.querySelectorAll('[data-dsh-rich-action]')).map((button) => ({
        actionId: button.getAttribute('data-dsh-rich-action'),
        disabled: button.disabled,
        settled: button.getAttribute('data-dsh-rich-settled'),
      })),
    }
  })
  record('I.ui.hostAck', ack.ack !== null && ack.error === null && /rich-interaction recorded/.test(ack.ack), `ack=${JSON.stringify(ack.ack)} error=${JSON.stringify(ack.error)}`)
  record('I.ui.cardSettled', ack.status === 'interacted', `status=${ack.status}`)
  record('I.ui.buttonsDisabledAfterClick', ack.buttons.length === 2 && ack.buttons.every(button => button.disabled === true), JSON.stringify(ack.buttons))

  const attemptMatch = /attempt=([^ )]+)/.exec(ack.ack ?? '')
  const ackAttemptId = attemptMatch === null ? null : attemptMatch[1]
  record('I.ui.ackCarriesAttempt', ackAttemptId !== null, `attemptId=${ackAttemptId}`)

  // The follow-up message must land in the SAME session (turn 2), not a new one.
  const sessionAfter = session === null ? null : waitForTurnEnds(session.sessionId, 2, 90000)
  await waitForStopGone(page)
  await page.waitForTimeout(1500)

  const allSessions = listSessions()
  const newSessionIds = allSessions.map(candidate => candidate.sessionId).filter(id => !before.has(id) && id !== session?.sessionId)
  record('I.session.noNewSessionForFollowUp', newSessionIds.length === 0, `unexpectedNewSessions=${JSON.stringify(newSessionIds)}`)

  const fresh = session === null ? null : readSession(session.sessionId)
  const commandEvents = fresh === null ? [] : fresh.events.filter(event => event.type === 'command/run')
  const userMessages = fresh === null ? [] : fresh.events.filter(event => event.type === 'user/message')
  const commandPayloads = commandEvents.map((event) => {
    const data = event.data ?? {}
    // command/run carries the structured split: { name, args } where args is the
    // verbatim text after the command name (separator whitespace included).
    const line = typeof data.rawInput === 'string'
      ? data.rawInput
      : `/${String(data.name ?? '')}${String(data.args ?? '')}`
    const payloadText = line.includes('/rich-interaction ')
      ? line.slice(line.indexOf('/rich-interaction ') + '/rich-interaction '.length)
      : null
    let payload = null
    try { payload = payloadText === null ? null : JSON.parse(payloadText) } catch { /* not JSON */ }
    return { seq: event.seq, line, payload }
  })
  const interactionCommand = commandPayloads.find(entry => entry.payload?.protocol === 'rich-interaction-v1')
  record('I.host.commandPersisted', interactionCommand !== undefined,
    interactionCommand === undefined ? `commands=${commandEvents.length}` : `seq=${interactionCommand.seq}`)
  record('I.host.commandSameSession',
    interactionCommand?.payload?.sessionId === session?.sessionId,
    `payload=${interactionCommand?.payload?.sessionId} log=${session?.sessionId}`)
  record('I.host.commandCallId',
    interactionCommand?.payload?.callId === cardCallId && interactionCommand?.payload?.cardKey === `${cardCallId}#q-derivative-1`,
    `payloadCallId=${interactionCommand?.payload?.callId} cardCallId=${cardCallId} cardKey=${interactionCommand?.payload?.cardKey}`)
  record('I.host.commandAttemptMatchesAck',
    ackAttemptId !== null && interactionCommand?.payload?.attemptId === ackAttemptId,
    `payloadAttempt=${interactionCommand?.payload?.attemptId} ackAttempt=${ackAttemptId}`)
  record('I.host.commandAction', interactionCommand?.payload?.actionId === 'a1', `actionId=${interactionCommand?.payload?.actionId}`)

  const followUpMessages = userMessages.filter((event) => {
    const text = JSON.stringify(event.data ?? {})
    return text.includes('My answer is cos(x)')
  })
  record('I.session.followUpInSameSession', followUpMessages.length === 1,
    `userMessages=${userMessages.length} followUp=${followUpMessages.length} before=${userMessagesBefore}`)
  record('I.turn.secondCompleted', sessionAfter !== null && sessionAfter.events.filter(event => event.type === 'turn/end').length >= 2,
    `turnEnds=${sessionAfter?.events.filter(event => event.type === 'turn/end').length ?? 0}`)
  record('I.host.singleCommandForClick', commandEvents.length === commandsBefore + 1,
    `commandsBefore=${commandsBefore} commandsAfter=${commandEvents.length}`)

  // The assistant answered the follow-up in the same session.
  const assistantAfterFollowUp = fresh === null ? [] : fresh.events.filter((event) => event.type === 'assistant/message'
    && JSON.stringify(event.data ?? {}).includes('Follow-up accepted in this same session'))
  record('I.session.agentAnsweredFollowUp', assistantAfterFollowUp.length >= 1, `assistantFollowUpMessages=${assistantAfterFollowUp.length}`)

  // A second synthetic click must not dispatch again.
  await page.evaluate(() => {
    const button = document.querySelector('[data-dsh-rich-action="a1"]')
    if (button !== null) button.click()
  })
  await page.waitForTimeout(2000)
  const afterSecondClick = readSession(session?.sessionId ?? '')
  const commandsAfterSecond = afterSecondClick === null ? -1 : afterSecondClick.events.filter(event => event.type === 'command/run').length
  record('I.session.duplicateClickSuppressed', commandsAfterSecond === commandEvents.length,
    `commandsAfterSecond=${commandsAfterSecond} expected=${commandEvents.length}`)

  const audit = readAuditRecords()
  const auditRecord = ackAttemptId === null ? undefined : audit.records.find(item => item.attemptId === ackAttemptId)
  record('I.audit.recordWritten', auditRecord !== undefined,
    `files=${JSON.stringify(audit.files)} records=${audit.records.length}`)
  record('I.audit.sessionMatches', auditRecord?.sessionId === session?.sessionId && auditRecord?.agentId === session?.sessionId,
    `record=${JSON.stringify(auditRecord ?? null).slice(0, 300)}`)
  record('I.audit.notDuplicate', auditRecord?.duplicate === false, `duplicate=${auditRecord?.duplicate}`)

  const finalShot = await screenshot(page, caseDir, 'I-card-final')
  const snapshot = await snapshotUi(page)

  artifact = {
    case: 'I',
    purpose: 'Interactive message_card: click -> Host command -> same-session follow-up -> UI feedback',
    scenario: scenario.name,
    startedAt: new Date().toISOString(),
    runtime: { version: state.dshVersion, profile: state.profile, urlRedacted: state.url.replace(/token=[^&]+/, 'token=***') },
    sessionId: session?.sessionId ?? null,
    sessionLog: session?.logPath ?? null,
    card: cardInfo,
    afterClick: ack,
    command: interactionCommand ?? null,
    followUp: {
      userMessagesBefore,
      userMessagesAfter: userMessages.length,
      followUpMatched: followUpMessages.length,
      turnEnds: sessionAfter?.events.filter(event => event.type === 'turn/end').length ?? 0,
      agentAnswered: assistantAfterFollowUp.length,
    },
    audit: { files: audit.files, record: auditRecord ?? null },
    duplicateClick: { commandsBefore: commandsBefore, commandsAfterFirstClick: commandEvents.length, commandsAfterSecondClick: commandsAfterSecond },
    reveal,
    screenshots: [beforeClickShot, afterClickShot, finalShot],
    snapshot,
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
    checks: results,
    failCount: results.filter(entry => entry.status === 'FAIL').length,
  }
  artifact.verdict = artifact.failCount === 0 ? 'ALL_PASS' : 'HAS_FAILURES'
  const artifactPath = writeArtifact(caseDir, 'case-I', artifact)
  console.log('')
  console.log(`SUMMARY ${artifact.verdict} fail=${artifact.failCount} -> ${artifactPath}`)
  console.log(`evidence sha256: ${sha256OfFile(artifactPath)}`)
} finally {
  await context.close()
}
if (artifact === null || artifact.failCount !== 0) process.exit(1)
