// core/src/agent/index.ts
import { readFileSync } from "node:fs";
var name = "dsh-study-agent";
var inject = ["tools", "systemPrompt", "skills"];
var allowed = ["rich_render", "rich_physics_demo", "rich_mermaid", "study_get_state", "study_get_plan", "study_issue_question", "study_teaching_step", "skill", "working_directory"];
function configureStudyAgent(ctx, skillContent) {
  ctx.effect(() => ctx.tools.presentAs("native"));
  const denied = ctx.tools.schemas().map((tool) => tool.name).filter((name2) => name2 !== "run_code" && !allowed.includes(name2));
  ctx.effect(() => ctx.tools.restrict({ deny: denied }));
  ctx.effect(() => ctx.tools.guard((exec) => {
    if (!allowed.includes(exec.name)) return "Study preset does not allow this capability";
    if (exec.name === "working_directory" && exec.arguments !== null && typeof exec.arguments === "object" && "cd" in exec.arguments) return "Study preset does not allow working directory changes";
    return void 0;
  }));
  ctx.effect(() => ctx.systemPrompt.section({
    name: "deployment:persona-prefix",
    order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
    interpolate: false,
    text: "\u4F60\u662F\u9762\u5411\u957F\u671F\u7269\u7406\u3001\u6570\u5B66\u548C\u5DE5\u7A0B\u5B66\u4E60\u7684\u6559\u5E08\u3002\u9ED8\u8BA4 systematic_teaching\uFF0C\u5148\u8BB2\u6388\u540E\u7EC3\u4E60\u3002\u6BCF\u6B21\u6062\u590D\u6216\u53CD\u9988\u524D\u8C03\u7528 study_get_state\uFF0C\u4EE5 Host \u8BB0\u5F55\u4E3A\u51C6\uFF0C\u4E0D\u80FD\u4ECE\u804A\u5929\u65E5\u671F\u6216\u7F51\u9875\u8FDB\u5EA6\u731C\u6D4B\u638C\u63E1\u5EA6\u3002\n\u5148\u901A\u8FC7 skill \u52A0\u8F7D study-systematic-teaching\u3002\u8BB2\u8BFE\u987A\u5E8F\uFF1A\u6982\u5FF5\u4E0E\u9002\u7528\u6761\u4EF6 \u2192 \u6570\u5B66\u5EFA\u6A21 \u2192 \u9010\u884C\u516C\u5F0F\u63A8\u5BFC \u2192 \u5B8C\u6574\u793A\u8303\u4F8B\u9898 \u2192 \u4E00\u6B21\u4E00\u6B65\u5F15\u5BFC\u7EC3\u4E60 \u2192 \u51C6\u5907\u5C31\u7EEA\u540E\u72EC\u7ACB\u6D4B\u8BC4 \u2192 \u53CD\u9988\u590D\u4E60\u3002\u4E0D\u8981\u521D\u6B21\u89C1\u9762\u5C31\u8FDE\u7EED\u51FA\u9898\u3002\nstudy_teaching_step \u53EA\u8BB0\u5F55\u5B9E\u9645\u8BB2\u6388\u9636\u6BB5\uFF0C\u4E0D\u4EE3\u8868\u5B66\u751F\u638C\u63E1\u3002\u9898\u5361\u53EA\u80FD\u7528 study_issue_question \u53D1\u653E\u53EF\u4FE1\u9898\u76EE\uFF1B\u5B66\u751F\u5FC5\u987B\u4EB2\u81EA\u5728\u5361\u7247\u4F5C\u7B54\u3002\u4F60\u4E0D\u80FD\u4EE3\u586B\u7B54\u6848\u3001\u4EE3\u505A\u4EBA\u5DE5\u590D\u6838\u3001\u8BBE\u7F6E\u6B63\u786E\u7387\u6216\u63D0\u5347\u80FD\u529B\u3002\u8BF7\u6C42\u63D0\u793A\u540E\u6C38\u8FDC\u4E0D\u80FD\u628A\u8BE5\u6B21\u4F5C\u7B54\u7B97\u4F5C H0\u3002\n\u5206\u5F00\u89E3\u91CA\u5DF2\u8BB2\u6388\u3001\u7406\u89E3\u8868\u8FF0\u3001\u63D0\u793A\u5B8C\u6210\u548C\u72EC\u7ACB\u89E3\u9898\u3002\u4E94\u7EF4\u8BC1\u636E\u9010\u9879\u5224\u65AD\uFF0CH0\u2014H4 \u662F\u5E2E\u52A9\u5F3A\u5EA6\uFF0CU/N/S/P/R \u662F\u80FD\u529B\u8BC1\u636E\uFF1B\u9898\u5E93\u793A\u4F8B\u548C\u8F6F\u4EF6\u6D4B\u8BD5\u4E0D\u662F\u7528\u6237\u5B66\u4E60\u6210\u7EE9\u3002\u672A\u6838\u9A8C\u7684\u63A8\u5BFC\u6216\u5F00\u653E\u9898\u4FDD\u7559 pending_review\u3002\nordinary_qa \u4E0E research_discussion \u4E2D\u76F4\u63A5\u56DE\u5E94\u95EE\u9898\uFF0C\u4E0D\u65E0\u6761\u4EF6\u8F6C\u5316\u4E3A\u6D4B\u8BC4\u3002\u5207\u6362\u6A21\u5F0F\u987B\u7531\u7528\u6237\u6267\u884C /study-mode\uFF1B\u5B66\u4E60\u8BB0\u5F55\u4E0D\u4F1A\u6E05\u7A7A\u3002\u4E0D\u80FD\u628A\u8BFE\u7A0B\u8BA1\u5212\u91CC\u7684\u5386\u53F2\u6210\u7EE9\u5F15\u7528\u5F53\u4F5C\u5DF2\u5BFC\u5165\u7684 Host \u8BC1\u636E\u3002\n\u6570\u5B66\u56FE\u5F62\u7528\u786E\u5B9A\u6027\u6570\u636E\u8C03\u7528 rich_render\uFF0C\u68C0\u67E5\u91CF\u7EB2\u3001\u8FB9\u754C\u6761\u4EF6\u3001\u5F52\u4E00\u5316\u4E0E\u8FD1\u4F3C\uFF1B\u89E3\u9898\u6D41\u7A0B\u6216\u6982\u5FF5\u5173\u7CFB\u56FE\u7528 rich_mermaid \u7684\u53D7\u9650 flowchart \u5B50\u96C6\uFF0CMarkdown \u4E2D\u7684 mermaid \u4EE3\u7801\u5757\u4E0D\u4F1A\u88AB\u6E32\u67D3\u3002\u4E0D\u5F97\u7F16\u9020\u5916\u90E8\u56FE\u7247URL\u6216\u56FE\u7247\u751F\u6210\u80FD\u529B\u3002\u7F3A\u5C11\u53EF\u4FE1\u9898\u5E93/\u539F\u5377\u4FE1\u606F\u65F6\u660E\u786E\u8BF4\u660E\uFF0C\u4EC5\u4F7F\u7528\u6807\u8BC6\u4E3A\u5408\u6210\u7684\u793A\u4F8B\u3002"
  }));
  ctx.effect(() => ctx.skills.register({ name: "study-systematic-teaching", description: "Use when teaching or resuming a physics, mathematics or engineering lesson, practice or assessment.", content: skillContent, source: "bundled", invocation: { modelInvocable: true, userInvocable: true } }));
}
function apply(ctx) {
  const skill = readFileSync(new URL("../skills/study-systematic-teaching/SKILL.md", import.meta.url), "utf8");
  configureStudyAgent(ctx, skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ""));
}
export {
  apply,
  configureStudyAgent,
  inject,
  name
};
