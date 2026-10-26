import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.ts';
import {registerApi} from '../src/host/api.ts';
import {readAttemptMeta} from '../src/client/protocol.ts';

test('malformed and cross-session command corpus cannot create grades, hints or mastery',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const commands:any[]=[],tools:any[]=[];
  registerApi({commands:{register:value=>{commands.push(value);return()=>{};}},tools:{register:value=>{tools.push(value);return()=>{};}},effect:f=>{f();}},engine,false);
  const card=engine.issue('owner','q-single','issue');
  const command=commands.find(c=>c.name==='study-attempt');
  const before=engine.store.events(engine.learnerId).length;
  for(let i=0;i<512;i++){
    const operation=['read','hint','submit','mastered'][i%4];
    const payload={operation,attemptId:card.attemptId,requestId:'attack-'+i,level:'H0',answer:['a'],correct:true,mastered:true};
    const response=await command.handler({agent:{id:'other-session'},rawInput:JSON.stringify(payload),signal:new AbortController().signal});
    assert.equal(response.kind,'error');assert.ok(response.text.length<=300);
    const tool=tools.find(tool=>tool.name==='study_issue_question');
    await assert.rejects(()=>tool.execute({questionId:'q-single',correct:true,mastered:true},{agent:{id:'owner'},callId:'forge-'+i,signal:new AbortController().signal}),/field/i);
    assert.equal(readAttemptMeta({kind:'study-attempt',version:1,attempt:{...card,sessionId:'other-session'}},'owner'),undefined);
  }
  for(const raw of ['null','[]','false','{broken','"text"','x'.repeat(16385)]){
    const response=await command.handler({agent:{id:'owner'},rawInput:raw,signal:new AbortController().signal});assert.equal(response.kind,'error');
  }
  assert.equal(engine.store.events(engine.learnerId).length,before);
  assert.equal(engine.attempt(card.attemptId).status,'issued');assert.equal(engine.attempt(card.attemptId).maxHelp,'H0');
  assert.equal(engine.progress('synthetic-physics','oscillation').concept.state,'U');engine.store.verify();
});
