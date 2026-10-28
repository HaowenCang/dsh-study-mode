import {fields,record,text,finite} from '../../shared/validation.ts';
import {dimensions,type Blank,type Dimension,type Question} from './question.ts';
/** Question types the model may write (D-015); true/false is stored as a two-option single choice. */
export const authoredTypes=['single_choice','multiple_choice','true_false','fill_blank','open'] as const;
const COMMON=['courseId','topicId','familyId','type','prompt','hints','dimensions'];
const SPECIFIC:Record<typeof authoredTypes[number],string[]>={single_choice:['options','answer'],multiple_choice:['options','answer'],true_false:['answer'],fill_blank:['blanks'],open:['referenceAnswer']};
const LETTERS='ABCDEFGHIJ';
export interface AuthoringContext {id:string;sessionId:string;time:string;acceptsTopic:(courseId:string,topicId:string)=>boolean}
/**
 * Validate a model-written question and build its immutable revision. Only the
 * structure is checked; whether the answer key is right is the model's claim.
 * @returns the revision to store; the caller issues it in the same transaction.
 */
export function parseAuthoredQuestion(value:unknown,context:AuthoringContext):Question{
  const q=record(value);
  if(!authoredTypes.includes(q.type as typeof authoredTypes[number]))throw new Error('Invalid question type: use '+authoredTypes.join(', '));
  const type=q.type as typeof authoredTypes[number];
  fields(q,[...COMMON,...SPECIFIC[type]]);
  const courseId=text(q.courseId,'course ID'),topicId=text(q.topicId,'topic ID'),familyId=text(q.familyId,'family ID');
  if(!context.acceptsTopic(courseId,topicId))throw new Error('Unknown course/topic: reuse a courseId and topicId from study_get_state, or name a new one as a short lowercase id (a-z, 0-9 and single hyphens, at most 48 characters)');
  const prompt=text(q.prompt,'prompt',4000);
  const hints=record(q.hints);fields(hints,['H1','H2','H3','H4']);
  for(const level of ['H1','H2','H3','H4'])if(typeof hints[level]!=='string'||!String(hints[level]).trim()||String(hints[level]).length>4000)throw new Error('Authored questions need hints H1, H2, H3 and H4 (each 1..4000 characters)');
  if(new Set(Object.values(hints).map(h=>String(h).trim())).size!==4)throw new Error('Authored hints H1-H4 must differ from each other');
  if(!Array.isArray(q.dimensions)||!q.dimensions.length||q.dimensions.some(d=>!dimensions.includes(d))||new Set(q.dimensions).size!==q.dimensions.length)throw new Error('Invalid evidence dimensions');
  // A final answer alone cannot show a derivation or a transfer, so only open questions carry those dimensions.
  if(type!=='open'&&q.dimensions.some(d=>d==='derivation'||d==='transfer'))throw new Error('Invalid evidence dimensions: derivation and transfer need an open question');
  const result:Question={id:context.id,version:1,courseId,topicId,familyId,kind:type==='true_false'?'single_choice':type,prompt,
    dimensions:q.dimensions as Dimension[],coverage:type==='open'?'steps':'final_answer_only',hints:hints as Question['hints'],source:'model',sessionId:context.sessionId,authoredAt:context.time};
  if(type==='single_choice'||type==='multiple_choice'){
    if(!Array.isArray(q.options)||q.options.length<2||q.options.length>10)throw new Error('Invalid options: give 2 to 10 option texts');
    result.options=q.options.map((label,index)=>({id:LETTERS[index]!,label:text(label,'option text',500)}));
    if(new Set(result.options.map(o=>o.label.trim())).size!==result.options.length)throw new Error('Invalid options: duplicate option text');
    const ids=result.options.map(o=>o.id);
    if(!Array.isArray(q.answer)||!q.answer.length||q.answer.some(a=>!ids.includes(a))||new Set(q.answer).size!==q.answer.length||(type==='single_choice'&&q.answer.length!==1))throw new Error('Invalid answer key: list the correct option letters');
    result.answer=[...q.answer] as string[];
  }else if(type==='true_false'){
    if(typeof q.answer!=='boolean')throw new Error('Invalid answer key: true/false questions take answer true or false');
    result.format='true_false';result.options=[{id:'true',label:'正确'},{id:'false',label:'错误'}];result.answer=[String(q.answer)];
  }else if(type==='fill_blank'){
    if(!Array.isArray(q.blanks)||q.blanks.length<1||q.blanks.length>20)throw new Error('Invalid blanks: give 1 to 20 blanks');
    result.blanks=q.blanks.map((raw,index)=>parseBlank(raw,index+1));
    const markers=[...prompt.matchAll(/\{\{(\d+)\}\}/g)].map(m=>Number(m[1]));
    if(markers.length!==result.blanks.length||result.blanks.some((_b,index)=>markers.filter(n=>n===index+1).length!==1))throw new Error('Blank markers must be {{1}}..{{'+result.blanks.length+'}}, each exactly once in the prompt');
  }else result.referenceAnswer=text(q.referenceAnswer,'reference answer: open questions need a reference answer',10000);
  return result;
}
function parseBlank(value:unknown,n:number):Blank{
  const b=record(value);fields(b,['accepted','value','tolerance','unit']);
  if((b.accepted===undefined)===(b.value===undefined))throw new Error(`Invalid blank ${n}: give accepted texts or a value, not both`);
  if(b.accepted!==undefined){
    if(b.tolerance!==undefined||b.unit!==undefined)throw new Error(`Invalid blank ${n}: tolerance and unit apply only to a value`);
    if(!Array.isArray(b.accepted)||b.accepted.length<1||b.accepted.length>10)throw new Error(`Invalid blank ${n}: give 1 to 10 accepted texts`);
    return {accepted:b.accepted.map(a=>text(a,`blank ${n} accepted text`))};
  }
  const blank:Blank={value:finite(b.value,`blank ${n} value`)};
  if(b.tolerance!==undefined&&(blank.tolerance=finite(b.tolerance,`blank ${n} tolerance`))<0)throw new Error(`Invalid blank ${n}: negative tolerance`);
  // A tolerance as wide as the value itself would accept nearly any answer.
  const tolerance=blank.tolerance??0,expected=blank.value!;
  if(expected===0?tolerance>1:tolerance>=Math.abs(expected))throw new Error(`Invalid blank ${n}: tolerance must be smaller than the value (at most 1 for a zero value)`);
  if(b.unit!==undefined)blank.unit=text(b.unit,`blank ${n} unit`,50);
  return blank;
}
