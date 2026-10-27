export const stages=['concept','mathematical_modeling','derivation','worked_examples','guided_practice','independent_assessment','review_and_consolidation'] as const;
export type Stage=typeof stages[number];
/** A topic with no recorded exposure has not started; its first recordable stage is concept. */
export type LessonStage=Stage|'not_started';
export interface Lesson {courseId:string;topicId:string;stage:LessonStage;exposureOnly:true}
/** Lesson as shown to the model: the stored record plus the stage it may record next (null once complete). */
export type LessonView=Lesson&{nextStage:Stage|null};
/** Stages that may follow `current`. A topic that never recorded concept may still open at mathematical_modeling, as records made before concept was recordable did. */
export function allowedNext(current:LessonStage):Stage[]{
  if(current==='not_started')return ['concept','mathematical_modeling'];
  const next=stages[stages.indexOf(current)+1];
  return next===undefined?[]:[next];
}
export function lessonView(lesson:Lesson):LessonView{return {...lesson,nextStage:allowedNext(lesson.stage)[0]??null};}
export function nextStage(current:LessonStage,next:unknown):Stage{
  if(allowedNext(current).includes(next as Stage))return next as Stage;
  const expected=allowedNext(current)[0];
  throw new Error(`Teaching stage sequence violation: current stage is ${current}; next allowed stage is ${expected??'none (lesson complete)'}. Stages in order: ${stages.join(', ')}`);
}
