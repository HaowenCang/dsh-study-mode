import {StudyEngine} from '../integration/engine.ts';
import {record,fields,text} from '../shared/validation.ts';
import {randomUUID} from 'node:crypto';
interface Exec {callId:string;agent?:{id:string};signal:AbortSignal}
interface Tool {name:string;description:string;parameters:Record<string,unknown>;execute:(args:unknown,exec:Exec)=>Promise<unknown>;output:{schema:Record<string,unknown>;render:(args:unknown,value:unknown)=>{type:'text';text:string}[];presentationMeta?:(args:unknown,value:unknown)=>unknown}}
interface Invocation {agent:{id:string};rawInput:string;signal:AbortSignal;commandId?:string}
interface Command {name:string;description:string;input:{hint:string};recordInput:boolean;handler:(invocation:Invocation)=>Promise<{kind:'success'|'error';text:string}>}
export interface ApiContext {tools:{register:(tool:Tool)=>()=>void};commands:{register:(command:Command)=>()=>void};effect:(callback:()=>undefined|(()=>void))=>void}
function session(exec:Exec):string{if(exec.signal.aborted)throw new Error('Study tool aborted');return text(exec.agent?.id,'receiving session');}
function args(value:unknown,allowed:string[]){const v=record(value);fields(v,allowed);return v;}
export function registerApi(ctx:ApiContext,engine:StudyEngine,enableHumanReview:boolean):void{
  const tools:Tool[]=[
    {name:'study_get_plan',description:'Read a trusted course-plan definition and optional day. A plan does not import or prove learner mastery.',parameters:{type:'object',properties:{courseId:{type:'string'},day:{type:'integer',minimum:1,maximum:366}},required:['courseId'],additionalProperties:false},execute:async(value,exec)=>{session(exec);const a=args(value,['courseId','day']);if(a.day!==undefined&&(!Number.isSafeInteger(a.day)||Number(a.day)<1))throw new Error('Invalid plan day');return engine.plan(text(a.courseId,'course ID'),a.day as number|undefined);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
    {name:'study_get_state',description:'Read Host-owned learning evidence and trusted question catalog. Teaching is separate from mastery.',parameters:{type:'object',properties:{},additionalProperties:false},execute:async(value,exec)=>{session(exec);args(value,[]);return {...engine.state(),questions:engine.questions()};},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
    {name:'study_issue_question',description:'Issue a trusted synthetic question in this session. Never submit a student answer or invent grades. Use only after teaching and worked examples.',parameters:{type:'object',properties:{questionId:{type:'string'}},required:['questionId'],additionalProperties:false},execute:async(value,exec)=>{const id=session(exec),a=args(value,['questionId']);return engine.issue(id,text(a.questionId,'question ID'),exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}],presentationMeta:(_a,v)=>({kind:'study-attempt',version:1,attempt:v})}},
    {name:'study_teaching_step',description:'Record a sequential teaching-stage exposure. This creates no mastery and does not claim student understanding.',parameters:{type:'object',properties:{courseId:{type:'string'},topicId:{type:'string'},stage:{type:'string'}},required:['courseId','topicId','stage'],additionalProperties:false},execute:async(value,exec)=>{const id=session(exec),a=args(value,['courseId','topicId','stage']);return engine.advanceLesson(id,text(a.courseId,'course ID'),text(a.topicId,'topic ID'),a.stage,exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
  ];
  for(const tool of tools)ctx.effect(()=>ctx.tools.register(tool));
  ctx.effect(()=>ctx.commands.register({
    name:'study-mode',description:'Select a teaching mode without changing learning evidence.',input:{hint:'systematic_teaching | guided_practice | independent_assessment | review | ordinary_qa | research_discussion'},recordInput:true,
    async handler(invocation){
      try{if(invocation.signal.aborted)throw new Error('Mode selection aborted');const result=engine.setMode(invocation.agent.id,invocation.rawInput.trim(),invocation.commandId??randomUUID());return {kind:'success',text:'学习模式：'+result.mode+'。既有学习记录保持。'};}
      catch(error){return {kind:'error',text:error instanceof Error?error.message:'Mode selection failed'};}
    },
  }));
  ctx.effect(()=>ctx.commands.register({
    name:'study-attempt',description:'Human-only attempt status, hint or answer submission.',input:{hint:'Internal learning card command'},recordInput:false,
    async handler(invocation){
      try{
        if(invocation.signal.aborted)throw new Error('Study command aborted');
        if(invocation.rawInput.length>16384)throw new Error('Study command payload exceeds size limit');
        const a=args(JSON.parse(invocation.rawInput),['operation','attemptId','requestId','level','answer']);
        const id=text(a.attemptId,'attempt ID'),sessionId=invocation.agent.id;
        if(engine.attempt(id).sessionId!==sessionId)throw new Error('Attempt session mismatch');
        let result:unknown;
        if(a.operation==='read'){fields(a,['operation','attemptId']);result=engine.attempt(id);}
        else if(a.operation==='hint'){fields(a,['operation','attemptId','requestId','level']);result=engine.hint(sessionId,id,a.level,text(a.requestId,'request ID'));}
        else if(a.operation==='submit'){fields(a,['operation','attemptId','requestId','answer']);result=engine.submit(sessionId,id,a.answer,text(a.requestId,'request ID'));}
        else throw new Error('Unknown study operation');
        return {kind:'success',text:JSON.stringify(result)};
      }catch(error){return {kind:'error',text:(error instanceof Error?error.message:'Study command failed').slice(0,300)};}
    },
  }));
  if(enableHumanReview)ctx.effect(()=>ctx.commands.register({
    name:'study-review',description:'Operator-enabled human grading review with mandatory justification.',input:{hint:'JSON attemptId, requestId, correct, reason'},recordInput:false,
    async handler(invocation){
      try{
        if(invocation.signal.aborted)throw new Error('Review aborted');
        if(invocation.rawInput.length>8192)throw new Error('Review payload too large');
        const a=args(JSON.parse(invocation.rawInput),['attemptId','requestId','correct','reason']);
        const result=engine.review(invocation.agent.id,text(a.attemptId,'attempt ID'),a.correct,text(a.reason,'review reason',2000),'local-human-operator',text(a.requestId,'request ID'));
        return {kind:'success',text:JSON.stringify(result)};
      }catch(error){return {kind:'error',text:(error instanceof Error?error.message:'Review failed').slice(0,300)};}
    },
  }));
}
