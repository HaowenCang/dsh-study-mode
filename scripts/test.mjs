/**
 * Run every suite: Study Core (Node test runner on TypeScript sources), Rich
 * Response (its own bundling unit runner, which needs rich/lib built first) and
 * the package contract against the committed lib/.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const steps = [
  ['core', join(root, 'core'), ['--test', 'tests/*.test.ts']],
  ['rich build', root, [join('rich', 'scripts', 'build.mjs')]],
  ['rich', root, [join('rich', 'scripts', 'run-unit-tests.mjs')]],
  ['package', root, ['--test', join('tests', 'package.test.mjs')]],
]
for (const [label, cwd, args] of steps) {
  console.log(`test: ${label}`)
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`test: ${label} FAILED`)
    process.exit(result.status ?? 1)
  }
}
console.log('test: OK')
