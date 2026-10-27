import {randomUUID} from 'node:crypto';
import {StudyStore} from '../storage/journal.ts';
import {parseCatalog,helps,publicQuestion,type Question,type Help} from '../domain/assessment/question.ts';
import {gradeAnswer} from '../domain/assessment/grading.ts';
import {capability,type Attempt} from '../domain/assessment/attempt.ts';
import {lessonView,nextStage,type Lesson} from '../domain/lesson/state.ts';
import {text} from '../shared/validation.ts';
import {deriveProgress} from '../domain/evidence/progress.ts';
import {courseCatalog} from '../domain/course/catalog.ts';
import {teachingMode,type TeachingMode} from '../domain/progress/mode.ts';
import {parsePlans,type CoursePlan} from '../domain/course/plan.ts';

export interface EngineOptions {databasePath:string;catalog:unknown;learnerId:string;now?:()=>number;plans?:unknown}
export class StudyEngine {
  readonly store:StudyStore;
  readonly learnerId:string;
  private readonly catalog:Question[];
  private readonly now:()=>number;
  private readonly plans:CoursePlan[];
  constructor(options:EngineOptions){
    this.learnerId=text(options.learnerId,'learner ID');this.catalog=parseCatalog(options.catalog);this.plans=parsePlans(options.plans);this.now=options.now??Date.now;
    this.store=new StudyStore(options.databasePath);
    try{for(const q of this.catalog)this.store.registerQuestion(q.id,q.version,q);for(const p of this.plans)this.store.registerPlan(p.courseId,p.version,p);}catch(error){this.store.close();throw error;}
  }
  private time(){return new Date(this.now()).toISOString();}
  private transaction<T>(sessionId:string,requestId:string,request:unknown,work:()=>T):T{
    text(sessionId,'session ID');text(requestId,'request ID');
    return this.store.transact(JSON.stringify([this.learnerId,sessionId,requestId]),{sessionId,request},work);
  }
  private append(kind:string,aggregate:string,sessionId:string,payload:unknown):void{
    this.store.append({kind,aggregate,sessionId,payload,learnerId:this.learnerId,time:this.time()});
  }
  private internal(id:string):Attempt{
    text(id,'attempt ID');const a=this.store.latest<Attempt>(this.learnerId,'attempt:'+id);
    if(!a)throw new Error('Unknown attempt');return a;
  }
  private question(a:Attempt):Question{return this.store.question(a.questionId,a.questionVersion) as Question;}
  private bound(session:string,id:string,open=true):Attempt{
    const a=this.internal(id);if(a.sessionId!==session)throw new Error('Attempt session mismatch');
    if(open&&a.status!=='issued')throw new Error('Attempt is closed/submitted');return a;
  }
  private allAttempts():Attempt[]{
    const latest=new Map<string,Attempt>();
    for(const e of this.store.events(this.learnerId))if(e.aggregate.startsWith('attempt:'))latest.set(e.aggregate,e.payload as Attempt);
    return [...latest.values()];
  }
  private exposure(a:Attempt,all:readonly Attempt[]=this.allAttempts()):void{
    if(a.status!=='issued')return;
    for(const old of all)if(old.questionId===a.questionId&&old.attemptId!==a.attemptId){
      if(helps.indexOf(old.maxHelp)>helps.indexOf(a.maxHelp))a.maxHelp=old.maxHelp;
      if(old.submittedAt||old.maxHelp!=='H0')a.independent=false;
    }
  }
  private view(a:Attempt,all?:readonly Attempt[]){this.exposure(a,all);const q=this.question(a);return {...a,question:publicQuestion(q),capability:capability(a,q)};}
  questions(){return this.catalog.map(publicQuestion);}
  attempt(id:string){return this.view(this.internal(id));}
  issue(sessionId:string,questionId:string,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'issue',questionId},()=>{
      const q=this.catalog.find(q=>q.id===questionId);if(!q)throw new Error('Unknown trusted question');
      let maxHelp:Help='H0';let previouslyAnswered=false;
      for(const old of this.allAttempts().filter(a=>a.questionId===q.id)){
        if(helps.indexOf(old.maxHelp)>helps.indexOf(maxHelp))maxHelp=old.maxHelp;
        if(old.submittedAt)previouslyAnswered=true;
      }
      const a:Attempt={attemptId:randomUUID(),learnerId:this.learnerId,sessionId,questionId:q.id,questionVersion:q.version,issuedAt:this.time(),status:'issued',maxHelp,independent:maxHelp==='H0'&&!previouslyAnswered,hints:[]};
      this.append('issued','attempt:'+a.attemptId,sessionId,a);return this.view(a);
    });
  }
  hint(sessionId:string,attemptId:string,level:unknown,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'hint',attemptId,level},()=>{
      if(!helps.includes(level as Help)||level==='H0')throw new Error('Invalid help level');
      const a=this.bound(sessionId,attemptId),q=this.question(a),hintText=q.hints[level as Help];
      if(!hintText)throw new Error('Requested hint is unavailable');
      a.independent=false;a.maxHelp=helps[Math.max(helps.indexOf(a.maxHelp),helps.indexOf(level as Help))]!;
      a.hints.push({level:level as Help,at:this.time()});if(level==='H4')a.revealedAt=this.time();
      this.append(level==='H4'?'answer_revealed':'hint_requested','attempt:'+attemptId,sessionId,a);
      return {...this.view(a),hintText};
    });
  }
  submit(sessionId:string,attemptId:string,answer:unknown,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'submit',attemptId,answer},()=>{
      const a=this.bound(sessionId,attemptId);this.exposure(a);const q=this.question(a),grade=gradeAnswer(q,answer);
      a.answer=answer;a.grade=grade;a.submittedAt=this.time();a.status=grade.outcome==='pending_review'?'pending_review':'graded';
      this.append('submitted','attempt:'+attemptId,sessionId,a);return this.view(a);
    });
  }
  review(sessionId:string,attemptId:string,correct:unknown,reason:string,reviewer:string,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'review',attemptId,correct,reason,reviewer},()=>{
      text(reason,'review reason',2000);text(reviewer,'reviewer');if(typeof correct!=='boolean')throw new Error('Invalid review verdict');
      const a=this.bound(sessionId,attemptId,false);if(!a.submittedAt)throw new Error('Cannot review an unsubmitted attempt');
      a.grade={outcome:correct?'correct':'incorrect',basis:reason,source:'human_review'};a.status='graded';a.review={reviewer,reason,at:this.time()};
      this.append('reviewed','attempt:'+attemptId,sessionId,a);return this.view(a);
    });
  }
  lesson(courseId:string,topicId:string):Lesson{
    // Read by payload identity as well, preserving already-recorded v1 events.
    const events=this.store.events(this.learnerId).filter(e=>e.kind==='teaching_exposure');
    const lesson=events.map(e=>e.payload as Lesson).filter(v=>v.courseId===courseId&&v.topicId===topicId).at(-1);
    return lesson??{courseId,topicId,stage:'not_started',exposureOnly:true};
  }
  advanceLesson(sessionId:string,courseId:string,topicId:string,stage:unknown,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'teaching',courseId,topicId,stage},()=>{
      if(!this.catalog.some(q=>q.courseId===courseId&&q.topicId===topicId)&&!this.plans.some(p=>p.courseId===courseId&&p.days.some(d=>d.unit===topicId)))throw new Error('Unknown course/topic');
      const current=this.lesson(courseId,topicId);
      // Repeating the stage already recorded is a no-op, so a retried call appends nothing.
      if(stage===current.stage)return lessonView(current);
      const lesson={...current,stage:nextStage(current.stage,stage)};
      this.append('teaching_exposure',JSON.stringify(['lesson',courseId,topicId]),sessionId,lesson);return lessonView(lesson);
    });
  }
  history(attemptId:string){return this.store.events(this.learnerId,'attempt:'+attemptId);}
  plan(courseId:string,day?:number){
    const plan=this.plans.find(p=>p.courseId===courseId);
    if(!plan)throw new Error(`No course plan for ${courseId}. study_get_state.plans lists the courses that have plans: ${this.plans.map(p=>p.courseId).join(', ')||'none'}`);
    const {days,...meta}=plan;
    if(day!==undefined){const selected=days.find(d=>d.day===day);if(!selected)throw new Error('Unknown plan day');return {...meta,day:selected,days:[]};}
    return {...meta,days:days.map(d=>({day:d.day,unit:d.unit,title:d.title}))};
  }
  mode():TeachingMode{return this.store.latest<{mode:TeachingMode}>(this.learnerId,'teaching-mode')?.mode??'systematic_teaching';}
  setMode(sessionId:string,value:unknown,requestId:string){
    return this.transaction(sessionId,requestId,{operation:'set-mode',value},()=>{
      const mode=teachingMode(value);this.append('mode_selected','teaching-mode',sessionId,{mode});return {mode};
    });
  }
  progress(courseId:string,topicId:string,all:readonly Attempt[]=this.allAttempts()){
    return deriveProgress(all.map(attempt=>({attempt,question:this.question(attempt)})).filter(i=>i.question.courseId===courseId&&i.question.topicId===topicId));
  }
  state(){
    const all=this.allAttempts();
    // Resolve immutable questions and lesson history once per snapshot. With
    // two 30-day plans, rescanning every attempt for every topic multiplied
    // database reads and JSON decoding by the number of plan units.
    const evidence=all.map(attempt=>({attempt,question:this.question(attempt)}));
    const lessons=new Map<string,Lesson>();
    for(const event of this.store.events(this.learnerId))if(event.kind==='teaching_exposure'){
      const value=event.payload as Lesson;lessons.set(JSON.stringify([value.courseId,value.topicId]),value);
    }
    const catalog=new Map(courseCatalog(this.catalog).map(c=>[c.courseId,new Set(c.topicIds)]));
    for(const plan of this.plans){
      const topics=catalog.get(plan.courseId)??new Set<string>();
      for(const day of plan.days)topics.add(day.unit);
      catalog.set(plan.courseId,topics);
    }
    const courses=[...catalog].map(([courseId,topicIds])=>({courseId,topicIds:[...topicIds],topics:[...topicIds].map(topicId=>({topicId,
      lesson:lessonView(lessons.get(JSON.stringify([courseId,topicId]))??{courseId,topicId,stage:'not_started',exposureOnly:true}),
      evidence:deriveProgress(evidence.filter(i=>i.question.courseId===courseId&&i.question.topicId===topicId)),
    }))}));
    return {learnerId:this.learnerId,mode:this.mode(),courses,plans:this.plans.map(p=>({courseId:p.courseId,title:p.title,startDate:p.startDate,endDate:p.endDate,evidenceStatus:p.evidenceStatus})),attempts:all.map(a=>this.view(a,all))};
  }
  close(){this.store.close();}
}
