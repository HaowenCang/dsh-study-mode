import test from 'node:test'
import assert from 'node:assert/strict'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {PhysicsToolView} from '../../src/client/physics-view'
import type {ToolViewProps} from '../../src/client/contract'
function props(meta:unknown):ToolViewProps{return {sessionId:'physics-session',callId:'physics-call',toolName:'rich_physics_demo',phase:'result',block:{kind:'tool-result',seq:1,time:1,callId:'physics-call',name:'rich_physics_demo',content:[{type:'text',text:'Physics demo'}],isError:false,call:{name:'rich_physics_demo',argsRaw:'{}'},subCalls:[],meta}}}
test('physical cards render finite numerical summaries and accessible controls',()=>{
  for(const demo of ['infinite_well','harmonic_oscillator','ising']){
    const html=renderToStaticMarkup(createElement(PhysicsToolView,props({kind:'rich-physics',version:1,demo})))
    assert.ok(html.includes('data-physics-demo="'+demo+'"'))
    assert.ok(html.includes('<svg'))
    assert.equal(/NaN|Infinity/.test(html),false)
    assert.ok(html.includes('导出 SVG'))
  }
})
test('tampered physics history falls back without executing supplied markup',()=>{
  const html=renderToStaticMarkup(createElement(PhysicsToolView,props({kind:'rich-physics',version:1,demo:'ising',script:'<img src=x onerror=alert(1)>'})))
  assert.ok(html.includes('role="alert"'));assert.equal(html.includes('<img'),false)
})
