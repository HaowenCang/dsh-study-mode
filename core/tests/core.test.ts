import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, catalog } from './fixtures.ts';

test('trusted answer key stays private; learner submission is independently graded',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const card=engine.issue('session-a','q-single','issue-a');
  assert.equal(card.status,'issued'); assert.equal(card.maxHelp,'H0');
  assert.equal(JSON.stringify(card).includes('"answer"'),false);
  const result=engine.submit('session-a',card.attemptId,['a'],'submit-a');
  assert.equal(result.grade?.outcome,'correct'); assert.equal(result.independent,true);
  assert.equal(result.capability,'U','a final choice alone cannot prove conceptual reasoning');
});

test('hint permanently closes independent eligibility, including repeated question in new session',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const card=engine.issue('session-a','q-single','issue-a');
  const help=engine.hint('session-a',card.attemptId,'H2','hint-a');
  assert.equal(help.maxHelp,'H2'); assert.equal(help.independent,false);
  const graded=engine.submit('session-a',card.attemptId,['a'],'submit-a');
  assert.equal(graded.grade?.outcome,'correct'); assert.equal(graded.capability,'S');
  const next=engine.issue('session-b','q-single','issue-b');
  assert.equal(next.independent,false); assert.equal(next.maxHelp,'H2');
});

test('session spoofing, duplicate attempts and conflicting idempotency retries are rejected',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const card=engine.issue('session-a','q-single','issue-a');
  assert.throws(()=>engine.submit('session-b',card.attemptId,['a'],'attack'),/session/i);
  const first=engine.submit('session-a',card.attemptId,['b'],'submit-a');
  assert.equal(first.grade?.outcome,'incorrect');
  assert.deepEqual(engine.submit('session-a',card.attemptId,['b'],'submit-a'),first);
  assert.throws(()=>engine.submit('session-a',card.attemptId,['a'],'submit-a'),/idempotency/i);
  assert.throws(()=>engine.submit('session-a',card.attemptId,['a'],'submit-b'),/closed|submitted/i);
  assert.throws(()=>engine.hint('session-a',card.attemptId,'H1','late-hint'),/closed|submitted/i);
});

test('numeric grading checks units and finite values; multiple choices require exact unique set',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const n=engine.issue('s','q-number','i1');
  assert.throws(()=>engine.submit('s',n.attemptId,{value:NaN,unit:'rad/s'},'invalid'),/finite|number/i);
  assert.equal(engine.submit('s',n.attemptId,{value:2.005,unit:'rad/s'},'s1').grade?.outcome,'correct');
  const n2=engine.issue('s','q-number','i2');
  assert.equal(engine.submit('s',n2.attemptId,{value:2,unit:'Hz'},'s2').grade?.outcome,'incorrect');
  const multi=engine.issue('s','q-multi','i3');
  assert.throws(()=>engine.submit('s',multi.attemptId,['a','a'],'duplicate'),/unique|duplicate/i);
  assert.equal(engine.submit('s',multi.attemptId,['c','a'],'s3').grade?.outcome,'correct');
});

test('open work remains pending until human review; original evidence is not overwritten',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const card=engine.issue('s','q-open','i1');
  const submitted=engine.submit('s',card.attemptId,'m x" = -kx','s1');
  assert.equal(submitted.status,'pending_review'); assert.equal(submitted.capability,'U');
  assert.throws(()=>engine.review('s',card.attemptId,true,'','operator','r0'),/reason/i);
  const reviewed=engine.review('s',card.attemptId,true,'Verified force law and derivation.','operator','r1');
  assert.equal(reviewed.capability,'P');
  const corrected=engine.review('s',card.attemptId,false,'Missing applicability conditions.','operator','r2');
  assert.equal(corrected.capability,'N');
  assert.equal(engine.history(card.attemptId).filter(e=>e.kind==='reviewed').length,2);
  assert.equal(engine.history(card.attemptId).some(e=>e.kind==='submitted'),true);
});

test('teaching stages persist across sessions without creating ability evidence',async t=>{
  const {engine,databasePath}=await fixture();
  assert.equal(engine.lesson('synthetic-physics','oscillation').stage,'concept');
  assert.throws(()=>engine.advanceLesson('s','synthetic-physics','oscillation','derivation','skip'),/stage|sequence/i);
  engine.advanceLesson('s','synthetic-physics','oscillation','mathematical_modeling','t1');
  engine.close();
  const second=await fixture(databasePath); t.after(()=>second.engine.close());
  assert.equal(second.engine.lesson('synthetic-physics','oscillation').stage,'mathematical_modeling');
  assert.equal(second.engine.state().attempts.length,0);
});

test('restart retains grades and exposure; immutable question version rejects changed key',async t=>{
  const {engine,databasePath}=await fixture();
  const card=engine.issue('s','q-single','i1'); engine.hint('s',card.attemptId,'H4','h1');
  engine.submit('s',card.attemptId,['a'],'s1'); engine.close();
  const second=await fixture(databasePath); t.after(()=>second.engine.close());
  assert.equal(second.engine.attempt(card.attemptId).maxHelp,'H4');
  assert.equal(second.engine.attempt(card.attemptId).grade?.outcome,'correct');
  const changed=catalog.map(q=>q.id==='q-single'?{...q,answer:['b']}:q);
  await assert.rejects(()=>fixture(databasePath,changed),/immutable|revision|version/i);
});

test('client-supplied grading and mastery fields cannot enter the trusted submission',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const card=engine.issue('s','q-number','i1');
  assert.throws(()=>engine.submit('s',card.attemptId,{value:999,unit:'rad/s',correct:true,mastered:true},'forge'),/field|property|answer/i);
  assert.equal(engine.attempt(card.attemptId).status,'issued');
});

test('help on a parallel active attempt closes independence before the other submission',async t=>{
  const {engine}=await fixture(); t.after(()=>engine.close());
  const a=engine.issue('s','q-single','i1'),b=engine.issue('s','q-single','i2');
  engine.hint('s',a.attemptId,'H3','h1');
  const result=engine.submit('s',b.attemptId,['a'],'s1');
  assert.equal(result.independent,false);assert.equal(result.maxHelp,'H3');assert.equal(result.capability,'S');
});

test('repeating an exposed answer without actual hints does not fabricate an S help record',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const a=engine.issue('s','q-single','i1');engine.submit('s',a.attemptId,['b'],'s1');
  const b=engine.issue('s','q-single','i2');const result=engine.submit('s',b.attemptId,['a'],'s2');
  assert.equal(result.independent,false);assert.equal(result.maxHelp,'H0');assert.equal(result.capability,'U');
});

test('R requires independently human-verified new item after a delay; elapsed time alone does not promote',async t=>{
  const variant={...catalog[3],id:'q-open-variant',prompt:'Synthetic variant: derive the oscillator equation with new coordinates.'};
  const {engine,advance}=await fixture(undefined,[...catalog,variant]);t.after(()=>engine.close());
  const a=engine.issue('s','q-open','i1');engine.submit('s',a.attemptId,'A complete derivation.','s1');engine.review('s',a.attemptId,true,'Reasoning and conditions verified.','operator','r1');
  assert.equal(engine.progress('synthetic-physics','oscillation').derivation.state,'P');
  advance(2*24*60*60*1000);
  assert.equal(engine.progress('synthetic-physics','oscillation').derivation.state,'P');
  const b=engine.issue('s2','q-open-variant','i2');engine.submit('s2',b.attemptId,'A complete new derivation.','s2');engine.review('s2',b.attemptId,true,'New-context reasoning verified.','operator','r2');
  const progress=engine.progress('synthetic-physics','oscillation');
  assert.equal(progress.derivation.state,'R');assert.equal(progress.derivation.attemptIds.length,2);assert.equal(progress.transfer.state,'U');
});

test('provider call IDs may be reused across different sessions without an idempotency conflict',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const a=engine.issue('session-a','q-single','provider-call');
  const b=engine.issue('session-b','q-single','provider-call');
  assert.notEqual(a.attemptId,b.attemptId);
});

test('objective questions cannot claim steps coverage and create reasoning mastery',async()=>{
  const invalid=catalog.map(q=>q.id==='q-single'?{...q,coverage:'steps'}:q);
  await assert.rejects(()=>fixture(undefined,invalid),/coverage|reasoning/i);
});

test('course and topic IDs containing separators have independent teaching state',async t=>{
  const a={...catalog[3],id:'topic-a',courseId:'a:b',topicId:'c'},b={...catalog[3],id:'topic-b',courseId:'a',topicId:'b:c'};
  const {engine}=await fixture(undefined,[a,b]);t.after(()=>engine.close());
  engine.advanceLesson('s','a:b','c','mathematical_modeling','t1');
  assert.equal(engine.lesson('a','b:c').stage,'concept');
  engine.advanceLesson('s','a','b:c','mathematical_modeling','t2');
  assert.equal(engine.lesson('a','b:c').courseId,'a');
});
