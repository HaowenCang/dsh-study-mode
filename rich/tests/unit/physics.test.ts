import test from 'node:test'
import assert from 'node:assert/strict'
import { harmonicOscillator, infiniteWell, isingExample } from '../../src/shared/physics'

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Number.isFinite(actual), `expected a finite value, got ${actual}`)
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

test('infinite well ground state has zero walls and the normalized midpoint peak', () => {
  const result = infiniteWell(1, 32)
  assert.equal(result.points.length, 33)
  assert.deepEqual(result.points[0], { x: 0, psi: 0, density: 0 })
  assert.deepEqual(result.points[32], { x: 1, psi: 0, density: 0 })
  close(result.points[16]!.psi, Math.SQRT2)
  close(result.points[16]!.density, 2)
  close(result.integral, 1)
  assert.deepEqual(result.nodes, [])
  assert.equal(result.energyRatio, 1)
})

test('infinite well excited state changes sign at its interior node', () => {
  const result = infiniteWell(2, 64)
  close(result.points[16]!.psi, Math.SQRT2)
  close(result.points[32]!.psi, 0)
  close(result.points[48]!.psi, -Math.SQRT2)
  assert.deepEqual(result.nodes, [0.5])
  assert.equal(result.energyRatio, 4)
})

test('infinite well all supported states integrate to one at the default resolution', () => {
  for (let n = 1; n <= 10; n++) {
    const result = infiniteWell(n)
    assert.equal(result.points.length, 513)
    close(result.integral, 1)
    assert.equal(result.nodes.length, n - 1)
    assert.equal(result.energyRatio, n * n)
    for (const node of result.nodes) assert.ok(node > 0 && node < 1)
  }
  assert.deepEqual(infiniteWell(4).nodes, [0.25, 0.5, 0.75])
})

test('infinite well bounds resolution relative to the state and rejects malformed inputs', () => {
  assert.equal(infiniteWell(10, 160).points.length, 161)
  assert.equal(infiniteWell(1, 2048).points.length, 2049)
  for (const n of [0, -1, 11, 1.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => infiniteWell(n))
  }
  for (const intervals of [0, 31, 32.5, 2049, NaN, Infinity]) {
    assert.throws(() => infiniteWell(1, intervals))
  }
  assert.throws(() => infiniteWell(10, 159))
  assert.throws(() => infiniteWell('1' as unknown as number))
  assert.throws(() => infiniteWell(1, '32' as unknown as number))
})

test('oscillator starts at maximum displacement with hand-derived angular frequency and energy', () => {
  const result = harmonicOscillator({ mass: 2, spring: 8, amplitude: 3, phase: 0 }, 32)
  close(result.omega, 2)
  close(result.period, Math.PI)
  close(result.totalEnergy, 36)
  assert.equal(result.points.length, 33)
  close(result.points[0]!.t, 0)
  close(result.points[0]!.x, 3)
  close(result.points[0]!.v, 0)
  close(result.points[0]!.kinetic, 0)
  close(result.points[0]!.potential, 36)
  close(result.points[8]!.t, Math.PI / 4)
  close(result.points[8]!.x, 0)
  close(result.points[8]!.v, -6)
  close(result.points[8]!.kinetic, 36)
  close(result.points[8]!.potential, 0)
})

test('oscillator phase rotates displacement and velocity with the expected sign', () => {
  const result = harmonicOscillator({ mass: 1, spring: 4, amplitude: 2, phase: Math.PI / 2 })
  close(result.points[0]!.x, 0)
  close(result.points[0]!.v, -4)
  close(result.points[0]!.kinetic, 8)
  close(result.points[0]!.potential, 0)
  close(result.totalEnergy, 8)
})

test('oscillator conserves energy and returns to its initial state after one period', () => {
  const result = harmonicOscillator({ mass: 0.7, spring: 13, amplitude: 1.3, phase: 0.9 })
  assert.equal(result.points.length, 257)
  close(result.totalEnergy, 10.985)
  for (const point of result.points) {
    close(point.total, 10.985)
    close(point.kinetic + point.potential, point.total)
  }
  const last = result.points.at(-1)!
  close(last.t, result.period)
  close(last.x, result.points[0]!.x)
  close(last.v, result.points[0]!.v)
})

test('oscillator zero amplitude stays at rest and parameter endpoints remain finite', () => {
  const rest = harmonicOscillator({ mass: 0.1, spring: 100, amplitude: 0, phase: 2 * Math.PI }, 2048)
  assert.equal(rest.points.length, 2049)
  close(rest.totalEnergy, 0)
  for (const point of rest.points) {
    close(point.x, 0)
    close(point.v, 0)
    close(point.total, 0)
  }
  const slow = harmonicOscillator({ mass: 10, spring: 0.1, amplitude: 5, phase: 0 }, 32)
  close(slow.omega, 0.1)
  close(slow.totalEnergy, 1.25)
})

test('oscillator rejects out-of-bounds and nonfinite physical parameters', () => {
  const valid = { mass: 1, spring: 1, amplitude: 1, phase: 0 }
  const invalid = {
    mass: [0, 0.09, 10.01, NaN, Infinity, -Infinity],
    spring: [0, 0.09, 100.01, NaN, Infinity, -Infinity],
    amplitude: [-0.01, 5.01, NaN, Infinity, -Infinity],
    phase: [-0.01, 2 * Math.PI + 0.01, NaN, Infinity, -Infinity],
  }
  for (const [key, values] of Object.entries(invalid)) {
    for (const value of values) assert.throws(() => harmonicOscillator({ ...valid, [key]: value }))
    assert.throws(() => harmonicOscillator({ ...valid, [key]: '1' } as unknown as typeof valid))
  }
  for (const intervals of [0, 31, 32.5, 2049, NaN, Infinity]) {
    assert.throws(() => harmonicOscillator(valid, intervals))
  }
})

test('ordered periodic Ising configurations have unit magnetization and minus two energy per spin', () => {
  for (const size of [4, 7, 32]) {
    const result = isingExample(size, 'ordered')
    assert.equal(result.size, size)
    assert.equal(result.spins.length, size * size)
    assert.ok(result.spins.every(spin => spin === 1))
    assert.equal(result.magnetization, 1)
    assert.equal(result.energyPerSpin, -2)
  }
})

test('seeded Ising example matches a finite hand-counted periodic configuration', () => {
  const result = isingExample(4, 'random', 1)
  assert.deepEqual(result.spins, [
    -1, -1, 1, -1,
    1, -1, -1, -1,
    -1, 1, 1, -1,
    1, -1, -1, 1,
  ])
  // Six up spins and ten down spins give M/16 = -1/4.
  // Horizontal bond products sum to 0; vertical row pairs sum to 0,-2,-4,-2.
  // Therefore E = -(0 - 8) = 8 and E/16 = 1/2 (each bond counted once).
  assert.equal(result.magnetization, -0.25)
  assert.equal(result.energyPerSpin, 0.5)
})

test('random Ising examples reproduce seeds, normalize zero and contain only unit spins', () => {
  assert.deepEqual(isingExample(4, 'random'), isingExample(4, 'random', 1))
  assert.deepEqual(isingExample(4, 'random', 0), isingExample(4, 'random', 1))
  assert.deepEqual(isingExample(7, 'random', 12345), isingExample(7, 'random', 12345))
  assert.notDeepEqual(isingExample(4, 'random', 1).spins, isingExample(4, 'random', 2).spins)
  const result = isingExample(32, 'random', 0xffffffff)
  assert.ok(result.spins.every(spin => spin === -1 || spin === 1))
  assert.ok(Math.abs(result.magnetization) <= 1)
  assert.ok(Math.abs(result.energyPerSpin) <= 2)
})

test('Ising examples reject invalid lattice sizes, kinds and unsigned seeds', () => {
  for (const size of [0, 3, 33, 4.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => isingExample(size, 'random'))
  }
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity, -Infinity]) {
    assert.throws(() => isingExample(4, 'random', seed))
    assert.throws(() => isingExample(4, 'ordered', seed))
  }
  assert.throws(() => isingExample('4' as unknown as number, 'random'))
  assert.throws(() => isingExample(4, 'random', '1' as unknown as number))
  assert.throws(() => isingExample(4, 'critical' as 'random'))
})
