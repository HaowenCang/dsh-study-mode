/**
 * Phase-visibility diagnostic (pre-acceptance): activates the slow scenario,
 * sends one message through the real composer, and samples the transcript DOM
 * every 250ms so we can learn the exact in-progress markers before writing
 * assertions. Also records the stop control while a turn runs.
 *
 * Usage: node tests/e2e/probe-phases.mjs <p1-root>
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureCaseDir, launchContext, loadP1State, openApp, screenshot, writeArtifact,
} from './_harness.mjs'

const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const scenarioName = process.argv[3] ?? 'c-slow-stream'
const outDir = ensureCaseDir(p1Root, 'probe-phases')
const state = loadP1State(p1Root)

// Activate the scenario. The mock re-reads this file per request and resets its
// cursor whenever the bytes change, so stamp it to force a reset on every run.
const scenarioPath = join(p1Root, 'mock-provider', 'scenarios', `${scenarioName}.json`)
const activePath = join(p1Root, 'mock-provider', 'scenarios', 'active.json')
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
scenario.activatedAt = new Date().toISOString()
writeFileSync(activePath, JSON.stringify(scenario, null, 2), 'utf8')

const parent = await launchContext(p1Root)
const { page, diagnostics } = parent

const sample = async () => page.evaluate(() => ({
  toolRows: Array.from(document.querySelectorAll('[data-chat-call-id]')).map((row) => {
    const stateEl = row.querySelector('[data-state]')
    return {
      callId: row.getAttribute('data-chat-call-id'),
      state: stateEl?.getAttribute('data-state') ?? null,
      tool: stateEl?.getAttribute('data-tool') ?? null,
      text: (row.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
      html: row.outerHTML.slice(0, 1200),
    }
  }),
  buttons: Array.from(document.querySelectorAll('button')).filter((button) => {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.innerText ?? ''}`.toLowerCase()
    return /stop|cancel|abort|interrupt|send/.test(label)
  }).map((button) => ({
    ariaLabel: button.getAttribute('aria-label'),
    text: (button.innerText ?? '').trim().slice(0, 40),
    disabled: button.disabled,
  })),
  assistantText: Array.from(document.querySelectorAll('[class*="assistant"], [data-chat-anchor-key]')).length,
  bodyLen: document.body.innerText.length,
}))

try {
  await openApp(parent, state)
  await page.getByRole('button', { name: 'New session', exact: false }).first().click({ force: true })
  await page.waitForTimeout(1500)

  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.type('PHASE-PROBE slow tool call', { delay: 8 })
  await page.waitForTimeout(300)
  const message = 'PHASE-PROBE slow tool call'
  await page.keyboard.press('Enter')

  const timeline = []
  const shots = []
  const seenStates = new Set()
  const started = Date.now()
  for (let i = 0; i < 100; i += 1) {
    const data = await sample()
    const at = Date.now() - started
    timeline.push({ at, states: data.toolRows.map((row) => row.state), tools: data.toolRows.map((row) => row.tool), buttons: data.buttons, bodyLen: data.bodyLen })
    for (const row of data.toolRows) {
      const key = `${row.callId}:${row.state}`
      if (!seenStates.has(key)) {
        seenStates.add(key)
        const shot = await screenshot(page, outDir, `phase-${row.state}-${seenStates.size}`)
        shots.push({ key, at, ...shot, text: row.text, html: row.html })
      }
    }
    const settled = data.toolRows.length > 0 && data.toolRows.every((row) => ['ok', 'error', 'stopped'].includes(row.state))
    if (settled && at > 3000) break
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(1500)
  const final = await sample()
  const finalShot = await screenshot(page, outDir, 'final')
  const artifact = {
    scenarioName,
    startedAt: new Date(started).toISOString(),
    message,
    timeline,
    seenStates: Array.from(seenStates),
    shots,
    final,
    finalShot,
    consoleErrors: diagnostics.consoleErrors,
    pageErrors: diagnostics.pageErrors,
  }
  writeArtifact(outDir, 'probe-phases', artifact)
  console.log(JSON.stringify({ seenStates: artifact.seenStates, shots: shots.map((s) => ({ key: s.key, path: s.path, text: s.text })), final: final.toolRows, buttonsInTurn: timeline.flatMap((t) => t.buttons).slice(0, 12) }, null, 2))
} finally {
  await parent.context.close()
}
