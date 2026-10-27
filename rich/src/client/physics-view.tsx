import {useEffect,useMemo,useRef,useState} from 'react'
import {harmonicOscillator,infiniteWell,isingExample} from '../shared/physics'
import {readPhysicsMeta,type PhysicsDemo} from '../shared/physics-protocol'
import {LinePlot} from './renderers/line-plot'
import type {RendererTheme} from './renderers/types'
import type {ToolViewProps} from './contract'
import type {PlotSeries} from '../shared/protocol'
import {buttonStyle,cardStyle,noteStyle} from './dsw'
import {copyPhysicsData,createPhysicsSvgExport,enterPhysicsFullscreen,PHYSICS_SVG_THEME,physicsSvgDetails,type PhysicsPreferences} from './physics-export'

const theme:RendererTheme=PHYSICS_SVG_THEME
type Preferences=PhysicsPreferences
const defaults:Preferences={n:1,mass:1,spring:4,amplitude:1,phase:0,quantity:'position',density:false,size:16,kind:'ordered',seed:1}
function readPreferences(key:string):Preferences{
  try{
    if(typeof window==='undefined')return {...defaults}
    const raw=JSON.parse(window.localStorage.getItem(key)??'null') as {version?:unknown;value?:Preferences}|null
    if(raw?.version!==1||!raw.value)return {...defaults}
    const p=raw.value
    infiniteWell(p.n);harmonicOscillator(p);isingExample(p.size,p.kind,p.seed)
    if(!['position','velocity','energy'].includes(p.quantity)||typeof p.density!=='boolean')return {...defaults}
    return {n:p.n,mass:p.mass,spring:p.spring,amplitude:p.amplitude,phase:p.phase,quantity:p.quantity,density:p.density,size:p.size,kind:p.kind,seed:p.seed}
  }catch{return {...defaults}}
}
function graph(title:string,series:PlotSeries[],xLabel:string,xUnit:string,yLabel:string,yUnit:string){
  return <LinePlot theme={theme} content={{schemaVersion:1,type:'line_plot',title,data:{series,xAxis:{label:xLabel,unit:xUnit},yAxis:{label:yLabel,unit:yUnit}}}}/>
}
function PhysicsDemoCard({demo,storageKey}:{demo:PhysicsDemo;storageKey:string}){
  const [p,setPreferences]=useState(()=>readPreferences(storageKey)),[notice,setNotice]=useState('')
  const root=useRef<HTMLElement>(null)
  useEffect(()=>{try{window.localStorage.setItem(storageKey,JSON.stringify({version:1,value:p}))}catch{/* Local presentation preferences are best effort, never learning evidence. */}},[storageKey,p])
  function set<K extends keyof Preferences>(key:K,value:Preferences[K]){setPreferences(previous=>({...previous,[key]:value}))}
  const calculation=useMemo(()=>demo==='infinite_well'?{kind:'well' as const,data:infiniteWell(p.n)}:demo==='harmonic_oscillator'?{kind:'oscillator' as const,data:harmonicOscillator(p)}:{kind:'ising' as const,data:isingExample(p.size,p.kind,p.seed)},[demo,p.n,p.mass,p.spring,p.amplitude,p.phase,p.size,p.kind,p.seed])
  function slider(label:string,key:'n'|'mass'|'spring'|'amplitude'|'phase'|'size',min:number,max:number,step:number){
    return <label style={{display:'grid',gridTemplateColumns:'minmax(80px, 130px) minmax(0, 1fr) 54px',gap:8,alignItems:'center'}}>{label}<input aria-label={label} type="range" min={min} max={max} step={step} style={{minWidth:0,width:'100%'}} value={p[key]} onChange={e=>set(key,Number(e.target.value))}/><output>{p[key].toFixed(key==='n'||key==='size'?0:2)}</output></label>
  }
  function exportSvg(){
    const svg=root.current?.querySelector('svg')
    if(!svg){setNotice('图形尚未准备好。');return}
    try{
      const copy=createPhysicsSvgExport(svg,physicsSvgDetails(demo,p))
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'}))
      const link=document.createElement('a');link.href=url;link.download=demo+'.svg';link.click();setTimeout(()=>URL.revokeObjectURL(url),0)
      setNotice('已导出当前 SVG。')
    }catch{setNotice('当前浏览器无法导出 SVG。')}
  }
  return <section ref={root} data-physics-demo={demo} style={{...cardStyle,overflow:'auto'}}>
    <header><strong>{demo==='infinite_well'?'一维无限深方势阱':demo==='harmonic_oscillator'?'经典简谐振子':'二维 Ising 有限构型'}</strong><p style={{...noteStyle,marginTop:2}}>确定性计算 · 参数变化仅影响演示，不改变学习成绩。</p></header>
    {calculation.kind==='well'?<>
      {slider('量子数 n','n',1,10,1)}
      <label><input type="checkbox" checked={p.density} onChange={e=>set('density',e.target.checked)}/>显示概率密度</label>
      <p>取 L=1 的无量纲坐标，ψₙ(x)=√2 sin(nπx)，0≤x≤1。</p>
      {graph(p.density?'归一化概率密度':'归一化波函数',[{name:p.density?'|ψ|²':'ψ',points:calculation.data.points.map(point=>({x:point.x,y:p.density?point.density:point.psi}))}],'x/L','1',p.density?'L|ψ|²':'√L ψ','1')}
      <p data-physics-integral={calculation.data.integral.toFixed(9)}>数值归一化积分：{calculation.data.integral.toFixed(9)}；内部节点：{calculation.data.nodes.length}；Eₙ/E₁={calculation.data.energyRatio}。</p>
    </>:calculation.kind==='oscillator'?<>
      {slider('质量 m (kg)','mass',0.1,10,0.1)}{slider('劲度 k (N/m)','spring',0.1,100,0.1)}
      {slider('振幅 A (m)','amplitude',0,5,0.1)}{slider('初相 φ (rad)','phase',0,2*Math.PI,0.01)}
      <label>显示量 <select aria-label="显示量" value={p.quantity} onChange={e=>set('quantity',e.target.value as Preferences['quantity'])}><option value="position">位移</option><option value="velocity">速度</option><option value="energy">能量</option></select></label>
      <p>x=A cos(ωt+φ)，v=−Aω sin(ωt+φ)，ω=√(k/m)。忽略阻尼和驱动。</p>
      {graph('一个周期内的'+(p.quantity==='energy'?'能量':p.quantity==='velocity'?'速度':'位移'),p.quantity==='energy'?[
        {name:'动能',points:calculation.data.points.map(v=>({x:v.t,y:v.kinetic}))},
        {name:'势能',points:calculation.data.points.map(v=>({x:v.t,y:v.potential}))},
        {name:'总能量',points:calculation.data.points.map(v=>({x:v.t,y:v.total}))},
      ]:[{name:p.quantity==='velocity'?'v':'x',points:calculation.data.points.map(v=>({x:v.t,y:p.quantity==='velocity'?v.v:v.x}))}],'t','s',p.quantity==='energy'?'E':p.quantity==='velocity'?'v':'x',p.quantity==='energy'?'J':p.quantity==='velocity'?'m/s':'m')}
      <p data-physics-energy={calculation.data.totalEnergy}>ω={calculation.data.omega.toFixed(4)} rad/s；T={calculation.data.period.toFixed(4)} s；总能量={calculation.data.totalEnergy.toFixed(6)} J。</p>
    </>:<>
      {slider('格点边长 N','size',4,32,1)}
      <label>示例构型 <select aria-label="示例构型" value={p.kind} onChange={e=>set('kind',e.target.value as Preferences['kind'])}><option value="ordered">有序 +1</option><option value="random">独立随机</option></select></label>
      <button type="button" onClick={()=>set('seed',(p.seed+1)>>>0)}>换一组随机种子</button>
      <svg role="img" aria-label={`${p.size}×${p.size} 周期边界 Ising 自旋构型`} viewBox={`0 0 ${p.size} ${p.size}`} style={{display:'block',width:'min(100%, 420px)',aspectRatio:'1',margin:'12px auto'}}>
        {calculation.data.spins.map((spin,i)=><rect key={i} x={i%p.size} y={Math.floor(i/p.size)} width={0.94} height={0.94} fill={spin===1?'#c95132':'#247bbf'}/>)}
      </svg>
      <p data-physics-magnetization={calculation.data.magnetization}>红 +1 / 蓝 −1；磁化强度 M/N²={calculation.data.magnetization.toFixed(6)}；每自旋能量={calculation.data.energyPerSpin.toFixed(6)}（J=1）。</p>
      <p>周期边界；这是单个有限构型，随机示例不是有限温度 Monte Carlo 采样，不能据此判定临界温度或热力学极限。</p>
    </>}
    <footer style={{display:'flex',gap:10,flexWrap:'wrap'}}><button type="button" style={buttonStyle} onClick={exportSvg}>导出 SVG</button><button type="button" style={buttonStyle} onClick={()=>{void enterPhysicsFullscreen(root.current).then(setNotice)}}>全屏</button><button type="button" style={buttonStyle} onClick={()=>{void copyPhysicsData(calculation.data,typeof navigator==='undefined'?undefined:navigator.clipboard).then(setNotice)}}>复制数据</button></footer>
    <p role="status" aria-live="polite">{notice}</p>
  </section>
}
export function PhysicsToolView(props:ToolViewProps){
  if(props.phase!=='result')return <p>正在准备确定性物理演示…</p>
  const block=props.block as {isError?:boolean;meta?:unknown},parsed=readPhysicsMeta(block.meta)
  if(block.isError||!parsed)return <p role="alert">物理演示数据不可用。</p>
  const key='dsh-rich-physics:v1:'+props.sessionId+':'+props.callId
  return <PhysicsDemoCard key={key} demo={parsed.demo} storageKey={key}/>
}
