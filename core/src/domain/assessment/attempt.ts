import type {Help,Question} from './question.ts';
import type {Grade} from './grading.ts';
export interface Attempt {
  attemptId:string; learnerId:string; sessionId:string; questionId:string; questionVersion:number;
  issuedAt:string; status:'issued'|'graded'|'pending_review'; maxHelp:Help; independent:boolean;
  hints:{level:Help;at:string}[]; revealedAt?:string; submittedAt?:string; answer?:unknown;
  grade?:Grade; review?:{reviewer:string;reason:string;at:string};
  /** Model opinions on an open answer (D-015); never a grade and never read by capability(). */
  modelReviews?:ModelReview[];
}
export const modelVerdicts=['correct','partially_correct','incorrect'] as const;
export interface ModelReview {verdict:typeof modelVerdicts[number];comment:string;at:string}
export type Capability='U'|'N'|'S'|'P'|'R';
export function capability(a:Attempt,q:Question):Capability {
  if(!a.grade||a.grade.outcome==='pending_review') return 'U';
  if(a.grade.outcome==='incorrect') return 'N';
  if(!a.independent) return a.maxHelp==='H0'?'U':'S';
  // A final answer never establishes unobserved reasoning, even if correct.
  return a.grade.source==='human_review'&&q.kind==='open'&&q.coverage==='steps'&&typeof a.answer==='string'&&a.answer.trim().length>0?'P':'U';
}
