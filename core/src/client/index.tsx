import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {readAttemptMeta,readModelReviewMeta,commandSummary,VERDICT_LABELS,type CardAttempt} from './protocol.ts';
import {AttemptView} from './card-view.tsx';
export {AttemptView} from './card-view.tsx';
import {type SessionRemote} from './continue.ts';
import {locateAttempt,runAttemptCommand} from './attempt-command.ts';
import {claimCall,inlineCardSelector,isClaimed,locateWithRetry,subscribeClaims} from './claims.ts';
export const name='dsh-study-core';
export const inject=['slots','remote','remote.commands','remote.session'];
interface Context {
  slots:{inject:(slot:string,callback:()=>()=>void)=>void;register:(spec:{name:string;key:string},component:unknown)=>()=>void};
  remote:{commands:{execute:(sessionId:string,line:string,attachments:unknown[])=>Promise<{ok:boolean;value?:{result:{kind:string;text?:string}};error?:{message:string}}>} ;session:SessionRemote};
}
interface Props {sessionId:string;callId:string;phase:string;block:{isError?:boolean;meta?:unknown}}
/** Owner props of the `rich.inline.toolcall` child Slot (declared by dsh-rich-response). */
interface InlineOwner {sessionId:string;callId:string;toolName:string;settled?:boolean;relocated?:boolean;turnOpen?:boolean}
const MUTED={margin:'6px 0',fontSize:12,color:'var(--dsw-alias-label-secondary, #5b6472)'};
const ALERT={margin:'6px 0',fontSize:12,color:'var(--dsw-alias-state-error-primary, #c62828)'};
export function apply(ctx:Context):void{
  /** One live learning card over a Host attempt; the Host stays the only owner of answers, hints and grades. */
  function StudyAttemptCard(props:{sessionId:string;initial:CardAttempt;skipInitialRead?:boolean}){
    const initial=props.initial;
    const [attempt,setAttempt]=useState<CardAttempt>(initial),[selected,setSelected]=useState<string[]>([]),[answer,setAnswer]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
    // Sized at render: the card mounts while the call is still streaming, before its question exists.
    const [blankValues,setBlanks]=useState<string[]>([]);
    const alive=useRef(true),sequence=useRef(0),requests=useRef(new Map<string,string>());
    async function command(operation:'read'|'hint'|'submit',extra:Record<string,unknown>={}){
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
    useEffect(()=>{alive.current=true;setAttempt(initial);if(!props.skipInitialRead)void command('read');return()=>{alive.current=false;sequence.current++;};},[props.sessionId,initial.attemptId]);
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
  /** Tool-view card: the full card unless the same call is already shown in the message body. */
  function StudyCard(props:Props){
    const claimed=useSyncExternalStore(subscribeClaims,()=>isClaimed(props.sessionId,props.callId),()=>false);
    const initial=readAttemptMeta(props.block.meta,props.sessionId);
    if(claimed)return <p data-study-card-stub style={MUTED}>题卡已显示在正文中。{' '}
      <button type="button" style={{font:'inherit',color:'var(--dsw-alias-label-link, #2563eb)',background:'none',border:0,padding:0,cursor:'pointer'}}
        onClick={()=>document.querySelector(inlineCardSelector(props.callId))?.scrollIntoView({block:'center',behavior:'smooth'})}>定位到题卡</button></p>;
    if(props.phase!=='result')return <p style={MUTED}>正在准备学习题卡…</p>;
    if(props.block.isError||!initial)return <p role="alert" style={ALERT}>学习题卡不可用，请读取 Host 学习状态后重试。</p>;
    return <StudyAttemptCard key={initial.attemptId} sessionId={props.sessionId} initial={initial}/>;
  }
  /**
   * Inline card (plan P4), rendered by the dsh-rich-response assistant renderer at the tool call's
   * position in the reply. Once the step has settled (the tool runs after the model's message) it
   * finds its Host attempt with the read-only `locate` operation, which also replaces the initial
   * read, then claims the call so the tool view shows a stub instead of a second card.
   */
  function InlineStudyCard(props:InlineOwner){
    const [state,setState]=useState<{kind:'waiting'}|{kind:'ready';attempt:CardAttempt}|{kind:'failed'}>({kind:'waiting'});
    const settled=props.settled!==false;
    // In a live turn the tool runs after the message settles, so give the Host a moment before the
    // first lookup (each lookup is a recorded command row); replays of closed turns look up at once.
    const live0=useRef(props.turnOpen===true||!settled);
    if(props.turnOpen===true||!settled)live0.current=true;
    useEffect(()=>{
      if(!settled)return;
      let live=true;setState({kind:'waiting'});
      const first=live0.current?new Promise<void>(r=>setTimeout(r,1200)):Promise.resolve();
      first.then(()=>locateWithRetry(()=>locateAttempt(ctx.remote,props.sessionId,props.callId),()=>live))
        .then(attempt=>{if(live&&attempt)setState({kind:'ready',attempt});},()=>{if(live)setState({kind:'failed'});});
      return()=>{live=false;};
    },[props.sessionId,props.callId,settled]);
    useEffect(()=>state.kind==='ready'?claimCall(props.sessionId,props.callId):undefined,[state.kind,props.sessionId,props.callId]);
    const body=state.kind==='ready'?<StudyAttemptCard key={state.attempt.attemptId} sessionId={props.sessionId} initial={state.attempt} skipInitialRead/>
      :state.kind==='failed'?<p role="alert" style={ALERT}>学习题卡不可用，可在工具详情中查看。</p>
      :<p style={MUTED}>正在准备学习题卡…</p>;
    return <div data-study-inline-card={props.callId} data-state={state.kind} data-relocated={props.relocated?'':undefined}>{body}</div>;
  }
  for(const key of ['study_issue_question','study_author_question'])ctx.slots.inject('rich.inline.toolcall',()=>ctx.slots.register({name:'rich.inline.toolcall',key},InlineStudyCard));
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
