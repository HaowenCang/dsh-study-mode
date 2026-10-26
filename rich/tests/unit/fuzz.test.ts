import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRichContent,readRichMeta} from '../../src/shared/validation'
import {physicsArgs,readPhysicsMeta} from '../../src/shared/physics-protocol'

test('seeded malformed JSON corpus fails closed in content and history readers',()=>{
  let seed=0x5d501
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0}
  const base=()=>({schemaVersion:1,type:'line_plot',title:'Fuzz fixture',data:{series:[{name:'s',points:[{x:0,y:1}]}]}})
  for(let i=0;i<1024;i++){
    const value:Record<string,unknown>=base(),bad=[null,false,[],{},'invalid',-random()][random()%6]
    switch(i%6){
      case 0:value.schemaVersion=2+random();break
      case 1:value.type='unknown-'+random();break
      case 2:value.title=typeof bad==='string'?false:bad;break
      case 3:value.data={series:bad};break
      case 4:value.data={series:[{name:'s',points:[{x:bad,y:1}]}]};break
      case 5:value.data={series:[{name:'s',points:[{x:0,y:1e8+random()}]}]};break
    }
    // A random number is valid as a coordinate; force a non-number in that arm.
    if(i%6===4&&(typeof bad==='number'))value.data={series:[{name:'s',points:[{x:null,y:1}]}]}
    assert.equal(validateRichContent(value).ok,false,'Malformed case '+i)
    assert.equal(readRichMeta({kind:'rich-response',envelopeVersion:1,content:value}),undefined)
    assert.throws(()=>physicsArgs({demo:'infinite_well',expression:String(random())}))
    assert.equal(readPhysicsMeta({kind:'rich-physics',version:1,demo:'invalid-'+random()}),undefined)
  }
  assert.equal(({} as Record<string,unknown>).polluted,undefined)
})
