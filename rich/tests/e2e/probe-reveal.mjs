/**
 * Diagnostic: why is the rich tool card in the DOM but not visible in the
 * transcript screenshot? Inspects the card's ancestor chain (collapsed process
 * group / clipping), tries the step disclosure, and screenshots the result.
 *
 * Usage: node tests/e2e/probe-reveal.mjs <p1-root> [sessionTitleSubstring]
 */
import { join } from 'node:path'
import {
  ensureCaseDir, launchContext, loadP1State, openApp, screenshot, writeArtifact,
} from './_harness.mjs'

const p1Root = process.argv[2] ?? 'E:\\Projects\\DSHarness\\_isolated\\study-rich-021rc2-p1'
const titleHint = process.argv[3] ?? 'R rich card'
const outDir = ensureCaseDir(p1Root, 'probe-reveal')
const state = loadP1State(p1Root)
const parent = await launchContext(p1Root)
const { page } = parent

try {
  await openApp(parent, state)
  const opener = page.getByText(new RegExp(titleHint, 'i')).first()
  if (await opener.count() > 0) { await opener.click({ force: true }); await page.waitForTimeout(4000) }

  const inspect = () => page.evaluate(() => {
    const card = document.querySelector('[data-dsh-rich="tool-card"]')
    if (card === null) return { card: null }
    const chain = []
    let node = card
    while (node !== null && chain.length < 14) {
      const style = getComputedStyle(node)
      chain.push({
        tag: node.tagName.toLowerCase(),
        cls: (node.className ?? '').toString().slice(0, 80),
        role: node.getAttribute('role'),
        ariaExpanded: node.getAttribute('aria-expanded'),
        display: style.display,
        visibility: style.visibility,
        overflow: style.overflow,
        height: style.height,
        maxHeight: style.maxHeight,
        hidden: node.hidden === true,
        rect: (() => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })(),
        text: (node.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
      })
      node = node.parentElement
    }
    const completed = Array.from(document.querySelectorAll('*')).filter((el) => /^Completed in \d/.test((el.innerText ?? '').trim()) && (el.innerText ?? '').trim().length < 40).map((el) => ({
      tag: el.tagName.toLowerCase(), cls: (el.className ?? '').toString().slice(0, 80), role: el.getAttribute('role'), ariaExpanded: el.getAttribute('aria-expanded'), text: el.innerText.trim().slice(0, 40), children: el.children.length,
    }))
    return { chain, completed }
  })

  const before = await inspect()
  await screenshot(page, outDir, '01-before-reveal')

  const clicked = []
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const hit = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, [role="button"], [data-disclosure-row], div, span'))
      const matches = all.filter((el) => /^Completed in \d/.test((el.innerText ?? '').trim()) && (el.innerText ?? '').trim().length < 40)
      if (matches.length === 0) return null
      // deepest match with the shortest text is the clickable header text
      const el = matches.sort((a, b) => (a.innerText ?? '').length - (b.innerText ?? '').length)[0]
      const target = el.closest('[role="button"], button, [data-disclosure-row]') ?? el
      target.click()
      return { tag: target.tagName.toLowerCase(), text: (target.innerText ?? '').trim().slice(0, 50), cls: (target.className ?? '').toString().slice(0, 60) }
    })
    if (hit === null) break
    clicked.push(hit)
    await page.waitForTimeout(900)
  }
  const after = await inspect()
  const shot = await screenshot(page, outDir, '02-after-reveal')
  const artifact = { titleHint, clicked, before, after, shot }
  writeArtifact(outDir, 'probe-reveal', artifact)
  console.log(JSON.stringify({ clicked, beforeCompleted: before.completed, afterCompleted: after.completed, chain: after.chain, shot }, null, 2))
} finally {
  await parent.context.close()
}
