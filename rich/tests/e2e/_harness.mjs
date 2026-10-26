/**
 * Shared harness for the Phase 1 real-browser E2E probes.
 *
 * Playwright lives in the ISOLATED p1 root (`<p1>/browser-test-data/node_modules`,
 * installed with a local npm cache) while the probe scripts live in this repo.
 * Node resolves bare imports from the importing FILE, so the package is loaded
 * by absolute path through createRequire — no NODE_PATH tricks, no global install.
 *
 * Every probe:
 *   - drives the real isolated Web app URL recorded in <p1>/logs/web-state.json
 *   - uses the system Edge binary and a persistent user-data dir under the p1 root
 *   - writes machine-readable JSON + PNG screenshots under <p1>/evidence/<case>
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export const EDGE_EXE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/** Load playwright-core from the isolated p1 browser-test-data directory. */
export function loadPlaywright(p1Root) {
  const require = createRequire(import.meta.url)
  const packageDir = resolve(p1Root, 'browser-test-data', 'node_modules', 'playwright-core')
  if (!existsSync(packageDir)) {
    throw new Error(`playwright-core missing at ${packageDir}; run the p1 browser-test-data npm install`)
  }
  return require(packageDir)
}

export function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

export function loadP1State(p1Root) {
  const statePath = join(p1Root, 'logs', 'web-state.json')
  if (!existsSync(statePath)) throw new Error(`web not running: ${statePath} missing`)
  return readJsonFile(statePath)
}

/** p1 evidence case directory: <p1>/evidence/<case> */
export function ensureCaseDir(p1Root, caseName) {
  const dir = join(p1Root, 'evidence', caseName)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Write a JSON artifact and return its path. */
export function writeArtifact(dir, name, value) {
  const path = join(dir, name.endsWith('.json') ? name : `${name}.json`)
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
  return path
}

/** Launch the system Edge headless with a persistent profile inside p1. */
export async function launchContext(p1Root, options = {}) {
  const { chromium } = loadPlaywright(p1Root)
  const userDataDir = options.userDataDir ?? join(p1Root, 'browser-test-data', 'user-data')
  mkdirSync(userDataDir, { recursive: true })
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: EDGE_EXE,
    headless: options.headless !== false,
    viewport: options.viewport ?? { width: 1440, height: 1000 },
    args: ['--no-first-run', '--no-default-browser-check'],
  })
  const page = context.pages()[0] ?? await context.newPage()
  const diagnostics = { consoleErrors: [], pageErrors: [], requests: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => diagnostics.pageErrors.push(String(error?.message ?? error)))
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/api/')) diagnostics.requests.push({ method: request.method(), url: redactUrl(url) })
  })
  return { context, page, diagnostics }
}

export function redactUrl(url) {
  return String(url).replace(/token=[^&]+/g, 'token=***')
}

/** Escape-driven overlay dismissal (welcome notice / dialogs), tolerant when absent. */
export async function dismissOverlays(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const hasDialog = await page.evaluate(() =>
      document.querySelector('[role="dialog"], [aria-modal="true"]') !== null)
    if (!hasDialog) return false
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(350)
    const close = page.locator('[role="dialog"] button[aria-label*="Close" i], [aria-modal="true"] button[aria-label*="Close" i], [role="dialog"] button').first()
    if (await close.count() > 0) await close.click({ force: true }).catch(() => {})
    await page.waitForTimeout(350)
  }
  return true
}

/** Navigate to the isolated app root and wait until the shell is interactive. */
export async function openApp(parent, state, options = {}) {
  const { page } = parent
  await page.goto(state.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(options.settleMs ?? 5000)
  await dismissOverlays(page)
  // The shell is ready when the composer or the primary navigation exists.
  await page.waitForFunction(() =>
    document.querySelector('textarea, [contenteditable="true"]') !== null
    || document.body.innerText.includes('New Session')
    || document.body.innerText.includes('New session'), null, { timeout: options.readyTimeoutMs ?? 45000 })
  await page.waitForTimeout(500)
  return page
}

export async function screenshot(page, dir, name) {
  const path = join(dir, name.endsWith('.png') ? name : `${name}.png`)
  await page.screenshot({ path })
  return { path, sha256: sha256OfFile(path) }
}

/** Structure snapshot used by every assertion in the probes. */
export async function snapshotUi(page) {
  return page.evaluate(() => {
    const toolRows = Array.from(document.querySelectorAll('[data-chat-call-id]')).map((row) => {
      const stateEl = row.querySelector('[data-state]')
      return {
        callId: row.getAttribute('data-chat-call-id'),
        anchor: row.getAttribute('data-chat-anchor-key'),
        state: stateEl?.getAttribute('data-state') ?? null,
        tool: stateEl?.getAttribute('data-tool') ?? null,
        variant: stateEl?.getAttribute('data-variant') ?? null,
        text: (row.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 300),
      }
    })
    const richCards = Array.from(document.querySelectorAll('[data-dsh-rich]')).map((el) => ({
      kind: el.getAttribute('data-dsh-rich'),
      status: el.getAttribute('data-dsh-rich-status'),
      callId: el.getAttribute('data-dsh-rich-call-id'),
      session: el.getAttribute('data-dsh-rich-session'),
      text: (el.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 300),
      hasSvg: el.querySelector('svg') !== null,
    }))
    const composer = document.querySelector('textarea, [contenteditable="true"]')
    return {
      toolRows,
      richCards,
      composer: composer === null ? null : {
        tag: composer.tagName.toLowerCase(),
        placeholder: composer.getAttribute('placeholder'),
        ariaLabel: composer.getAttribute('aria-label'),
      },
      buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
        text: (button.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
        disabled: button.disabled,
      })).filter((button) => button.text !== '' || button.ariaLabel !== null || button.title !== null).slice(0, 80),
      bodyText: document.body.innerText.slice(0, 4000),
    }
  })
}

/** All page text, for soft checks such as an echoed assistant reply. */
export async function pageText(page) {
  return page.evaluate(() => document.body.innerText)
}

/**
 * Expand the transcript's collapsed process groups so a tool card is actually
 * visible. DSH 0.2.1-rc.2 nests tool rows under two disclosures: the step group
 * ("Completed in 1s") and the tool group ("Called tools"); both default closed
 * after a turn settles. Clicks only real disclosure buttons and stops as soon as
 * a tool card passes `checkVisibility` (which accounts for content-visibility).
 */
export async function revealCards(page, attempts = 8) {
  const steps = []
  const labels = /^(Completed in \d|Called tools|Updated the plan|Failed in \d|Stopped|Running for|Worked for|Thought for)/
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const state = await page.evaluate((labelSource) => {
      const re = new RegExp(labelSource)
      const cardElements = Array.from(document.querySelectorAll('[data-dsh-rich="tool-card"], [data-chat-call-id]'))
      const visible = cardElements.some((card) => card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }))
      let clicked = null
      let blockerReason = null
      if (!visible && cardElements.length > 0) {
        // First choice: a collapsed disclosure header with a known label
        // ("Completed in 1s", "Called tools", "Updated the plan", …), preferring
        // the label match over any icon-only button.
        const collapsed = Array.from(document.querySelectorAll('button[aria-expanded="false"], [role="button"][aria-expanded="false"], [data-disclosure-row][aria-expanded="false"]'))
        const withText = collapsed.filter((element) => (element.innerText ?? '').trim() !== '')
        const preferred = withText.find((element) => re.test((element.innerText ?? '').trim()))
        let target = preferred ?? null
        if (target === null) {
          // Fallback: walk up to the nearest hidden blocker and click its header.
          const card = cardElements[0]
          let node = card.parentElement
          let blocker = null
          for (let depth = 0; node !== null && depth < 14; depth += 1, node = node.parentElement) {
            const style = getComputedStyle(node)
            if (style.contentVisibility === 'hidden' || (node.clientHeight === 0 && node.scrollHeight > 0)) { blocker = node; break }
          }
          if (blocker !== null) {
            blockerReason = { cls: (blocker.className ?? '').toString().slice(0, 60), h: blocker.clientHeight, scrollH: blocker.scrollHeight }
            const scope = blocker.parentElement ?? blocker
            const candidates = Array.from(scope.querySelectorAll('button, [role="button"], [data-disclosure-row], [data-disclosure-header]'))
            target = candidates.find((candidate) => (candidate.innerText ?? '').trim() !== '') ?? candidates[0] ?? null
          }
        }
        if (target !== null) {
          target.click()
          clicked = ((target.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)) || (target.getAttribute('aria-label') ?? '').slice(0, 40)
        }
      }
      return { cardCount: cardElements.length, visible, clicked, blockerReason }
    }, labels.source)
    steps.push({ attempt, ...state })
    if (state.visible || state.clicked === null) break
    await page.waitForTimeout(900)
  }
  const visible = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-dsh-rich="tool-card"], [data-chat-call-id]'))
    return cards.some((card) => card.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }))
  })
  return { steps, visible }
}
