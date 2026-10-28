import type {CSSProperties,ReactNode} from 'react';
import {displaySubmittedAnswer,gradeLabel,nextHintLevel,VERDICT_LABELS,type CardAttempt} from './protocol.ts';

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
const panel:CSSProperties={margin:'8px 0 0',padding:'8px 10px',borderRadius:T.radiusMd,background:T.layer,whiteSpace:'pre-wrap',wordBreak:'break-word'};
const caption:CSSProperties={fontSize:12,color:T.muted,marginBottom:4};
const GRADE_COLORS:Record<string,string>={correct:T.success,incorrect:T.error};
const VERDICT_COLORS:Record<string,string>={correct:T.success,partially_correct:T.muted,incorrect:T.error};
const KIND_LABELS:Record<string,string>={single_choice:'单选题',multiple_choice:'多选题',numeric:'数值题',fill_blank:'填空题',open:'简答 / 推导'};

export interface AttemptViewProps {
  sessionId:string;attempt:CardAttempt;busy:boolean;notice:string;selected:string[];answer:string;blanks:string[];
  onSelect:(optionId:string)=>void;onAnswer:(value:string)=>void;onBlank:(index:number,value:string)=>void;onHint:(level:string)=>void;onSubmit:()=>void;onRefresh:()=>void;
}

/** Split a fill-in prompt at its {{n}} markers; `blank` renders marker n (1-based). */
function withBlanks(prompt:string,blank:(n:number)=>ReactNode):ReactNode[]{
  return prompt.split(/\{\{(\d+)\}\}/).map((part,i)=>i%2===0?part:<span key={i}>{blank(Number(part))}</span>);
}

/** Stateless study card; the registered component in index.tsx owns state and Host commands. */
export function AttemptView(p:AttemptViewProps){
  const a=p.attempt,q=a.question,closed=a.status!=='issued',choice=q.kind==='single_choice'||q.kind==='multiple_choice';
  const trueFalse=q.format==='true_false',lettered=q.source==='model'&&choice&&!trueFalse,hint=nextHintLevel(a);
  const status=p.busy?'正在核验 Host 记录…':p.notice||(a.grade?'':'答案由 Host 判分；已讲授不等于已掌握。');
  const prompt=q.kind!=='fill_blank'?q.prompt:withBlanks(q.prompt,n=>{
    const unit=q.blanks?.[n-1]?.unit;
    if(closed)return <span style={{padding:'0 4px',borderBottom:'1px solid '+T.faint,color:T.muted}}>（{n}）{unit?' '+unit:''}</span>;
    return <span style={{display:'inline-flex',alignItems:'center',gap:4,margin:'0 2px'}}>
      <input aria-label={'第 '+n+' 空'} value={p.blanks[n-1]??''} maxLength={500} disabled={p.busy} onChange={e=>p.onBlank(n-1,e.target.value)} style={{...field,width:120,padding:'2px 6px'}}/>
      {unit?<span style={{color:T.muted}}>{unit}</span>:null}</span>;
  });
  return <section data-dsh-study="attempt" data-study-attempt={a.attemptId} data-study-question={q.id} data-study-status={a.status} data-study-session={p.sessionId}
    style={{border:hairline,borderRadius:T.radius,padding:'14px 16px',margin:'6px 0',background:T.base,color:T.text,font:'inherit',fontSize:13,lineHeight:1.6,maxWidth:760}}>
    <header style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:6,marginBottom:8}}>
      <span style={{fontSize:12,fontWeight:600,color:T.muted,marginRight:4}}>学习练习</span>
      <span style={tag}>{trueFalse?'判断题':KIND_LABELS[q.kind]}</span>
      {q.source==='model'?<span data-study-source="model" style={tag}>模型出题</span>:null}
      <span style={tag}>帮助等级：{a.maxHelp}</span>
      <span style={tag}>{a.independent?'独立测评':'不计为独立测评'}</span>
      <span style={tag}>能力证据：{a.capability??'U'}</span>
    </header>
    <p style={{margin:'0 0 12px',fontSize:14,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{prompt}</p>
    {a.hintText?<div data-study-hint style={{margin:'0 0 12px',padding:'8px 10px',borderRadius:T.radiusMd,background:T.layer,color:T.text}}><span style={{color:T.muted,marginRight:6}}>提示 {a.maxHelp}</span>{a.hintText}</div>:null}
    {closed?<div>
      <div style={caption}>已提交的作答</div>
      <pre data-study-submitted-answer style={{...panel,margin:0,font:'inherit'}}>{displaySubmittedAnswer(a)}</pre>
      {a.grade?.parts?<p data-study-parts style={{margin:'8px 0 0'}}>{a.grade.parts.map((ok,i)=><span key={i} style={{marginRight:12,color:ok?T.success:T.error}}>第 {i+1} 空 {ok?'正确':'错误'}</span>)}</p>:null}
      {a.grade?<p data-study-grade={a.grade.outcome} style={{margin:'8px 0 0',color:GRADE_COLORS[a.grade.outcome]??T.muted}}>{gradeLabel(a.grade)}</p>:null}
      {a.referenceAnswer?<div data-study-reference style={{marginTop:10}}><div style={caption}>参考答案（出题时锁定）</div><div style={{...panel,margin:0}}>{a.referenceAnswer}</div></div>:null}
      {a.modelReviews?.map((r,i)=><div key={i} data-study-model-review={r.verdict} style={{marginTop:10}}>
        <div style={caption}>模型评阅（不计入判分）：<span style={{color:VERDICT_COLORS[r.verdict]??T.muted}}>{VERDICT_LABELS[r.verdict]??r.verdict}</span></div>
        <div style={{...panel,margin:0}}>{r.comment}</div></div>)}
    </div>:<fieldset disabled={p.busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <legend style={{fontSize:12,color:T.muted,padding:0,marginBottom:6}}>{q.kind==='fill_blank'?'在题干的空格中作答':'你的作答'}</legend>
      {choice?q.options?.map((option,i)=>{const checked=p.selected.includes(option.id);
        return <label key={option.id} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 10px',marginBottom:6,border:checked?'0.5px solid '+T.primary:hairline,borderRadius:T.radiusMd,background:checked?T.layer:T.base,cursor:'pointer'}}>
          <input type={q.kind==='single_choice'?'radio':'checkbox'} name={a.attemptId} value={option.id} checked={checked} onChange={()=>p.onSelect(option.id)} style={{margin:'4px 0 0',accentColor:T.primary}}/>
          <span style={{wordBreak:'break-word'}}>{lettered?<span style={{color:T.muted,marginRight:6}}>{String.fromCharCode(65+i)}.</span>:null}{option.label}</span></label>;}):null}
      {q.kind==='numeric'?<label style={{display:'flex',alignItems:'center',gap:8}}><span style={{color:T.muted}}>数值（{q.unit}）</span><input aria-label="数值答案" type="number" step="any" value={p.answer} onChange={e=>p.onAnswer(e.target.value)} style={{...field,width:180}}/></label>:null}
      {q.kind==='open'?<label style={{display:'block'}}><span style={{display:'block',color:T.muted,marginBottom:4}}>{q.source==='model'?'作答':'推导与条件'}</span><textarea aria-label="开放题作答" value={p.answer} maxLength={10000} onChange={e=>p.onAnswer(e.target.value)} style={{...field,width:'100%',minHeight:120,resize:'vertical'}}/></label>:null}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:12}}>
        <button type="button" style={primaryButton} onClick={p.onSubmit}>提交作答</button>
        {hint?<button type="button" style={button} onClick={()=>p.onHint(hint)}>请求提示 {hint}</button>:null}
      </div>
    </fieldset>}
    <footer style={{display:'flex',alignItems:'center',gap:8,marginTop:12}}>
      <p role="status" aria-live="polite" style={{margin:0,flex:1,minWidth:0,fontSize:12,color:T.muted}}>{status}</p>
      <button type="button" disabled={p.busy} onClick={p.onRefresh} style={{...button,fontSize:12,padding:'2px 8px',border:0,background:'transparent',color:T.faint}}>刷新学习记录</button>
    </footer>
  </section>;
}
