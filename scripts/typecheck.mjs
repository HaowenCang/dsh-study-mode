/** Strict TypeScript check of the root entries and both assembled plugin programs. */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const projects = ['tsconfig.json', 'core/tsconfig.json', 'rich/tsconfig.host.json', 'rich/tsconfig.client.json', 'rich/tsconfig.tests.json']
let failed = false
for (const project of projects) {
  console.log(`typecheck: tsc -p ${project}`)
  const result = spawnSync(process.execPath, [tsc, '-p', project, '--noEmit', '--pretty', 'false'], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) failed = true
}
if (failed) {
  console.error('typecheck: FAILED')
  process.exit(1)
}
console.log('typecheck: OK')
