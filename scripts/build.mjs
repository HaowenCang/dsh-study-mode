/**
 * Reproducible build of the committed lib/ artifacts.
 *
 *   lib/index.js  Host entry   (Node ESM, src/host.ts)
 *   lib/agent.js  Study preset agent plugin (Node ESM, core/src/agent/index.ts)
 *   lib/client.js Client entry (browser CJS inside the documented
 *                 `window.__ModuleLoader__.load({ id, factory })` handoff)
 *
 * React stays external and resolves from the DSH browser module table. Built
 * entries read ../data and ../skills relative to lib/, so both live at the
 * package root. lib/ is committed because GitHub installs run no build.
 *
 * Usage: node scripts/build.mjs [--out <dir>]
 */
import { build } from 'esbuild'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outFlag = process.argv.indexOf('--out')
const outDir = outFlag === -1 ? join(root, 'lib') : resolve(process.argv[outFlag + 1])
const PACKAGE_NAME = 'dsh-study-mode'
const CLIENT_BANNER = 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PACKAGE_NAME)
  + ', factory: (require) => { var module = { exports: {} }; var exports = module.exports;'
const CLIENT_FOOTER = 'return module.exports; } });'
const common = { absWorkingDir: root, bundle: true, legalComments: 'none', logLevel: 'warning' }

function fail(message) {
  throw new Error('build: ' + message)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
for (const [entry, file] of [['src/host.ts', 'index.js'], ['core/src/agent/index.ts', 'agent.js']]) {
  await build({ ...common, entryPoints: [entry], outfile: join(outDir, file), platform: 'node', format: 'esm', target: 'node24' })
}
await build({
  ...common,
  entryPoints: ['src/client.ts'],
  outfile: join(outDir, 'client.js'),
  platform: 'browser',
  format: 'cjs',
  target: ['chrome110', 'firefox110', 'safari16'],
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: CLIENT_BANNER },
  footer: { js: CLIENT_FOOTER },
})

const client = await readFile(join(outDir, 'client.js'), 'utf8')
if (!client.startsWith(CLIENT_BANNER) || !client.trimEnd().endsWith(CLIENT_FOOTER)) fail('client bundle lost the __ModuleLoader__ handoff')
if (!client.includes('module.exports = __toCommonJS(')) fail('client bundle lost the CJS export assignment')
if (/require\(["']react-dom/.test(client)) fail('client bundle must not require react-dom')
for (const file of ['index.js', 'agent.js']) {
  const host = await readFile(join(outDir, file), 'utf8')
  const imports = [...host.matchAll(/^import\s.*?from\s+"([^"]+)"/gm)].map(match => match[1]).filter(specifier => !specifier.startsWith('node:'))
  if (imports.length > 0) fail(`${file} imports non-builtin modules: ${imports.join(', ')}`)
  if (host.includes('@deepseek-ai/')) fail(`${file} must not reference harness package specifiers`)
}
for (const file of ['index.js', 'agent.js', 'client.js']) {
  const source = await readFile(join(outDir, file), 'utf8')
  if (/\beval\(|new Function\(|dangerouslySetInnerHTML|innerHTML\s*=/.test(source)) fail(`${file} contains a forbidden executable HTML surface`)
  console.log(`build: ${file} ${Buffer.byteLength(source)} bytes`)
}
