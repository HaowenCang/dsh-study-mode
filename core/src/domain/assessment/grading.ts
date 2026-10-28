import type {Question} from './question.ts';
import {fields,record,text,finite} from '../../shared/validation.ts';
/** `parts` holds per-blank results of a fill-in question. */
export interface Grade {outcome:'correct'|'incorrect'|'pending_review';basis:string;source:'deterministic'|'human_review';parts?:boolean[]}
/**
 * Blank texts compare case-sensitively (mA is not MA) after NFC, full-width ASCII folding,
 * one minus sign for U+2212 and whitespace removal; superscripts stay (10² is not 102).
 */
const normalize=(value:string)=>value.normalize('NFC').replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/−/g,'-').replace(/\s+/g,'');
/** A decimal, optionally in e or ×10^n notation, optionally followed by the blank's own unit; nothing else (no hex). */
function blankNumber(answer:string,unit:string|undefined):number{
  let s=normalize(answer);const u=unit===undefined?'':normalize(unit);
  if(u&&s.endsWith(u))s=s.slice(0,-u.length);
  const m=/^([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+)|[×xX*·]10\^\{?([+-]?\d+)\}?)?$/.exec(s);
  return m?Number(m[1])*10**Number(m[2]??m[3]??0):Number.NaN;
}
function blankCorrect(blank:NonNullable<Question['blanks']>[number],answer:string):boolean{
  if(blank.accepted!==undefined)return blank.accepted.some(accepted=>normalize(accepted)===normalize(answer));
  const value=blankNumber(answer,blank.unit),expected=blank.value as number;
  return Number.isFinite(value)&&Math.abs(value-expected)<=(blank.tolerance??0)+Number.EPSILON*Math.max(1,Math.abs(expected));
}
export function gradeAnswer(q:Question,answer:unknown):Grade {
  if(q.kind==='open'){
    text(answer,'open answer',10000);
    return {outcome:'pending_review',basis:'Open work requires human review of reasoning and applicability.',source:'deterministic'};
  }
  if(q.kind==='fill_blank'){
    const blanks=q.blanks??[];
    if(!Array.isArray(answer)||answer.length!==blanks.length||answer.some(a=>typeof a!=='string'||a.length>500))throw new Error('Fill-in answer must give one text (at most 500 characters) per blank');
    const parts=blanks.map((blank,index)=>blankCorrect(blank,answer[index] as string));
    return {outcome:parts.every(Boolean)?'correct':'incorrect',basis:'Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.',source:'deterministic',parts};
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
  const basis=q.kind==='numeric'?'Host answer key, exact unit and configured absolute/relative tolerance.'
    :q.source==='model'?'Exact option set against the model-authored answer key locked at issue.':'Exact option set against Host answer key.';
  return {outcome:correct?'correct':'incorrect',basis,source:'deterministic'};
}
