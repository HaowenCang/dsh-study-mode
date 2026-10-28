import {StudyEngine} from '../integration/engine.ts';
import {record,fields,text} from '../shared/validation.ts';
import {randomUUID} from 'node:crypto';
import {stages} from '../domain/lesson/state.ts';
import {authoredTypes} from '../domain/assessment/authored.ts';
import {dimensions} from '../domain/assessment/question.ts';
import {modelVerdicts} from '../domain/assessment/attempt.ts';
interface Exec {callId:string;agent?:{id:string};signal:AbortSignal}
interface Tool {name:string;description:string;parameters:Record<string,unknown>;execute:(args:unknown,exec:Exec)=>Promise<unknown>;output:{schema:Record<string,unknown>;render:(args:unknown,value:unknown)=>{type:'text';text:string}[];presentationMeta?:(args:unknown,value:unknown)=>unknown}}
interface Invocation {agent:{id:string};rawInput:string;signal:AbortSignal;commandId?:string}
interface Command {name:string;description:string;input:{hint:string};recordInput:boolean;handler:(invocation:Invocation)=>Promise<{kind:'success'|'error';text:string}>}
export interface ApiContext {tools:{register:(tool:Tool)=>()=>void};commands:{register:(command:Command)=>()=>void};effect:(callback:()=>undefined|(()=>void))=>void}
const AUTHOR_DESCRIPTION='Write your own question and issue it as an answer card in this session (use study_issue_question for a fitting question listed in study_get_state.questions). '
  +'Write the prompt, options, hints and reference answer in the language the learner uses. Types: single_choice and multiple_choice (options are plain texts; answer lists the correct option letters "A", "B", ...), '
  +'true_false (answer is true or false), fill_blank (mark each blank in the prompt as {{1}}, {{2}}, ...; each blank gives accepted texts, or a value with optional tolerance and unit), open (short answer or derivation; give referenceAnswer). '
  +'dimensions: derivation and transfer need an open question. Hints: H1 quantities and directions, H2 the key equation or theorem, H3 steps or intermediate results, H4 the full solution. Reuse a courseId and topicId from study_get_state when the subject matches; otherwise create a new topic with short lowercase ids such as math / laplace-pde (listed as model-created). Never file a question under an unrelated topic. '
  +'The answer key, hints and reference answer are locked at issue: you cannot change them or the grade later. The Host checks the structure, not whether your key is right, and the card is labelled as model-written. '
  +'The learner answers on the card; never answer for them or reveal the answer in your reply.';
const AUTHOR_PARAMETERS={type:'object',properties:{
  courseId:{type:'string'},topicId:{type:'string'},familyId:{type:'string',description:'Short id of the skill being tested. R evidence needs a different prompt in the same family at least 24 h later; copying a prompt keeps its earlier help and exposure.'},
  type:{type:'string',enum:[...authoredTypes]},prompt:{type:'string',description:'Question text, at most 4000 characters; fill_blank marks blanks as {{1}}, {{2}}, ...'},
  options:{type:'array',items:{type:'string'},minItems:2,maxItems:10,description:'single_choice / multiple_choice only; lettered A, B, ... in order.'},
  answer:{anyOf:[{type:'array',items:{type:'string'}},{type:'boolean'}],description:'Option letters for choice questions; true or false for true_false.'},
  blanks:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{accepted:{type:'array',items:{type:'string'},minItems:1,maxItems:10},value:{type:'number'},tolerance:{type:'number',minimum:0},unit:{type:'string'}},additionalProperties:false},description:'fill_blank only, in marker order.'},
  referenceAnswer:{type:'string',description:'open only; shown to the learner after they submit.'},
  hints:{type:'object',properties:{H1:{type:'string'},H2:{type:'string'},H3:{type:'string'},H4:{type:'string'}},required:['H1','H2','H3','H4'],additionalProperties:false},
  dimensions:{type:'array',minItems:1,items:{type:'string',enum:[...dimensions]}},
},required:['courseId','topicId','familyId','type','prompt','hints','dimensions'],additionalProperties:false};
function session(exec:Exec):string{if(exec.signal.aborted)throw new Error('Study tool aborted');return text(exec.agent?.id,'receiving session');}
function args(value:unknown,allowed:string[]){const v=record(value);fields(v,allowed);return v;}
export function registerApi(ctx:ApiContext,engine:StudyEngine,enableHumanReview:boolean):void{
  const tools:Tool[]=[
    {name:'study_get_plan',description:'Read a trusted course-plan definition and optional day, only for a courseId listed in study_get_state.plans. A plan does not import or prove learner mastery.',parameters:{type:'object',properties:{courseId:{type:'string'},day:{type:'integer',minimum:1,maximum:366}},required:['courseId'],additionalProperties:false},execute:async(value,exec)=>{session(exec);const a=args(value,['courseId','day']);if(a.day!==undefined&&(!Number.isSafeInteger(a.day)||Number(a.day)<1))throw new Error('Invalid plan day');return engine.plan(text(a.courseId,'course ID'),a.day as number|undefined);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
    {name:'study_get_state',description:'Read Host-owned learning evidence and trusted question catalog. Teaching is separate from mastery.',parameters:{type:'object',properties:{},additionalProperties:false},execute:async(value,exec)=>{session(exec);args(value,[]);return {...engine.state(),questions:engine.questions()};},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
    {name:'study_issue_question',description:'Issue a trusted synthetic question in this session. Never submit a student answer or invent grades. Use only after teaching and worked examples.',parameters:{type:'object',properties:{questionId:{type:'string'}},required:['questionId'],additionalProperties:false},execute:async(value,exec)=>{const id=session(exec),a=args(value,['questionId']);return engine.issue(id,text(a.questionId,'question ID'),exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}],presentationMeta:(_a,v)=>({kind:'study-attempt',version:1,attempt:v})}},
    {name:'study_author_question',description:AUTHOR_DESCRIPTION,parameters:AUTHOR_PARAMETERS,execute:async(value,exec)=>{const id=session(exec);return engine.author(id,value,exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}],presentationMeta:(_a,v)=>({kind:'study-attempt',version:1,attempt:v})}},
    {name:'study_model_review',description:'Record your review of a submitted open (short-answer or derivation) answer from this session: a verdict and a comment the learner sees. Compare the answer with the reference answer locked at issue. The review is stored separately and does not change the Host grade, the pending human review or any capability level.',parameters:{type:'object',properties:{attemptId:{type:'string'},verdict:{type:'string',enum:[...modelVerdicts]},comment:{type:'string',description:'What is right, what is missing or wrong, in the learner\'s language; at most 4000 characters.'}},required:['attemptId','verdict','comment'],additionalProperties:false},execute:async(value,exec)=>{const id=session(exec),a=args(value,['attemptId','verdict','comment']);return engine.modelReview(id,text(a.attemptId,'attempt ID'),a.verdict,a.comment,exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}],presentationMeta:(_a,v)=>{const value=v as {attemptId:string;modelReviews?:unknown[]};return {kind:'study-model-review',version:1,attemptId:value.attemptId,review:value.modelReviews?.at(-1)};}}},
    {name:'study_teaching_step',description:'Record a sequential teaching-stage exposure after teaching it. Stages in order: '+stages.join(', ')+'. A new topic starts at concept; courseId/topicId come from study_get_state, or are new short lowercase ids (e.g. math / laplace-pde) for a subject not listed there. study_get_state shows each lesson stage and nextStage, and repeating the current stage records nothing. This creates no mastery and does not claim student understanding.',parameters:{type:'object',properties:{courseId:{type:'string'},topicId:{type:'string'},stage:{type:'string',enum:[...stages]}},required:['courseId','topicId','stage'],additionalProperties:false},execute:async(value,exec)=>{const id=session(exec),a=args(value,['courseId','topicId','stage']);return engine.advanceLesson(id,text(a.courseId,'course ID'),text(a.topicId,'topic ID'),a.stage,exec.callId);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:JSON.stringify(v)}]}},
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
