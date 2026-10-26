export interface SessionRemote {
  prompt(request:{requestId:string;sessionId:string;mode:'queue';content:{type:'text';text:string}[]}):Promise<{ok:boolean;value?:unknown;error?:{message:string}}>;
}
/** RC.3 official SessionPromptRequest. No composer draft mutation or DOM access. */
export async function continueTeaching(remote:SessionRemote,sessionId:string,attemptId:string,requestId:string){
  return remote.prompt({requestId,sessionId,mode:'queue',content:[{type:'text',text:`学习题卡 ${attemptId} 的作答已由 Host 记录。请先调用 study_get_state 核对判分与提示状态，再继续反馈教学；不得自行改写能力等级。`}]});
}
