/** Pure, bounded numerical examples; no runtime, learner state or expression evaluation. */
function boundedNumber(value: number, name: string, minimum: number, maximum: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be finite and between ${minimum} and ${maximum}`)
  }
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): void {
  boundedNumber(value, name, minimum, maximum)
  if (!Number.isInteger(value)) throw new RangeError(`${name} must be an integer`)
}

/** Dimensionless stationary states on x in [0,1], with energy measured in units of E1. */
export function infiniteWell(n: number, intervals = 512): {
  points: { x: number; psi: number; density: number }[]
  integral: number
  nodes: number[]
  energyRatio: number
} {
  boundedInteger(n, 'n', 1, 10)
  boundedInteger(intervals, 'intervals', Math.max(32, 16 * n), 2048)
  const points = Array.from({ length: intervals + 1 }, (_, index) => {
    const x = index / intervals
    const psi = index === 0 || index === intervals ? 0 : Math.SQRT2 * Math.sin(n * Math.PI * x)
    return { x, psi, density: psi * psi }
  })
  let integral = 0
  for (let index = 1; index < points.length; index++) {
    integral += (points[index - 1]!.density + points[index]!.density) / (2 * intervals)
  }
  const nodes = Array.from({ length: n - 1 }, (_, index) => (index + 1) / n)
  return { points, integral, nodes, energyRatio: n * n }
}

/** One period of the classical mass-spring oscillator; callers supply unit labels. */
export function harmonicOscillator(
  options: { mass: number; spring: number; amplitude: number; phase: number },
  intervals = 256,
): {
  omega: number
  period: number
  totalEnergy: number
  points: { t: number; x: number; v: number; kinetic: number; potential: number; total: number }[]
} {
  const { mass, spring, amplitude, phase } = options
  boundedNumber(mass, 'mass', 0.1, 10)
  boundedNumber(spring, 'spring', 0.1, 100)
  boundedNumber(amplitude, 'amplitude', 0, 5)
  boundedNumber(phase, 'phase', 0, 2 * Math.PI)
  boundedInteger(intervals, 'intervals', 32, 2048)
  const omega = Math.sqrt(spring / mass)
  const period = 2 * Math.PI / omega
  const totalEnergy = 0.5 * spring * amplitude * amplitude
  const points = Array.from({ length: intervals + 1 }, (_, index) => {
    const t = index * period / intervals
    const angle = omega * t + phase
    const x = amplitude * Math.cos(angle)
    const v = -amplitude * omega * Math.sin(angle)
    const kinetic = 0.5 * mass * v * v
    const potential = 0.5 * spring * x * x
    return { t, x, v, kinetic, potential, total: kinetic + potential }
  })
  return { omega, period, totalEnergy, points }
}

/** A finite periodic J=1 lattice configuration, not a Monte Carlo or critical-temperature model. */
export function isingExample(size: number, kind: 'ordered' | 'random', seed = 1): {
  size: number
  spins: number[]
  magnetization: number
  energyPerSpin: number
} {
  boundedInteger(size, 'size', 4, 32)
  boundedInteger(seed, 'seed', 0, 0xffffffff)
  if (kind !== 'ordered' && kind !== 'random') throw new RangeError('kind must be ordered or random')
  let state = seed === 0 ? 1 : seed
  const spins = Array.from({ length: size * size }, () => {
    if (kind === 'ordered') return 1
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) < 0x80000000 ? -1 : 1
  })
  let magnetization = 0
  let energy = 0
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const spin = spins[row * size + column]!
      const right = spins[row * size + (column + 1) % size]!
      const down = spins[((row + 1) % size) * size + column]!
      magnetization += spin
      energy -= spin * (right + down)
    }
  }
  return { size, spins, magnetization: magnetization / spins.length, energyPerSpin: energy / spins.length }
}
