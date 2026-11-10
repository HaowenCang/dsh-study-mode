/**
 * Single-instance claims for learning cards shown in the message body (plan P4).
 *
 * The inline card (child Slot `rich.inline.toolcall`, declared by the dsh-rich-response assistant
 * renderer) claims a tool call once it has located the Host attempt; while claimed, the tool view of
 * the same call shows a short stub instead of a second full card. Purely presentational: the Host
 * stays the only owner of attempts, answers and evidence, and both cards talk to it the same way.
 */
const counts=new Map<string,number>();
const listeners=new Set<()=>void>();
const key=(sessionId:string,callId:string)=>JSON.stringify([sessionId,callId]);
const notify=()=>{for(const listener of [...listeners])listener();};

/** Claim a call; returns the release function (idempotent). */
export function claimCall(sessionId:string,callId:string):()=>void{
  const k=key(sessionId,callId);counts.set(k,(counts.get(k)??0)+1);notify();
  let released=false;
  return ()=>{
    if(released)return;released=true;
    const next=(counts.get(k)??1)-1;if(next<=0)counts.delete(k);else counts.set(k,next);notify();
  };
}
export function isClaimed(sessionId:string,callId:string):boolean{return (counts.get(key(sessionId,callId))??0)>0;}
export function subscribeClaims(listener:()=>void):()=>void{listeners.add(listener);return ()=>{listeners.delete(listener);};}
/** DOM anchor of the inline card of a call, used by the tool-view stub to scroll to it. */
export function inlineCardSelector(callId:string):string{return '[data-study-inline-card="'+callId.replace(/["\\]/g,'\\$&')+'"]';}

/**
 * Locate with bounded retries: the inline card mounts while the issuing call is still streaming,
 * before the Host has an attempt for it. Stops early when `alive()` turns false.
 */
export async function locateWithRetry<T>(locate:()=>Promise<T>,alive:()=>boolean,delays:readonly number[]=[250,500,1000,1500,2000,3000,3000,4000,5000],sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<T|undefined>{
  for(let i=0;;i++){
    if(!alive())return undefined;
    try{return await locate();}catch(error){
      // Only an unknown attempt is worth waiting for; other refusals are final.
      if(!(error instanceof Error&&/Unknown attempt/.test(error.message))||i>=delays.length)throw error;
    }
    await sleep(delays[i] as number);
  }
}
