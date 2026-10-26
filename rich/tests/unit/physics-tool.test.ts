import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhysicsTool } from '../../src/host/tools/physics-demo'
import { readPhysicsMeta } from '../../src/shared/physics-protocol'

test('physics tool persists only a bounded named deterministic demo envelope', async () => {
  const tool=createPhysicsTool()
  for(const demo of ['infinite_well','harmonic_oscillator','ising']){
    const value=await tool.execute({demo},{signal:new AbortController().signal})
    const meta=tool.output.presentationMeta?.({},value as never)
    assert.deepEqual(readPhysicsMeta(meta),{demo})
  }
})
test('physics tool refuses executable expressions and extra model configuration', async () => {
  const tool=createPhysicsTool(),exec={signal:new AbortController().signal}
  await assert.rejects(()=>tool.execute({demo:'infinite_well',expression:'eval()'},exec))
  await assert.rejects(()=>tool.execute({demo:'unknown'},exec))
  assert.equal(readPhysicsMeta({kind:'rich-physics',version:99,demo:'ising'}),undefined)
  assert.equal(readPhysicsMeta({kind:'rich-physics',version:1,demo:'ising',script:'x'}),undefined)
})
