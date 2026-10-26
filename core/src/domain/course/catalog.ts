import type {Question} from '../assessment/question.ts';
export function courseCatalog(questions:readonly Question[]){
  const courses=new Map<string,Set<string>>();
  for(const question of questions){if(!courses.has(question.courseId))courses.set(question.courseId,new Set());courses.get(question.courseId)!.add(question.topicId);}
  return [...courses].map(([courseId,topics])=>({courseId,topicIds:[...topics]}));
}
