import { mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

export const catalog = [
  {id:'q-single',version:1,courseId:'synthetic-physics',topicId:'oscillation',familyId:'direction',kind:'single_choice',prompt:'Synthetic check: restoring force for x > 0?',options:[{id:'a',label:'negative'},{id:'b',label:'positive'}],answer:['a'],dimensions:['concept'],coverage:'final_answer_only',hints:{H1:'Consider the direction toward equilibrium.',H2:'Use F = -kx.',H3:'For k > 0 and x > 0, -kx < 0.',H4:'The correct choice is a.'}},
  {id:'q-multi',version:1,courseId:'synthetic-physics',topicId:'oscillation',familyId:'energy',kind:'multiple_choice',prompt:'Synthetic check: conserved quantities in undamped SHM?',options:[{id:'a',label:'total energy'},{id:'b',label:'kinetic energy'},{id:'c',label:'angular frequency'}],answer:['a','c'],dimensions:['concept'],coverage:'final_answer_only',hints:{H1:'Consider time dependence.'}},
  {id:'q-number',version:1,courseId:'synthetic-physics',topicId:'oscillation',familyId:'frequency',kind:'numeric',prompt:'Synthetic: m=1 kg, k=4 N/m. Angular frequency?',answer:2,unit:'rad/s',absoluteTolerance:0.01,relativeTolerance:0,dimensions:['calculation'],coverage:'final_answer_only',hints:{H1:'Identify mass and spring constant.'}},
  {id:'q-open',version:1,courseId:'synthetic-physics',topicId:'oscillation',familyId:'derive',kind:'open',prompt:'Synthetic: derive the SHM equation.',dimensions:['derivation'],coverage:'steps',hints:{H1:'Identify the force law.'}},
] as const;

export async function fixture(path?:string,questions:unknown=catalog,plans?:unknown) {
  assert.ok(existsSync(new URL('../src/integration/engine.ts',import.meta.url)), 'StudyEngine is not implemented');
  const {StudyEngine}=await import('../src/integration/engine.ts');
  const testRoot=fileURLToPath(new URL('../.tmp/',import.meta.url));mkdirSync(testRoot,{recursive:true});
  const databasePath=path??join(mkdtempSync(join(testRoot,'study-test-')),'study.db');
  let timestamp=Date.parse('2026-10-26T12:00:00Z');
  const engine=new StudyEngine({databasePath,catalog:questions,learnerId:'synthetic-learner',now:()=>timestamp,...plans===undefined?{}:{plans}});
  return {engine,databasePath,advance:(ms:number)=>{timestamp+=ms;}};
}
