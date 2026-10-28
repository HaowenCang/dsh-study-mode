import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import * as vm from 'node:vm';
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
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
  const result=await continueTeaching(remote,'session-original','6f1c2d3e-0000-4000-8000-000000000001','request-feedback');
  assert.equal(result.ok,true);
  // UI-01: the queued prompt shows as the learner's bubble, so it is short and names the attempt by its first 8 characters.
  assert.deepEqual(accepted,{requestId:'request-feedback',sessionId:'session-original',mode:'queue',content:[{type:'text',text:'我已提交题卡作答（编号 6f1c2d3e）。请先调用 study_get_state 核对 Host 判分与提示记录，再继续讲解；不得自行改写能力等级。'}]});
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

test('UI-01: grade labels are Chinese and keep human review reasons verbatim',async()=>{
  const {gradeLabel}=await import('../src/client/protocol.ts');
  assert.equal(gradeLabel({outcome:'correct',basis:'Exact option set against Host answer key.'}),'回答正确 · 按 Host 答案键比对选项');
  assert.equal(gradeLabel({outcome:'incorrect',basis:'Host answer key, exact unit and configured absolute/relative tolerance.'}),'需要纠正 · 按 Host 答案键比对数值、单位与容差');
  assert.equal(gradeLabel({outcome:'pending_review',basis:'Open work requires human review of reasoning and applicability.'}),'待人工复核 · 开放题需人工复核推理与适用条件');
  assert.equal(gradeLabel({outcome:'correct',basis:'Reviewer accepted the sign argument.'}),'回答正确 · Reviewer accepted the sign argument.');
});

/** Load the built client bundle with React from the module table, as DSH does. */
function loadClient():{AttemptView:(props:unknown)=>unknown}{
  let loaded:{factory:(require:(id:string)=>unknown)=>unknown}|undefined;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:(entry:typeof loaded)=>{loaded=entry;}}}});
  return loaded!.factory(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return JsxRuntime;throw new Error('unexpected module '+id);}) as {AttemptView:(props:unknown)=>unknown};
}
/** Expand function components and collect visible text and inline styles. */
function flatten(node:unknown,out={text:[] as string[],styles:[] as string[],buttons:[] as string[],inputs:[] as string[]}){
  if(node===null||node===undefined||typeof node==='boolean')return out;
  if(typeof node==='string'||typeof node==='number'){out.text.push(String(node));return out;}
  if(Array.isArray(node)){for(const child of node)flatten(child,out);return out;}
  const element=node as {type:unknown;props:Record<string,unknown>};
  if(typeof element.type==='function')return flatten((element.type as (p:unknown)=>unknown)(element.props),out);
  if(element.props.style!==undefined)out.styles.push(JSON.stringify(element.props.style));
  if(element.type==='button')out.buttons.push(flatten(element.props.children).text.join(''));
  if(element.type==='input'||element.type==='textarea')out.inputs.push(String(element.props['aria-label']??element.props.type));
  return flatten(element.props.children,out);
}

test('UI-01: built study card uses DSH alias tokens, Chinese status tags and no internal ids',()=>{
  const {AttemptView}=loadClient();
  assert.equal(typeof AttemptView,'function');
  const question={id:'q-visible-id',version:1,kind:'single_choice' as const,prompt:'回复力方向？',options:[{id:'a',label:'指向平衡位置'},{id:'b',label:'背离平衡位置'}]};
  const noop=()=>{};
  const base={sessionId:'s',busy:false,notice:'',selected:['a'],answer:'',blanks:[],onSelect:noop,onAnswer:noop,onBlank:noop,onHint:noop,onSubmit:noop,onRefresh:noop};
  const issued=flatten(AttemptView({...base,attempt:{attemptId:'6f1c2d3e-uuid',sessionId:'s',status:'issued',maxHelp:'H1',independent:false,question,hintText:'考虑指向平衡位置的方向。'}}));
  const visible=issued.text.join('');
  assert.ok(!visible.includes('q-visible-id')&&!visible.includes('6f1c2d3e'),visible);
  assert.match(visible,/帮助等级：H1/);assert.match(visible,/能力证据：U/);assert.match(visible,/考虑指向平衡位置的方向/);
  assert.deepEqual(issued.buttons.filter(b=>b==='提交作答'||b==='请求提示 H1').sort(),['提交作答','请求提示 H1']);
  assert.ok(issued.styles.some(s=>s.includes('--dsw-alias-border-l2')));
  assert.ok(!issued.styles.some(s=>s.includes('--dsw-color-')));
  const graded=flatten(AttemptView({...base,attempt:{attemptId:'a',sessionId:'s',status:'graded',maxHelp:'H0',independent:true,question,answer:['a'],grade:{outcome:'correct',basis:'Exact option set against Host answer key.'},capability:'R'}}));
  assert.match(graded.text.join(''),/回答正确 · 按 Host 答案键比对选项/);
  assert.match(graded.text.join(''),/指向平衡位置/);
  assert.ok(!graded.buttons.includes('提交作答'));
});

test('STUDY-02: card protocol accepts model questions, fill-in blanks and model-review envelopes only',async()=>{
  const {readAttemptMeta,readModelReviewMeta,displaySubmittedAnswer,gradeLabel}=await import('../src/client/protocol.ts');
  const question={id:'m-1',version:1,kind:'fill_blank',source:'model',prompt:'F = {{1}}，ω = {{2}}。',blanks:[{},{unit:'rad/s'}]};
  const attempt={attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H0',independent:true,question};
  assert.equal(readAttemptMeta({kind:'study-attempt',version:1,attempt},'s')?.question.kind,'fill_blank');
  assert.equal(readAttemptMeta({kind:'study-attempt',version:1,attempt:{...attempt,question:{...question,blanks:'x'}}},'s'),undefined);
  assert.equal(readAttemptMeta({kind:'study-attempt',version:1,attempt:{...attempt,question:{...question,source:'operator'}}},'s'),undefined);
  assert.equal(displaySubmittedAnswer({...attempt,status:'graded',answer:['-kx','2']} as never),'（1）-kx；（2）2 rad/s');
  assert.equal(gradeLabel({outcome:'correct',basis:'Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.'}),'回答正确 · 按出题时锁定的模型答案逐空比对');
  assert.equal(gradeLabel({outcome:'incorrect',basis:'Exact option set against the model-authored answer key locked at issue.'}),'需要纠正 · 按出题时锁定的模型答案键比对选项');
  const review={verdict:'partially_correct',comment:'缺少条件。',at:'2026-10-27T00:00:00.000Z'};
  assert.deepEqual(readModelReviewMeta({kind:'study-model-review',version:1,attemptId:'a',review}),{attemptId:'a',review});
  assert.equal(readModelReviewMeta({kind:'study-model-review',version:1,attemptId:'a',review:{...review,verdict:'mastered'}}),undefined);
});

test('STUDY-02: built card shows the model-question label, inline blanks, next hint level, reference answer and model review',()=>{
  const {AttemptView}=loadClient();
  const noop=()=>{};
  const base={sessionId:'s',busy:false,notice:'',selected:[],answer:'',blanks:['',''],onSelect:noop,onAnswer:noop,onBlank:noop,onHint:noop,onSubmit:noop,onRefresh:noop};
  const blankQuestion={id:'m-1',version:1,kind:'fill_blank',source:'model',prompt:'回复力 F = {{1}}，角频率 ω = {{2}}。',blanks:[{},{unit:'rad/s'}]};
  const issued=flatten(AttemptView({...base,attempt:{attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H1',independent:false,hints:[{level:'H1',at:'t'}],question:blankQuestion}}));
  const text=issued.text.join('');
  assert.match(text,/模型出题/);assert.match(text,/回复力 F = /);assert.match(text,/rad\/s/);assert.equal(text.includes('{{'),false);
  assert.deepEqual(issued.inputs,['第 1 空','第 2 空']);
  assert.ok(issued.buttons.includes('请求提示 H2'),issued.buttons.join('|'));
  const last=flatten(AttemptView({...base,attempt:{attemptId:'a',sessionId:'s',status:'issued',maxHelp:'H4',independent:false,hints:[{level:'H4',at:'t'}],question:blankQuestion}}));
  assert.ok(!last.buttons.some(b=>b.startsWith('请求提示')),'no hint beyond H4');
  const graded=flatten(AttemptView({...base,attempt:{attemptId:'a',sessionId:'s',status:'graded',maxHelp:'H0',independent:true,question:blankQuestion,answer:['-kx','3'],grade:{outcome:'incorrect',basis:'Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.',parts:[true,false]}}}));
  assert.match(graded.text.join(''),/第 1 空 正确.*第 2 空 错误/s);
  const open={id:'m-2',version:1,kind:'open',source:'model',prompt:'推导简谐运动方程。'};
  const reviewed=flatten(AttemptView({...base,attempt:{attemptId:'b',sessionId:'s',status:'pending_review',maxHelp:'H0',independent:true,question:open,answer:'mx\'\'=-kx',referenceAnswer:'x\'\' + ω²x = 0',grade:{outcome:'pending_review',basis:'Open work requires human review of reasoning and applicability.'},modelReviews:[{verdict:'partially_correct',comment:'缺少 ω 的定义。',at:'t'}]}}));
  const shown=reviewed.text.join('');
  assert.match(shown,/参考答案（出题时锁定）/);assert.match(shown,/ω²x = 0/);
  assert.match(shown,/模型评阅（不计入判分）/);assert.match(shown,/部分正确/);assert.match(shown,/缺少 ω 的定义/);
  assert.match(shown,/待人工复核/);
  const tf=flatten(AttemptView({...base,attempt:{attemptId:'c',sessionId:'s',status:'issued',maxHelp:'H0',independent:true,question:{id:'m-3',version:1,kind:'single_choice',format:'true_false',source:'model',prompt:'机械能守恒。',options:[{id:'true',label:'正确'},{id:'false',label:'错误'}]}}}));
  assert.match(tf.text.join(''),/判断题/);
});
