import type {Question} from './question.ts';
import {fields,record,text,finite} from '../../shared/validation.ts';
export interface Grade {outcome:'correct'|'incorrect'|'pending_review';basis:string;source:'deterministic'|'human_review'}
export function gradeAnswer(q:Question,answer:unknown):Grade {
  if(q.kind==='open'){
    text(answer,'open answer',10000);
    return {outcome:'pending_review',basis:'Open work requires human review of reasoning and applicability.',source:'deterministic'};
  }
  let correct=false;
  if(q.kind==='numeric'){
    const a=record(answer); fields(a,['value','unit']);
    const value=finite(a.value,'answer value'),unit=text(a.unit,'answer unit');
    const expected=q.answer as number;
    const tolerance=Math.max(q.absoluteTolerance??0,Math.abs(expected)*(q.relativeTolerance??0));
    correct=unit===q.unit&&Math.abs(value-expected)<=tolerance+Number.EPSILON*Math.max(1,Math.abs(expected));
  }else{
    if(!Array.isArray(answer)||!answer.length||answer.length>64||answer.some(a=>typeof a!=='string'||!q.options?.some(o=>o.id===a))) throw new Error('Invalid choice answer');
    if(new Set(answer).size!==answer.length) throw new Error('Choice answers must be unique; duplicate option');
    if(q.kind==='single_choice'&&answer.length!==1) throw new Error('Single-choice answer must contain one option');
    const expected=q.answer as string[];
    correct=answer.length===expected.length&&answer.every(a=>expected.includes(a));
  }
  return {outcome:correct?'correct':'incorrect',basis:q.kind==='numeric'?'Host answer key, exact unit and configured absolute/relative tolerance.':'Exact option set against Host answer key.',source:'deterministic'};
}
