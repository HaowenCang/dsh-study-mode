import {useEffect,useRef,useState} from 'react';
import {readAttemptMeta,displaySubmittedAnswer,commandSummary,type CardAttempt} from './protocol.ts';
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
        setAttempt(value);setNotice(value.hintText??(value.grade?`${value.grade.outcome}: ${value.grade.basis}`:''));
        if(feedback&&!(await feedback).ok&&alive.current&&sequence.current===current)setNotice('作答已保存，教学反馈尚未排队；请在当前会话继续。');
      }catch(error){if(alive.current&&sequence.current===current)setNotice(error instanceof Error?error.message:'Learning action failed');}
      finally{if(alive.current&&sequence.current===current)setBusy(false);}
    }
    useEffect(()=>{alive.current=true;setAttempt(initial);void command('read');return()=>{alive.current=false;sequence.current++;};},[props.sessionId,props.callId,initial?.attemptId]);
    if(props.phase!=='result')return <p>正在准备学习题卡…</p>;
    if(props.block.isError||!initial||!attempt)return <p role="alert">学习题卡不可用，请读取 Host 学习状态后重试。</p>;
    const a=attempt,closed=a.status!=='issued';
    function submit(){
      const value=a.question.kind==='numeric'?{value:Number(answer),unit:a.question.unit}:a.question.kind==='open'?answer:selected;
      if(a.question.kind==='numeric'&&(!answer.trim()||!Number.isFinite(Number(answer)))){setNotice('请输入有限数值。');return;}
      void command('submit',{answer:value});
    }
    return <section data-dsh-study="attempt" data-study-attempt={a.attemptId} data-study-status={a.status} data-study-session={props.sessionId} style={{padding:18,border:'1px solid var(--dsw-color-border, #aaa)',borderRadius:12,background:'var(--dsw-color-bg-secondary, #f8fafc)',color:'var(--dsw-color-text-primary, #17212f)',maxWidth:760}}>
      <header><strong>学习练习 · {a.question.id}</strong><p>{a.question.prompt}</p></header>
      <p>帮助等级：{a.maxHelp} · {a.independent?'具备本次独立测评资格':'本次不计为独立测评'} · 能力证据：{a.capability??'U'}</p>
      {closed?<div><strong>已提交的作答</strong><pre data-study-submitted-answer style={{whiteSpace:'pre-wrap'}}>{displaySubmittedAnswer(a)}</pre></div>:<fieldset disabled={busy} style={{border:0,padding:0}}><legend>你的作答</legend>
        {a.question.options?.map(option=><label key={option.id} style={{display:'block',padding:'6px 0'}}><input type={a.question.kind==='single_choice'?'radio':'checkbox'} name={a.attemptId} value={option.id} checked={selected.includes(option.id)} onChange={()=>setSelected(a.question.kind==='single_choice'?[option.id]:selected.includes(option.id)?selected.filter(v=>v!==option.id):[...selected,option.id])}/> {option.label}</label>)}
        {a.question.kind==='numeric'?<label>数值（{a.question.unit}）<input aria-label="数值答案" type="number" step="any" value={answer} onChange={e=>setAnswer(e.target.value)}/></label>:null}
        {a.question.kind==='open'?<label>推导与条件<textarea aria-label="开放题作答" value={answer} maxLength={10000} onChange={e=>setAnswer(e.target.value)}/></label>:null}
        <div style={{display:'flex',gap:10,marginTop:12}}><button type="button" onClick={()=>void command('hint',{level:'H1'})}>请求提示 H1</button><button type="button" onClick={submit}>提交作答</button></div>
      </fieldset>}
      <p role="status" aria-live="polite">{busy?'正在核验 Host 记录…':notice||a.grade?.outcome||'答案由 Host 判分；已讲授不等于已掌握。'}</p>
      <button type="button" disabled={busy} onClick={()=>void command('read')}>刷新学习记录</button>
    </section>;
  }
  ctx.slots.inject('tool.call.toolview',()=>ctx.slots.register({name:'tool.call.toolview',key:'study_issue_question'},StudyCard));
  function StudyCommand(props:{sessionId:string;node:{outcome:{kind:string;text?:string}|null}}){
    return <p data-study-command style={{fontSize:12,opacity:0.8}}>{commandSummary(props.node.outcome,props.sessionId)}</p>;
  }
  for(const key of ['study-attempt','study-review'])ctx.slots.inject('conversation.chat.commandview',()=>ctx.slots.register({name:'conversation.chat.commandview',key},StudyCommand));
}
