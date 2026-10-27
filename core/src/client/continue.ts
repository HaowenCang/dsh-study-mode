export interface SessionRemote {
  prompt(request:{requestId:string;sessionId:string;mode:'queue';content:{type:'text';text:string}[]}):Promise<{ok:boolean;value?:unknown;error?:{message:string}}>;
}
/** RC.3 official SessionPromptRequest. No composer draft mutation or DOM access. The text appears as the learner's message, so it stays short. */
export async function continueTeaching(remote:SessionRemote,sessionId:string,attemptId:string,requestId:string){
  return remote.prompt({requestId,sessionId,mode:'queue',content:[{type:'text',text:`我已提交题卡作答（编号 ${attemptId.slice(0,8)}）。请先调用 study_get_state 核对 Host 判分与提示记录，再继续讲解；不得自行改写能力等级。`}]});
}
