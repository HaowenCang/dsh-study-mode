/**
 * Package contract of the published dsh-study-mode bundle: the DSH bundle
 * manifest, one Loader row per client package, the committed lib/ artifacts
 * (installs from GitHub run no build), and the published file list.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const require = createRequire(join(root, 'package.json'))

function hostContext() {
  const tools = [], commands = [], disposers = [], children = []
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') disposers.push(dispose) },
    tools: { register(tool) { tools.push(tool.name); return () => {} } },
    commands: { register(command) { commands.push(command.name); return () => {} } },
    plugin(child, config) { children.push(child.name); child.apply(ctx, config) },
  }
  return { ctx, tools, commands, children, dispose: () => { for (const dispose of disposers.reverse()) dispose() } }
}

describe('DSH bundle manifest', () => {
  it('declares an MIT-licensed public bundle for the tested DSH release', () => {
    assert.equal(pkg.name, 'dsh-study-tutor')
    assert.equal(pkg.license, 'MIT')
    assert.equal(pkg.private, undefined)
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.engines.dsh, '>=0.2.1-rc.3 <0.2.2')
    assert.deepEqual(pkg.dsh.bundle, { patch: './cordis.patch.yml' })
    assert.equal(pkg.dsh.client.platform, 'web')
    assert.equal(pkg.repository.url, 'git+https://github.com/HaowenCang/dsh-study-mode.git')
    assert.equal(pkg.version, '0.2.0')
    assert.match(readFileSync(join(root, 'LICENSE'), 'utf8'), /^MIT License/)
  })

  it('exports only existing built entries, locale and icon files', () => {
    for (const [key, file] of Object.entries(pkg.exports)) {
      if (key === './locale/*.json') for (const lang of ['en', 'zh']) assert.ok(existsSync(join(root, file.replace('*', lang))), lang)
      else assert.ok(existsSync(join(root, file)), `${key} -> ${file}`)
    }
    assert.deepEqual(Object.keys(pkg.exports).sort(), ['.', './agent', './client', './icon', './locale/*.json'])
    assert.ok(existsSync(join(root, pkg.icon)))
    for (const lang of ['en', 'zh']) {
      const meta = JSON.parse(readFileSync(join(root, 'locale', `${lang}.json`), 'utf8')).meta
      assert.ok(meta.title.length > 0 && meta.description.length > 0)
    }
  })

  it('runs no install-time scripts, so a GitHub install needs no build permission', () => {
    for (const hook of ['prepare', 'preinstall', 'install', 'postinstall', 'prepack']) assert.equal(pkg.scripts?.[hook], undefined, hook)
  })

  it('mounts one Loader row for the package plus the Study preset agent row', () => {
    assert.deepEqual([...patch.matchAll(/^\s+name: '?([^'\s]+)'?\s*$/gm)].map(match => match[1]), [
      'dsh-study-tutor', '@deepseek-ai/dsh-agent-preset', 'dsh-study-tutor/agent', '@deepseek-ai/dsh-tool-skill',
    ])
    // The row id stays dsh-study-mode so existing profile overrides of that row keep applying after the npm rename.
    assert.match(patch, /^    - id: dsh-study-mode$/m)
    assert.doesNotMatch(patch, /dsh-study-core|dsh-rich-response/)
  })
})

describe('built entries', () => {
  it('the Host entry mounts Study Core and Rich Response as child plugins', async () => {
    const home = mkdtempSync(join(tmpdir(), 'study-mode-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const host = hostContext()
    try {
      const entry = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
      assert.equal(entry.name, 'dsh-study-tutor')
      assert.equal(entry.default, undefined)
      entry.apply(host.ctx, { core: {}, rich: {} })
      assert.deepEqual(host.children, ['dsh-study-core', 'dsh-rich-response'])
      for (const tool of ['study_get_state', 'study_issue_question', 'study_author_question', 'study_model_review', 'rich_render', 'rich_physics_demo', 'rich_mermaid']) assert.ok(host.tools.includes(tool), tool)
      assert.ok(host.commands.includes('rich-interaction'))
      assert.ok(existsSync(join(home, 'study-core', 'study.db')))
    } finally {
      host.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('the Client entry registers under the package id and mounts both client halves', () => {
    const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
    assert.ok(source.startsWith('window.__ModuleLoader__.load({ id: "dsh-study-tutor", factory:'))
    let registration
    globalThis.window = { __ModuleLoader__: { load(value) { registration = value } } }
    try {
      vm.runInThisContext(source, { filename: 'lib/client.js' })
    } finally {
      delete globalThis.window
    }
    const exports = registration.factory(specifier => require(specifier))
    assert.equal(exports.name, 'dsh-study-tutor')
    const children = []
    exports.apply({ plugin(child) { children.push(child.name) } })
    assert.deepEqual(children, ['dsh-study-core', 'dsh-rich-response'])
  })

  it('the agent entry loads the bundled teaching Skill', async () => {
    const entry = await import(pathToFileURL(join(root, 'lib', 'agent.js')).href)
    let skill
    entry.apply({
      effect(callback) { callback() },
      tools: { presentAs: () => () => {}, schemas: () => [], restrict: () => () => {}, guard: () => () => {} },
      systemPrompt: { getSectionOrder: () => 1, section: () => () => {} },
      skills: { register(value) { skill = value; return () => {} } },
    })
    assert.equal(skill.name, 'study-systematic-teaching')
    assert.match(skill.content, /H0/)
  })

  it('committed lib/ matches a fresh build of the sources', () => {
    const out = mkdtempSync(join(tmpdir(), 'study-mode-lib-'))
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs'), '--out', out], { cwd: root, stdio: 'pipe' })
      const built = readdirSync(out).sort()
      assert.deepEqual(readdirSync(join(root, 'lib')).sort(), built)
      for (const file of built) assert.ok(readFileSync(join(out, file)).equals(readFileSync(join(root, 'lib', file))), `lib/${file} is stale; run npm run build`)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('published content', () => {
  it('packs only runtime files', () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const [report] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }))
    const files = report.files.map(file => file.path.replace(/\\/g, '/')).sort()
    for (const file of ['LICENSE', 'README.md', 'cordis.patch.yml', 'data/synthetic.json', 'icon.svg', 'lib/agent.js', 'lib/client.js', 'lib/index.js', 'locale/en.json', 'locale/zh.json', 'package.json', 'skills/study-systematic-teaching/SKILL.md']) {
      assert.ok(files.includes(file), file)
    }
    assert.deepEqual(files.filter(file => /^(core|rich|src|tests|scripts)\//.test(file)), [])
  })

  it('contains no local paths, account ids or private course data', () => {
    const self = fileURLToPath(import.meta.url)
    // Generic patterns only; the private assembler also checks account and course identifiers before publishing.
    const forbidden = [/[A-Za-z]:[\\/](Projects|Users)/, /\\Users\\/, /\/(home|Users)\/[^/\s]+\//, /course-plans\.json/]
    const leaks = []
    const walk = dir => {
      for (const name of readdirSync(dir)) {
        if (['.git', 'node_modules', '.tmp'].includes(name)) continue
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path !== self) {
          const text = readFileSync(path, 'utf8')
          for (const pattern of forbidden) if (pattern.test(text)) leaks.push(`${relative(root, path)} ${pattern}`)
        }
      }
    }
    walk(root)
    assert.deepEqual(leaks, [])
  })
})
