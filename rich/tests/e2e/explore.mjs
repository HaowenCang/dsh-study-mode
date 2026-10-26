/**
 * UI reconnaissance probe for the isolated DSH 0.2.1-rc.2 Web app.
 *
 * Prints the DOM surface a headless test needs: composer element, send/stop
 * controls, buttons, session controls, and every data-* attribute family. Run
 * this before writing assertions; it is not an acceptance test.
 *
 * Usage:
 *   node tests/e2e/explore.mjs <p1-root>
 */
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  launchContext, loadP1State, openApp, snapshotUi, screenshot, ensureCaseDir, writeArtifact,
} from './_harness.mjs'

const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const outDir = ensureCaseDir(p1Root, 'explore')
const state = loadP1State(p1Root)
const parent = await launchContext(p1Root)
const { page, diagnostics } = parent

try {
  await openApp(parent, state)

  async function dump(tag, extra = {}) {
    const snapshot = await snapshotUi(page)
    const shot = await screenshot(page, outDir, tag)
    const artifact = { tag, at: new Date().toISOString(), ...extra, snapshot, ...shot }
    writeArtifact(outDir, tag, artifact)
    console.log(`--- ${tag} ---`)
    console.log(JSON.stringify({
      composer: snapshot.composer,
      toolRows: snapshot.toolRows,
      buttons: snapshot.buttons.slice(0, 40),
      bodyHead: snapshot.bodyText.slice(0, 500),
    }, null, 2))
    return artifact
  }

  await dump('01-loaded')

  // Try the obvious "new session" affordance.
  const newSession = page.getByRole('button', { name: /new session/i }).first()
  const hasNew = await newSession.count()
  console.log('newSession buttons:', hasNew)
  if (hasNew > 0) {
    await newSession.click({ force: true })
    await page.waitForTimeout(3000)
    await dump('02-after-new-session')
  }

  // Type a message and send it, to learn the send path and the request shape.
  const composer = page.locator('textarea, [contenteditable="true"]').first()
  if (await composer.count() > 0) {
    await composer.click()
    await composer.type('Hello from the exploration probe. Reply with a short sentence.', { delay: 15 })
    await page.waitForTimeout(500)
    await dump('03-composer-typed')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(6000)
    await dump('04-after-enter')
    writeFileSync(join(outDir, 'requests.json'), JSON.stringify(diagnostics.requests.slice(-40), null, 2))
  } else {
    console.log('no composer found')
  }

  console.log('--- console errors ---')
  console.log(JSON.stringify(diagnostics.consoleErrors, null, 2))
  console.log('--- page errors ---')
  console.log(JSON.stringify(diagnostics.pageErrors, null, 2))
} finally {
  await parent.context.close()
}
