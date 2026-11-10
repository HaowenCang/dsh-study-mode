import {readFileSync} from 'node:fs';
export const name='dsh-study-agent';
export const inject=['tools','systemPrompt','skills'];
const allowed=['rich_render','rich_physics_demo','rich_mermaid','rich_heatmap','rich_image','rich_svg','rich_check_figure','study_get_state','study_get_plan','study_issue_question','study_author_question','study_model_review','study_teaching_step','skill','working_directory'];
/** Figure guidance for the 0.2.1 route: figure tools write a file and return one image line to copy. */
export const FIGURES_LEGACY='数学图形用确定性数据调用 rich_render，检查量纲、边界条件、归一化与近似；解题流程或概念关系图用 rich_mermaid 的受限 flowchart 子集，Markdown 中的 mermaid 代码块不会被渲染。受力图、几何、电路、装置等示意图用 rich_svg 绘制（仅限基本几何元素）。'
  +'rich_render、rich_mermaid、rich_heatmap、rich_svg 和 rich_image 的结果会给出一行 Markdown 图片 ![标题](路径)：把这一行原样复制到回答正文中讨论该图的位置，单独成行，图会显示在那里；不要改写路径，也不要在回答中直接书写 SVG、HTML 或 svg/mermaid 代码块。'
  +'二维场、概率密度或矩阵用 rich_heatmap，只放实际计算或题目给定的数值；';
/** Figure guidance when Rich Response draws fences inline (plan P7): the figure appears where the fence is written. */
export const FIGURES_INLINE='图形直接写在回答正文中讨论它的位置，用下列受限代码块，图会随回答显示在原位，不需要也不会有图片路径：'
  +'```svg 写受力图、几何、电路、装置等示意图，内容是一个 <svg viewBox="minX minY 宽 高"> 元素（必须有 viewBox），只用 g、defs、marker、line、polyline、polygon、rect、circle、ellipse、path、text、tspan、title、desc 和表现属性（fill、stroke、stroke-width、font-size、transform 等，颜色写字面值），箭头用 <defs> 中的 <marker id> 加 marker-end="url(#id)"；不得含 style、script、事件属性、链接、image、use、foreignObject、渐变或 url() 填充。'
  +'```mermaid 写解题流程或概念关系图，只支持 flowchart 子集：首行 flowchart TD（或 LR、BT、RL），节点 A[框]、A(圆角)、A{判断}、A((圆))，连线 A --> B、A -.-> B、A -->|标签| B；不支持 subgraph、click、style/classDef、其他图类型和同一对节点间的两条连线；可在首行前写 %% title: 标题。'
  +'```dsh-plot 写函数图，内容是 JSON，如 {"title":"阻尼振动","fns":[{"expr":"exp(-x/4)*cos(2*x)","label":"x(t)"}],"x":[0,12],"xLabel":"t","yLabel":"x"}；表达式只能用 x、数字、+ - * / ^、括号和 sin cos tan exp log sqrt abs pi e，最多 8 条曲线。数据点曲线可写 rich_render 的 line_plot/scatter_plot 内容 JSON。'
  +'```dsh-heatmap 写二维场、概率密度或矩阵，JSON 如 {"title":"势能","values":[[0,1],[1,2]],"colorScale":{"palette":"sequential","label":"U"}}，只放实际计算或题目给定的数值。'
  +'```dsh-physics 内容为 {"demo":"infinite_well"}、{"demo":"harmonic_oscillator"} 或 {"demo":"ising"}，显示可调参数的物理演示。'
  +'图形用确定性数据，检查量纲、边界条件、归一化与近似。没有把握的图先用 rich_check_figure 检查同一段代码，按返回的行号改正，通过后原样写进正文；正文里不要写 HTML，也不要写图片路径或 Markdown 图片行。';
/** SKILL.md sentence of the 0.2.1 route and its inline replacement (the test pins that the sentence exists). */
export const SKILL_FIGURES_LEGACY='图形工具返回的 `![标题](路径)` 行要原样放在正文中讨论该图的位置并单独成行，使图与文字相邻；不要在回答里手写 SVG、HTML 或 svg/mermaid 代码块，示意图改用 rich_svg。';
export const SKILL_FIGURES_INLINE='图形用 ```svg、```mermaid、```dsh-plot、```dsh-heatmap 或 ```dsh-physics 受限代码块直接写在正文中讨论该图的位置，图与文字相邻；没有把握时先用 rich_check_figure 检查。不要手写 HTML 或图片路径。';
export interface AgentContext {
  effect:(callback:()=>()=>void)=>void;
  tools:{schemas:()=>{name:string}[];restrict:(filter:{deny:string[]})=>()=>void;guard:(guard:(exec:{name:string;arguments:unknown})=>string|undefined)=>()=>void};
  systemPrompt:{getSectionOrder:(key:string)=>number;section:(section:{name:string;order:number;text:string;interpolate?:boolean})=>()=>void};
  skills:{register:(skill:{name:string;description:string;content:string;source:string;invocation:{modelInvocable:boolean;userInvocable:boolean}})=>()=>void};
}
export function configureStudyAgent(ctx:AgentContext,skillContent:string):void{
  // A preset generation is an ancestor scope, not an Agent event recipient.
  // Deny current unrelated globals while admitting its scoped Skill loader;
  // the monotonic guard also constrains late and Agent-owned capabilities.
  // The bundle's preset row declares native tool presentation for every version
  // this package supports: on DSH 0.2.1 that is @deepseek-ai/dsh-agent-tool-presentation
  // calling the then-public tools.presentAs(), and on 0.2.2 the same selector
  // mounts the native tool executor. Doing it as a preset row instead of an
  // agent call is what keeps teaching native on 0.2.2, where presentAs() is gone,
  // even when the deployment defaults to PTC.
  // Rich Response registers rich_check_figure exactly when its answers draw figure fences inline
  // (Host config `inline`, auto on DSH 0.2.2), so the policy follows that one decision.
  const inline=ctx.tools.schemas().some(tool=>tool.name==='rich_check_figure');
  const denied=ctx.tools.schemas().map(tool=>tool.name).filter(name=>name!=='run_code'&&!allowed.includes(name));
  ctx.effect(()=>ctx.tools.restrict({deny:denied}));
  ctx.effect(()=>ctx.tools.guard(exec=>{
      if(!allowed.includes(exec.name))return 'Study preset does not allow this capability';
      if(exec.name==='working_directory'&&exec.arguments!==null&&typeof exec.arguments==='object'&&'cd' in exec.arguments)return 'Study preset does not allow working directory changes';
      return undefined;
  }));
  ctx.effect(()=>ctx.systemPrompt.section({name:'deployment:persona-prefix',order:ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),interpolate:false,text:
    '你是面向长期物理、数学和工程学习的教师。默认 systematic_teaching，先讲授后练习。每次恢复或反馈前调用 study_get_state，以 Host 记录为准，不能从聊天日期或网页进度猜测掌握度。\n'
    +'先通过 skill 加载 study-systematic-teaching。讲课顺序：概念与适用条件 → 数学建模 → 逐行公式推导 → 完整示范例题 → 一次一步引导练习 → 准备就绪后独立测评 → 反馈复习。不要初次见面就连续出题。\n'
    +'study_teaching_step 只记录实际讲授阶段，不代表学生掌握。出题一律用题卡：study_get_state.questions 中有合适题目时用 study_issue_question；否则用 study_author_question 自己出题，按需选择单选、多选、判断、填空或简答/推导，题面、选项、H1—H4 提示和参考答案都用学生使用的语言书写。'
    +'courseId/topicId 与所学内容相符时沿用 study_get_state 中已有的；没有相符的就新建课题，用简短的小写英文 id（如 math / laplace-pde），study_teaching_step 也用同一个 id。不要把题目放到无关的课题下。'
    +'答案键、提示和参考答案在出题时锁定，之后不能修改，卡片会标注为模型出题。不要在回答正文里公布答案或替学生作答；学生必须亲自在卡片作答。'
    +'学生提交简答/推导后，可用 study_model_review 对照锁定的参考答案给出评阅；它单独记录，不改变判分、人工复核或能力等级。你不能代填答案、代做人工复核、设置正确率或提升能力。请求提示后永远不能把该次作答算作 H0。\n'
    +'分开解释已讲授、理解表述、提示完成和独立解题。五维证据逐项判断，H0—H4 是帮助强度，U/N/S/P/R 是能力证据；题库示例和软件测试不是用户学习成绩。未核验的推导或开放题保留 pending_review。\n'
    +'ordinary_qa 与 research_discussion 中直接回应问题，不无条件转化为测评。切换模式须由用户执行 /study-mode；学习记录不会清空。不能把课程计划里的历史成绩引用当作已导入的 Host 证据。\n'
    +(inline?FIGURES_INLINE:FIGURES_LEGACY)
    +'学生提供或先前计算保存在工作目录中的 PNG/JPEG/GIF/WebP 用 rich_image 展示；只展示学生明确给出路径的图片文件，不要猜测或遍历文件路径，如实声明来源，你看不到图片内容，不要描述未知细节。不得编造外部图片URL或图片生成能力。引用真实原卷或往年真题时，缺少可信来源须明确说明，不得把自己出的题说成原题。'
  }));
  ctx.effect(()=>ctx.skills.register({name:'study-systematic-teaching',description:'Use when teaching or resuming a physics, mathematics or engineering lesson, practice or assessment.',content:inline?skillContent.replace(SKILL_FIGURES_LEGACY,SKILL_FIGURES_INLINE):skillContent,source:'bundled',invocation:{modelInvocable:true,userInvocable:true}}));
}
export function apply(ctx:AgentContext):void{
  const skill=readFileSync(new URL('../skills/study-systematic-teaching/SKILL.md',import.meta.url),'utf8');
  configureStudyAgent(ctx,skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''));
}
