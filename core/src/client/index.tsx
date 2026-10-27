import {useEffect,useRef,useState} from 'react';
import {readAttemptMeta,commandSummary,type CardAttempt} from './protocol.ts';
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
    const a=attempt;
    function submit(){
      const value=a.question.kind==='numeric'?{value:Number(answer),unit:a.question.unit}:a.question.kind==='open'?answer:selected;
      if(a.question.kind==='numeric'&&(!answer.trim()||!Number.isFinite(Number(answer)))){setNotice('请输入有限数值。');return;}
      void command('submit',{answer:value});
    }
    function select(id:string){setSelected(a.question.kind==='single_choice'?[id]:selected.includes(id)?selected.filter(v=>v!==id):[...selected,id]);}
    return <AttemptView sessionId={props.sessionId} attempt={a} busy={busy} notice={notice} selected={selected} answer={answer}
      onSelect={select} onAnswer={setAnswer} onHint={()=>void command('hint',{level:'H1'})} onSubmit={submit} onRefresh={()=>void command('read')}/>;
  }
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'study_issue_question'},StudyCard));
  function StudyCommand(props:{sessionId:string;node:{outcome:{kind:string;text?:string}|null}}){
    return <p data-study-command style={{margin:'2px 0',fontSize:12,color:'var(--dsw-alias-label-tertiary, #8a929e)'}}>{commandSummary(props.node.outcome,props.sessionId)}</p>;
  }
  for(const key of ['study-attempt','study-review'])ctx.slots.inject('conversation.chat.commandview',()=>ctx.slots.register({name:'conversation.chat.commandview',key},StudyCommand));
}
