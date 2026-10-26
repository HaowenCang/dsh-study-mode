export const stages=['concept','mathematical_modeling','derivation','worked_examples','guided_practice','independent_assessment','review_and_consolidation'] as const;
export type Stage=typeof stages[number];
export interface Lesson {courseId:string;topicId:string;stage:Stage;exposureOnly:true}
export function nextStage(current:Stage,next:unknown):Stage{
  if(stages[stages.indexOf(current)+1]!==next) throw new Error('Teaching stage sequence violation');
  return next as Stage;
}
