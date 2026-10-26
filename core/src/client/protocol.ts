export interface CardAttempt {
  attemptId:string;sessionId:string;status:'issued'|'graded'|'pending_review';maxHelp:string;independent:boolean;
  question:{id:string;version:number;kind:'single_choice'|'multiple_choice'|'numeric'|'open';prompt:string;options?:{id:string;label:string}[];unit?:string};
  hintText?:string;capability?:string;grade?:{outcome:string;basis:string};
  answer?:unknown;
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bounded=(v:unknown,n=10000):v is string=>typeof v==='string'&&v.length>0&&v.length<=n;
export function readAttempt(value:unknown,sessionId:string):CardAttempt|undefined{
  if(!object(value)||value.sessionId!==sessionId||!bounded(value.attemptId,200)||!['issued','graded','pending_review'].includes(String(value.status))||!['H0','H1','H2','H3','H4'].includes(String(value.maxHelp))||typeof value.independent!=='boolean')return;
  const q=value.question;
  if(!object(q)||!bounded(q.id,200)||!Number.isSafeInteger(q.version)||!bounded(q.prompt)||!['single_choice','multiple_choice','numeric','open'].includes(String(q.kind)))return;
  if(q.kind==='single_choice'||q.kind==='multiple_choice'){
    if(!Array.isArray(q.options)||q.options.length<2||q.options.length>64||q.options.some(o=>!object(o)||!bounded(o.id,200)||!bounded(o.label,2000)))return;
  }
  if(q.kind==='numeric'&&!bounded(q.unit,200))return;
  if(value.grade!==undefined&&(!object(value.grade)||!bounded(value.grade.outcome,30)||!bounded(value.grade.basis,2000)))return;
  if(value.hintText!==undefined&&!bounded(value.hintText))return;
  return value as unknown as CardAttempt;
}
export function readAttemptMeta(meta:unknown,sessionId:string):CardAttempt|undefined{
  if(!object(meta)||meta.kind!=='study-attempt'||meta.version!==1)return;
  return readAttempt(meta.attempt,sessionId);
}
export function displaySubmittedAnswer(a:CardAttempt):string{
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
    if(a.grade)return '作答已记录：'+(a.grade.outcome==='correct'?'正确':a.grade.outcome==='incorrect'?'待纠正':'待人工复核')+'；帮助等级 '+a.maxHelp+'。';
    if(a.hintText)return '已记录 '+a.maxHelp+' 提示，本次作答不再计为独立测评。';
    return '学习记录已同步。';
  }catch{return '学习记录不可用，请刷新题卡。';}
}
