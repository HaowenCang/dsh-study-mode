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
