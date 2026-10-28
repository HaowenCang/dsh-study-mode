import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.ts';

// STUDY-02 (D-015): questions the model writes itself, locked by the Host at issue.
const hints={H1:'注意位移与回复力的方向。',H2:'用胡克定律 F = -kx。',H3:'x > 0 时 -kx < 0。',H4:'答案是 A：指向平衡位置。'};
const base={courseId:'synthetic-physics',topicId:'oscillation',familyId:'restoring-force',hints,dimensions:['concept']};
const single={...base,type:'single_choice',prompt:'弹簧振子位于 x > 0 处时，回复力的方向是？',options:['指向平衡位置','背离平衡位置','始终为零'],answer:['A']};

test('STUDY-02: an authored question is stored as an immutable model revision and issued without its key',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const card=engine.author('session-a',single,'call-1');
  assert.equal(card.status,'issued');assert.equal(card.maxHelp,'H0');assert.equal(card.independent,true);
  assert.equal(card.question.source,'model');assert.equal(card.question.prompt,single.prompt);
  assert.deepEqual(card.question.options,[{id:'A',label:'指向平衡位置'},{id:'B',label:'背离平衡位置'},{id:'C',label:'始终为零'}]);
  assert.match(card.question.id,/^m-/);
  const json=JSON.stringify(card);
  // The attempt's own `hints` request list is public; the authored hint texts are not.
  for(const secret of ['"answer"','referenceAnswer',hints.H1,hints.H2,hints.H4])assert.equal(json.includes(secret),false,secret);
  const stored=engine.store.question(card.questionId,1) as {source:string;answer:string[];sessionId:string};
  assert.deepEqual(stored.answer,['A']);assert.equal(stored.source,'model');assert.equal(stored.sessionId,'session-a');
  assert.throws(()=>engine.store.db.prepare('UPDATE questions SET payload=? WHERE id=?').run('{}',card.questionId),/immutable/);
  const graded=engine.submit('session-a',card.attemptId,['A'],'submit-1');
  assert.equal(graded.grade?.outcome,'correct');
  assert.equal(graded.grade?.basis,'Exact option set against the model-authored answer key locked at issue.');
  assert.equal(graded.capability,'U','a final choice alone cannot prove conceptual reasoning');
  engine.store.verify();
});

test('STUDY-02: a retried call returns the same card; a conflicting retry is refused; bank issue cannot reuse it',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const first=engine.author('s',single,'call-1');
  assert.deepEqual(engine.author('s',single,'call-1'),first);
  assert.equal(engine.store.db.prepare("SELECT COUNT(*) AS n FROM questions WHERE id LIKE 'm-%'").get()?.n,1);
  assert.throws(()=>engine.author('s',{...single,answer:['B']},'call-1'),/idempotency/i);
  assert.throws(()=>engine.issue('s',first.questionId,'call-2'),/Unknown trusted question/);
});

test('STUDY-02: true/false, multiple choice and authored hints up to H4',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const tf=engine.author('s',{...base,type:'true_false',prompt:'无阻尼简谐运动中机械能守恒。',answer:true},'c1');
  assert.equal(tf.question.kind,'single_choice');assert.equal(tf.question.format,'true_false');
  assert.deepEqual(tf.question.options,[{id:'true',label:'正确'},{id:'false',label:'错误'}]);
  assert.equal(engine.submit('s',tf.attemptId,['false'],'s1').grade?.outcome,'incorrect');
  const multi=engine.author('s',{...base,type:'multiple_choice',prompt:'下列哪些量保持不变？',options:['总机械能','动能','角频率'],answer:['A','C']},'c2');
  const h1=engine.hint('s',multi.attemptId,'H1','h1');assert.equal(h1.hintText,hints.H1);
  const h4=engine.hint('s',multi.attemptId,'H4','h4');assert.equal(h4.hintText,hints.H4);assert.ok(h4.revealedAt);
  const graded=engine.submit('s',multi.attemptId,['C','A'],'s2');
  assert.equal(graded.grade?.outcome,'correct');assert.equal(graded.capability,'S');
});

test('STUDY-02: fill-in-blank grades each blank by normalized text or number within tolerance',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const input={...base,type:'fill_blank',prompt:'回复力 F = {{1}}，角频率 ω = {{2}}。',blanks:[{accepted:['-kx','−kx']},{value:2,tolerance:0.01,unit:'rad/s'}],dimensions:['calculation']};
  const card=engine.author('s',input,'c1');
  assert.equal(card.question.kind,'fill_blank');
  assert.deepEqual(card.question.blanks,[{},{unit:'rad/s'}]);
  assert.equal(JSON.stringify(card).includes('-kx'),false);
  assert.throws(()=>engine.submit('s',card.attemptId,['-kx'],'bad'),/blank/i);
  const right=engine.submit('s',card.attemptId,[' - k x ','2.005'],'s1');
  assert.equal(right.grade?.outcome,'correct');assert.deepEqual(right.grade?.parts,[true,true]);
  const again=engine.author('s',input,'c2');
  const wrong=engine.submit('s',again.attemptId,['kx','abc'],'s2');
  assert.equal(wrong.grade?.outcome,'incorrect');assert.deepEqual(wrong.grade?.parts,[false,false]);
  assert.equal(wrong.capability,'N');
  const evidence=engine.state().courses[0]!.topics.find(topic=>topic.topicId==='oscillation')!.evidence.calculation;
  assert.equal(evidence.state,'N');assert.ok(evidence.attemptIds.includes(again.attemptId));
});

test('STUDY-02: authored questions are validated before anything is stored',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const bad:[unknown,RegExp][]=[
    [{...single,courseId:'unknown-course'},/course\/topic/i],
    [{...single,answer:['A','B']},/answer key/i],
    [{...single,answer:['D']},/answer key/i],
    [{...single,options:['only one']},/options/i],
    [{...single,options:Array.from({length:11},(_,i)=>'option '+i)},/options/i],
    [{...single,hints:{H1:'a',H2:'b',H3:'c'}},/H4/],
    [{...single,correct:true},/Unexpected field/],
    [{...single,referenceAnswer:'x'},/Unexpected field|reference/i],
    [{...single,type:'numeric'},/type/i],
    [{...single,dimensions:['mastery']},/dimension/i],
    [{...base,type:'fill_blank',prompt:'只有 {{1}}。',blanks:[{accepted:['a']},{accepted:['b']}]},/marker/i],
    [{...base,type:'fill_blank',prompt:'{{1}} 和 {{1}}',blanks:[{accepted:['a']}]},/marker/i],
    [{...base,type:'fill_blank',prompt:'{{1}}',blanks:[{accepted:['a'],value:1}]},/blank/i],
    [{...base,type:'open',prompt:'推导简谐运动方程。'},/reference answer/i],
    [{...base,type:'true_false',prompt:'对吗？',answer:'true'},/answer key/i],
  ];
  for(const [input,pattern] of bad)assert.throws(()=>engine.author('s',input,'bad-'+String(pattern)),pattern,JSON.stringify(input));
  assert.equal(engine.store.db.prepare("SELECT COUNT(*) AS n FROM questions WHERE id LIKE 'm-%'").get()?.n,0);
  assert.equal(engine.state().attempts.length,0);
});

test('STUDY-02: model review of an open answer is recorded apart and never grades or promotes',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const open=engine.author('s',{...base,type:'open',prompt:'由牛顿第二定律推导简谐运动方程。',referenceAnswer:'m x\'\' = -kx，得 x\'\' + ω²x = 0，ω = √(k/m)。',dimensions:['derivation']},'c1');
  assert.equal(open.question.kind,'open');assert.equal(JSON.stringify(open).includes('referenceAnswer'),false);
  assert.throws(()=>engine.modelReview('s',open.attemptId,'correct','好','r0'),/unsubmitted|submitted/i);
  const submitted=engine.submit('s',open.attemptId,'F = -kx，所以 x\'\' = -(k/m)x。','s1');
  assert.equal(submitted.status,'pending_review');assert.match(String(submitted.referenceAnswer),/ω = √\(k\/m\)/);
  assert.throws(()=>engine.modelReview('other',open.attemptId,'correct','好','r1'),/session/i);
  assert.throws(()=>engine.modelReview('s',open.attemptId,'mastered','好','r2'),/verdict/i);
  assert.throws(()=>engine.modelReview('s',open.attemptId,'correct','  ','r3'),/comment/i);
  const reviewed=engine.modelReview('s',open.attemptId,'partially_correct','方程正确，但没有说明 ω 的物理意义。','r4');
  assert.equal(reviewed.status,'pending_review');assert.deepEqual(reviewed.grade,submitted.grade);
  assert.equal(reviewed.capability,'U');assert.equal(reviewed.review,undefined);
  assert.deepEqual(reviewed.modelReviews?.map(r=>r.verdict),['partially_correct']);
  assert.equal(engine.history(open.attemptId).at(-1)?.kind,'model_reviewed');
  const human=engine.review('s',open.attemptId,true,'Verified derivation.','operator','hr1');
  assert.equal(human.capability,'P');assert.equal(human.modelReviews?.length,1);
  const choice=engine.author('s',single,'c2');engine.submit('s',choice.attemptId,['A'],'s2');
  assert.throws(()=>engine.modelReview('s',choice.attemptId,'correct','好','r5'),/open/i);
});

test('STUDY-02: databases move to schema 3 and keep earlier learning records',async t=>{
  const {engine,databasePath}=await fixture();
  assert.equal(engine.store.db.prepare('PRAGMA user_version').get()?.user_version,3);
  const a=engine.issue('s','q-single','i1');engine.store.db.exec('PRAGMA user_version=2');engine.close();
  const next=await fixture(databasePath);t.after(()=>next.engine.close());
  assert.equal(next.engine.store.db.prepare('PRAGMA user_version').get()?.user_version,3);
  assert.equal(next.engine.attempt(a.attemptId).status,'issued');
});

// Independent review R1-R7 (2026-10-28).
test('STUDY-02 R1: a copied prompt inherits earlier help and exposure, and cannot count as a different question for R',async t=>{
  const {engine,advance}=await fixture();t.after(()=>engine.close());
  const bank=engine.issue('s','q-single','i1');engine.submit('s',bank.attemptId,['a'],'s1');
  const copy=engine.author('s',{...single,prompt:'  Synthetic check: restoring force for x > 0? '},'c1');
  assert.equal(copy.independent,false,'a bank question copied word for word was already answered');
  const x=engine.author('s',single,'c2');engine.hint('s',x.attemptId,'H4','h4');
  const again=engine.author('s',single,'c3');
  assert.equal(again.maxHelp,'H4');assert.equal(again.independent,false);
  const openInput={...base,type:'open',familyId:'derive',prompt:'Synthetic: derive the SHM equation.',referenceAnswer:'x″ + ω²x = 0',dimensions:['derivation']};
  const first=engine.issue('s','q-open','i2');engine.submit('s',first.attemptId,'m x″ = -kx','s2');engine.review('s',first.attemptId,true,'ok','op','r1');
  advance(25*60*60*1000);
  const copied=engine.author('s',openInput,'c4');engine.submit('s',copied.attemptId,'m x″ = -kx','s3');
  const reviewed=engine.review('s',copied.attemptId,true,'ok','op','r2');
  assert.notEqual(reviewed.capability,'R');
  assert.notEqual(engine.state().courses[0]!.topics.find(topic=>topic.topicId==='oscillation')!.evidence.derivation.state,'R');
});

test('STUDY-02 R2: objective model questions cannot carry derivation or transfer evidence',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  for(const dims of [['derivation'],['concept','transfer']])
    assert.throws(()=>engine.author('s',{...single,dimensions:dims},'d-'+dims.join()),/dimension/i);
  assert.throws(()=>engine.author('s',{...base,type:'true_false',prompt:'对吗？',answer:true,dimensions:['derivation']},'d-tf'),/dimension/i);
  assert.equal(engine.author('s',{...base,type:'open',prompt:'推导。',referenceAnswer:'x',dimensions:['derivation','transfer']},'d-open').status,'issued');
});

test('STUDY-02 R3/R4: blanks keep letter case and superscripts, unify minus signs and read numbers strictly',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const input={...base,type:'fill_blank',prompt:'{{1}} {{2}} {{3}} {{4}}',dimensions:['calculation'],
    blanks:[{accepted:['mA']},{accepted:['10²']},{accepted:['-kx']},{value:3e8,tolerance:1e6,unit:'m/s'}]};
  const grade=(answer:string[],n:string)=>engine.submit('s',engine.author('s',input,'a'+n).attemptId,answer,'b'+n).grade?.parts;
  assert.deepEqual(grade(['mA','10²','−kx','3e8'],'1'),[true,true,true,true]);
  assert.deepEqual(grade(['MA','102','kx','0x11E1A300'],'2'),[false,false,false,false]);
  assert.deepEqual(grade(['ｍA','10 ²','- k x','3×10^8 m/s'],'3'),[true,true,true,true]);
  assert.deepEqual(grade(['mA','10²','-kx','3*10^8'],'4'),[true,true,true,true]);
});

test('STUDY-02 R6: duplicate options or hints and unbounded tolerances are refused',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  assert.throws(()=>engine.author('s',{...single,options:['2 m',' 2 m','3 m']},'o'),/duplicate option/i);
  assert.throws(()=>engine.author('s',{...single,hints:{...hints,H2:hints.H1}},'h'),/hints.*differ/i);
  const blankWith=(value:number,tolerance:number)=>({...base,type:'fill_blank',prompt:'{{1}}',dimensions:['calculation'],blanks:[{value,tolerance}]});
  assert.throws(()=>engine.author('s',blankWith(2,1e300),'t1'),/tolerance/i);
  assert.throws(()=>engine.author('s',blankWith(0,5),'t2'),/tolerance/i);
  assert.equal(engine.author('s',blankWith(2,0.5),'t3').status,'issued');
});

test('STUDY-02 R7: model review applies only to model-written open questions',async t=>{
  const {engine}=await fixture();t.after(()=>engine.close());
  const bank=engine.issue('s','q-open','i');engine.submit('s',bank.attemptId,'F = -kx','s');
  assert.throws(()=>engine.modelReview('s',bank.attemptId,'correct','好','r'),/model-written/i);
});
