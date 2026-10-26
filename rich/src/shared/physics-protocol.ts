export const PHYSICS_DEMOS=['infinite_well','harmonic_oscillator','ising'] as const
export type PhysicsDemo=typeof PHYSICS_DEMOS[number]
export function physicsArgs(value:unknown):{demo:PhysicsDemo}{
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a named physics demo')
  const record=value as Record<string,unknown>
  if(Object.keys(record).some(k=>k!=='demo')||!PHYSICS_DEMOS.includes(record.demo as PhysicsDemo))throw new Error('Unsupported physics demo or extra fields')
  return {demo:record.demo as PhysicsDemo}
}
export function readPhysicsMeta(value:unknown):{demo:PhysicsDemo}|undefined{
  if(value===null||typeof value!=='object'||Array.isArray(value))return
  const record=value as Record<string,unknown>
  if(record.kind!=='rich-physics'||record.version!==1||Object.keys(record).some(k=>!['kind','version','demo'].includes(k)))return
  try{return physicsArgs({demo:record.demo})}catch{return}
}
