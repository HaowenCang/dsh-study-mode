import {PHYSICS_DEMOS,physicsArgs} from '../../shared/physics-protocol'
import type {ToolDefinitionLike} from '../types'
export function createPhysicsTool():ToolDefinitionLike{
  return {
    name:'rich_physics_demo',
    description:'Show a deterministic interactive physics demonstration: normalized infinite well, classical harmonic oscillator, or finite Ising example. No executable expressions or model-generated curve data. Ising is a finite configuration example, not a phase-transition simulation.',
    parameters:{type:'object',properties:{demo:{type:'string',enum:[...PHYSICS_DEMOS]}},required:['demo'],additionalProperties:false},
    output:{schema:{type:'object',properties:{demo:{type:'string',enum:[...PHYSICS_DEMOS]}},required:['demo'],additionalProperties:false},render:(_a,value)=>[{type:'text',text:'Interactive deterministic physics demo: '+physicsArgs(value).demo+'. It stays in the tool record and has no inline figure; for a figure inside your answer use rich_render, rich_svg, rich_mermaid or rich_heatmap.'}],presentationMeta:(_a,value)=>({kind:'rich-physics',version:1,...physicsArgs(value)})},
    async execute(args,exec){if(exec.signal.aborted)throw new Error('Physics demo aborted');return physicsArgs(args)},
  }
}
