import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.ts';

/** Register the Host API against a fake context and return its tools and the /study-attempt runner. */
async function host(engine:any){
  const {registerApi}=await import('../src/host/api.ts');
  const tools:any[]=[],commands:any[]=[];
  registerApi({tools:{register:(d:any)=>{tools.push(d);return()=>{};}},commands:{register:(d:any)=>{commands.push(d);return()=>{};}},effect:(f:()=>undefined|(()=>void))=>{f();}},engine,false);
  const command=commands.find(c=>c.name==='study-attempt');
  const run=(sessionId:string,value:unknown):Promise<{kind:string;text:string}>=>command.handler({agent:{id:sessionId},rawInput:typeof value==='string'?value:JSON.stringify(value),signal:new AbortController().signal});
  const exec=(callId:string,sessionId='session-a')=>({callId,agent:{id:sessionId},signal:new AbortController().signal});
  return {tools,command,run,exec,tool:(name:string)=>tools.find(t=>t.name===name)};
}
/** Every event row (with its hash chain), every idempotency row and the chain head. */
function snapshot(engine:any){
  const db=engine.store.db;
  return {
    events:db.prepare('SELECT seq,id,learner,aggregate_id,kind,body,previous_hash,hash FROM events ORDER BY seq').all(),
    operations:db.prepare('SELECT id,request_hash,result FROM operations ORDER BY id').all(),
    questions:db.prepare('SELECT COUNT(*) AS n FROM questions').get().n,
  };
}
const AUTHORED={courseId:'synthetic-physics',topicId:'oscillation',familyId:'f',type:'single_choice',prompt:'Synthetic authored check?',options:['yes','no'],answer:['A'],hints:{H1:'a',H2:'b',H3:'c',H4:'d'},dimensions:['concept']};

test('P4 locate: finds the attempt a study tool issued in this session by its callId',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {run,exec,tool,command}=await host(engine);
  assert.equal(command.recordInput,false);
  const issued=await tool('study_issue_question').execute({questionId:'q-single'},exec('call-issue'));
  const authored=await tool('study_author_question').execute(AUTHORED,exec('call-author'));
  const found=await run('session-a',{operation:'locate',callId:'call-issue',requestId:'client-1'});
  assert.equal(found.kind,'success',found.text);
  const value=JSON.parse(found.text);
  assert.equal(value.attemptId,issued.attemptId);assert.equal(value.sessionId,'session-a');assert.equal(value.question.id,'q-single');
  assert.equal('answer' in value.question,false,'locate must not expose the answer key');
  // requestId is optional for a read-only lookup.
  const second=await run('session-a',{operation:'locate',callId:'call-author'});
  assert.equal(second.kind,'success',second.text);assert.equal(JSON.parse(second.text).attemptId,authored.attemptId);
  // The located view is the current state, not the stale issue-time result.
  await run('session-a',{operation:'hint',attemptId:issued.attemptId,requestId:'h1',level:'H1'});
  const after=JSON.parse((await run('session-a',{operation:'locate',callId:'call-issue'})).text);
  assert.equal(after.maxHelp,'H1');assert.equal(after.independent,false);
  // The engine lookup is the same pure read.
  assert.equal(engine.locate('session-a','call-issue').attemptId,issued.attemptId);
});

test('P4 locate: a foreign session and an unknown callId are refused like other study operations',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {run,exec,tool}=await host(engine);
  await tool('study_issue_question').execute({questionId:'q-single'},exec('call-1'));
  const foreign=await run('session-b',{operation:'locate',callId:'call-1',requestId:'r'});
  assert.equal(foreign.kind,'error');assert.match(foreign.text,/unknown attempt/i);
  assert.doesNotMatch(foreign.text,/[0-9a-f]{8}-[0-9a-f]{4}/i,'refusal must not leak the attempt ID');
  const unknown=await run('session-a',{operation:'locate',callId:'call-missing'});
  assert.equal(unknown.kind,'error');assert.match(unknown.text,/unknown attempt/i);
  assert.throws(()=>engine.locate('session-b','call-1'),/unknown attempt/i);
  assert.throws(()=>engine.locate('session-a','call-missing'),/unknown attempt/i);
});

test('P4 locate: many lookups write no event or idempotency row and keep the hash chain intact',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {run,exec,tool}=await host(engine);
  const card=await tool('study_issue_question').execute({questionId:'q-single'},exec('call-1'));
  await run('session-a',{operation:'hint',attemptId:card.attemptId,requestId:'h1',level:'H1'});
  await run('session-a',{operation:'submit',attemptId:card.attemptId,requestId:'s1',answer:['a']});
  const before=snapshot(engine);
  for(let i=0;i<50;i++){
    assert.equal((await run('session-a',{operation:'locate',callId:'call-1',requestId:'r-'+i})).kind,'success');
    assert.equal((await run('session-b',{operation:'locate',callId:'call-1',requestId:'r-'+i})).kind,'error');
    assert.equal((await run('session-a',{operation:'locate',callId:'missing-'+i})).kind,'error');
    engine.locate('session-a','call-1');
  }
  assert.deepEqual(snapshot(engine),before);
  engine.store.verify();
});

test('P4 locate: tampered, forged and malformed input is refused',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {run,exec,tool}=await host(engine);
  const card=await tool('study_issue_question').execute({questionId:'q-open'},exec('call-1'));
  await run('session-a',{operation:'hint',attemptId:card.attemptId,requestId:'hint-req',level:'H1'});
  await run('session-a',{operation:'submit',attemptId:card.attemptId,requestId:'submit-req',answer:'mx\'\' = -kx'});
  await tool('study_teaching_step').execute({courseId:'synthetic-physics',topicId:'oscillation',stage:'concept'},exec('call-step'));
  const before=snapshot(engine);
  const refused=async(value:unknown,pattern?:RegExp)=>{const r=await run('session-a',value);assert.equal(r.kind,'error',JSON.stringify(value)+' -> '+r.text);if(pattern)assert.match(r.text,pattern);};
  // Malformed payloads.
  await refused('{not json');
  await refused('[]');
  await refused({operation:'locate'},/call ID/i);
  await refused({operation:'locate',callId:''},/call ID/i);
  await refused({operation:'locate',callId:'   '},/call ID/i);
  await refused({operation:'locate',callId:42},/call ID/i);
  await refused({operation:'locate',callId:['call-1']},/call ID/i);
  await refused({operation:'locate',callId:'x'.repeat(201)},/call ID/i);
  await refused({operation:'locate',callId:'call-1',requestId:7},/request ID/i);
  await refused({operation:'locate',callId:'call-1',requestId:'r'.repeat(201)},/request ID/i);
  // Forged extra fields cannot ride along a read-only lookup.
  await refused({operation:'locate',callId:'call-1',attemptId:card.attemptId},/unexpected field/i);
  await refused({operation:'locate',callId:'call-1',answer:'forged'},/unexpected field/i);
  await refused({operation:'locate',callId:'call-1',level:'H4'},/unexpected field/i);
  await refused({operation:'locate',callId:'call-1',sessionId:'session-a'},/unexpected field/i);
  await refused({operation:'read',attemptId:card.attemptId,callId:'call-1'},/unexpected field/i);
  // Only the issuing call locates an attempt: hint, submit and teaching request IDs do not.
  await refused({operation:'locate',callId:'hint-req'},/unknown attempt/i);
  await refused({operation:'locate',callId:'submit-req'},/unknown attempt/i);
  await refused({operation:'locate',callId:'call-step'},/unknown attempt/i);
  // A callId cannot smuggle another session into the idempotency key.
  await refused({operation:'locate',callId:'session-a","call-1'},/unknown attempt/i);
  assert.equal((await run('session-b',{operation:'locate',callId:'call-1'})).kind,'error');
  assert.deepEqual(snapshot(engine),before);

  // A forged idempotency row (that table carries no triggers) cannot redirect another session to this attempt.
  const issued=engine.store.db.prepare('SELECT result FROM operations WHERE id=?').get(JSON.stringify(['synthetic-learner','session-a','call-1'])) as {result:string};
  engine.store.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(JSON.stringify(['synthetic-learner','session-b','forged']),'x',issued.result);
  engine.store.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(JSON.stringify(['synthetic-learner','session-a','garbage']),'x','{oops');
  engine.store.db.prepare('INSERT INTO operations VALUES(?,?,?)').run(JSON.stringify(['synthetic-learner','session-a','not-an-attempt']),'x',JSON.stringify({attemptId:'00000000-0000-4000-8000-000000000000',sessionId:'session-a',status:'issued',hints:[]}));
  const r1=await run('session-b',{operation:'locate',callId:'forged'});assert.equal(r1.kind,'error');assert.match(r1.text,/unknown attempt/i);
  const r2=await run('session-a',{operation:'locate',callId:'garbage'});assert.equal(r2.kind,'error');assert.match(r2.text,/unknown attempt/i);
  const r3=await run('session-a',{operation:'locate',callId:'not-an-attempt'});assert.equal(r3.kind,'error');assert.match(r3.text,/unknown attempt/i);
});

test('P4 locate: the model-visible tool set is unchanged and has no answer, review or mastery tool',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const {tools}=await host(engine);
  assert.deepEqual(tools.map(t=>t.name).sort(),['study_author_question','study_get_plan','study_get_state','study_issue_question','study_model_review','study_teaching_step']);
  assert.equal(tools.some(t=>/locate|submit|answer_submit|mastery|human_review|grade/i.test(t.name)),false);
});

test('P4 locateAttempt: the client helper sends a read-only locate and validates the session-bound result',async()=>{
  const {locateAttempt}=await import('../src/client/attempt-command.ts');
  assert.equal(typeof locateAttempt,'function','locateAttempt is not implemented');
  const attempt={attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H0',independent:true,question:{id:'q',version:1,kind:'single_choice',prompt:'Q',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}};
  const lines:string[]=[];let reply:any={ok:true,value:{result:{kind:'success',text:JSON.stringify(attempt)}}};
  const remote={commands:{execute:async(sessionId:string,line:string)=>{lines.push(sessionId+' '+line);return reply;}},session:{prompt:async()=>{throw new Error('locate must not prompt');}}};
  const value=await locateAttempt(remote,'s','call-1');
  assert.equal(value.attemptId,'a');
  assert.equal(lines.length,1);
  assert.ok(lines[0]!.startsWith('s /study-attempt '));
  assert.deepEqual(JSON.parse(lines[0]!.slice('s /study-attempt '.length)),{operation:'locate',callId:'call-1'});
  // A result from another session or a malformed result is refused.
  await assert.rejects(locateAttempt(remote,'other','call-1'),/Invalid Host learning state/);
  reply={ok:true,value:{result:{kind:'success',text:'{"attemptId":"a"}'}}};
  await assert.rejects(locateAttempt(remote,'s','call-1'),/Invalid Host learning state/);
  reply={ok:true,value:{result:{kind:'error',text:'Unknown attempt'}}};
  await assert.rejects(locateAttempt(remote,'s','call-1'),/Unknown attempt/);
  reply={ok:false,error:{message:'offline'}};
  await assert.rejects(locateAttempt(remote,'s','call-1'),/offline/);
  // An invalid callId never reaches the Host.
  lines.length=0;
  await assert.rejects(locateAttempt(remote,'s',''),/call ID/i);
  await assert.rejects(locateAttempt(remote,'s','x'.repeat(201)),/call ID/i);
  assert.equal(lines.length,0);
});
