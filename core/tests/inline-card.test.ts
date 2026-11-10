import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as vm from 'node:vm';
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';

test('P4 claims: an inline card claim hides the tool-view card of the same session and call only',async()=>{
  const {claimCall,isClaimed,subscribeClaims,inlineCardSelector}=await import('../src/client/claims.ts');
  let notified=0;const stop=subscribeClaims(()=>{notified++;});
  assert.equal(isClaimed('s','c1'),false);
  const release=claimCall('s','c1');const second=claimCall('s','c1');
  assert.equal(isClaimed('s','c1'),true);assert.equal(isClaimed('other','c1'),false);assert.equal(isClaimed('s','c2'),false);
  release();release();
  assert.equal(isClaimed('s','c1'),true,'a second mount still holds the claim; double release is a no-op');
  second();assert.equal(isClaimed('s','c1'),false);
  assert.equal(notified,4);stop();claimCall('s','c3')();assert.equal(notified,4);
  assert.equal(inlineCardSelector('a"b\\c'),'[data-study-inline-card="a\\"b\\\\c"]');
});

test('P4 locateWithRetry: waits only for an attempt that does not exist yet, and stops when unmounted',async()=>{
  const {locateWithRetry}=await import('../src/client/claims.ts');
  const slept:number[]=[];const sleep=async(ms:number)=>{slept.push(ms);};
  let calls=0;
  const value=await locateWithRetry(async()=>{if(++calls<3)throw new Error('Unknown attempt');return 'found';},()=>true,[10,20,30],sleep);
  assert.equal(value,'found');assert.deepEqual(slept,[10,20]);
  await assert.rejects(locateWithRetry(async()=>{throw new Error('Unknown attempt');},()=>true,[1,2],sleep),/Unknown attempt/);
  calls=0;await assert.rejects(locateWithRetry(async()=>{calls++;throw new Error('Attempt session mismatch');},()=>true,[1,2],sleep),/mismatch/);
  assert.equal(calls,1,'other refusals are final');
  let alive=true;calls=0;
  const gone=await locateWithRetry(async()=>{calls++;alive=false;throw new Error('Unknown attempt');},()=>alive,[1,2,3],sleep);
  assert.equal(gone,undefined);assert.equal(calls,1);
});

test('P4 locateAttempt: sends one read-only locate command and validates the attempt against the session',async()=>{
  const {locateAttempt}=await import('../src/client/attempt-command.ts');
  const attempt={attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H0',independent:true,question:{id:'q',version:1,kind:'single_choice',prompt:'Q',options:[{id:'a',label:'A'},{id:'b',label:'B'}]}};
  const lines:string[]=[];
  const remote={commands:{execute:async(_s:string,line:string)=>{lines.push(line);return {ok:true,value:{result:{kind:'success',text:JSON.stringify(attempt)}}};}}};
  assert.equal((await locateAttempt(remote,'s','call-1')).attemptId,'a');
  assert.deepEqual(lines,['/study-attempt {"operation":"locate","callId":"call-1"}']);
  await assert.rejects(locateAttempt(remote,'other','call-1'),/Invalid Host learning state/);
  await assert.rejects(locateAttempt(remote,'s',''),/Invalid call ID/);
  const refused={commands:{execute:async()=>({ok:true,value:{result:{kind:'error',text:'Unknown attempt'}}})}};
  await assert.rejects(locateAttempt(refused,'s','call-1'),/Unknown attempt/);
});

test('P4 built client registers inline cards in rich.inline.toolcall next to the tool views',()=>{
  let loaded:{factory:(require:(id:string)=>unknown)=>unknown}|undefined;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:(entry:typeof loaded)=>{loaded=entry;}}}});
  const mod=loaded!.factory(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return JsxRuntime;throw new Error('unexpected module '+id);}) as {apply:(ctx:unknown)=>void};
  const registered:string[]=[];
  mod.apply({slots:{inject:(_slot:string,callback:()=>unknown)=>{callback();},register:(spec:{name:string;key:string})=>{registered.push(spec.name+'/'+spec.key);return ()=>{};}},remote:{commands:{execute:async()=>({ok:false})},session:{}}});
  for(const key of ['study_issue_question','study_author_question']){
    assert.ok(registered.includes('tool.call.toolview/'+key));
    assert.ok(registered.includes('rich.inline.toolcall/'+key));
  }
});

test('P4 command rows: a too-early inline lookup reads as a pending card, other refusals stay explicit',async()=>{
  const {commandSummary}=await import('../src/client/protocol.ts');
  assert.equal(commandSummary({kind:'error',text:'Unknown attempt'},'s'),'题卡尚未就绪，正文题卡会自动重试。');
  assert.equal(commandSummary({kind:'error',text:'Attempt session mismatch'},'s'),'学习操作未完成：Attempt session mismatch');
});
