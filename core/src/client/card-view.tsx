import type {CSSProperties} from 'react';
import {displaySubmittedAnswer,gradeLabel,type CardAttempt} from './protocol.ts';

/**
 * DSH 0.2.1-rc.3 alias tokens (UI-01); fallbacks keep the card readable outside DSH.
 * Internal ids (attempt, question) stay in data attributes and never in visible text.
 */
const T={
  text:'var(--dsw-alias-label-primary, #1b1f24)',muted:'var(--dsw-alias-label-secondary, #5b6472)',faint:'var(--dsw-alias-label-tertiary, #8a929e)',
  border:'var(--dsw-alias-border-l2, #d9dee7)',layer:'var(--dsw-alias-bg-layer-1, #f6f7f9)',base:'var(--dsw-alias-bg-base, #ffffff)',
  primary:'var(--dsw-alias-button-primary-fill, #1f2328)',success:'var(--dsw-alias-state-success-primary, #1a7f37)',error:'var(--dsw-alias-state-error-primary, #c62828)',
  radius:'var(--dsw-radius-lg, 12px)',radiusMd:'var(--dsw-radius-md, 8px)',radiusSm:'var(--dsw-radius-sm, 6px)',
};
const hairline='0.5px solid '+T.border;
const tag:CSSProperties={fontSize:11,lineHeight:'18px',padding:'0 8px',borderRadius:999,background:T.layer,color:T.muted,whiteSpace:'nowrap'};
const button:CSSProperties={font:'inherit',fontSize:13,padding:'5px 14px',borderRadius:T.radiusSm,border:hairline,background:T.base,color:T.text,cursor:'pointer'};
const primaryButton:CSSProperties={...button,border:'0.5px solid '+T.primary,background:T.primary,color:'#ffffff'};
const field:CSSProperties={font:'inherit',fontSize:13,padding:'6px 8px',border:hairline,borderRadius:T.radiusSm,background:T.base,color:T.text,boxSizing:'border-box'};
const GRADE_COLORS:Record<string,string>={correct:T.success,incorrect:T.error};

export interface AttemptViewProps {
  sessionId:string;attempt:CardAttempt;busy:boolean;notice:string;selected:string[];answer:string;
  onSelect:(optionId:string)=>void;onAnswer:(value:string)=>void;onHint:()=>void;onSubmit:()=>void;onRefresh:()=>void;
}

/** Stateless study card; the registered component in index.tsx owns state and Host commands. */
export function AttemptView(p:AttemptViewProps){
  const a=p.attempt,closed=a.status!=='issued',choice=a.question.kind==='single_choice'||a.question.kind==='multiple_choice';
  const status=p.busy?'正在核验 Host 记录…':p.notice||(a.grade?'':'答案由 Host 判分；已讲授不等于已掌握。');
  return <section data-dsh-study="attempt" data-study-attempt={a.attemptId} data-study-question={a.question.id} data-study-status={a.status} data-study-session={p.sessionId}
    style={{border:hairline,borderRadius:T.radius,padding:'14px 16px',margin:'6px 0',background:T.base,color:T.text,font:'inherit',fontSize:13,lineHeight:1.6,maxWidth:760}}>
    <header style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6,marginBottom:8}}>
      <span style={{fontSize:12,fontWeight:600,color:T.muted,marginRight:4}}>学习练习</span>
      <span style={tag}>帮助等级：{a.maxHelp}</span>
      <span style={tag}>{a.independent?'独立测评':'不计为独立测评'}</span>
      <span style={tag}>能力证据：{a.capability??'U'}</span>
    </header>
    <p style={{margin:'0 0 12px',fontSize:14,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{a.question.prompt}</p>
    {a.hintText?<div data-study-hint style={{margin:'0 0 12px',padding:'8px 10px',borderRadius:T.radiusMd,background:T.layer,color:T.text}}><span style={{color:T.muted,marginRight:6}}>提示 {a.maxHelp}</span>{a.hintText}</div>:null}
    {closed?<div>
      <div style={{fontSize:12,color:T.muted,marginBottom:4}}>已提交的作答</div>
      <pre data-study-submitted-answer style={{margin:0,padding:'8px 10px',borderRadius:T.radiusMd,background:T.layer,font:'inherit',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{displaySubmittedAnswer(a)}</pre>
      {a.grade?<p data-study-grade={a.grade.outcome} style={{margin:'8px 0 0',color:GRADE_COLORS[a.grade.outcome]??T.muted}}>{gradeLabel(a.grade)}</p>:null}
    </div>:<fieldset disabled={p.busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <legend style={{fontSize:12,color:T.muted,padding:0,marginBottom:6}}>你的作答</legend>
      {choice?a.question.options?.map(option=>{const checked=p.selected.includes(option.id);
        return <label key={option.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 10px',marginBottom:6,border:checked?'0.5px solid '+T.primary:hairline,borderRadius:T.radiusMd,background:checked?T.layer:T.base,cursor:'pointer'}}>
          <input type={a.question.kind==='single_choice'?'radio':'checkbox'} name={a.attemptId} value={option.id} checked={checked} onChange={()=>p.onSelect(option.id)} style={{margin:'4px 0 0',accentColor:T.primary}}/>
          <span style={{wordBreak:'break-word'}}>{option.label}</span></label>;}):null}
      {a.question.kind==='numeric'?<label style={{display:'flex',alignItems:'center',gap:8}}><span style={{color:T.muted}}>数值（{a.question.unit}）</span><input aria-label="数值答案" type="number" step="any" value={p.answer} onChange={e=>p.onAnswer(e.target.value)} style={{...field,width:180}}/></label>:null}
      {a.question.kind==='open'?<label style={{display:'block'}}><span style={{display:'block',color:T.muted,marginBottom:4}}>推导与条件</span><textarea aria-label="开放题作答" value={p.answer} maxLength={10000} onChange={e=>p.onAnswer(e.target.value)} style={{...field,width:'100%',minHeight:120,resize:'vertical'}}/></label>:null}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
        <button type="button" style={primaryButton} onClick={p.onSubmit}>提交作答</button>
        <button type="button" style={button} onClick={p.onHint}>请求提示 H1</button>
      </div>
    </fieldset>}
    <footer style={{display:'flex',alignItems:'center',gap:8,marginTop:12}}>
      <p role="status" aria-live="polite" style={{margin:0,flex:1,minWidth:0,fontSize:12,color:T.muted}}>{status}</p>
      <button type="button" disabled={p.busy} onClick={p.onRefresh} style={{...button,fontSize:12,padding:'2px 8px',border:0,background:'transparent',color:T.faint}}>刷新学习记录</button>
    </footer>
  </section>;
}
