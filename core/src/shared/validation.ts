export function record(value: unknown): Record<string, unknown> {
  if (value===null || typeof value!=='object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string,unknown>;
}
export function fields(value:Record<string,unknown>,allowed:readonly string[]):void {
  for(const key of Object.keys(value)) if(!allowed.includes(key)) throw new Error(`Unexpected field: ${key}`);
}
export function text(value:unknown,name:string,max=200):string {
  if(typeof value!=='string' || !value.trim() || value.length>max) throw new Error(`Invalid ${name}`);
  return value;
}
export function finite(value:unknown,name:string):number {
  if(typeof value!=='number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}
export function canonical(value:unknown):string {
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  const obj=value as Record<string,unknown>;
  return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+canonical(obj[k])).join(',')+'}';
}
