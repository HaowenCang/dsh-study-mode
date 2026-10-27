import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,symlinkSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './fixtures.ts';

test('Host exposes no model answer/review/mastery tools and human commands bind the receiving session',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  assert.ok(existsSync(new URL('../src/host/api.ts',import.meta.url)),'Host API is not implemented');
  const {registerApi}=await import('../src/host/api.ts');
  const tools:any[]=[],commands:any[]=[],effects:(()=>void)[]=[];
  const ctx={tools:{register:(d:unknown)=>{tools.push(d);return()=>{};}},commands:{register:(d:unknown)=>{commands.push(d);return()=>{};}},effect:(f:()=>undefined|(()=>void))=>{const dispose=f();if(dispose)effects.push(dispose);}};
  registerApi(ctx,engine,false);
  assert.deepEqual(tools.map(t=>t.name).sort(),['study_get_plan','study_get_state','study_issue_question','study_teaching_step']);
  assert.equal(commands.some(c=>c.name==='study-review'),false);
  const issue=tools.find(d=>d.name==='study_issue_question');
  const exec={callId:'call-1',agent:{id:'session-a'},signal:new AbortController().signal};
  const card=await issue.execute({questionId:'q-single'},exec);
  const command=commands.find(c=>c.name==='study-attempt');
  const run=(sessionId:string,value:unknown)=>command.handler({agent:{id:sessionId},rawInput:JSON.stringify(value),signal:new AbortController().signal});
  const forged=await run('session-b',{operation:'submit',attemptId:card.attemptId,requestId:'attack',answer:['a']});
  assert.equal(forged.kind,'error');assert.match(forged.text,/session/i);
  const hint=await run('session-a',{operation:'hint',attemptId:card.attemptId,requestId:'h1',level:'H1'});
  assert.equal(hint.kind,'success');assert.equal(JSON.parse(hint.text).independent,false);
  await assert.rejects(()=>issue.execute({questionId:'q-single',correct:true},exec),/field/i);
  const abort=new AbortController();abort.abort();
  await assert.rejects(()=>issue.execute({questionId:'q-single'},{...exec,signal:abort.signal}),/abort/i);
  effects.forEach(dispose=>dispose());
});

test('storage rejects a linked ancestor before creating any directory outside DSH_HOME',async t=>{
  const {engine,databasePath}=await fixture();engine.close();
  const base=dirname(databasePath),root=join(base,'allowed'),outside=join(base,'outside');mkdirSync(root);mkdirSync(outside);
  symlinkSync(outside,join(root,'linked'),'junction');
  const previous=process.env.DSH_HOME;process.env.DSH_HOME=root;
  t.after(()=>{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;});
  const {apply}=await import('../src/host/index.ts');
  assert.throws(()=>apply({} as any,{databasePath:join(root,'linked','must-not-exist','study.db')}),/symbolic link/i);
  assert.equal(existsSync(join(outside,'must-not-exist')),false);
});

test('storage rejects a final database symlink without opening its target',async t=>{
  const {engine,databasePath}=await fixture();engine.close();
  const base=dirname(databasePath),root=join(base,'allowed'),target=join(base,'outside-target');mkdirSync(root);writeFileSync(target,'preserve this sentinel');
  symlinkSync(target,join(root,'study.db'),'file');
  const previous=process.env.DSH_HOME;process.env.DSH_HOME=root;
  t.after(()=>{if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;});
  const {apply}=await import('../src/host/index.ts');
  assert.throws(()=>apply({} as any,{databasePath:join(root,'study.db')}),/symbolic link/i);
  assert.equal(readFileSync(target,'utf8'),'preserve this sentinel');
});

test('storage follows DSH home resolution: unset or blank DSH_HOME means ~/.dsh, a relative one is refused',async t=>{
  const {engine,databasePath}=await fixture();engine.close();
  const home=join(dirname(databasePath),'user-home');mkdirSync(home);
  const saved={DSH_HOME:process.env.DSH_HOME,HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE};
  t.after(()=>{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  process.env.HOME=home;process.env.USERPROFILE=home;
  const {apply}=await import('../src/host/index.ts');
  const disposers:(()=>void)[]=[];
  const ctx={tools:{register:()=>()=>{}},commands:{register:()=>()=>{}},effect:(f:()=>undefined|(()=>void))=>{const dispose=f();if(dispose)disposers.push(dispose);}};
  for(const value of [undefined,'   ']){
    if(value===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=value;
    apply(ctx as any,{catalogPath:fileURLToPath(new URL('../data/synthetic.json',import.meta.url))});
    assert.ok(existsSync(join(home,'.dsh','study-core','study.db')),`DSH_HOME=${String(value)}`);
    disposers.splice(0).forEach(dispose=>dispose());
  }
  process.env.DSH_HOME='relative-home';
  assert.throws(()=>apply(ctx as any,{}),/absolute/i);
});

test('TOOLS-01: teaching-step schema lists the stages and the plan tool points at study_get_state.plans',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {registerApi}=await import('../src/host/api.ts');
  const tools:any[]=[];
  registerApi({tools:{register:(d:unknown)=>{tools.push(d);return()=>{};}},commands:{register:()=>()=>{}},effect:(f:()=>undefined|(()=>void))=>{f();}},engine,false);
  const step=tools.find(d=>d.name==='study_teaching_step');
  assert.deepEqual(step.parameters.properties.stage.enum,['concept','mathematical_modeling','derivation','worked_examples','guided_practice','independent_assessment','review_and_consolidation']);
  assert.match(step.description,/concept.*mathematical_modeling/s);
  assert.match(tools.find(d=>d.name==='study_get_plan').description,/study_get_state.*plans/);
});
