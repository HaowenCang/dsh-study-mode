export interface ModelReview {verdict:'correct'|'partially_correct'|'incorrect';comment:string;at:string}
export interface CardAttempt {
  attemptId:string;sessionId:string;status:'issued'|'graded'|'pending_review';maxHelp:string;independent:boolean;
  question:{id:string;version:number;kind:'single_choice'|'multiple_choice'|'numeric'|'open'|'fill_blank';prompt:string;options?:{id:string;label:string}[];unit?:string;
    source?:'model';format?:'true_false';blanks?:{unit?:string}[]};
  hintText?:string;capability?:string;grade?:{outcome:string;basis:string;parts?:boolean[]};
  answer?:unknown;hints?:{level:string;at:string}[];referenceAnswer?:string;modelReviews?:ModelReview[];
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bounded=(v:unknown,n=10000):v is string=>typeof v==='string'&&v.length>0&&v.length<=n;
const HELPS=['H0','H1','H2','H3','H4'];
const VERDICTS=['correct','partially_correct','incorrect'];
const review=(r:unknown):r is ModelReview=>object(r)&&VERDICTS.includes(String(r.verdict))&&bounded(r.comment,4000)&&bounded(r.at,64);
export function readAttempt(value:unknown,sessionId:string):CardAttempt|undefined{
  if(!object(value)||value.sessionId!==sessionId||!bounded(value.attemptId,200)||!['issued','graded','pending_review'].includes(String(value.status))||!HELPS.includes(String(value.maxHelp))||typeof value.independent!=='boolean')return;
  const q=value.question;
  if(!object(q)||!bounded(q.id,200)||!Number.isSafeInteger(q.version)||!bounded(q.prompt)||!['single_choice','multiple_choice','numeric','open','fill_blank'].includes(String(q.kind)))return;
  if(q.source!==undefined&&q.source!=='model')return;
  if(q.format!==undefined&&(q.format!=='true_false'||q.kind!=='single_choice'))return;
  if(q.kind==='single_choice'||q.kind==='multiple_choice'){
    if(!Array.isArray(q.options)||q.options.length<2||q.options.length>64||q.options.some(o=>!object(o)||!bounded(o.id,200)||!bounded(o.label,2000)))return;
  }
  if(q.kind==='numeric'&&!bounded(q.unit,200))return;
  if(q.kind==='fill_blank'&&(!Array.isArray(q.blanks)||q.blanks.length<1||q.blanks.length>20||q.blanks.some(b=>!object(b)||(b.unit!==undefined&&!bounded(b.unit,50)))))return;
  if(value.grade!==undefined&&(!object(value.grade)||!bounded(value.grade.outcome,30)||!bounded(value.grade.basis,2000)||(value.grade.parts!==undefined&&(!Array.isArray(value.grade.parts)||value.grade.parts.some(p=>typeof p!=='boolean')))))return;
  if(value.hintText!==undefined&&!bounded(value.hintText))return;
  if(value.hints!==undefined&&(!Array.isArray(value.hints)||value.hints.length>64||value.hints.some(h=>!object(h)||!HELPS.includes(String(h.level)))))return;
  if(value.referenceAnswer!==undefined&&!bounded(value.referenceAnswer))return;
  if(value.modelReviews!==undefined&&(!Array.isArray(value.modelReviews)||value.modelReviews.length>20||!value.modelReviews.every(review)))return;
  return value as unknown as CardAttempt;
}
export function readAttemptMeta(meta:unknown,sessionId:string):CardAttempt|undefined{
  if(!object(meta)||meta.kind!=='study-attempt'||meta.version!==1)return;
  return readAttempt(meta.attempt,sessionId);
}
/** Envelope of a study_model_review result: the attempt and the review just recorded. */
export function readModelReviewMeta(meta:unknown):{attemptId:string;review:ModelReview}|undefined{
  if(!object(meta)||meta.kind!=='study-model-review'||meta.version!==1||!bounded(meta.attemptId,200)||!review(meta.review))return;
  return {attemptId:meta.attemptId,review:meta.review};
}
/**
 * The hint level the card offers next. Model questions always carry H1–H4, so the card escalates one level
 * past the highest request and stops after H4; catalog questions may hold only H1, so they keep offering H1.
 */
export function nextHintLevel(a:CardAttempt):string|undefined{
  if(a.question.source!=='model')return 'H1';
  const highest=Math.max(0,...(a.hints??[]).map(h=>HELPS.indexOf(h.level)));
  return HELPS[highest+1];
}
export function displaySubmittedAnswer(a:CardAttempt):string{
  if(a.question.kind==='fill_blank'&&Array.isArray(a.answer))return a.answer.map((v,i)=>{const unit=a.question.blanks?.[i]?.unit;return `（${i+1}）${String(v)}${unit?' '+unit:''}`;}).join('；');
  if(Array.isArray(a.answer))return a.answer.map(id=>a.question.options?.find(o=>o.id===id)?.label??String(id)).join(', ');
  if(typeof a.answer==='string')return a.answer;
  if(object(a.answer)&&typeof a.answer.value==='number'&&Number.isFinite(a.answer.value)&&typeof a.answer.unit==='string')return String(a.answer.value)+' '+a.answer.unit;
  return '尚无可显示的作答';
}
export function commandSummary(outcome:{kind:string;text?:string}|null,sessionId:string):string{
  if(!outcome)return '正在核验学习记录…';
  if(outcome.kind!=='success')return '学习操作未完成：'+(outcome.text??'请重试').slice(0,300);
  try{
    const a=readAttempt(JSON.parse(outcome.text??'null'),sessionId);
    if(!a)return '学习记录不可用，请刷新题卡。';
    if(a.grade)return '作答已记录：'+(OUTCOME_LABELS[a.grade.outcome]??a.grade.outcome)+'；帮助等级 '+a.maxHelp+'。';
    if(a.hintText)return '已记录 '+a.maxHelp+' 提示，本次作答不再计为独立测评。';
    return '学习记录已同步。';
  }catch{return '学习记录不可用，请刷新题卡。';}
}
const OUTCOME_LABELS:Record<string,string>={correct:'回答正确',incorrect:'需要纠正',pending_review:'待人工复核'};
export const VERDICT_LABELS:Record<string,string>={correct:'正确',partially_correct:'部分正确',incorrect:'错误'};
/** Chinese wording of the deterministic grading bases; a human reviewer's reason is shown as written. */
const BASIS_LABELS:Record<string,string>={
  'Exact option set against Host answer key.':'按 Host 答案键比对选项',
  'Host answer key, exact unit and configured absolute/relative tolerance.':'按 Host 答案键比对数值、单位与容差',
  'Open work requires human review of reasoning and applicability.':'开放题需人工复核推理与适用条件',
  'Exact option set against the model-authored answer key locked at issue.':'按出题时锁定的模型答案键比对选项',
  'Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.':'按出题时锁定的模型答案逐空比对',
};
export function gradeLabel(grade:{outcome:string;basis:string}):string{
  return (OUTCOME_LABELS[grade.outcome]??grade.outcome)+' · '+(BASIS_LABELS[grade.basis]??grade.basis);
}
