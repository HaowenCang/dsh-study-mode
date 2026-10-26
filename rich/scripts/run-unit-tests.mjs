/**
 * Unit-test runner with no test framework dependency.
 *
 * Each `tests/unit/*.test.ts` file is bundled with esbuild into `.tmp/unit/`
 * (this is also what proves the Shared module graph is bundler-clean), then
 * executed with the Node test runner.
 */
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const unitDir = join(root, 'tests', 'unit')
const outDir = join(root, '.tmp', 'unit')

const entries = (await readdir(unitDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts'))
  .map(entry => entry.name)
  .sort()

if (entries.length === 0) {
  console.error('test:unit: no tests found')
  process.exit(1)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const outputs = []
for (const entry of entries) {
  const outfile = join(outDir, entry.replace(/\.ts$/, '.mjs'))
  await build({
    absWorkingDir: root,
    entryPoints: [join('tests', 'unit', entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // Renderer components are authored for the automatic JSX runtime, exactly
    // like the client bundle; the test bundle must use the same transform.
    jsx: 'automatic',
    // React stays external: react-dom/server's CJS build needs real Node
    // builtins, and the test and the evaluated client bundle must share one
    // React instance.
    external: ['node:*', 'react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
    logLevel: 'warning',
  })
  outputs.push(outfile)
}

const result = spawnSync(process.execPath, ['--test', ...outputs], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) {
  console.error('test:unit: FAILED')
  process.exit(result.status ?? 1)
}
console.log(`test:unit: OK (${String(outputs.length)} files)`)
