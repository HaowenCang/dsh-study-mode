import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyPhysicsData,
  createPhysicsSvgExport,
  enterPhysicsFullscreen,
  physicsSvgDetails,
} from '../../src/client/physics-export'

const parameters = { n: 4, mass: 2, spring: 8, amplitude: 3, phase: 1.2, quantity: 'energy' as const, density: true, size: 4, kind: 'random' as const, seed: 7 }

// A small DOM boundary fixture: setting innerHTML fails so the real exporter
// must append nodes and use textContent. Browser serialization is also checked
// by the isolated runtime download test; this fixture needs no browser process.
class ElementFixture {
  readonly attributes = new Map<string, string>()
  readonly children: ElementFixture[] = []
  textContent = ''
  constructor(readonly ownerDocument: DocumentFixture, readonly tagName: string) {}
  set innerHTML(_value: string) { throw new Error('unsafe HTML sink') }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  appendChild(child: ElementFixture): ElementFixture { this.children.push(child); return child }
  cloneNode(deep: boolean): ElementFixture {
    const copy = new ElementFixture(this.ownerDocument, this.tagName)
    for (const [name, value] of this.attributes) copy.setAttribute(name, value)
    copy.textContent = this.textContent
    if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true))
    return copy
  }
}
class DocumentFixture {
  createElementNS(_namespace: string, name: string): ElementFixture { return new ElementFixture(this, name) }
}
function elements(root: ElementFixture): ElementFixture[] { return [root, ...root.children.flatMap(elements)] }
function sourceSvg(): ElementFixture {
  const document = new DocumentFixture(), svg = document.createElementNS('', 'svg')
  svg.setAttribute('viewBox', '0 0 640 240')
  svg.setAttribute('style', 'width:100%;max-width:640px;height:auto')
  const curve = document.createElementNS('', 'polyline')
  curve.setAttribute('points', '0,0 1,1')
  curve.setAttribute('stroke', '#247bbf')
  svg.appendChild(curve)
  return svg
}

test('standalone well export visibly retains the current quantum number, quantity and model', () => {
  const details = physicsSvgDetails('infinite_well', parameters)
  const source = sourceSvg()
  const exported = createPhysicsSvgExport(source as unknown as SVGSVGElement, details) as unknown as ElementFixture
  const visible = elements(exported).filter(node => node.tagName === 'text').map(node => node.textContent).join('\n')
  assert.match(visible, /一维无限深方势阱/)
  assert.match(visible, /n=4/)
  assert.match(visible, /概率密度/)
  assert.match(visible, /L=1/)
  assert.match(visible, /无量纲/)
  assert.match(visible, /0≤x≤1/)
  assert.match(visible, /积分=1\.000000000/)
  assert.ok(elements(exported).some(node => node.tagName === 'polyline'))
  assert.equal(source.getAttribute('style'), 'width:100%;max-width:640px;height:auto')
  assert.equal(exported.getAttribute('xmlns'), 'http://www.w3.org/2000/svg')
  assert.equal(elements(exported).some(node => [...node.attributes.values()].some(value => value.includes('var('))), false)
})

test('standalone oscillator export has current SI parameters, three colored energy labels and model limits', () => {
  const details = physicsSvgDetails('harmonic_oscillator', parameters)
  const exported = createPhysicsSvgExport(sourceSvg() as unknown as SVGSVGElement, details) as unknown as ElementFixture
  const visible = elements(exported).filter(node => node.tagName === 'text').map(node => node.textContent).join('\n')
  for (const value of ['经典简谐振子', 'm=2 kg', 'k=8 N/m', 'A=3 m', 'φ=1.2 rad', '动能', '势能', '总能量', '无阻尼', '无驱动', 'J']) assert.ok(visible.includes(value), value)
  assert.match(visible, /总能量=36\.000000 J/)
  assert.deepEqual(details.legend.map(item => [item.label, item.color]), [['动能', '#247bbf'], ['势能', '#c95132'], ['总能量', '#258545']])
  for (const color of ['#247bbf', '#c95132', '#258545']) {
    assert.ok(elements(exported).some(node => node.tagName === 'line' && node.getAttribute('stroke') === color))
  }
})

test('standalone Ising export retains finite-configuration limits and colored spin meanings', () => {
  const details = physicsSvgDetails('ising', parameters)
  const exported = createPhysicsSvgExport(sourceSvg() as unknown as SVGSVGElement, details) as unknown as ElementFixture
  const visible = elements(exported).filter(node => node.tagName === 'text').map(node => node.textContent).join('\n')
  for (const value of ['二维 Ising 有限构型', 'N=4', 'seed=7', '独立随机', '红 +1', '蓝 −1', 'J=1', '周期边界', '非 Monte Carlo', '非热力学极限', '临界温度']) assert.ok(visible.includes(value), value)
  assert.deepEqual(details.legend.map(item => [item.label, item.color]), [['红 +1', '#c95132'], ['蓝 −1', '#247bbf']])
})

test('exported annotation text cannot become markup or an external CSS dependency', () => {
  const details = physicsSvgDetails('infinite_well', parameters)
  const unsafe = '<script>alert(1)</script><image href="https://example.test/x"/>'
  const exported = createPhysicsSvgExport(sourceSvg() as unknown as SVGSVGElement, { ...details, title: unsafe }) as unknown as ElementFixture
  assert.ok(elements(exported).some(node => node.tagName === 'text' && node.textContent === unsafe))
  assert.equal(elements(exported).some(node => node.tagName === 'script' || node.tagName === 'image'), false)
  assert.equal(exported.getAttribute('fill'), '#182433')
  assert.ok(exported.getAttribute('font-family'))
  const nested = exported.children.find(node => node.tagName === 'svg')!
  assert.equal(nested.getAttribute('style'), null)
})

test('clipboard action reports missing and denied APIs and copies the actual calculation JSON', async () => {
  assert.match(await copyPhysicsData({ energy: 2 }), /不支持.*剪贴板/)
  assert.match(await copyPhysicsData({}, { writeText: async () => { throw new Error('denied') } }), /未允许复制/)
  let copied = ''
  assert.equal(await copyPhysicsData({ energy: 2 }, { writeText: async text => { copied = text } }), '已复制计算数据。')
  assert.equal(copied, '{"energy":2}')
})

test('fullscreen action reports missing and denied APIs and confirms a successful request', async () => {
  assert.match(await enterPhysicsFullscreen(null), /不支持.*全屏/)
  assert.match(await enterPhysicsFullscreen({} as Element), /不支持.*全屏/)
  assert.match(await enterPhysicsFullscreen({ requestFullscreen: async () => { throw new Error('denied') } }), /未进入全屏/)
  let called = false
  assert.equal(await enterPhysicsFullscreen({ requestFullscreen: async () => { called = true } }), '已进入全屏。')
  assert.equal(called, true)
})
