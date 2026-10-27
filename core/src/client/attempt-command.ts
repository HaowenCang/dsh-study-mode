import {readAttempt,type CardAttempt} from './protocol.ts';
import {continueTeaching,type SessionRemote} from './continue.ts';
export interface CommandRemote {
  commands:{execute:(sessionId:string,line:string,attachments:unknown[])=>Promise<{ok:boolean;value?:{result:{kind:string;text?:string}};error?:{message:string}}>};
  session:SessionRemote;
}
/**
 * Run one learning-card command through the Host and validate the returned attempt.
 * A successful submit queues the original-session feedback prompt before this resolves,
 * independent of whether the calling card is still mounted, so a recorded answer always
 * resumes teaching. Only the caller's own state updates depend on the card still being current.
 * @returns the Host attempt, plus the feedback prompt outcome for a submit.
 */
export async function runAttemptCommand(remote:CommandRemote,sessionId:string,attemptId:string,payload:Record<string,unknown>,feedbackId:string|undefined):Promise<{value:CardAttempt;feedback?:Promise<{ok:boolean}>}>{
  const response=await remote.commands.execute(sessionId,'/study-attempt '+JSON.stringify(payload),[]);
  if(!response.ok||response.value?.result.kind!=='success')throw new Error(response.value?.result.text??response.error?.message??'Host command failed');
  const value=readAttempt(JSON.parse(response.value.result.text??'null'),sessionId);
  if(!value||value.attemptId!==attemptId)throw new Error('Invalid Host learning state');
  if(payload.operation!=='submit'||feedbackId===undefined)return {value};
  // Settles instead of rejecting: an unmounted caller never awaits it.
  return {value,feedback:continueTeaching(remote.session,sessionId,value.attemptId,feedbackId).then(result=>({ok:result.ok}),()=>({ok:false}))};
}
