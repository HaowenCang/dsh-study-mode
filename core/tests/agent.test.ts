import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fixture} from './fixtures.ts';

test('Study preset contributes a scoped teaching policy and omits filesystem/shell capabilities',async()=>{
  assert.ok(existsSync(new URL('../src/agent/index.ts',import.meta.url)),'Study Agent preset is not implemented');
  const {configureStudyAgent}=await import('../src/agent/index.ts');
  let restriction:{deny:string[]}|undefined,policy='',skill:any;const disposers:(()=>void)[]=[];
  const scope={effect:(f:()=>()=>void)=>disposers.push(f()),tools:{presentAs:()=>()=>{},schemas:()=>['rich_render','study_get_state','study_issue_question','study_teaching_step','skill','pwsh','read_file','write_file'].map(name=>({name})),restrict:(filter:{deny:string[]})=>{restriction=filter;return()=>{};},guard:()=>()=>{}}};
  const ctx={effect:scope.effect,tools:scope.tools,systemPrompt:{getSectionOrder:()=>1,section:(section:{text:string})=>{policy=section.text;return()=>{};}},skills:{register:(value:unknown)=>{skill=value;return()=>{};}}};
  configureStudyAgent(ctx,'A supplied, source-controlled teaching skill.');
  assert.deepEqual(restriction?.deny,['pwsh','read_file','write_file']);
  assert.match(policy,/study_get_state/);assert.match(policy,/独立/);assert.equal(skill.name,'study-systematic-teaching');
  disposers.forEach(dispose=>dispose());
});

test('Study guard refuses directory changes and future non-teaching tools in the runtime own layer',async()=>{
  const {configureStudyAgent}=await import('../src/agent/index.ts');
  let guard:((exec:{name:string;arguments:unknown})=>string|undefined)|undefined;
  const scope={effect:(f:()=>()=>void)=>{f();},tools:{presentAs:()=>()=>{},schemas:()=>[{name:'working_directory'},{name:'study_get_state'}],restrict:()=>()=>{},guard:(value:typeof guard)=>{guard=value;return()=>{};}}};
  configureStudyAgent({effect:scope.effect,tools:scope.tools,systemPrompt:{getSectionOrder:()=>1,section:()=>()=>{}},skills:{register:()=>()=>{}}},'Skill');
  assert.equal(typeof guard,'function','No monotonic guard was installed');
  assert.match(guard!({name:'working_directory',arguments:{cd:'E:\\outside'}})??'',/directory/i);
  assert.equal(guard!({name:'working_directory',arguments:{}}),undefined);
  assert.match(guard!({name:'pwsh',arguments:{command:'anything'}})??'',/Study/);
});

test('PTC deployment uses scoped native presentation without restricting reserved transport',async()=>{
  const {configureStudyAgent}=await import('../src/agent/index.ts');
  let mode:string|undefined,deny:string[]=[],guard:((exec:{name:string;arguments:unknown})=>string|undefined)|undefined;
  configureStudyAgent({effect:f=>{f();},tools:{
    presentAs:value=>{mode=value;return()=>{};},
    schemas:()=>['run_code','pwsh','study_get_state'].map(name=>({name})),
    restrict:filter=>{assert.ok(!filter.deny.includes('run_code'),'Reserved PTC transport cannot be restricted');deny=filter.deny;return()=>{};},
    guard:value=>{guard=value;return()=>{};},
  },systemPrompt:{getSectionOrder:()=>1,section:()=>()=>{}},skills:{register:()=>()=>{}}},'Skill');
  assert.equal(mode,'native');assert.deepEqual(deny,['pwsh']);
  assert.match(guard!({name:'run_code',arguments:{code:'anything'}})??'',/Study/);
  assert.equal(guard!({name:'study_get_state',arguments:{}}),undefined);
});

test('teaching mode defaults to systematic and persists without changing capability or course history',async t=>{
  const {engine,databasePath}=await fixture();
  assert.equal(engine.mode(),'systematic_teaching');
  engine.setMode('s','ordinary_qa','m1');
  assert.equal(engine.mode(),'ordinary_qa');
  assert.throws(()=>engine.setMode('s','mastered','m2'),/mode/i);
  assert.equal(engine.state().attempts.length,0);engine.close();
  const resumed=await fixture(databasePath);t.after(()=>resumed.engine.close());
  assert.equal(resumed.engine.mode(),'ordinary_qa');
});

test('Study preset admits the bounded Mermaid flowchart tool and names it in the teaching policy',async()=>{
  const {configureStudyAgent}=await import('../src/agent/index.ts');
  let restriction:{deny:string[]}|undefined,guard:((exec:{name:string;arguments:unknown})=>string|undefined)|undefined,policy='';
  const tools={presentAs:()=>()=>{},schemas:()=>['rich_mermaid','rich_render','pwsh'].map(name=>({name})),restrict:(filter:{deny:string[]})=>{restriction=filter;return()=>{};},guard:(value:typeof guard)=>{guard=value;return()=>{};}};
  configureStudyAgent({effect:(f:()=>()=>void)=>{f();},tools,systemPrompt:{getSectionOrder:()=>1,section:(section:{text:string})=>{policy=section.text;return()=>{};}},skills:{register:()=>()=>{}}},'Skill');
  assert.deepEqual(restriction?.deny,['pwsh']);
  assert.equal(guard!({name:'rich_mermaid',arguments:{title:'t',source:'flowchart TD\nA-->B'}}),undefined);
  assert.match(policy,/rich_mermaid/);
});

test('Study preset admits the heatmap and workspace image tools and names them in the teaching policy',async()=>{
  const {configureStudyAgent}=await import('../src/agent/index.ts');
  let restriction:{deny:string[]}|undefined,guard:((exec:{name:string;arguments:unknown})=>string|undefined)|undefined,policy='';
  const tools={presentAs:()=>()=>{},schemas:()=>['rich_heatmap','rich_image','read_image','pwsh'].map(name=>({name})),restrict:(filter:{deny:string[]})=>{restriction=filter;return()=>{};},guard:(value:typeof guard)=>{guard=value;return()=>{};}};
  configureStudyAgent({effect:(f:()=>()=>void)=>{f();},tools,systemPrompt:{getSectionOrder:()=>1,section:(section:{text:string})=>{policy=section.text;return()=>{};}},skills:{register:()=>()=>{}}},'Skill');
  assert.deepEqual(restriction?.deny,['read_image','pwsh']);
  assert.equal(guard!({name:'rich_heatmap',arguments:{content:{}}}),undefined);
  assert.equal(guard!({name:'rich_image',arguments:{path:'a.png',alt:'a',source:'user_provided'}}),undefined);
  assert.match(policy,/rich_heatmap/);
  assert.match(policy,/rich_image/);
  assert.match(policy,/只展示学生明确给出路径的图片文件，不要猜测或遍历文件路径/);
});
