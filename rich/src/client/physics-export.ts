import type { PhysicsDemo } from '../shared/physics-protocol'
import { harmonicOscillator, infiniteWell, isingExample } from '../shared/physics'

export interface PhysicsPreferences {
  n: number
  mass: number
  spring: number
  amplitude: number
  phase: number
  quantity: 'position' | 'velocity' | 'energy'
  density: boolean
  size: number
  kind: 'ordered' | 'random'
  seed: number
}
export interface PhysicsSvgDetails {
  title: string
  parameters: string[]
  legend: { label: string; color: string }[]
  model: string[]
}
/** Literal colors shared by the on-screen chart and its self-contained export. */
export const PHYSICS_SVG_THEME = {
  text: '#182433', muted: '#667085', border: '#ccd3dc', surface: '#f7f9fc',
  accent: '#247bbf', series: ['#247bbf', '#c95132', '#258545'],
}

export function physicsSvgDetails(demo: PhysicsDemo, p: PhysicsPreferences): PhysicsSvgDetails {
  if (demo === 'infinite_well') return {
    title: '一维无限深方势阱',
    parameters: [`n=${p.n}；显示量=${p.density ? '归一化概率密度' : '归一化波函数'}；Eₙ/E₁=${p.n * p.n}`,
      `积分=${infiniteWell(p.n).integral.toFixed(9)}；内部节点=${p.n-1}`],
    legend: [{ label: p.density ? '|ψ|² 概率密度' : 'ψ 波函数', color: '#247bbf' }],
    model: ['理想无限深势阱；L=1，无量纲坐标 0≤x≤1。', 'ψₙ(x)=√2 sin(nπx)；两端波函数为零。'],
  }
  if (demo === 'harmonic_oscillator') return {
    title: '经典简谐振子',
    parameters: [
      `m=${p.mass} kg；k=${p.spring} N/m；A=${p.amplitude} m；φ=${p.phase} rad`,
      `显示量=${p.quantity === 'energy' ? '能量 (J)' : p.quantity === 'velocity' ? '速度 (m/s)' : '位移 (m)'}；时间单位 s`,
      `ω=${harmonicOscillator(p).omega.toFixed(6)} rad/s；总能量=${harmonicOscillator(p).totalEnergy.toFixed(6)} J`,
    ],
    legend: p.quantity === 'energy'
      ? [{ label: '动能', color: '#247bbf' }, { label: '势能', color: '#c95132' }, { label: '总能量', color: '#258545' }]
      : [{ label: p.quantity === 'velocity' ? 'v 速度' : 'x 位移', color: '#247bbf' }],
    model: ['经典质量-弹簧模型；无阻尼、无驱动；只展示一个周期。', 'x=A cos(ωt+φ)，v=−Aω sin(ωt+φ)，ω=√(k/m)。'],
  }
  return {
    title: '二维 Ising 有限构型',
    parameters: [`N=${p.size}；构型=${p.kind === 'ordered' ? '有序 +1' : '独立随机'}；seed=${p.seed}；J=1`,
      `M/N²=${isingExample(p.size,p.kind,p.seed).magnetization.toFixed(6)}；每自旋能量=${isingExample(p.size,p.kind,p.seed).energyPerSpin.toFixed(6)}`],
    legend: [{ label: '红 +1', color: '#c95132' }, { label: '蓝 −1', color: '#247bbf' }],
    model: ['周期边界，J=1；每条右向和下向相邻键只计一次。', '单个有限构型；非 Monte Carlo 采样；非热力学极限。', '不能据此判定临界温度。'],
  }
}

/** Wrap only our generated chart SVG. Annotation strings enter the DOM as text. */
export function createPhysicsSvgExport(source: SVGSVGElement, details: PhysicsSvgDetails): SVGSVGElement {
  const document = source.ownerDocument
  const namespace = 'http://www.w3.org/2000/svg'
  const output = document.createElementNS(namespace, 'svg')
  const width = 800, plotWidth = width - 48
  const box = (source.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
  const sourceWidth = box[2] ?? 640, sourceHeight = box[3] ?? 240
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 240 / 640
  const plotHeight = Math.min(480, Math.max(240, plotWidth * ratio))
  const plotTop = 64 + 24 * (details.parameters.length + details.legend.length)
  const modelTop = plotTop + plotHeight + 28
  const height = modelTop + 24 * details.model.length + 20
  for (const [name, value] of Object.entries({ xmlns: namespace, width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': 'Arial, Microsoft YaHei, sans-serif', fill: PHYSICS_SVG_THEME.text, role: 'img', 'aria-label': details.title })) {
    output.setAttribute(name, String(value))
  }
  function append(name: 'rect' | 'text' | 'line' | 'title', attributes: Record<string, string | number>, text?: string): void {
    const node = document.createElementNS(namespace, name)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
    if (text !== undefined) node.textContent = text
    output.appendChild(node)
  }
  append('title', {}, details.title)
  append('rect', { x: 0, y: 0, width, height, fill: '#ffffff' })
  append('text', { x: 24, y: 32, 'font-size': 22, 'font-weight': 600 }, details.title)
  let y = 58
  for (const text of details.parameters) {
    append('text', { x: 24, y, 'font-size': 14 }, text)
    y += 24
  }
  for (const item of details.legend) {
    append('line', { x1: 24, x2: 44, y1: y - 4, y2: y - 4, stroke: item.color, 'stroke-width': 4 })
    append('text', { x: 54, y, 'font-size': 14 }, item.label)
    y += 24
  }
  const chart = source.cloneNode(true) as SVGSVGElement
  chart.removeAttribute('style')
  for (const [name, value] of Object.entries({ x: 24, y: plotTop, width: plotWidth, height: plotHeight, preserveAspectRatio: 'xMidYMid meet' })) chart.setAttribute(name, String(value))
  output.appendChild(chart)
  details.model.forEach((text, index) => append('text', { x: 24, y: modelTop + 24 * index, 'font-size': 14 }, text))
  return output
}

export async function copyPhysicsData(data: unknown, clipboard?: Pick<Clipboard, 'writeText'>): Promise<string> {
  if (typeof clipboard?.writeText !== 'function') return '当前浏览器不支持剪贴板复制，请使用导出 SVG。'
  try {
    await clipboard.writeText(JSON.stringify(data))
    return '已复制计算数据。'
  } catch { return '浏览器未允许复制，请使用导出 SVG。' }
}

export async function enterPhysicsFullscreen(target?: Pick<Element, 'requestFullscreen'> | null): Promise<string> {
  if (typeof target?.requestFullscreen !== 'function') return '当前浏览器不支持全屏显示。'
  try {
    await target.requestFullscreen()
    return '已进入全屏。'
  } catch { return '当前浏览器未进入全屏。' }
}
