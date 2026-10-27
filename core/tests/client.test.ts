import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
test('learning card reads only its Host-issued session metadata and refuses malformed envelopes',async()=>{
  assert.ok(existsSync(new URL('../src/client/protocol.ts',import.meta.url)),'Learning-card protocol is not implemented');
  const {readAttemptMeta}=await import('../src/client/protocol.ts');
  const meta={kind:'study-attempt',version:1,attempt:{attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H0',independent:true,question:{id:'q',version:1,kind:'single_choice',prompt:'Question',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}}};
  assert.equal(readAttemptMeta(meta,'s')?.attemptId,'a');
  assert.equal(readAttemptMeta(meta,'different-session'),undefined);
  assert.equal(readAttemptMeta({...meta,version:99},'s'),undefined);
  assert.equal(readAttemptMeta({...meta,attempt:{...meta.attempt,question:{prompt:'broken'}}},'s'),undefined);
});

test('continuing teaching addresses the original session directly and never touches composer drafts',async()=>{
  assert.ok(existsSync(new URL('../src/client/continue.ts',import.meta.url)),'Draft-safe continuation is not implemented');
  const {continueTeaching}=await import('../src/client/continue.ts');
  let accepted:unknown;
  const remote={prompt:async(request:unknown)=>{accepted=request;return {ok:true as const,value:{accepted:true as const}};}};
  const result=await continueTeaching(remote,'session-original','attempt-original','request-feedback');
  assert.equal(result.ok,true);
  assert.deepEqual(accepted,{requestId:'request-feedback',sessionId:'session-original',mode:'queue',content:[{type:'text',text:'学习题卡 attempt-original 的作答已由 Host 记录。请先调用 study_get_state 核对判分与提示状态，再继续反馈教学；不得自行改写能力等级。'}]});
});

test('restored answer display uses the actual submitted choices and units',async()=>{
  const protocol=await import('../src/client/protocol.ts');
  assert.equal(typeof protocol.displaySubmittedAnswer,'function','Persisted answer display is missing');
  const question={id:'q',version:1,kind:'single_choice' as const,prompt:'Question',options:[{id:'a',label:'negative'},{id:'b',label:'positive'}]};
  const base={attemptId:'a',sessionId:'s',status:'graded' as const,maxHelp:'H0',independent:true,question};
  assert.equal(protocol.displaySubmittedAnswer({...base,answer:['a']}),'negative');
  assert.equal(protocol.displaySubmittedAnswer({...base,question:{id:'n',version:1,kind:'numeric',prompt:'Q',unit:'rad/s'},answer:{value:2,unit:'Hz'}}),'2 Hz');
});

test('human command rows summarize learning results without dumping internal JSON',async()=>{
  const protocol=await import('../src/client/protocol.ts');
  assert.equal(typeof protocol.commandSummary,'function','Learning command presentation is missing');
  const value={attemptId:'internal-uuid',sessionId:'s',status:'graded',maxHelp:'H1',independent:false,question:{id:'q',version:1,kind:'open',prompt:'Q'},grade:{outcome:'correct',basis:'Reviewed'},capability:'S'};
  const summary=protocol.commandSummary({kind:'success',text:JSON.stringify(value)},'s');
  assert.match(summary,/正确/);assert.equal(summary.includes('internal-uuid'),false);assert.equal(summary.includes('attemptId'),false);
  assert.match(protocol.commandSummary({kind:'success',text:'{malformed'},'s'),/不可用/);
});

test('a recorded submit queues original-session feedback even when the card is already gone',async()=>{
  assert.ok(existsSync(new URL('../src/client/attempt-command.ts',import.meta.url)),'Card command flow is not separated from the component');
  const {runAttemptCommand}=await import('../src/client/attempt-command.ts');
  const attempt={attemptId:'a',sessionId:'s',status:'graded',maxHelp:'H0',independent:true,question:{id:'q',version:1,kind:'single_choice',prompt:'Q',options:[{id:'a',label:'A'},{id:'b',label:'B'}]},grade:{outcome:'correct',basis:'key'}};
  const prompts:unknown[]=[];
  const remote={
    commands:{execute:async(_s:string,line:string)=>line.includes('"operation":"broken"')?{ok:false,error:{message:'refused'}}:{ok:true,value:{result:{kind:'success',text:JSON.stringify(attempt)}}}},
    session:{prompt:async(request:unknown)=>{prompts.push(request);return {ok:true};}},
  };
  // The caller is unmounted before the response arrives and never awaits the feedback outcome.
  const submitted=await runAttemptCommand(remote,'s','a',{operation:'submit',attemptId:'a',requestId:'r',answer:['a']},'feedback-1');
  assert.equal(submitted.value.status,'graded');
  assert.equal(prompts.length,1,'feedback prompt was not queued');
  assert.equal((prompts[0] as {requestId:string;sessionId:string}).requestId,'feedback-1');
  assert.equal((prompts[0] as {sessionId:string}).sessionId,'s');
  const read=await runAttemptCommand(remote,'s','a',{operation:'read',attemptId:'a'},undefined);
  assert.equal(read.feedback,undefined);assert.equal(prompts.length,1,'a read must not queue feedback');
  await assert.rejects(runAttemptCommand(remote,'s','a',{operation:'broken',attemptId:'a'},'feedback-2'),/refused/);
  await assert.rejects(runAttemptCommand(remote,'other-session','a',{operation:'submit',attemptId:'a'},'feedback-3'),/Invalid Host learning state/);
  assert.equal(prompts.length,1,'failed or foreign results must not queue feedback');
  const offline={...remote,session:{prompt:async()=>{throw new Error('connection lost');}}};
  const lost=await runAttemptCommand(offline,'s','a',{operation:'submit',attemptId:'a'},'feedback-4');
  assert.deepEqual(await lost.feedback,{ok:false});
});
