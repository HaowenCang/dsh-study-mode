import {useEffect,useRef,useState} from 'react';
import {readAttemptMeta,readModelReviewMeta,commandSummary,VERDICT_LABELS,type CardAttempt} from './protocol.ts';
import {AttemptView} from './card-view.tsx';
export {AttemptView} from './card-view.tsx';
import {type SessionRemote} from './continue.ts';
import {runAttemptCommand} from './attempt-command.ts';
export const name='dsh-study-core';
export const inject=['slots','remote','remote.commands','remote.session'];
interface Context {
  slots:{inject:(slot:string,callback:()=>()=>void)=>void;register:(spec:{name:string;key:string},component:unknown)=>()=>void};
  remote:{commands:{execute:(sessionId:string,line:string,attachments:unknown[])=>Promise<{ok:boolean;value?:{result:{kind:string;text?:string}};error?:{message:string}}>} ;session:SessionRemote};
}
interface Props {sessionId:string;callId:string;phase:string;block:{isError?:boolean;meta?:unknown}}
export function apply(ctx:Context):void{
  function StudyCard(props:Props){
    const initial=readAttemptMeta(props.block.meta,props.sessionId);
    const [attempt,setAttempt]=useState<CardAttempt|undefined>(initial),[selected,setSelected]=useState<string[]>([]),[answer,setAnswer]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
    // Sized at render: the card mounts while the call is still streaming, before its question exists.
    const [blankValues,setBlanks]=useState<string[]>([]);
    const alive=useRef(true),sequence=useRef(0),requests=useRef(new Map<string,string>());
    async function command(operation:'read'|'hint'|'submit',extra:Record<string,unknown>={}){
      if(!initial)return;
      const current=++sequence.current;setBusy(true);
      const signature=JSON.stringify({operation,...extra});
      let requestId=requests.current.get(signature);if(!requestId){requestId=crypto.randomUUID();requests.current.set(signature,requestId);}
      const payload=operation==='read'?{operation,attemptId:initial.attemptId}:{operation,attemptId:initial.attemptId,requestId,...extra};
      const feedbackKey=signature+':feedback';
      let feedbackId=operation==='submit'?requests.current.get(feedbackKey):undefined;
      if(operation==='submit'&&!feedbackId){feedbackId=crypto.randomUUID();requests.current.set(feedbackKey,feedbackId);}
      try{
        // The feedback prompt is queued inside runAttemptCommand even if this card unmounts meanwhile.
        const {value,feedback}=await runAttemptCommand(ctx.remote,props.sessionId,initial.attemptId,payload,feedbackId);
        if(!alive.current||sequence.current!==current)return;
        setAttempt(value);setNotice('');
        if(feedback&&!(await feedback).ok&&alive.current&&sequence.current===current)setNotice('作答已保存，教学反馈尚未排队；请在当前会话继续。');
      }catch(error){if(alive.current&&sequence.current===current)setNotice(error instanceof Error?error.message:'学习操作未完成，请重试。');}
      finally{if(alive.current&&sequence.current===current)setBusy(false);}
    }
    useEffect(()=>{alive.current=true;setAttempt(initial);void command('read');return()=>{alive.current=false;sequence.current++;};},[props.sessionId,props.callId,initial?.attemptId]);
    if(props.phase!=='result')return <p style={{margin:'6px 0',fontSize:12,color:'var(--dsw-alias-label-secondary, #5b6472)'}}>正在准备学习题卡…</p>;
    if(props.block.isError||!initial||!attempt)return <p role="alert" style={{margin:'6px 0',fontSize:12,color:'var(--dsw-alias-state-error-primary, #c62828)'}}>学习题卡不可用，请读取 Host 学习状态后重试。</p>;
    const a=attempt,blanks=(a.question.blanks??[]).map((_,i)=>blankValues[i]??'');
    function submit(){
      const value=a.question.kind==='numeric'?{value:Number(answer),unit:a.question.unit}:a.question.kind==='open'?answer:a.question.kind==='fill_blank'?blanks.map(v=>v.trim()):selected;
      if(a.question.kind==='numeric'&&(!answer.trim()||!Number.isFinite(Number(answer)))){setNotice('请输入有限数值。');return;}
      if(a.question.kind==='fill_blank'&&blanks.some(v=>!v.trim())){setNotice('请填写每个空。');return;}
      void command('submit',{answer:value});
    }
    function select(id:string){setSelected(a.question.kind==='single_choice'?[id]:selected.includes(id)?selected.filter(v=>v!==id):[...selected,id]);}
    function blank(index:number,value:string){setBlanks(blanks.map((v,i)=>i===index?value:v));}
    return <AttemptView sessionId={props.sessionId} attempt={a} busy={busy} notice={notice} selected={selected} answer={answer} blanks={blanks}
      onSelect={select} onAnswer={setAnswer} onBlank={blank} onHint={level=>void command('hint',{level})} onSubmit={submit} onRefresh={()=>void command('read')}/>;
  }
  for(const key of ['study_issue_question','study_author_question'])ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key},StudyCard));
  /** A model review is shown where the model recorded it; the answer card shows it again after a refresh. */
  function ModelReviewRow(props:Props){
    const recorded=props.phase==='result'&&!props.block.isError?readModelReviewMeta(props.block.meta):undefined;
    if(!recorded)return <p style={{margin:'2px 0',fontSize:12,color:'var(--dsw-alias-label-tertiary, #8a929e)'}}>{props.phase==='result'?'模型评阅未记录。':'正在记录模型评阅…'}</p>;
    return <div data-study-model-review={recorded.review.verdict} style={{margin:'6px 0',padding:'8px 10px',borderRadius:'var(--dsw-radius-md, 8px)',background:'var(--dsw-alias-bg-layer-1, #f6f7f9)',fontSize:13,lineHeight:1.6,maxWidth:760,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
      <div style={{fontSize:12,color:'var(--dsw-alias-label-secondary, #5b6472)',marginBottom:4}}>模型评阅（不计入判分，不改变人工复核或能力等级）：{VERDICT_LABELS[recorded.review.verdict]??recorded.review.verdict}</div>
      {recorded.review.comment}</div>;
  }
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'study_model_review'},ModelReviewRow));
  function StudyCommand(props:{sessionId:string;node:{outcome:{kind:string;text?:string}|null}}){
    return <p data-study-command style={{margin:'2px 0',fontSize:12,color:'var(--dsw-alias-label-tertiary, #8a929e)'}}>{commandSummary(props.node.outcome,props.sessionId)}</p>;
  }
  for(const key of ['study-attempt','study-review'])ctx.slots.inject('conversation.chat.commandview',()=>ctx.slots.register({name:'conversation.chat.commandview',key},StudyCommand));
}
