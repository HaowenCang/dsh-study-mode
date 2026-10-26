import {fields,record,text,finite} from '../../shared/validation.ts';
export const dimensions=['concept','modeling','derivation','calculation','transfer'] as const;
export type Dimension=typeof dimensions[number];
export const helps=['H0','H1','H2','H3','H4'] as const;
export type Help=typeof helps[number];
export interface Question {
  id:string; version:number; courseId:string; topicId:string; familyId:string;
  kind:'single_choice'|'multiple_choice'|'numeric'|'open'; prompt:string;
  options?:{id:string;label:string}[]; answer?:string[]|number; unit?:string;
  absoluteTolerance?:number; relativeTolerance?:number;
  dimensions:Dimension[]; coverage:'final_answer_only'|'steps'; hints:Partial<Record<Help,string>>;
}
export function parseCatalog(value:unknown):Question[]{
  if(!Array.isArray(value)||value.length===0||value.length>10000) throw new Error('Invalid question catalog');
  const seen=new Set<string>();
  return value.map(raw=>{
    const q=record(raw); fields(q,['id','version','courseId','topicId','familyId','kind','prompt','options','answer','unit','absoluteTolerance','relativeTolerance','dimensions','coverage','hints']);
    for(const key of ['id','courseId','topicId','familyId']) text(q[key],key);
    text(q.prompt,'prompt',10000);
    if(!Number.isSafeInteger(q.version)||Number(q.version)<1) throw new Error('Invalid question version');
    if(seen.has(String(q.id))) throw new Error('Duplicate question ID'); seen.add(String(q.id));
    if(!['single_choice','multiple_choice','numeric','open'].includes(String(q.kind))) throw new Error('Invalid question kind');
    if(q.coverage!=='steps'&&q.coverage!=='final_answer_only') throw new Error('Invalid grading coverage');
    if(q.kind!=='open'&&q.coverage==='steps')throw new Error('Objective answers cannot establish steps coverage or reasoning');
    if(!Array.isArray(q.dimensions)||!q.dimensions.length||q.dimensions.some(d=>!dimensions.includes(d))) throw new Error('Invalid evidence dimensions');
    const hints=record(q.hints); fields(hints,['H1','H2','H3','H4']);
    for(const hint of Object.values(hints)) text(hint,'hint',10000);
    if(q.kind==='single_choice'||q.kind==='multiple_choice'){
      if(!Array.isArray(q.options)||q.options.length<2||q.options.length>64) throw new Error('Invalid options');
      const ids=q.options.map(raw=>{const option=record(raw);fields(option,['id','label']);text(option.label,'option label',2000);return text(option.id,'option ID');});
      if(new Set(ids).size!==ids.length) throw new Error('Duplicate option ID');
      if(!Array.isArray(q.answer)||!q.answer.length||q.answer.some(a=>!ids.includes(a))||new Set(q.answer).size!==q.answer.length||(q.kind==='single_choice'&&q.answer.length!==1)) throw new Error('Invalid answer key');
    }else if(q.kind==='numeric'){
      finite(q.answer,'answer'); text(q.unit,'unit');
      for(const key of ['absoluteTolerance','relativeTolerance']) if(finite(q[key],key)<0) throw new Error('Negative tolerance');
    }else if(q.answer!==undefined) throw new Error('Open question cannot have an automatic answer key');
    return JSON.parse(JSON.stringify(q)) as Question;
  });
}
export function publicQuestion(q:Question):Omit<Question,'answer'|'hints'|'absoluteTolerance'|'relativeTolerance'> {
  const {answer:_a,hints:_h,absoluteTolerance:_at,relativeTolerance:_rt,...result}=q;
  return result;
}
