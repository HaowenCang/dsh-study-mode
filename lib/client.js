window.__ModuleLoader__.load({ id: "dsh-study-mode", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name4 in all)
    __defProp(target, name4, { get: all[name4], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports3 = {};
__export(client_exports3, {
  apply: () => apply3,
  name: () => name3
});
module.exports = __toCommonJS(client_exports3);

// core/src/client/index.tsx
var client_exports = {};
__export(client_exports, {
  AttemptView: () => AttemptView,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
var import_react = require("react");

// core/src/client/protocol.ts
var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var bounded = (v, n = 1e4) => typeof v === "string" && v.length > 0 && v.length <= n;
var HELPS = ["H0", "H1", "H2", "H3", "H4"];
var VERDICTS = ["correct", "partially_correct", "incorrect"];
var review = (r) => object(r) && VERDICTS.includes(String(r.verdict)) && bounded(r.comment, 4e3) && bounded(r.at, 64);
function readAttempt(value, sessionId) {
  if (!object(value) || value.sessionId !== sessionId || !bounded(value.attemptId, 200) || !["issued", "graded", "pending_review"].includes(String(value.status)) || !HELPS.includes(String(value.maxHelp)) || typeof value.independent !== "boolean") return;
  const q = value.question;
  if (!object(q) || !bounded(q.id, 200) || !Number.isSafeInteger(q.version) || !bounded(q.prompt) || !["single_choice", "multiple_choice", "numeric", "open", "fill_blank"].includes(String(q.kind))) return;
  if (q.source !== void 0 && q.source !== "model") return;
  if (q.format !== void 0 && (q.format !== "true_false" || q.kind !== "single_choice")) return;
  if (q.kind === "single_choice" || q.kind === "multiple_choice") {
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 64 || q.options.some((o) => !object(o) || !bounded(o.id, 200) || !bounded(o.label, 2e3))) return;
  }
  if (q.kind === "numeric" && !bounded(q.unit, 200)) return;
  if (q.kind === "fill_blank" && (!Array.isArray(q.blanks) || q.blanks.length < 1 || q.blanks.length > 20 || q.blanks.some((b) => !object(b) || b.unit !== void 0 && !bounded(b.unit, 50)))) return;
  if (value.grade !== void 0 && (!object(value.grade) || !bounded(value.grade.outcome, 30) || !bounded(value.grade.basis, 2e3) || value.grade.parts !== void 0 && (!Array.isArray(value.grade.parts) || value.grade.parts.some((p) => typeof p !== "boolean")))) return;
  if (value.hintText !== void 0 && !bounded(value.hintText)) return;
  if (value.hints !== void 0 && (!Array.isArray(value.hints) || value.hints.length > 64 || value.hints.some((h) => !object(h) || !HELPS.includes(String(h.level))))) return;
  if (value.referenceAnswer !== void 0 && !bounded(value.referenceAnswer)) return;
  if (value.modelReviews !== void 0 && (!Array.isArray(value.modelReviews) || value.modelReviews.length > 20 || !value.modelReviews.every(review))) return;
  return value;
}
function readAttemptMeta(meta, sessionId) {
  if (!object(meta) || meta.kind !== "study-attempt" || meta.version !== 1) return;
  return readAttempt(meta.attempt, sessionId);
}
function readModelReviewMeta(meta) {
  if (!object(meta) || meta.kind !== "study-model-review" || meta.version !== 1 || !bounded(meta.attemptId, 200) || !review(meta.review)) return;
  return { attemptId: meta.attemptId, review: meta.review };
}
function nextHintLevel(a) {
  if (a.question.source !== "model") return "H1";
  const highest = Math.max(0, ...(a.hints ?? []).map((h) => HELPS.indexOf(h.level)));
  return HELPS[highest + 1];
}
function displaySubmittedAnswer(a) {
  if (a.question.kind === "fill_blank" && Array.isArray(a.answer)) return a.answer.map((v, i) => {
    const unit2 = a.question.blanks?.[i]?.unit;
    return `\uFF08${i + 1}\uFF09${String(v)}${unit2 ? " " + unit2 : ""}`;
  }).join("\uFF1B");
  if (Array.isArray(a.answer)) return a.answer.map((id) => a.question.options?.find((o) => o.id === id)?.label ?? String(id)).join(", ");
  if (typeof a.answer === "string") return a.answer;
  if (object(a.answer) && typeof a.answer.value === "number" && Number.isFinite(a.answer.value) && typeof a.answer.unit === "string") return String(a.answer.value) + " " + a.answer.unit;
  return "\u5C1A\u65E0\u53EF\u663E\u793A\u7684\u4F5C\u7B54";
}
function commandSummary(outcome, sessionId) {
  if (!outcome) return "\u6B63\u5728\u6838\u9A8C\u5B66\u4E60\u8BB0\u5F55\u2026";
  if (outcome.kind !== "success") return "\u5B66\u4E60\u64CD\u4F5C\u672A\u5B8C\u6210\uFF1A" + (outcome.text ?? "\u8BF7\u91CD\u8BD5").slice(0, 300);
  try {
    const a = readAttempt(JSON.parse(outcome.text ?? "null"), sessionId);
    if (!a) return "\u5B66\u4E60\u8BB0\u5F55\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u9898\u5361\u3002";
    if (a.grade) return "\u4F5C\u7B54\u5DF2\u8BB0\u5F55\uFF1A" + (OUTCOME_LABELS[a.grade.outcome] ?? a.grade.outcome) + "\uFF1B\u5E2E\u52A9\u7B49\u7EA7 " + a.maxHelp + "\u3002";
    if (a.hintText) return "\u5DF2\u8BB0\u5F55 " + a.maxHelp + " \u63D0\u793A\uFF0C\u672C\u6B21\u4F5C\u7B54\u4E0D\u518D\u8BA1\u4E3A\u72EC\u7ACB\u6D4B\u8BC4\u3002";
    return "\u5B66\u4E60\u8BB0\u5F55\u5DF2\u540C\u6B65\u3002";
  } catch {
    return "\u5B66\u4E60\u8BB0\u5F55\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5237\u65B0\u9898\u5361\u3002";
  }
}
var OUTCOME_LABELS = { correct: "\u56DE\u7B54\u6B63\u786E", incorrect: "\u9700\u8981\u7EA0\u6B63", pending_review: "\u5F85\u4EBA\u5DE5\u590D\u6838" };
var VERDICT_LABELS = { correct: "\u6B63\u786E", partially_correct: "\u90E8\u5206\u6B63\u786E", incorrect: "\u9519\u8BEF" };
var BASIS_LABELS = {
  "Exact option set against Host answer key.": "\u6309 Host \u7B54\u6848\u952E\u6BD4\u5BF9\u9009\u9879",
  "Host answer key, exact unit and configured absolute/relative tolerance.": "\u6309 Host \u7B54\u6848\u952E\u6BD4\u5BF9\u6570\u503C\u3001\u5355\u4F4D\u4E0E\u5BB9\u5DEE",
  "Open work requires human review of reasoning and applicability.": "\u5F00\u653E\u9898\u9700\u4EBA\u5DE5\u590D\u6838\u63A8\u7406\u4E0E\u9002\u7528\u6761\u4EF6",
  "Exact option set against the model-authored answer key locked at issue.": "\u6309\u51FA\u9898\u65F6\u9501\u5B9A\u7684\u6A21\u578B\u7B54\u6848\u952E\u6BD4\u5BF9\u9009\u9879",
  "Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.": "\u6309\u51FA\u9898\u65F6\u9501\u5B9A\u7684\u6A21\u578B\u7B54\u6848\u9010\u7A7A\u6BD4\u5BF9"
};
function gradeLabel(grade) {
  return (OUTCOME_LABELS[grade.outcome] ?? grade.outcome) + " \xB7 " + (BASIS_LABELS[grade.basis] ?? grade.basis);
}

// core/src/client/card-view.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var T = {
  text: "var(--dsw-alias-label-primary, #1b1f24)",
  muted: "var(--dsw-alias-label-secondary, #5b6472)",
  faint: "var(--dsw-alias-label-tertiary, #8a929e)",
  border: "var(--dsw-alias-border-l2, #d9dee7)",
  layer: "var(--dsw-alias-bg-layer-1, #f6f7f9)",
  base: "var(--dsw-alias-bg-base, #ffffff)",
  primary: "var(--dsw-alias-button-primary-fill, #1f2328)",
  success: "var(--dsw-alias-state-success-primary, #1a7f37)",
  error: "var(--dsw-alias-state-error-primary, #c62828)",
  radius: "var(--dsw-radius-lg, 12px)",
  radiusMd: "var(--dsw-radius-md, 8px)",
  radiusSm: "var(--dsw-radius-sm, 6px)"
};
var hairline = "0.5px solid " + T.border;
var tag = { fontSize: 11, lineHeight: "18px", padding: "0 8px", borderRadius: 999, background: T.layer, color: T.muted, whiteSpace: "nowrap" };
var button = { font: "inherit", fontSize: 13, padding: "5px 14px", borderRadius: T.radiusSm, border: hairline, background: T.base, color: T.text, cursor: "pointer" };
var primaryButton = { ...button, border: "0.5px solid " + T.primary, background: T.primary, color: "#ffffff" };
var field = { font: "inherit", fontSize: 13, padding: "6px 8px", border: hairline, borderRadius: T.radiusSm, background: T.base, color: T.text, boxSizing: "border-box" };
var panel = { margin: "8px 0 0", padding: "8px 10px", borderRadius: T.radiusMd, background: T.layer, whiteSpace: "pre-wrap", wordBreak: "break-word" };
var caption = { fontSize: 12, color: T.muted, marginBottom: 4 };
var GRADE_COLORS = { correct: T.success, incorrect: T.error };
var VERDICT_COLORS = { correct: T.success, partially_correct: T.muted, incorrect: T.error };
var KIND_LABELS = { single_choice: "\u5355\u9009\u9898", multiple_choice: "\u591A\u9009\u9898", numeric: "\u6570\u503C\u9898", fill_blank: "\u586B\u7A7A\u9898", open: "\u7B80\u7B54 / \u63A8\u5BFC" };
function withBlanks(prompt, blank) {
  return prompt.split(/\{\{(\d+)\}\}/).map((part, i) => i % 2 === 0 ? part : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: blank(Number(part)) }, i));
}
function AttemptView(p) {
  const a = p.attempt, q = a.question, closed = a.status !== "issued", choice = q.kind === "single_choice" || q.kind === "multiple_choice";
  const trueFalse = q.format === "true_false", lettered = q.source === "model" && choice && !trueFalse, hint = nextHintLevel(a);
  const status = p.busy ? "\u6B63\u5728\u6838\u9A8C Host \u8BB0\u5F55\u2026" : p.notice || (a.grade ? "" : "\u7B54\u6848\u7531 Host \u5224\u5206\uFF1B\u5DF2\u8BB2\u6388\u4E0D\u7B49\u4E8E\u5DF2\u638C\u63E1\u3002");
  const prompt = q.kind !== "fill_blank" ? q.prompt : withBlanks(q.prompt, (n) => {
    const unit2 = q.blanks?.[n - 1]?.unit;
    if (closed) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { padding: "0 4px", borderBottom: "1px solid " + T.faint, color: T.muted }, children: [
      "\uFF08",
      n,
      "\uFF09",
      unit2 ? " " + unit2 : ""
    ] });
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 4, margin: "0 2px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u7B2C " + n + " \u7A7A", value: p.blanks[n - 1] ?? "", maxLength: 500, disabled: p.busy, onChange: (e) => p.onBlank(n - 1, e.target.value), style: { ...field, width: 120, padding: "2px 6px" } }),
      unit2 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: T.muted }, children: unit2 }) : null
    ] });
  });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      "data-dsh-study": "attempt",
      "data-study-attempt": a.attemptId,
      "data-study-question": q.id,
      "data-study-status": a.status,
      "data-study-session": p.sessionId,
      style: { border: hairline, borderRadius: T.radius, padding: "14px 16px", margin: "6px 0", background: T.base, color: T.text, font: "inherit", fontSize: 13, lineHeight: 1.6, maxWidth: 760 },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontSize: 12, fontWeight: 600, color: T.muted, marginRight: 4 }, children: "\u5B66\u4E60\u7EC3\u4E60" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: tag, children: trueFalse ? "\u5224\u65AD\u9898" : KIND_LABELS[q.kind] }),
          q.source === "model" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "data-study-source": "model", style: tag, children: "\u6A21\u578B\u51FA\u9898" }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: tag, children: [
            "\u5E2E\u52A9\u7B49\u7EA7\uFF1A",
            a.maxHelp
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: tag, children: a.independent ? "\u72EC\u7ACB\u6D4B\u8BC4" : "\u4E0D\u8BA1\u4E3A\u72EC\u7ACB\u6D4B\u8BC4" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: tag, children: [
            "\u80FD\u529B\u8BC1\u636E\uFF1A",
            a.capability ?? "U"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { margin: "0 0 12px", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: prompt }),
        a.hintText ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-study-hint": true, style: { margin: "0 0 12px", padding: "8px 10px", borderRadius: T.radiusMd, background: T.layer, color: T.text }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: T.muted, marginRight: 6 }, children: [
            "\u63D0\u793A ",
            a.maxHelp
          ] }),
          a.hintText
        ] }) : null,
        closed ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: caption, children: "\u5DF2\u63D0\u4EA4\u7684\u4F5C\u7B54" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { "data-study-submitted-answer": true, style: { ...panel, margin: 0, font: "inherit" }, children: displaySubmittedAnswer(a) }),
          a.grade?.parts ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { "data-study-parts": true, style: { margin: "8px 0 0" }, children: a.grade.parts.map((ok, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { marginRight: 12, color: ok ? T.success : T.error }, children: [
            "\u7B2C ",
            i + 1,
            " \u7A7A ",
            ok ? "\u6B63\u786E" : "\u9519\u8BEF"
          ] }, i)) }) : null,
          a.grade ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { "data-study-grade": a.grade.outcome, style: { margin: "8px 0 0", color: GRADE_COLORS[a.grade.outcome] ?? T.muted }, children: gradeLabel(a.grade) }) : null,
          a.referenceAnswer ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-study-reference": true, style: { marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: caption, children: "\u53C2\u8003\u7B54\u6848\uFF08\u51FA\u9898\u65F6\u9501\u5B9A\uFF09" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...panel, margin: 0 }, children: a.referenceAnswer })
          ] }) : null,
          a.modelReviews?.map((r, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { "data-study-model-review": r.verdict, style: { marginTop: 10 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: caption, children: [
              "\u6A21\u578B\u8BC4\u9605\uFF08\u4E0D\u8BA1\u5165\u5224\u5206\uFF09\uFF1A",
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: VERDICT_COLORS[r.verdict] ?? T.muted }, children: VERDICT_LABELS[r.verdict] ?? r.verdict })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { ...panel, margin: 0 }, children: r.comment })
          ] }, i))
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { disabled: p.busy, style: { border: 0, padding: 0, margin: 0, minWidth: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { style: { fontSize: 12, color: T.muted, padding: 0, marginBottom: 6 }, children: q.kind === "fill_blank" ? "\u5728\u9898\u5E72\u7684\u7A7A\u683C\u4E2D\u4F5C\u7B54" : "\u4F60\u7684\u4F5C\u7B54" }),
          choice ? q.options?.map((option, i) => {
            const checked = p.selected.includes(option.id);
            return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", marginBottom: 6, border: checked ? "0.5px solid " + T.primary : hairline, borderRadius: T.radiusMd, background: checked ? T.layer : T.base, cursor: "pointer" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: q.kind === "single_choice" ? "radio" : "checkbox", name: a.attemptId, value: option.id, checked, onChange: () => p.onSelect(option.id), style: { margin: "4px 0 0", accentColor: T.primary } }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { wordBreak: "break-word" }, children: [
                lettered ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: T.muted, marginRight: 6 }, children: [
                  String.fromCharCode(65 + i),
                  "."
                ] }) : null,
                option.label
              ] })
            ] }, option.id);
          }) : null,
          q.kind === "numeric" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: T.muted }, children: [
              "\u6570\u503C\uFF08",
              q.unit,
              "\uFF09"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { "aria-label": "\u6570\u503C\u7B54\u6848", type: "number", step: "any", value: p.answer, onChange: (e) => p.onAnswer(e.target.value), style: { ...field, width: 180 } })
          ] }) : null,
          q.kind === "open" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { style: { display: "block" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { display: "block", color: T.muted, marginBottom: 4 }, children: q.source === "model" ? "\u4F5C\u7B54" : "\u63A8\u5BFC\u4E0E\u6761\u4EF6" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { "aria-label": "\u5F00\u653E\u9898\u4F5C\u7B54", value: p.answer, maxLength: 1e4, onChange: (e) => p.onAnswer(e.target.value), style: { ...field, width: "100%", minHeight: 120, resize: "vertical" } })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: primaryButton, onClick: p.onSubmit, children: "\u63D0\u4EA4\u4F5C\u7B54" }),
            hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", style: button, onClick: () => p.onHint(hint), children: [
              "\u8BF7\u6C42\u63D0\u793A ",
              hint
            ] }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 12 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", "aria-live": "polite", style: { margin: 0, flex: 1, minWidth: 0, fontSize: 12, color: T.muted }, children: status }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: p.busy, onClick: p.onRefresh, style: { ...button, fontSize: 12, padding: "2px 8px", border: 0, background: "transparent", color: T.faint }, children: "\u5237\u65B0\u5B66\u4E60\u8BB0\u5F55" })
        ] })
      ]
    }
  );
}

// core/src/client/continue.ts
async function continueTeaching(remote, sessionId, attemptId, requestId) {
  return remote.prompt({ requestId, sessionId, mode: "queue", content: [{ type: "text", text: `\u6211\u5DF2\u63D0\u4EA4\u9898\u5361\u4F5C\u7B54\uFF08\u7F16\u53F7 ${attemptId.slice(0, 8)}\uFF09\u3002\u8BF7\u5148\u8C03\u7528 study_get_state \u6838\u5BF9 Host \u5224\u5206\u4E0E\u63D0\u793A\u8BB0\u5F55\uFF0C\u518D\u7EE7\u7EED\u8BB2\u89E3\uFF1B\u4E0D\u5F97\u81EA\u884C\u6539\u5199\u80FD\u529B\u7B49\u7EA7\u3002` }] });
}

// core/src/client/attempt-command.ts
async function runAttemptCommand(remote, sessionId, attemptId, payload, feedbackId) {
  const response = await remote.commands.execute(sessionId, "/study-attempt " + JSON.stringify(payload), []);
  if (!response.ok || response.value?.result.kind !== "success") throw new Error(response.value?.result.text ?? response.error?.message ?? "Host command failed");
  const value = readAttempt(JSON.parse(response.value.result.text ?? "null"), sessionId);
  if (!value || value.attemptId !== attemptId) throw new Error("Invalid Host learning state");
  if (payload.operation !== "submit" || feedbackId === void 0) return { value };
  return { value, feedback: continueTeaching(remote.session, sessionId, value.attemptId, feedbackId).then((result) => ({ ok: result.ok }), () => ({ ok: false })) };
}

// core/src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var name = "dsh-study-core";
var inject = ["slots", "remote", "remote.commands", "remote.session"];
function apply(ctx) {
  function StudyCard(props) {
    const initial = readAttemptMeta(props.block.meta, props.sessionId);
    const [attempt, setAttempt] = (0, import_react.useState)(initial), [selected, setSelected] = (0, import_react.useState)([]), [answer, setAnswer] = (0, import_react.useState)(""), [notice, setNotice] = (0, import_react.useState)(""), [busy, setBusy] = (0, import_react.useState)(false);
    const [blankValues, setBlanks] = (0, import_react.useState)([]);
    const alive = (0, import_react.useRef)(true), sequence = (0, import_react.useRef)(0), requests = (0, import_react.useRef)(/* @__PURE__ */ new Map());
    async function command(operation, extra = {}) {
      if (!initial) return;
      const current = ++sequence.current;
      setBusy(true);
      const signature = JSON.stringify({ operation, ...extra });
      let requestId = requests.current.get(signature);
      if (!requestId) {
        requestId = crypto.randomUUID();
        requests.current.set(signature, requestId);
      }
      const payload = operation === "read" ? { operation, attemptId: initial.attemptId } : { operation, attemptId: initial.attemptId, requestId, ...extra };
      const feedbackKey = signature + ":feedback";
      let feedbackId = operation === "submit" ? requests.current.get(feedbackKey) : void 0;
      if (operation === "submit" && !feedbackId) {
        feedbackId = crypto.randomUUID();
        requests.current.set(feedbackKey, feedbackId);
      }
      try {
        const { value, feedback } = await runAttemptCommand(ctx.remote, props.sessionId, initial.attemptId, payload, feedbackId);
        if (!alive.current || sequence.current !== current) return;
        setAttempt(value);
        setNotice("");
        if (feedback && !(await feedback).ok && alive.current && sequence.current === current) setNotice("\u4F5C\u7B54\u5DF2\u4FDD\u5B58\uFF0C\u6559\u5B66\u53CD\u9988\u5C1A\u672A\u6392\u961F\uFF1B\u8BF7\u5728\u5F53\u524D\u4F1A\u8BDD\u7EE7\u7EED\u3002");
      } catch (error) {
        if (alive.current && sequence.current === current) setNotice(error instanceof Error ? error.message : "\u5B66\u4E60\u64CD\u4F5C\u672A\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002");
      } finally {
        if (alive.current && sequence.current === current) setBusy(false);
      }
    }
    (0, import_react.useEffect)(() => {
      alive.current = true;
      setAttempt(initial);
      void command("read");
      return () => {
        alive.current = false;
        sequence.current++;
      };
    }, [props.sessionId, props.callId, initial?.attemptId]);
    if (props.phase !== "result") return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: "6px 0", fontSize: 12, color: "var(--dsw-alias-label-secondary, #5b6472)" }, children: "\u6B63\u5728\u51C6\u5907\u5B66\u4E60\u9898\u5361\u2026" });
    if (props.block.isError || !initial || !attempt) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", style: { margin: "6px 0", fontSize: 12, color: "var(--dsw-alias-state-error-primary, #c62828)" }, children: "\u5B66\u4E60\u9898\u5361\u4E0D\u53EF\u7528\uFF0C\u8BF7\u8BFB\u53D6 Host \u5B66\u4E60\u72B6\u6001\u540E\u91CD\u8BD5\u3002" });
    const a = attempt, blanks = (a.question.blanks ?? []).map((_, i) => blankValues[i] ?? "");
    function submit() {
      const value = a.question.kind === "numeric" ? { value: Number(answer), unit: a.question.unit } : a.question.kind === "open" ? answer : a.question.kind === "fill_blank" ? blanks.map((v) => v.trim()) : selected;
      if (a.question.kind === "numeric" && (!answer.trim() || !Number.isFinite(Number(answer)))) {
        setNotice("\u8BF7\u8F93\u5165\u6709\u9650\u6570\u503C\u3002");
        return;
      }
      if (a.question.kind === "fill_blank" && blanks.some((v) => !v.trim())) {
        setNotice("\u8BF7\u586B\u5199\u6BCF\u4E2A\u7A7A\u3002");
        return;
      }
      void command("submit", { answer: value });
    }
    function select(id) {
      setSelected(a.question.kind === "single_choice" ? [id] : selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
    }
    function blank(index, value) {
      setBlanks(blanks.map((v, i) => i === index ? value : v));
    }
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      AttemptView,
      {
        sessionId: props.sessionId,
        attempt: a,
        busy,
        notice,
        selected,
        answer,
        blanks,
        onSelect: select,
        onAnswer: setAnswer,
        onBlank: blank,
        onHint: (level) => void command("hint", { level }),
        onSubmit: submit,
        onRefresh: () => void command("read")
      }
    );
  }
  for (const key of ["study_issue_question", "study_author_question"]) ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key }, StudyCard));
  function ModelReviewRow(props) {
    const recorded = props.phase === "result" && !props.block.isError ? readModelReviewMeta(props.block.meta) : void 0;
    if (!recorded) return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { style: { margin: "2px 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #8a929e)" }, children: props.phase === "result" ? "\u6A21\u578B\u8BC4\u9605\u672A\u8BB0\u5F55\u3002" : "\u6B63\u5728\u8BB0\u5F55\u6A21\u578B\u8BC4\u9605\u2026" });
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { "data-study-model-review": recorded.review.verdict, style: { margin: "6px 0", padding: "8px 10px", borderRadius: "var(--dsw-radius-md, 8px)", background: "var(--dsw-alias-bg-layer-1, #f6f7f9)", fontSize: 13, lineHeight: 1.6, maxWidth: 760, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #5b6472)", marginBottom: 4 }, children: [
        "\u6A21\u578B\u8BC4\u9605\uFF08\u4E0D\u8BA1\u5165\u5224\u5206\uFF0C\u4E0D\u6539\u53D8\u4EBA\u5DE5\u590D\u6838\u6216\u80FD\u529B\u7B49\u7EA7\uFF09\uFF1A",
        VERDICT_LABELS[recorded.review.verdict] ?? recorded.review.verdict
      ] }),
      recorded.review.comment
    ] });
  }
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key: "study_model_review" }, ModelReviewRow));
  function StudyCommand(props) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { "data-study-command": true, style: { margin: "2px 0", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #8a929e)" }, children: commandSummary(props.node.outcome, props.sessionId) });
  }
  for (const key of ["study-attempt", "study-review"]) ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({ name: "conversation.chat.commandview", key }, StudyCommand));
}

// rich/src/client/index.ts
var client_exports2 = {};
__export(client_exports2, {
  apply: () => apply2,
  inject: () => inject2,
  name: () => name2
});

// rich/src/client/toolview.tsx
var import_react6 = require("react");

// rich/src/shared/protocol.ts
var RICH_CONTENT_SCHEMA_VERSION = 1;
var RICH_META_KIND = "rich-response";
var RICH_META_ENVELOPE_VERSION = 1;
var RICH_INTERACTION_PROTOCOL = "rich-interaction-v1";
var RICH_LIMITS = {
  /** Maximum serialized payload size of the whole content object (UTF-8 bytes). */
  maxSerializedBytes: 256 * 1024,
  maxTitleLength: 200,
  maxSubtitleLength: 500,
  maxSeries: 8,
  maxPointsPerSeries: 2048,
  maxTotalPoints: 8192,
  maxAxisLabelLength: 80,
  maxDiagramNodes: 60,
  maxDiagramEdges: 120,
  maxNodeIdLength: 64,
  maxNodeLabelLength: 120,
  maxEdgeLabelLength: 80,
  maxCardBodyLength: 4e3,
  maxCardActions: 5,
  maxActionIdLength: 64,
  maxActionLabelLength: 120,
  maxSubmitTextLength: 2e3,
  maxQuestionIdLength: 64,
  /** Largest absolute coordinate accepted from the model. */
  maxAbsCoordinate: 1e7
};

// rich/src/shared/validation.ts
var CONTENT_TYPES = ["line_plot", "scatter_plot", "basic_diagram", "message_card"];
var NODE_SHAPES = ["box", "rounded", "diamond", "circle"];
var NODE_TONES = ["default", "accent", "muted"];
var HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
var SAFE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
function issue(code, path, detail) {
  return { code, path, detail };
}
function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
function boundedString(value, path, maxLength, code, required) {
  if (value === void 0 || value === null) {
    if (!required) return { ok: true, value: void 0 };
    return { ok: false, issue: issue(code, path, "is required") };
  }
  if (typeof value !== "string") return { ok: false, issue: issue(code, path, "must be a string") };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, issue: issue(code, path, "must not be empty") };
  if (trimmed.length > maxLength) {
    return { ok: false, issue: issue(code, path, `must be at most ${String(maxLength)} characters`) };
  }
  return { ok: true, value: trimmed };
}
function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)) {
    return {
      ok: false,
      issue: issue("NON_FINITE_NUMBER", path, "must be a finite, canonical JSON number (NaN, +/-Infinity and -0 are rejected)")
    };
  }
  return { ok: true, value };
}
function boundedCoordinate(value, path) {
  const read = finiteNumber(value, path);
  if (!read.ok) return read;
  if (Math.abs(read.value) > RICH_LIMITS.maxAbsCoordinate) {
    return {
      ok: false,
      issue: issue("COORDINATE_OUT_OF_RANGE", path, `must satisfy |value| <= ${String(RICH_LIMITS.maxAbsCoordinate)}`)
    };
  }
  return read;
}
function serializedByteSize(value) {
  let text3;
  try {
    text3 = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof text3 !== "string") return Number.POSITIVE_INFINITY;
  if (typeof TextEncoder === "undefined") return text3.length;
  return new TextEncoder().encode(text3).length;
}
function readSchemaVersion(value) {
  if (!isRecord(value)) return void 0;
  const raw = value["schemaVersion"];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : void 0;
}
function validateAxis(raw, path, issues) {
  if (raw === void 0 || raw === null) return void 0;
  if (!isRecord(raw)) {
    issues.push(issue("INVALID_AXIS", path, "must be an object"));
    return void 0;
  }
  const axis = {};
  const label = boundedString(raw["label"], `${path}.label`, RICH_LIMITS.maxAxisLabelLength, "INVALID_AXIS", false);
  if (!label.ok) issues.push(label.issue);
  else if (label.value !== void 0) axis.label = label.value;
  const unit2 = boundedString(raw["unit"], `${path}.unit`, RICH_LIMITS.maxAxisLabelLength, "INVALID_AXIS", false);
  if (!unit2.ok) issues.push(unit2.issue);
  else if (unit2.value !== void 0) axis.unit = unit2.value;
  for (const key of ["min", "max"]) {
    if (raw[key] === void 0) continue;
    const read = finiteNumber(raw[key], `${path}.${key}`);
    if (!read.ok) issues.push(read.issue);
    else axis[key] = read.value;
  }
  if (axis.min !== void 0 && axis.max !== void 0 && axis.min >= axis.max) {
    issues.push(issue("INVALID_AXIS_RANGE", path, "min must be strictly below max"));
  }
  return axis;
}
function validateSeriesList(raw, path, issues) {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(issue("INVALID_SERIES", path, "must be a non-empty array of series"));
    return [];
  }
  if (raw.length > RICH_LIMITS.maxSeries) {
    issues.push(issue("TOO_MANY_SERIES", path, `at most ${String(RICH_LIMITS.maxSeries)} series are allowed`));
    return [];
  }
  const series = [];
  let total = 0;
  raw.forEach((candidate, seriesIndex) => {
    const at = `${path}[${String(seriesIndex)}]`;
    if (!isRecord(candidate)) {
      issues.push(issue("INVALID_SERIES", at, "must be an object"));
      return;
    }
    const name4 = boundedString(candidate["name"], `${at}.name`, RICH_LIMITS.maxAxisLabelLength, "INVALID_SERIES", true);
    if (!name4.ok) {
      issues.push(name4.issue);
      return;
    }
    let color;
    if (candidate["color"] !== void 0) {
      if (typeof candidate["color"] !== "string" || !HEX_COLOR.test(candidate["color"])) {
        issues.push(issue("INVALID_COLOR", `${at}.color`, "must be a #rgb or #rrggbb literal"));
      } else color = candidate["color"];
    }
    const rawPoints = candidate["points"];
    if (!Array.isArray(rawPoints)) {
      issues.push(issue("INVALID_POINT", `${at}.points`, "must be an array"));
      return;
    }
    if (rawPoints.length > RICH_LIMITS.maxPointsPerSeries) {
      issues.push(issue(
        "TOO_MANY_POINTS",
        `${at}.points`,
        `at most ${String(RICH_LIMITS.maxPointsPerSeries)} points per series are allowed`
      ));
      return;
    }
    total += rawPoints.length;
    const points = [];
    for (let pointIndex = 0; pointIndex < rawPoints.length; pointIndex += 1) {
      const pointPath = `${at}.points[${String(pointIndex)}]`;
      const point = rawPoints[pointIndex];
      if (!isRecord(point)) {
        issues.push(issue("INVALID_POINT", pointPath, "must be an object with finite x and y"));
        continue;
      }
      const x = boundedCoordinate(point["x"], `${pointPath}.x`);
      const y = boundedCoordinate(point["y"], `${pointPath}.y`);
      if (x.ok && y.ok) points.push({ x: x.value, y: y.value });
      else {
        if (!x.ok) issues.push(x.issue);
        if (!y.ok) issues.push(y.issue);
      }
    }
    series.push(color === void 0 ? { name: name4.value, points } : { name: name4.value, points, color });
  });
  if (total > RICH_LIMITS.maxTotalPoints) {
    issues.push(issue(
      "TOO_MANY_TOTAL_POINTS",
      path,
      `at most ${String(RICH_LIMITS.maxTotalPoints)} points across all series are allowed`
    ));
  }
  return series;
}
function validateDiagram(raw, issues) {
  const empty = { nodes: [], edges: [] };
  if (!isRecord(raw)) {
    issues.push(issue("INVALID_NODE", "data", "must be an object with nodes and edges"));
    return empty;
  }
  const rawNodes = raw["nodes"];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    issues.push(issue("INVALID_NODE", "data.nodes", "must be a non-empty array"));
    return empty;
  }
  if (rawNodes.length > RICH_LIMITS.maxDiagramNodes) {
    issues.push(issue("TOO_MANY_NODES", "data.nodes", `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`));
    return empty;
  }
  const nodes = [];
  const ids = /* @__PURE__ */ new Set();
  rawNodes.forEach((candidate, index) => {
    const at = `data.nodes[${String(index)}]`;
    if (!isRecord(candidate)) {
      issues.push(issue("INVALID_NODE", at, "must be an object"));
      return;
    }
    const id = boundedString(candidate["id"], `${at}.id`, RICH_LIMITS.maxNodeIdLength, "INVALID_NODE", true);
    if (!id.ok) {
      issues.push(id.issue);
      return;
    }
    if (!SAFE_ID.test(id.value)) {
      issues.push(issue("INVALID_NODE", `${at}.id`, "must match [A-Za-z0-9._:-]{1,64}"));
      return;
    }
    if (ids.has(id.value)) {
      issues.push(issue("DUPLICATE_NODE_ID", `${at}.id`, "node ids must be unique"));
      return;
    }
    const label = boundedString(candidate["label"], `${at}.label`, RICH_LIMITS.maxNodeLabelLength, "INVALID_NODE", true);
    if (!label.ok) {
      issues.push(label.issue);
      return;
    }
    const x = finiteNumber(candidate["x"], `${at}.x`);
    const y = finiteNumber(candidate["y"], `${at}.y`);
    if (!x.ok || !y.ok) {
      if (!x.ok) issues.push(x.issue);
      if (!y.ok) issues.push(y.issue);
      return;
    }
    if (!Number.isInteger(x.value) || x.value < 0 || x.value > 1e3 || !Number.isInteger(y.value) || y.value < 0 || y.value > 1e3) {
      issues.push(issue("INVALID_NODE", at, "x and y must be integers in [0, 1000]"));
      return;
    }
    const node = { id: id.value, label: label.value, x: x.value, y: y.value };
    if (candidate["shape"] !== void 0) {
      if (typeof candidate["shape"] !== "string" || !NODE_SHAPES.includes(candidate["shape"])) {
        issues.push(issue("INVALID_SHAPE", `${at}.shape`, "must be one of box, rounded, diamond, circle"));
      } else node.shape = candidate["shape"];
    }
    if (candidate["tone"] !== void 0) {
      if (typeof candidate["tone"] !== "string" || !NODE_TONES.includes(candidate["tone"])) {
        issues.push(issue("INVALID_SHAPE", `${at}.tone`, "must be one of default, accent, muted"));
      } else node.tone = candidate["tone"];
    }
    ids.add(id.value);
    nodes.push(node);
  });
  const rawEdges = raw["edges"] === void 0 ? [] : raw["edges"];
  if (!Array.isArray(rawEdges)) {
    issues.push(issue("INVALID_EDGE", "data.edges", "must be an array"));
    return { nodes, edges: [] };
  }
  if (rawEdges.length > RICH_LIMITS.maxDiagramEdges) {
    issues.push(issue("TOO_MANY_EDGES", "data.edges", `at most ${String(RICH_LIMITS.maxDiagramEdges)} edges are allowed`));
    return { nodes, edges: [] };
  }
  const edges = [];
  rawEdges.forEach((candidate, index) => {
    const at = `data.edges[${String(index)}]`;
    if (!isRecord(candidate)) {
      issues.push(issue("INVALID_EDGE", at, "must be an object"));
      return;
    }
    const from = boundedString(candidate["from"], `${at}.from`, RICH_LIMITS.maxNodeIdLength, "INVALID_EDGE", true);
    const to = boundedString(candidate["to"], `${at}.to`, RICH_LIMITS.maxNodeIdLength, "INVALID_EDGE", true);
    if (!from.ok) {
      issues.push(from.issue);
      return;
    }
    if (!to.ok) {
      issues.push(to.issue);
      return;
    }
    if (!ids.has(from.value) || !ids.has(to.value)) {
      issues.push(issue("UNKNOWN_EDGE_REF", at, "from and to must name declared nodes"));
      return;
    }
    if (from.value === to.value) {
      issues.push(issue("INVALID_EDGE", at, "self edges are not supported"));
      return;
    }
    const edge = { from: from.value, to: to.value };
    if (candidate["label"] !== void 0) {
      const label = boundedString(candidate["label"], `${at}.label`, RICH_LIMITS.maxEdgeLabelLength, "INVALID_EDGE", false);
      if (!label.ok) issues.push(label.issue);
      else if (label.value !== void 0) edge.label = label.value;
    }
    if (candidate["dashed"] !== void 0) {
      if (typeof candidate["dashed"] !== "boolean") issues.push(issue("INVALID_EDGE", `${at}.dashed`, "must be a boolean"));
      else edge.dashed = candidate["dashed"];
    }
    edges.push(edge);
  });
  return { nodes, edges };
}
function preScanCardinality(type, value) {
  if (type === "line_plot" || type === "scatter_plot") {
    const data = value["data"];
    if (!isRecord(data)) return void 0;
    const rawSeries = data["series"];
    if (!Array.isArray(rawSeries)) return void 0;
    if (rawSeries.length > RICH_LIMITS.maxSeries) {
      return issue("TOO_MANY_SERIES", "data.series", `at most ${String(RICH_LIMITS.maxSeries)} series are allowed`);
    }
    let total = 0;
    for (let index = 0; index < rawSeries.length; index += 1) {
      const candidate = rawSeries[index];
      if (!isRecord(candidate)) continue;
      const points = candidate["points"];
      if (!Array.isArray(points)) continue;
      if (points.length > RICH_LIMITS.maxPointsPerSeries) {
        return issue(
          "TOO_MANY_POINTS",
          `data.series[${String(index)}].points`,
          `at most ${String(RICH_LIMITS.maxPointsPerSeries)} points per series are allowed`
        );
      }
      total += points.length;
    }
    if (total > RICH_LIMITS.maxTotalPoints) {
      return issue(
        "TOO_MANY_TOTAL_POINTS",
        "data.series",
        `at most ${String(RICH_LIMITS.maxTotalPoints)} points across all series are allowed`
      );
    }
    return void 0;
  }
  if (type === "basic_diagram") {
    const data = value["data"];
    if (!isRecord(data)) return void 0;
    const nodes = data["nodes"];
    if (Array.isArray(nodes) && nodes.length > RICH_LIMITS.maxDiagramNodes) {
      return issue("TOO_MANY_NODES", "data.nodes", `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`);
    }
    const edges = data["edges"];
    if (Array.isArray(edges) && edges.length > RICH_LIMITS.maxDiagramEdges) {
      return issue("TOO_MANY_EDGES", "data.edges", `at most ${String(RICH_LIMITS.maxDiagramEdges)} edges are allowed`);
    }
    return void 0;
  }
  const actions = value["actions"];
  if (Array.isArray(actions) && actions.length > RICH_LIMITS.maxCardActions) {
    return issue("TOO_MANY_ACTIONS", "actions", `at most ${String(RICH_LIMITS.maxCardActions)} actions are allowed`);
  }
  return void 0;
}
function validateRichContentUnsafe(value) {
  const issues = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [issue("NOT_AN_OBJECT", "", "payload must be a JSON object")] };
  }
  if (readSchemaVersion(value) !== RICH_CONTENT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [issue("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", `only schemaVersion ${String(RICH_CONTENT_SCHEMA_VERSION)} is supported`)]
    };
  }
  const type = value["type"];
  if (typeof type !== "string" || !CONTENT_TYPES.includes(type)) {
    return { ok: false, issues: [issue("UNKNOWN_TYPE", "type", "unsupported content type")] };
  }
  const oversized = preScanCardinality(type, value);
  if (oversized !== void 0) return { ok: false, issues: [oversized] };
  const size = serializedByteSize(value);
  if (size > RICH_LIMITS.maxSerializedBytes) {
    return {
      ok: false,
      issues: [issue(
        "PAYLOAD_TOO_LARGE",
        "",
        `serialized payload is ${String(size)} bytes (limit ${String(RICH_LIMITS.maxSerializedBytes)})`
      )]
    };
  }
  const title = boundedString(value["title"], "title", RICH_LIMITS.maxTitleLength, "INVALID_TITLE", true);
  if (!title.ok) return { ok: false, issues: [title.issue] };
  const subtitle = boundedString(value["subtitle"], "subtitle", RICH_LIMITS.maxSubtitleLength, "INVALID_SUBTITLE", false);
  if (!subtitle.ok) issues.push(subtitle.issue);
  const subtitleValue = subtitle.ok ? subtitle.value : void 0;
  if (type === "line_plot" || type === "scatter_plot") {
    const data = value["data"];
    if (!isRecord(data)) {
      issues.push(issue("INVALID_SERIES", "data", "must be an object with a series array"));
      return { ok: false, issues };
    }
    const series = validateSeriesList(data["series"], "data.series", issues);
    const xAxis = validateAxis(data["xAxis"], "data.xAxis", issues);
    const yAxis = validateAxis(data["yAxis"], "data.yAxis", issues);
    if (issues.length > 0) return { ok: false, issues };
    const value_ = {
      schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
      type,
      title: title.value,
      ...subtitleValue === void 0 ? {} : { subtitle: subtitleValue },
      data: {
        series,
        ...xAxis === void 0 ? {} : { xAxis },
        ...yAxis === void 0 ? {} : { yAxis }
      }
    };
    return { ok: true, value: value_ };
  }
  if (type === "basic_diagram") {
    const { nodes, edges } = validateDiagram(value["data"], issues);
    if (issues.length > 0) return { ok: false, issues };
    const value_ = {
      schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
      type: "basic_diagram",
      title: title.value,
      ...subtitleValue === void 0 ? {} : { subtitle: subtitleValue },
      data: { nodes, edges }
    };
    return { ok: true, value: value_ };
  }
  const body = boundedString(value["body"], "body", RICH_LIMITS.maxCardBodyLength, "INVALID_BODY", true);
  if (!body.ok) issues.push(body.issue);
  const bodyText = body.ok ? body.value : "";
  let questionId;
  if (value["questionId"] !== void 0) {
    if (typeof value["questionId"] !== "string" || !SAFE_ID.test(value["questionId"])) {
      issues.push(issue("INVALID_QUESTION_ID", "questionId", "must match [A-Za-z0-9._:-]{1,64}"));
    } else questionId = value["questionId"];
  }
  const actions = [];
  if (value["actions"] !== void 0) {
    const rawActions = value["actions"];
    if (!Array.isArray(rawActions) || rawActions.length === 0) {
      issues.push(issue("INVALID_ACTION", "actions", "must be a non-empty array when present"));
    } else if (rawActions.length > RICH_LIMITS.maxCardActions) {
      issues.push(issue("TOO_MANY_ACTIONS", "actions", `at most ${String(RICH_LIMITS.maxCardActions)} actions are allowed`));
    } else {
      const ids = /* @__PURE__ */ new Set();
      rawActions.forEach((candidate, index) => {
        const at = `actions[${String(index)}]`;
        if (!isRecord(candidate)) {
          issues.push(issue("INVALID_ACTION", at, "must be an object"));
          return;
        }
        if (typeof candidate["id"] !== "string" || !SAFE_ID.test(candidate["id"])) {
          issues.push(issue("INVALID_ACTION", `${at}.id`, "must match [A-Za-z0-9._:-]{1,64}"));
          return;
        }
        if (ids.has(candidate["id"])) {
          issues.push(issue("INVALID_ACTION", `${at}.id`, "action ids must be unique"));
          return;
        }
        const label = boundedString(candidate["label"], `${at}.label`, RICH_LIMITS.maxActionLabelLength, "INVALID_ACTION", true);
        if (!label.ok) {
          issues.push(label.issue);
          return;
        }
        const submitText = boundedString(candidate["submitText"], `${at}.submitText`, RICH_LIMITS.maxSubmitTextLength, "INVALID_ACTION", true);
        if (!submitText.ok) {
          issues.push(submitText.issue);
          return;
        }
        ids.add(candidate["id"]);
        actions.push({ id: candidate["id"], label: label.value, submitText: submitText.value });
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  const card = {
    schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
    type: "message_card",
    title: title.value,
    ...subtitleValue === void 0 ? {} : { subtitle: subtitleValue },
    ...questionId === void 0 ? {} : { questionId },
    body: bodyText,
    ...actions.length === 0 ? {} : { actions }
  };
  return { ok: true, value: card };
}
function validateRichContent(value) {
  try {
    return validateRichContentUnsafe(value);
  } catch {
    return { ok: false, issues: [issue("NOT_AN_OBJECT", "", "payload could not be read as a JSON object")] };
  }
}
function readRichMeta(value) {
  try {
    if (!isRecord(value)) return void 0;
    if (value["kind"] !== RICH_META_KIND) return void 0;
    if (value["envelopeVersion"] !== RICH_META_ENVELOPE_VERSION) return void 0;
    const result = validateRichContent(value["content"]);
    if (!result.ok) return void 0;
    return { kind: RICH_META_KIND, envelopeVersion: RICH_META_ENVELOPE_VERSION, content: result.value };
  } catch {
    return void 0;
  }
}
function formatValidationIssues(issues) {
  const head = issues.slice(0, 8).map((item) => `${item.code}@${item.path || "<root>"}: ${item.detail}`);
  const suffix = issues.length > head.length ? ` (+${String(issues.length - head.length)} more)` : "";
  return head.join("; ") + suffix;
}

// rich/src/shared/interaction.ts
var MAX_INTERACTION_SKEW_MS = 10 * 60 * 1e3;
var MAX_INTERACTION_RAW_INPUT = 8 * 1024;
var SAFE_ID2 = /^[A-Za-z0-9._:-]{1,64}$/;
var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function text(value, field2, maxLength, issues) {
  if (typeof value !== "string") {
    issues.push({ field: field2, detail: "must be a string" });
    return void 0;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ field: field2, detail: "must not be empty" });
    return void 0;
  }
  if (trimmed.length > maxLength) {
    issues.push({ field: field2, detail: `must be at most ${String(maxLength)} characters` });
    return void 0;
  }
  return trimmed;
}
function readInteractionPayload(value) {
  const issues = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ field: "", detail: "payload must be a JSON object" }] };
  }
  const record = value;
  if (record["protocol"] !== RICH_INTERACTION_PROTOCOL) {
    issues.push({ field: "protocol", detail: `must be "${RICH_INTERACTION_PROTOCOL}"` });
  }
  if (record["protocolVersion"] !== 1) {
    issues.push({ field: "protocolVersion", detail: "must be 1" });
  }
  const sessionId = text(record["sessionId"], "sessionId", RICH_LIMITS.maxNodeIdLength + 64, issues);
  const callId = text(record["callId"], "callId", RICH_LIMITS.maxNodeIdLength + 64, issues);
  const cardKey = text(record["cardKey"], "cardKey", 200, issues);
  const actionId = text(record["actionId"], "actionId", RICH_LIMITS.maxActionIdLength, issues);
  if (actionId !== void 0 && !SAFE_ID2.test(actionId)) {
    issues.push({ field: "actionId", detail: "must match [A-Za-z0-9._:-]{1,64}" });
  }
  const attemptId = text(record["attemptId"], "attemptId", 128, issues);
  const submittedAt = text(record["submittedAt"], "submittedAt", 64, issues);
  let questionId;
  if (record["questionId"] !== void 0) {
    if (typeof record["questionId"] !== "string" || !SAFE_ID2.test(record["questionId"])) {
      issues.push({ field: "questionId", detail: "must match [A-Za-z0-9._:-]{1,64}" });
    } else questionId = record["questionId"];
  }
  let answer;
  if (record["answer"] !== void 0) {
    answer = text(record["answer"], "answer", RICH_LIMITS.maxSubmitTextLength, issues);
  }
  if (submittedAt !== void 0 && (!ISO_INSTANT.test(submittedAt) || Number.isNaN(Date.parse(submittedAt)))) {
    issues.push({ field: "submittedAt", detail: "must be an ISO-8601 UTC instant (for example 2026-01-01T00:00:00.000Z)" });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      protocol: RICH_INTERACTION_PROTOCOL,
      protocolVersion: 1,
      sessionId,
      callId,
      cardKey,
      ...questionId === void 0 ? {} : { questionId },
      actionId,
      attemptId,
      submittedAt,
      ...answer === void 0 ? {} : { answer }
    }
  };
}
function validateInteractionPayload(value) {
  try {
    return readInteractionPayload(value);
  } catch {
    return { ok: false, issues: [{ field: "", detail: "payload could not be read as a JSON object" }] };
  }
}
function cardKeyFor(callId, questionId) {
  return questionId === void 0 ? callId : `${callId}#${questionId}`;
}
function createAttemptId() {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto?.randomUUID !== void 0) return globalCrypto.randomUUID();
  const random = Math.random().toString(36).slice(2, 12);
  return `attempt-${Date.now().toString(36)}-${random}`;
}

// rich/src/client/interactions.ts
var INTERACTION_TIMEOUT_MS = 1e4;
function errorText(error) {
  if (error instanceof Error) return error.message.slice(0, 240);
  return String(error).slice(0, 240);
}
function buildInteractionPayload(request, attemptId, now) {
  return {
    protocol: RICH_INTERACTION_PROTOCOL,
    protocolVersion: 1,
    sessionId: request.sessionId,
    callId: request.callId,
    cardKey: cardKeyFor(request.callId, request.questionId),
    ...request.questionId === void 0 ? {} : { questionId: request.questionId },
    actionId: request.actionId,
    attemptId,
    submittedAt: new Date(now).toISOString(),
    ...request.answer === void 0 ? {} : { answer: request.answer }
  };
}
async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`interaction timed out after ${String(timeoutMs)}ms`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}
async function submitInteraction(request) {
  const attemptId = createAttemptId();
  const payload = buildInteractionPayload(request, attemptId, Date.now());
  const local = validateInteractionPayload(payload);
  if (!local.ok) {
    return {
      ok: false,
      text: `invalid interaction payload: ${local.issues.map((item) => `${item.field}: ${item.detail}`).join("; ")}`,
      duplicate: false,
      followUpQueued: false,
      attemptId
    };
  }
  if (payload.sessionId !== request.sessionId) {
    return { ok: false, text: "refusing to submit: session identity mismatch", duplicate: false, followUpQueued: false, attemptId };
  }
  const command = `/rich-interaction ${JSON.stringify(payload)}`;
  let hostText = "";
  let duplicate = false;
  try {
    const result = await withTimeout(
      request.ctx.remote.commands.execute(request.sessionId, command, []),
      request.timeoutMs ?? INTERACTION_TIMEOUT_MS
    );
    if (!result.ok) {
      return {
        ok: false,
        text: `host rejected the interaction (${result.error.code}): ${result.error.message}`.slice(0, 300),
        duplicate: false,
        followUpQueued: false,
        attemptId
      };
    }
    const outcome = result.value.result;
    if (outcome.kind !== "success") {
      return {
        ok: false,
        text: (outcome.text ?? "host rejected the interaction").slice(0, 300),
        duplicate: false,
        followUpQueued: false,
        attemptId
      };
    }
    const receipt = outcome.text ?? "recorded";
    duplicate = receipt.endsWith(" (duplicate)");
    hostText = receipt.slice(0, 300);
  } catch (error) {
    return {
      ok: false,
      text: `interaction failed: ${errorText(error)}`,
      duplicate: false,
      followUpQueued: false,
      attemptId
    };
  }
  let followUpQueued = false;
  if (!duplicate && request.submitText !== void 0 && request.submitText.trim().length > 0) {
    const session = request.ctx.remote.session;
    if (typeof session?.prompt !== "function") {
      return { ok: true, text: `${hostText}; follow-up unavailable in this slot context`, duplicate, followUpQueued: false, attemptId };
    }
    const controller = new AbortController();
    try {
      const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attemptId) ? attemptId : globalThis.crypto.randomUUID();
      const result = await withTimeout(session.prompt({
        requestId,
        sessionId: request.sessionId,
        mode: "queue",
        content: [{ type: "text", text: request.submitText }]
      }, controller.signal), request.timeoutMs ?? INTERACTION_TIMEOUT_MS);
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      if (result.value.accepted !== true) throw new Error("session did not acknowledge acceptance");
      followUpQueued = true;
    } catch (error) {
      controller.abort();
      return {
        ok: true,
        text: `${hostText}; follow-up was not confirmed submitted: ${errorText(error)}`,
        duplicate,
        followUpQueued: false,
        attemptId
      };
    }
  }
  return { ok: true, text: hostText, duplicate, followUpQueued, attemptId };
}

// rich/src/client/renderers/index.tsx
var import_react5 = require("react");

// rich/src/client/renderers/chart/surface.tsx
var import_react2 = require("react");

// rich/src/shared/chart-scale.ts
var CHART_DEFAULT_WIDTH = 640;
var CHART_DEFAULT_HEIGHT = 240;
var CHART_MIN_WIDTH = 240;
var CHART_MIN_HEIGHT = 220;
var CHART_MAX_HEIGHT = 260;
var CHART_MARGINS = { top: 12, right: 16, bottom: 44, left: 64 };
var TICK_FONT_SIZE = 10;
var X_TICK_TARGET = 6;
var Y_TICK_TARGET = 5;
var MAX_TICKS = 24;
var MAX_COORDINATE_DECIMALS = 6;
var FALLBACK_SERIES_PALETTE = [
  "#d94f2b",
  "#247bbf",
  "#1a7f37",
  "#8e44ad",
  "#c98a00",
  "#0f766e",
  "#b0355b",
  "#475569"
];
var DEFAULT_AXIS_RANGE = { min: 0, max: 1 };
var HEX_COLOR2 = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function clamp(value, low, high) {
  if (!Number.isFinite(value)) return low;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
function normalizeChartWidth(width) {
  if (width === void 0 || !Number.isFinite(width) || width <= 0) return CHART_DEFAULT_WIDTH;
  return Math.max(CHART_MIN_WIDTH, Math.round(width));
}
function normalizeChartHeight(height) {
  if (height === void 0 || !Number.isFinite(height) || height <= 0) return CHART_DEFAULT_HEIGHT;
  return Math.round(clamp(height, CHART_MIN_HEIGHT, CHART_MAX_HEIGHT));
}
function chartLayout(width, height) {
  const normalizedWidth = normalizeChartWidth(width);
  const normalizedHeight = normalizeChartHeight(height);
  const plot = {
    left: CHART_MARGINS.left,
    top: CHART_MARGINS.top,
    width: Math.max(20, normalizedWidth - CHART_MARGINS.left - CHART_MARGINS.right),
    height: Math.max(20, normalizedHeight - CHART_MARGINS.top - CHART_MARGINS.bottom)
  };
  return { width: normalizedWidth, height: normalizedHeight, plot };
}
function plotExtents(series) {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const item of Array.isArray(series) ? series : []) {
    if (item === null || typeof item !== "object") continue;
    const points = Array.isArray(item.points) ? item.points : [];
    for (const point of points) {
      if (point === null || typeof point !== "object") continue;
      const { x, y } = point;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) continue;
      seen = true;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!seen) return { x: void 0, y: void 0 };
  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
}
function resolveAxisRange(extent, spec, fallback = DEFAULT_AXIS_RANGE) {
  const specMin = spec !== void 0 && isFiniteNumber(spec.min) ? spec.min : void 0;
  const specMax = spec !== void 0 && isFiniteNumber(spec.max) ? spec.max : void 0;
  let min = specMin ?? (extent !== void 0 ? extent.min : fallback.min);
  let max = specMax ?? (extent !== void 0 ? extent.max : fallback.max);
  if (!Number.isFinite(min)) min = fallback.min;
  if (!Number.isFinite(max)) max = fallback.max;
  if (max > min) return { min, max };
  const explicitMin = specMin !== void 0;
  const explicitMax = specMax !== void 0;
  if (explicitMin && explicitMax) {
    return { min, max: min + Math.max(Math.abs(min) * 0.05, 0.5) };
  }
  if (explicitMin && !explicitMax) {
    return { min, max: min + Math.max(Math.abs(min) * 0.05, 0.5) };
  }
  if (explicitMax && !explicitMin) {
    return { min: max - Math.max(Math.abs(max) * 0.05, 0.5), max };
  }
  const pad = Math.max(Math.abs(min) * 0.05, 0.5);
  return { min: min - pad, max: max + pad };
}
function roundTo(value, decimals) {
  if (!Number.isFinite(value)) return 0;
  const digits = Math.trunc(clamp(decimals, 0, 12));
  const factor = 10 ** digits;
  if (!Number.isFinite(factor) || factor === 0) return value;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
function niceStep(raw) {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const power = 10 ** exponent;
  const fraction = raw / power;
  let niceFraction;
  if (fraction < 1.5) niceFraction = 1;
  else if (fraction < 3) niceFraction = 2;
  else if (fraction < 7) niceFraction = 5;
  else niceFraction = 10;
  const step = niceFraction * power;
  return Number.isFinite(step) && step > 0 ? step : 1;
}
function decimalsForStep(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const exponent = Math.floor(Math.log10(step));
  const decimals = clamp(-exponent, 0, MAX_COORDINATE_DECIMALS);
  return Object.is(decimals, -0) ? 0 : decimals;
}
function formatNumber(value, decimals) {
  if (!Number.isFinite(value)) return "0";
  const digits = Math.trunc(clamp(decimals, 0, MAX_COORDINATE_DECIMALS));
  const rounded = roundTo(value, digits);
  const text3 = rounded.toFixed(digits);
  if (/^-0(?:\.0+)?$/.test(text3)) return text3.slice(1);
  return text3;
}
function formatTickLabel(value, decimals, unit2) {
  const number2 = formatNumber(value, decimals);
  if (unit2 === void 0) return number2;
  const trimmed = unit2.trim();
  return trimmed.length === 0 ? number2 : `${number2} ${trimmed}`;
}
function niceTicks(min, max, targetCount) {
  if (!isFiniteNumber(min) || !isFiniteNumber(max)) return [];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const target = isFiniteNumber(targetCount) && targetCount >= 2 ? Math.floor(Math.min(targetCount, 12)) : 5;
  if (high === low) return [roundTo(low, 6)];
  const span = high - low;
  if (!(span > 0) || !Number.isFinite(span)) return [roundTo(low, 6)];
  const step = niceStep(span / (target - 1));
  const decimals = decimalsForStep(step);
  const first = Math.ceil(low / step - 1e-9) * step;
  const values = [];
  const hardLimit = Math.min(MAX_TICKS, target * 3 + 4);
  for (let index = 0; index < hardLimit; index += 1) {
    const value = first + index * step;
    if (!Number.isFinite(value) || value > high + step * 1e-6) break;
    const rounded = roundTo(value, decimals);
    if (rounded < low - step * 1e-6) continue;
    values.push(rounded);
  }
  if (values.length < 2) {
    const fallback = [roundTo(low, decimals), roundTo(high, decimals)];
    if (fallback[0] !== fallback[1]) return fallback;
    return values.length === 1 ? values : [fallback[0]];
  }
  return values;
}
function buildTickSet(range, targetCount, unit2) {
  const target = isFiniteNumber(targetCount) && targetCount >= 2 ? Math.floor(Math.min(targetCount, 12)) : 5;
  const span = (isFiniteNumber(range.max) ? range.max : 0) - (isFiniteNumber(range.min) ? range.min : 0);
  const step = span > 0 && Number.isFinite(span) ? niceStep(span / (target - 1)) : 0;
  const decimals = decimalsForStep(step);
  const ticks = niceTicks(range.min, range.max, target).map((value) => ({
    value,
    label: formatTickLabel(value, decimals, unit2)
  }));
  return { step, decimals, ticks };
}
function createLinearScale(domain, pixelMin, pixelMax) {
  const span = domain.max - domain.min;
  const pixelSpan = pixelMax - pixelMin;
  const validSpan = Number.isFinite(span) && span !== 0;
  const validPixelSpan = Number.isFinite(pixelSpan) && pixelSpan !== 0;
  const map = (value) => {
    if (!Number.isFinite(value)) return pixelMin;
    if (!validSpan) return (pixelMin + pixelMax) / 2;
    return pixelMin + (value - domain.min) / span * pixelSpan;
  };
  const invert = (pixel) => {
    if (!Number.isFinite(pixel) || !validPixelSpan) return domain.min;
    return domain.min + (pixel - pixelMin) / pixelSpan * span;
  };
  return { domain, pixelMin, pixelMax, map, invert };
}
function formatCoordinate(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = roundTo(value, MAX_COORDINATE_DECIMALS);
  if (rounded === 0) return "0";
  return String(rounded);
}
function buildPolylineFromPixelPoints(points) {
  const parts = [];
  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue;
    parts.push(`${formatCoordinate(point.x)},${formatCoordinate(point.y)}`);
  }
  return parts.join(" ");
}
function nearestPoint(series, pixelX, pixelY) {
  if (!Number.isFinite(pixelX) || !Number.isFinite(pixelY)) return void 0;
  let bestSeries;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const item of series) {
    let seriesPoint;
    let seriesDistance = Number.POSITIVE_INFINITY;
    for (const mark of item.marks) {
      const dx = mark.pixel.x - pixelX;
      const dy = mark.pixel.y - pixelY;
      const distance = dx * dx + dy * dy;
      if (distance < seriesDistance) {
        seriesDistance = distance;
        seriesPoint = mark;
      }
    }
    if (seriesPoint !== void 0 && seriesDistance < bestDistance) {
      bestDistance = seriesDistance;
      bestSeries = {
        seriesIndex: item.index,
        pointIndex: seriesPoint.index,
        point: seriesPoint.point,
        pixel: seriesPoint.pixel,
        series: item
      };
    }
  }
  return bestSeries;
}
function seriesColor(series, index, palette) {
  if (typeof series.color === "string" && HEX_COLOR2.test(series.color)) return series.color;
  const fromPalette = palette[index % palette.length];
  if (typeof fromPalette === "string" && fromPalette.length > 0) return fromPalette;
  return FALLBACK_SERIES_PALETTE[index % FALLBACK_SERIES_PALETTE.length];
}
function createChartModel(data, options = {}) {
  const layout = chartLayout(options.width, options.height);
  const palette = options.palette !== void 0 && options.palette.length > 0 ? options.palette : FALLBACK_SERIES_PALETTE;
  const rawSeries = data !== null && typeof data === "object" && Array.isArray(data.series) ? data.series : [];
  const extents = plotExtents(rawSeries);
  const xRange = resolveAxisRange(extents.x, data?.xAxis);
  const yRange = resolveAxisRange(extents.y, data?.yAxis);
  const xTicks = buildTickSet(xRange, X_TICK_TARGET);
  const yTicks = buildTickSet(yRange, Y_TICK_TARGET);
  const xScale = createLinearScale(xRange, layout.plot.left, layout.plot.left + layout.plot.width);
  const yScale = createLinearScale(yRange, layout.plot.top + layout.plot.height, layout.plot.top);
  const series = rawSeries.map((item, index) => {
    const sourcePoints = item !== null && typeof item === "object" && Array.isArray(item.points) ? item.points : [];
    const marks = [];
    for (const point of sourcePoints) {
      if (point === null || typeof point !== "object") continue;
      if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) continue;
      marks.push({ index: marks.length, point, pixel: { x: xScale.map(point.x), y: yScale.map(point.y) } });
    }
    return {
      index,
      name: typeof item.name === "string" ? item.name : `series ${String(index + 1)}`,
      color: seriesColor(item, index, palette),
      marks,
      polyline: buildPolylineFromPixelPoints(marks.map((mark) => mark.pixel))
    };
  });
  const totalPoints = series.reduce((sum, item) => sum + item.marks.length, 0);
  const xAxis = data?.xAxis;
  const yAxis = data?.yAxis;
  return {
    layout,
    plot: layout.plot,
    xRange,
    yRange,
    xScale,
    yScale,
    xTicks,
    yTicks,
    series,
    totalPoints,
    hasData: totalPoints > 0,
    xLabel: typeof xAxis?.label === "string" ? xAxis.label : void 0,
    xUnit: typeof xAxis?.unit === "string" ? xAxis.unit : void 0,
    yLabel: typeof yAxis?.label === "string" ? yAxis.label : void 0,
    yUnit: typeof yAxis?.unit === "string" ? yAxis.unit : void 0
  };
}
function axisTitleText(label, unit2) {
  const name4 = label?.trim() ?? "";
  const suffix = unit2?.trim() ?? "";
  if (name4.length > 0 && suffix.length > 0) return `${name4} (${suffix})`;
  if (name4.length > 0) return name4;
  return suffix;
}

// rich/src/client/renderers/chart/surface.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function Legend({ series, theme: theme4 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "div",
    {
      "data-dsh-rich": "legend",
      style: { display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: "12px", color: theme4.muted },
      children: series.map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "span",
        {
          "data-dsh-rich": "legend-item",
          "data-dsh-rich-series-index": item.index,
          "data-dsh-rich-series-name": item.name,
          style: { display: "inline-flex", alignItems: "center", gap: "5px" },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "span",
              {
                "data-dsh-rich": "legend-swatch",
                "aria-hidden": "true",
                style: { width: "10px", height: "10px", borderRadius: "2px", background: item.color, display: "inline-block" }
              }
            ),
            item.name
          ]
        },
        item.index
      ))
    }
  );
}
function Tooltip({ hover, model, theme: theme4 }) {
  const rows = [
    { text: hover.series.name, strong: true },
    { text: `x: ${formatTickLabel(hover.point.x, model.xTicks.decimals, model.xUnit)}`, strong: false },
    { text: `y: ${formatTickLabel(hover.point.y, model.yTicks.decimals, model.yUnit)}`, strong: false }
  ];
  const longest = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
  const boxWidth = Math.min(240, Math.max(96, longest * 6.2 + 18));
  const boxHeight = rows.length * 14 + 10;
  const x = clamp(hover.pixel.x + 12, 2, Math.max(2, model.layout.width - boxWidth - 2));
  const y = clamp(hover.pixel.y - boxHeight - 10, 2, Math.max(2, model.layout.height - boxHeight - 2));
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("g", { "data-dsh-rich": "tooltip", pointerEvents: "none", transform: `translate(${formatCoordinate(x)},${formatCoordinate(y)})`, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "rect",
      {
        "data-dsh-rich": "tooltip-box",
        x: 0,
        y: 0,
        width: boxWidth,
        height: boxHeight,
        rx: 4,
        fill: theme4.surface,
        stroke: theme4.border,
        strokeWidth: 1,
        opacity: 0.97
      }
    ),
    rows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "text",
      {
        "data-dsh-rich": "tooltip-row",
        x: 8,
        y: 14 + index * 14,
        fontSize: 10,
        fill: row.strong ? theme4.text : theme4.muted,
        fontWeight: row.strong ? 600 : 400,
        children: row.text
      },
      index
    ))
  ] });
}
function AxisTicks({ model, theme: theme4 }) {
  const { plot } = model;
  const xLabel = axisTitleText(model.xLabel, model.xUnit);
  const yLabel = axisTitleText(model.yLabel, model.yUnit);
  const xTickY = plot.top + plot.height;
  const yTickX = plot.left;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("g", { "data-dsh-rich": "axes", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "line",
      {
        "data-dsh-rich": "axis-line",
        "data-dsh-rich-axis": "x",
        x1: plot.left,
        y1: xTickY,
        x2: plot.left + plot.width,
        y2: xTickY,
        stroke: theme4.border,
        strokeWidth: 1
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "line",
      {
        "data-dsh-rich": "axis-line",
        "data-dsh-rich-axis": "y",
        x1: yTickX,
        y1: plot.top,
        x2: yTickX,
        y2: plot.top + plot.height,
        stroke: theme4.border,
        strokeWidth: 1
      }
    ),
    model.xTicks.ticks.map((tick) => {
      const position = formatCoordinate(model.xScale.map(tick.value));
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("g", { "data-dsh-rich": "tick", "data-dsh-rich-axis": "x", "data-dsh-rich-tick-value": tick.value, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("line", { x1: position, y1: xTickY, x2: position, y2: xTickY + 4, stroke: theme4.border, strokeWidth: 1 }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("text", { x: position, y: xTickY + 14, fontSize: TICK_FONT_SIZE, fill: theme4.muted, textAnchor: "middle", children: tick.label })
      ] }, `x-${String(tick.value)}`);
    }),
    model.yTicks.ticks.map((tick) => {
      const position = formatCoordinate(model.yScale.map(tick.value));
      const label = formatTickLabel(tick.value, model.yTicks.decimals, model.yUnit);
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("g", { "data-dsh-rich": "tick", "data-dsh-rich-axis": "y", "data-dsh-rich-tick-value": tick.value, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("line", { x1: yTickX - 4, y1: position, x2: yTickX, y2: position, stroke: theme4.border, strokeWidth: 1 }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("text", { x: yTickX - 8, y: position, dy: "0.32em", fontSize: TICK_FONT_SIZE, fill: theme4.muted, textAnchor: "end", children: label })
      ] }, `y-${String(tick.value)}`);
    }),
    xLabel.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "text",
      {
        "data-dsh-rich": "axis-title",
        "data-dsh-rich-axis": "x",
        x: plot.left + plot.width / 2,
        y: model.layout.height - 8,
        fontSize: 11,
        fill: theme4.muted,
        textAnchor: "middle",
        children: xLabel
      }
    ) : null,
    yLabel.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "text",
      {
        "data-dsh-rich": "axis-title",
        "data-dsh-rich-axis": "y",
        x: 14,
        y: plot.top + plot.height / 2,
        fontSize: 11,
        fill: theme4.muted,
        textAnchor: "middle",
        transform: `rotate(-90 14 ${formatCoordinate(plot.top + plot.height / 2)})`,
        children: yLabel
      }
    ) : null
  ] });
}
function GridLines({ model, theme: theme4 }) {
  const { plot } = model;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("g", { "data-dsh-rich": "grid", children: [
    model.yTicks.ticks.map((tick) => {
      const position = formatCoordinate(model.yScale.map(tick.value));
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "line",
        {
          "data-dsh-rich": "grid-line",
          "data-dsh-rich-axis": "y",
          x1: plot.left,
          y1: position,
          x2: plot.left + plot.width,
          y2: position,
          stroke: theme4.border,
          strokeWidth: 1,
          opacity: 0.45
        },
        `gy-${String(tick.value)}`
      );
    }),
    model.xTicks.ticks.map((tick) => {
      const position = formatCoordinate(model.xScale.map(tick.value));
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "line",
        {
          "data-dsh-rich": "grid-line",
          "data-dsh-rich-axis": "x",
          x1: position,
          y1: plot.top,
          x2: position,
          y2: plot.top + plot.height,
          stroke: theme4.border,
          strokeWidth: 1,
          opacity: 0.22
        },
        `gx-${String(tick.value)}`
      );
    })
  ] });
}
function ChartSurface(props) {
  const { data, theme: theme4 } = props;
  const rawId = (0, import_react2.useId)();
  const clipId = `dsh-rich-clip-${rawId.replace(/[^A-Za-z0-9_-]/g, "") || "chart"}`;
  const model = (0, import_react2.useMemo)(
    () => createChartModel(data, { width: props.width, height: props.height, palette: theme4.series }),
    [data, props.width, props.height, theme4.series]
  );
  const svgRef = (0, import_react2.useRef)(null);
  const [hover, setHover] = (0, import_react2.useState)(null);
  const handlePointerMove = (event) => {
    const svg = svgRef.current;
    if (svg === null) return;
    const bounds2 = svg.getBoundingClientRect();
    if (bounds2.width <= 0 || bounds2.height <= 0) return;
    const px2 = (event.clientX - bounds2.left) / bounds2.width * model.layout.width;
    const py = (event.clientY - bounds2.top) / bounds2.height * model.layout.height;
    const next = nearestPoint(model.series, px2, py);
    setHover((current) => {
      if (next === void 0) return current === null ? current : null;
      if (current !== null && current.seriesIndex === next.seriesIndex && current.pointIndex === next.pointIndex) return current;
      return next;
    });
  };
  const handlePointerLeave = () => {
    setHover((current) => current === null ? current : null);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      "data-dsh-rich": props.kind,
      "data-dsh-rich-series-count": model.series.length,
      "data-dsh-rich-point-count": model.totalPoints,
      style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, color: theme4.text },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { "data-dsh-rich": "chart-header", style: { display: "flex", flexDirection: "column", gap: "1px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { "data-dsh-rich": "chart-title", style: { fontWeight: 600, fontSize: "13px" }, children: props.title }),
          props.subtitle !== void 0 && props.subtitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { "data-dsh-rich": "chart-subtitle", style: { color: theme4.muted, fontSize: "12px" }, children: props.subtitle }) : null
        ] }),
        model.series.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Legend, { series: model.series, theme: theme4 }) : null,
        !model.hasData ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            "data-dsh-rich": "empty",
            role: "status",
            style: {
              padding: "14px 12px",
              border: `1px dashed ${theme4.border}`,
              borderRadius: "8px",
              color: theme4.muted,
              fontSize: "12px"
            },
            children: props.emptyMessage
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "svg",
          {
            ref: svgRef,
            "data-dsh-rich-chart": props.kind,
            role: "img",
            "aria-label": props.ariaLabel,
            width: model.layout.width,
            height: model.layout.height,
            viewBox: `0 0 ${String(model.layout.width)} ${String(model.layout.height)}`,
            style: { width: "100%", maxWidth: `${String(model.layout.width)}px`, height: "auto", display: "block", overflow: "visible" },
            onPointerMove: handlePointerMove,
            onPointerLeave: handlePointerLeave,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("clipPath", { id: clipId, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("rect", { x: model.plot.left, y: model.plot.top, width: model.plot.width, height: model.plot.height }) }) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GridLines, { model, theme: theme4 }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(AxisTicks, { model, theme: theme4 }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("g", { "data-dsh-rich": "plot-area", clipPath: `url(#${clipId})`, children: props.renderSeries({ model, plot: model.plot, clipId }) }),
              hover !== null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Tooltip, { hover, model, theme: theme4 }) : null
            ]
          }
        )
      ]
    }
  );
}

// rich/src/client/renderers/chart/use-width.ts
var import_react3 = require("react");
function useContainerWidth(fallback = CHART_DEFAULT_WIDTH) {
  const ref = (0, import_react3.useRef)(null);
  const [width, setWidth] = (0, import_react3.useState)(fallback);
  (0, import_react3.useEffect)(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const apply4 = (next) => {
      if (!Number.isFinite(next) || next <= 0) return;
      const rounded = Math.max(CHART_MIN_WIDTH, Math.round(next));
      setWidth((current) => current === rounded ? current : rounded);
    };
    apply4(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === void 0) return;
      apply4(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, width };
}

// rich/src/client/renderers/line-plot.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var MAX_LINE_HIT_TARGETS = 500;
function chartAriaLabel(content) {
  const count = content.data.series.reduce((sum, item) => sum + item.points.length, 0);
  const units = [];
  if (content.data.xAxis?.unit !== void 0) units.push(`x unit ${content.data.xAxis.unit}`);
  if (content.data.yAxis?.unit !== void 0) units.push(`y unit ${content.data.yAxis.unit}`);
  return `Line plot ${content.title}: ${String(content.data.series.length)} series, ${String(count)} points${units.length > 0 ? `; ${units.join(", ")}` : ""}`;
}
function renderMarks(context, theme4) {
  const { model } = context;
  const drawHitTargets = model.totalPoints <= MAX_LINE_HIT_TARGETS;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("g", { "data-dsh-rich": "series-layer", children: model.series.map((series) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
    "g",
    {
      "data-dsh-rich-series": series.index,
      "data-dsh-rich-series-name": series.name,
      "data-dsh-rich-series-index": series.index,
      "data-dsh-rich-series-color": series.color,
      children: [
        series.marks.length > 1 && series.polyline.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "polyline",
          {
            "data-dsh-rich": "line",
            "data-dsh-rich-series-index": series.index,
            points: series.polyline,
            fill: "none",
            stroke: series.color,
            strokeWidth: 1.75,
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }
        ) : null,
        series.marks.length === 1 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "circle",
          {
            "data-dsh-rich": "point",
            "data-dsh-rich-series-index": series.index,
            "data-dsh-rich-point-index": 0,
            cx: formatCoordinate(series.marks[0]?.pixel.x ?? 0),
            cy: formatCoordinate(series.marks[0]?.pixel.y ?? 0),
            r: 3.5,
            fill: series.color
          }
        ) : null,
        drawHitTargets ? series.marks.map((mark) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "circle",
          {
            "data-dsh-rich": "point-hit",
            "data-dsh-rich-series-index": series.index,
            "data-dsh-rich-point-index": mark.index,
            "data-dsh-rich-point-x": mark.point.x,
            "data-dsh-rich-point-y": mark.point.y,
            cx: formatCoordinate(mark.pixel.x),
            cy: formatCoordinate(mark.pixel.y),
            r: 9,
            fill: "transparent"
          },
          mark.index
        )) : null
      ]
    },
    series.index
  )) });
}
function LinePlotView({ content, theme: theme4, width, height }) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    ChartSurface,
    {
      kind: "line-plot",
      title: content.title,
      subtitle: content.subtitle,
      data: content.data,
      theme: theme4,
      width,
      height,
      ariaLabel: chartAriaLabel(content),
      emptyMessage: "No data points to plot.",
      renderSeries: (context) => renderMarks(context, theme4)
    }
  );
}
function LinePlot({ content, theme: theme4 }) {
  const { ref, width } = useContainerWidth();
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { ref, "data-dsh-rich-container": "line-plot", style: { width: "100%", minWidth: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(LinePlotView, { content, theme: theme4, width }) });
}

// rich/src/client/renderers/scatter-plot.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var SCATTER_POINT_RADIUS = 3.5;
function chartAriaLabel2(content) {
  const count = content.data.series.reduce((sum, item) => sum + item.points.length, 0);
  const units = [];
  if (content.data.xAxis?.unit !== void 0) units.push(`x unit ${content.data.xAxis.unit}`);
  if (content.data.yAxis?.unit !== void 0) units.push(`y unit ${content.data.yAxis.unit}`);
  return `Scatter plot ${content.title}: ${String(content.data.series.length)} series, ${String(count)} points${units.length > 0 ? `; ${units.join(", ")}` : ""}`;
}
function renderMarks2(context) {
  const { model } = context;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("g", { "data-dsh-rich": "series-layer", children: model.series.map((series) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    "g",
    {
      "data-dsh-rich-series": series.index,
      "data-dsh-rich-series-name": series.name,
      "data-dsh-rich-series-index": series.index,
      "data-dsh-rich-series-color": series.color,
      children: series.marks.map((mark) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "circle",
        {
          "data-dsh-rich": "point",
          "data-dsh-rich-series-index": series.index,
          "data-dsh-rich-point-index": mark.index,
          "data-dsh-rich-point-x": mark.point.x,
          "data-dsh-rich-point-y": mark.point.y,
          cx: formatCoordinate(mark.pixel.x),
          cy: formatCoordinate(mark.pixel.y),
          r: SCATTER_POINT_RADIUS,
          fill: series.color,
          fillOpacity: 0.85
        },
        mark.index
      ))
    },
    series.index
  )) });
}
function ScatterPlotView({ content, theme: theme4, width, height }) {
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    ChartSurface,
    {
      kind: "scatter-plot",
      title: content.title,
      subtitle: content.subtitle,
      data: content.data,
      theme: theme4,
      width,
      height,
      ariaLabel: chartAriaLabel2(content),
      emptyMessage: "No data points to plot.",
      renderSeries: (context) => renderMarks2(context)
    }
  );
}
function ScatterPlot({ content, theme: theme4 }) {
  const { ref, width } = useContainerWidth();
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { ref, "data-dsh-rich-container": "scatter-plot", style: { width: "100%", minWidth: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ScatterPlotView, { content, theme: theme4, width }) });
}

// rich/src/client/renderers/basic-diagram.tsx
var import_react4 = require("react");

// rich/src/shared/text-width.ts
var WIDE_CHAR = new RegExp("[\\u1100-\\u115F\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6\\u{1F300}-\\u{1FAFF}\\u{20000}-\\u{3FFFD}\\uFE0F\\u20E3]|\\p{Extended_Pictographic}|\\p{Regional_Indicator}", "u");
var LATIN_WIDE = /* @__PURE__ */ new Map([["W", 1.75], ["@", 1.75], ["%", 1.6], ["M", 1.55], ["m", 1.55]]);
var LATIN_CAPITAL = /^[A-HK-Zw]$/;
var segmenter;
function graphemes(text3) {
  if (segmenter === void 0) {
    segmenter = typeof Intl === "object" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
  }
  if (segmenter === null) return Array.from(text3);
  return Array.from(segmenter.segment(text3), (part) => part.segment);
}
function graphemeWidth(cluster) {
  if (WIDE_CHAR.test(cluster)) return 2;
  return LATIN_WIDE.get(cluster) ?? (LATIN_CAPITAL.test(cluster) ? 1.35 : 1);
}

// rich/src/shared/diagram-geometry.ts
var DIAGRAM_VIEW = { width: 1e3, height: 560 };
var DIAGRAM_FONT = { node: 12, edge: 11 };
var DIAGRAM_MIN_RENDER_WIDTH = 680;
var DIAGRAM_BOX = { width: 148, height: 60 };
var DIAGRAM_DIAMOND = { halfWidth: 88, halfHeight: 46 };
var DIAGRAM_CIRCLE_RADIUS = 40;
var DIAGRAM_EDGE_LABEL_UNITS = 24;
var BOX_HALF_WIDTH = DIAGRAM_BOX.width / 2;
var BOX_HALF_HEIGHT = DIAGRAM_BOX.height / 2;
var DIAMOND_HALF_WIDTH = DIAGRAM_DIAMOND.halfWidth;
var DIAMOND_HALF_HEIGHT = DIAGRAM_DIAMOND.halfHeight;
var CIRCLE_RADIUS = DIAGRAM_CIRCLE_RADIUS;
var VIEWPORT_INSET = 8;
var EDGE_GAP = 5;
var ARROW_GAP = 8;
var MIN_EDGE_LENGTH = 18;
function clampTo(value, low, high) {
  if (!Number.isFinite(value)) return low;
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
function normalizeShape(shape) {
  switch (shape) {
    case "rounded":
    case "diamond":
    case "circle":
    case "box":
      return shape;
    default:
      return "box";
  }
}
function mapNode(node) {
  const shape = normalizeShape(node.shape);
  const halfWidth = shape === "diamond" ? DIAMOND_HALF_WIDTH : shape === "circle" ? CIRCLE_RADIUS : BOX_HALF_WIDTH;
  const halfHeight = shape === "diamond" ? DIAMOND_HALF_HEIGHT : shape === "circle" ? CIRCLE_RADIUS : BOX_HALF_HEIGHT;
  const x = Number.isFinite(node.x) ? node.x : 500;
  const y = Number.isFinite(node.y) ? node.y : 500;
  const center = {
    x: clampTo(x / 1e3 * DIAGRAM_VIEW.width, halfWidth + VIEWPORT_INSET, DIAGRAM_VIEW.width - halfWidth - VIEWPORT_INSET),
    y: clampTo(y / 1e3 * DIAGRAM_VIEW.height, halfHeight + VIEWPORT_INSET, DIAGRAM_VIEW.height - halfHeight - VIEWPORT_INSET)
  };
  return {
    node,
    shape,
    center,
    halfWidth,
    halfHeight,
    radius: shape === "circle" ? CIRCLE_RADIUS : 0,
    // Width units (CJK = 2): a circle's 79-unit text chord fits six CJK glyphs at 12px.
    labelMaxChars: shape === "circle" ? 12 : shape === "diamond" ? 17 : 20
  };
}
function boundaryDistance(geometry, directionX, directionY) {
  const absX = Math.abs(directionX);
  const absY = Math.abs(directionY);
  switch (geometry.shape) {
    case "circle":
      return geometry.radius;
    case "diamond": {
      const term = absX / geometry.halfWidth + absY / geometry.halfHeight;
      return term > 0 ? 1 / term : geometry.halfWidth;
    }
    case "box":
    case "rounded": {
      const candidates = [];
      if (absX > 1e-9) candidates.push(geometry.halfWidth / absX);
      if (absY > 1e-9) candidates.push(geometry.halfHeight / absY);
      return candidates.length > 0 ? Math.min(...candidates) : geometry.halfHeight;
    }
    default:
      return geometry.halfHeight;
  }
}
function truncateLabel(label, maxChars) {
  const clusters = graphemes(label);
  let total = 0;
  for (const cluster of clusters) total += graphemeWidth(cluster);
  if (total <= maxChars) return label;
  const budget = Math.max(1, maxChars - 3);
  let used = 0;
  let kept = "";
  for (const cluster of clusters) {
    const width = graphemeWidth(cluster);
    if (used + width > budget) break;
    used += width;
    kept += cluster;
  }
  return `${kept.length > 0 ? kept : clusters[0] ?? ""}...`;
}
function buildDiagramGeometry(nodes, edges) {
  const byId = /* @__PURE__ */ new Map();
  const mappedNodes = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node === null || typeof node !== "object" || typeof node.id !== "string") continue;
    if (byId.has(node.id)) continue;
    const geometry = mapNode(node);
    byId.set(node.id, geometry);
    mappedNodes.push(geometry);
  }
  const mappedEdges = [];
  let droppedEdges = 0;
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (edge === null || typeof edge !== "object" || typeof edge.from !== "string" || typeof edge.to !== "string") {
      droppedEdges += 1;
      continue;
    }
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === void 0 || to === void 0 || from === to) {
      droppedEdges += 1;
      continue;
    }
    const dx = to.center.x - from.center.x;
    const dy = to.center.y - from.center.y;
    const length2 = Math.hypot(dx, dy);
    if (!Number.isFinite(length2) || length2 < MIN_EDGE_LENGTH) {
      droppedEdges += 1;
      continue;
    }
    const unitX = dx / length2;
    const unitY = dy / length2;
    const maxOffset = (length2 - 4) / 2;
    const startOffset = Math.min(boundaryDistance(from, unitX, unitY) + EDGE_GAP, maxOffset);
    const endOffset = Math.min(boundaryDistance(to, -unitX, -unitY) + EDGE_GAP + ARROW_GAP, maxOffset);
    const start = {
      x: from.center.x + unitX * startOffset,
      y: from.center.y + unitY * startOffset
    };
    const end = {
      x: to.center.x - unitX * endOffset,
      y: to.center.y - unitY * endOffset
    };
    mappedEdges.push({
      edge,
      from,
      to,
      start,
      end,
      label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6 },
      labelText: typeof edge.label === "string" ? edge.label : ""
    });
  }
  return { nodes: mappedNodes, edges: mappedEdges, droppedEdges };
}

// rich/src/client/renderers/diagram/geometry.ts
function toneStyle(tone, theme4) {
  switch (tone) {
    case "accent":
      return { fill: theme4.accent, stroke: theme4.accent, text: "#ffffff", opacity: 1 };
    case "muted":
      return { fill: theme4.surface, stroke: theme4.border, text: theme4.muted, opacity: 0.72 };
    case "default":
    case void 0:
      return { fill: theme4.surface, stroke: theme4.border, text: theme4.text, opacity: 1 };
    default:
      return { fill: theme4.surface, stroke: theme4.border, text: theme4.text, opacity: 1 };
  }
}

// rich/src/client/renderers/basic-diagram.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function diagramAriaLabel(content) {
  return `Diagram ${content.title}: ${String(content.data.nodes.length)} nodes, ${String(content.data.edges.length)} edges`;
}
function NodeShape({ geometry, theme: theme4 }) {
  const tone = toneStyle(geometry.node.tone, theme4);
  const { center, halfWidth, halfHeight } = geometry;
  const label = typeof geometry.node.label === "string" ? geometry.node.label : "";
  const shapeProps = {
    fill: tone.fill,
    stroke: tone.stroke,
    strokeWidth: 1.4,
    opacity: tone.opacity
  };
  let shapeElement;
  switch (geometry.shape) {
    case "diamond":
      shapeElement = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "polygon",
        {
          "data-dsh-rich": "node-shape",
          points: [
            `${formatCoordinate(center.x)},${formatCoordinate(center.y - halfHeight)}`,
            `${formatCoordinate(center.x + halfWidth)},${formatCoordinate(center.y)}`,
            `${formatCoordinate(center.x)},${formatCoordinate(center.y + halfHeight)}`,
            `${formatCoordinate(center.x - halfWidth)},${formatCoordinate(center.y)}`
          ].join(" "),
          ...shapeProps
        }
      );
      break;
    case "circle":
      shapeElement = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "circle",
        {
          "data-dsh-rich": "node-shape",
          cx: formatCoordinate(center.x),
          cy: formatCoordinate(center.y),
          r: geometry.radius,
          ...shapeProps
        }
      );
      break;
    case "rounded":
      shapeElement = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "rect",
        {
          "data-dsh-rich": "node-shape",
          x: formatCoordinate(center.x - halfWidth),
          y: formatCoordinate(center.y - halfHeight),
          width: halfWidth * 2,
          height: halfHeight * 2,
          rx: 14,
          ...shapeProps
        }
      );
      break;
    case "box":
    default:
      shapeElement = /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "rect",
        {
          "data-dsh-rich": "node-shape",
          x: formatCoordinate(center.x - halfWidth),
          y: formatCoordinate(center.y - halfHeight),
          width: halfWidth * 2,
          height: halfHeight * 2,
          rx: 3,
          ...shapeProps
        }
      );
      break;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
    "g",
    {
      "data-dsh-rich": "node",
      "data-dsh-rich-node-id": geometry.node.id,
      "data-dsh-rich-node-shape": geometry.shape,
      "data-dsh-rich-node-tone": geometry.node.tone ?? "default",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("title", { children: label }),
        shapeElement,
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "text",
          {
            "data-dsh-rich": "node-label",
            x: formatCoordinate(center.x),
            y: formatCoordinate(center.y),
            dy: "0.34em",
            textAnchor: "middle",
            fontSize: DIAGRAM_FONT.node,
            fill: tone.text,
            children: truncateLabel(label, geometry.labelMaxChars)
          }
        )
      ]
    }
  );
}
function BasicDiagram({ content, theme: theme4 }) {
  const rawId = (0, import_react4.useId)();
  const arrowId = `dsh-rich-arrow-${rawId.replace(/[^A-Za-z0-9_-]/g, "") || "d"}`;
  const geometry = (0, import_react4.useMemo)(
    () => buildDiagramGeometry(content.data.nodes, content.data.edges),
    [content.data]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { "data-dsh-rich": "basic-diagram", style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, color: theme4.text }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { "data-dsh-rich": "diagram-header", style: { display: "flex", flexDirection: "column", gap: "1px" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { "data-dsh-rich": "diagram-title", style: { fontWeight: 600, fontSize: "13px" }, children: content.title }),
      content.subtitle !== void 0 && content.subtitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { "data-dsh-rich": "diagram-subtitle", style: { color: theme4.muted, fontSize: "12px" }, children: content.subtitle }) : null
    ] }),
    geometry.nodes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "div",
      {
        "data-dsh-rich": "empty",
        role: "status",
        style: { padding: "14px 12px", border: `1px dashed ${theme4.border}`, borderRadius: "8px", color: theme4.muted, fontSize: "12px" },
        children: "No diagram nodes to draw."
      }
    ) : (
      // Narrow cards scroll horizontally rather than shrinking the labels (VIS-02).
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "div",
        {
          "data-dsh-rich": "diagram-scroll",
          role: "region",
          "aria-label": `Diagram ${content.title}, scroll horizontally when narrow`,
          tabIndex: 0,
          style: { overflowX: "auto", maxWidth: "100%" },
          children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "svg",
            {
              "data-dsh-rich-svg": "basic-diagram",
              role: "img",
              "aria-label": diagramAriaLabel(content),
              viewBox: `0 0 ${String(DIAGRAM_VIEW.width)} ${String(DIAGRAM_VIEW.height)}`,
              style: { width: "100%", minWidth: `${String(DIAGRAM_MIN_RENDER_WIDTH)}px`, height: "auto", display: "block" },
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                  "marker",
                  {
                    id: arrowId,
                    viewBox: "0 0 10 7",
                    markerWidth: 10,
                    markerHeight: 7,
                    refX: 10,
                    refY: 3.5,
                    orient: "auto",
                    markerUnits: "userSpaceOnUse",
                    children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("path", { d: "M0,0 L10,3.5 L0,7 Z", fill: theme4.muted })
                  }
                ) }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("g", { "data-dsh-rich": "edges", "data-dsh-rich-edge-count": geometry.edges.length, "data-dsh-rich-dropped-edges": geometry.droppedEdges, children: geometry.edges.map((edge, index) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
                  "g",
                  {
                    "data-dsh-rich": "edge",
                    "data-dsh-rich-edge-from": edge.edge.from,
                    "data-dsh-rich-edge-to": edge.edge.to,
                    "data-dsh-rich-edge-dashed": edge.edge.dashed === true ? "true" : "false",
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
                        "line",
                        {
                          "data-dsh-rich": "edge-line",
                          x1: formatCoordinate(edge.start.x),
                          y1: formatCoordinate(edge.start.y),
                          x2: formatCoordinate(edge.end.x),
                          y2: formatCoordinate(edge.end.y),
                          stroke: theme4.muted,
                          strokeWidth: 1.3,
                          strokeDasharray: edge.edge.dashed === true ? "7 5" : void 0,
                          markerEnd: `url(#${arrowId})`
                        }
                      ),
                      edge.labelText.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
                        "text",
                        {
                          "data-dsh-rich": "edge-label",
                          x: formatCoordinate(edge.label.x),
                          y: formatCoordinate(edge.label.y),
                          textAnchor: "middle",
                          fontSize: DIAGRAM_FONT.edge,
                          fill: theme4.muted,
                          stroke: theme4.surface,
                          strokeWidth: 3,
                          paintOrder: "stroke",
                          children: [
                            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("title", { children: edge.labelText }),
                            truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS)
                          ]
                        }
                      ) : null
                    ]
                  },
                  `${edge.edge.from}->${edge.edge.to}#${String(index)}`
                )) }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("g", { "data-dsh-rich": "nodes", "data-dsh-rich-node-count": geometry.nodes.length, children: geometry.nodes.map((node) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(NodeShape, { geometry: node, theme: theme4 }, node.node.id)) })
              ]
            }
          )
        }
      )
    )
  ] });
}

// rich/src/client/renderers/message-card.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function MessageCard({ content, theme: theme4, onAction, busy, feedback, settledActionId }) {
  const actions = content.actions ?? [];
  const isBusy = busy === true;
  const isSettled = settledActionId !== void 0;
  const disabled = isBusy || isSettled;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "section",
    {
      "data-dsh-rich": "message-card",
      "data-dsh-rich-question-id": content.questionId,
      "aria-busy": isBusy ? true : void 0,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        border: `0.5px solid ${theme4.border}`,
        borderRadius: "var(--dsw-radius-md, 10px)",
        background: theme4.surface,
        color: theme4.text,
        padding: "10px 12px",
        minWidth: 0
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { "data-dsh-rich": "card-header", style: { display: "flex", flexDirection: "column", gap: "1px" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { "data-dsh-rich": "card-title", style: { fontWeight: 600, fontSize: "13px" }, children: content.title }),
          content.subtitle !== void 0 && content.subtitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { "data-dsh-rich": "card-subtitle", style: { color: theme4.muted, fontSize: "12px" }, children: content.subtitle }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            "data-dsh-rich": "card-body",
            style: { whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "13px", lineHeight: 1.5 },
            children: content.body
          }
        ),
        content.questionId !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { "data-dsh-rich": "question-hint", style: { color: theme4.muted, fontSize: "11px" }, children: "Choose an option to answer this question." }) : null,
        actions.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "div",
          {
            "data-dsh-rich": "card-actions",
            role: "group",
            "aria-label": `${content.title} actions`,
            style: { display: "flex", flexWrap: "wrap", gap: "8px" },
            children: actions.map((action) => {
              const settled = settledActionId === action.id;
              return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
                "button",
                {
                  type: "button",
                  "data-dsh-rich-action": action.id,
                  "data-dsh-rich-settled": settled ? "true" : void 0,
                  disabled,
                  "aria-disabled": disabled,
                  "aria-label": settled ? `${action.label}\uFF08\u5DF2\u63D0\u4EA4\uFF09` : action.label,
                  onClick: () => {
                    if (!disabled) onAction(action.id);
                  },
                  style: {
                    padding: "5px 12px",
                    borderRadius: "6px",
                    border: `0.5px solid ${settled ? theme4.accent : theme4.border}`,
                    background: settled ? theme4.accent : "transparent",
                    color: settled ? "#ffffff" : theme4.text,
                    font: "inherit",
                    fontSize: "12px",
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled && !settled ? 0.55 : 1
                  },
                  children: [
                    action.label,
                    settled ? "\uFF08\u5DF2\u63D0\u4EA4\uFF09" : ""
                  ]
                },
                action.id
              );
            })
          }
        ) : null,
        isBusy ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { "data-dsh-rich": "busy", role: "status", "aria-live": "polite", style: { color: theme4.muted, fontSize: "12px" }, children: "Submitting your choice..." }) : null,
        feedback !== void 0 && feedback.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { "data-dsh-rich": "feedback", role: "status", "aria-live": "polite", style: { color: theme4.muted, fontSize: "12px", wordBreak: "break-word" }, children: feedback }) : null
      ]
    }
  );
}

// rich/src/client/renderers/index.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function RenderFailure({ message, code }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
    "div",
    {
      "data-dsh-rich": "render-error",
      role: "alert",
      style: { padding: "10px 12px", border: "0.5px solid var(--dsw-alias-state-error-primary, #c62828)", borderRadius: "var(--dsw-radius-md, 8px)", color: "var(--dsw-alias-state-error-primary, #c62828)" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: "\u56FE\u5F62\u65E0\u6CD5\u663E\u793A\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { opacity: 0.8 }, children: [
          code,
          ": ",
          message
        ] })
      ]
    }
  );
}
var RendererBoundary = class extends import_react5.Component {
  state = { failed: null };
  static getDerivedStateFromError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return { failed: { message: message.slice(0, 300), code: "RENDER_THREW" } };
  }
  render() {
    if (this.state.failed !== null) {
      return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RenderFailure, { message: this.state.failed.message, code: this.state.failed.code });
    }
    return this.props.children;
  }
};
function RichContentView(props) {
  let body;
  switch (props.content.type) {
    case "line_plot":
      body = /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(LinePlot, { content: props.content, theme: props.theme });
      break;
    case "scatter_plot":
      body = /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(ScatterPlot, { content: props.content, theme: props.theme });
      break;
    case "basic_diagram":
      body = /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(BasicDiagram, { content: props.content, theme: props.theme });
      break;
    case "message_card":
      body = /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
        MessageCard,
        {
          content: props.content,
          theme: props.theme,
          onAction: props.onAction,
          busy: props.busy,
          feedback: props.feedback,
          settledActionId: props.settledActionId
        }
      );
      break;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RendererBoundary, { children: body });
}

// rich/src/client/dsw.ts
var DSW = {
  text: "var(--dsw-alias-label-primary, #1b1f24)",
  muted: "var(--dsw-alias-label-secondary, #5b6472)",
  faint: "var(--dsw-alias-label-tertiary, #8a929e)",
  border: "var(--dsw-alias-border-l2, #d9dee7)",
  layer: "var(--dsw-alias-bg-layer-1, #f6f7f9)",
  base: "var(--dsw-alias-bg-base, #ffffff)",
  hover: "var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04))",
  success: "var(--dsw-alias-state-success-primary, #1a7f37)",
  error: "var(--dsw-alias-state-error-primary, #c62828)",
  radius: "var(--dsw-radius-lg, 12px)",
  radiusSmall: "var(--dsw-radius-sm, 6px)"
};
var cardStyle = {
  border: `0.5px solid ${DSW.border}`,
  borderRadius: DSW.radius,
  padding: "12px 14px",
  margin: "6px 0",
  background: DSW.base,
  color: DSW.text,
  font: "inherit",
  fontSize: 13,
  lineHeight: 1.55,
  maxWidth: "100%",
  overflow: "hidden"
};
var buttonStyle = {
  font: "inherit",
  fontSize: 12,
  padding: "3px 10px",
  border: `0.5px solid ${DSW.border}`,
  borderRadius: DSW.radiusSmall,
  background: DSW.base,
  color: DSW.text,
  cursor: "pointer"
};
var noteStyle = { color: DSW.muted, fontSize: 12, margin: 0 };

// rich/src/client/toolview.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
var SERIES_COLORS = ["#d94f2b", "#247bbf", "#1a7f37", "#8e44ad", "#c98a00", "#0f766e", "#b0355b", "#475569"];
function themeOf() {
  return {
    text: DSW.text,
    muted: DSW.muted,
    border: DSW.border,
    surface: DSW.layer,
    accent: "#247bbf",
    series: SERIES_COLORS
  };
}
function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").trim();
}
function candidateFromArgs(raw) {
  if (raw === void 0 || raw.trim().length === 0) return { ok: false, text: "arguments not available yet" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, text: "arguments are not valid JSON yet" };
  }
  const candidate = parsed?.content;
  const result = validateRichContent(candidate);
  if (result.ok) return { ok: true, content: result.value };
  return { ok: false, text: formatValidationIssues(result.issues) };
}
function stageOf(props, previewArgs) {
  if (props.phase === "preparing") return { kind: "preparing" };
  if (props.phase === "start") {
    if (!previewArgs) return { kind: "preparing" };
    const candidate = candidateFromArgs(props.block.argsRaw);
    return candidate.ok ? { kind: "preview", content: candidate.content } : { kind: "preparing" };
  }
  const block = props.block;
  if (block.isError === true) {
    const detail = textOf(block.content);
    const reason = block.error?.reason;
    const code = block.error?.code ?? "TOOL_ERROR";
    return {
      kind: "error",
      code,
      text: [detail, reason === void 0 ? "" : `(${reason})`, block.error?.name ?? ""].filter(Boolean).join(" ").slice(0, 600)
    };
  }
  const meta = block.meta;
  if (meta !== null && typeof meta === "object") {
    const record = meta;
    if (record["kind"] === "rich-response") {
      const raw = JSON.stringify(record).slice(0, 4e3);
      const envelope = readRichMeta(meta);
      if (envelope !== void 0) return { kind: "ready", content: envelope.content };
      const content = record["content"];
      const schemaVersion = readSchemaVersion(content);
      if (schemaVersion !== void 0 && schemaVersion !== 1) {
        return { kind: "unsupported", version: schemaVersion, raw };
      }
      const envelopeVersion = typeof record["envelopeVersion"] === "number" ? record["envelopeVersion"] : void 0;
      if (record["envelopeVersion"] !== 1) {
        return { kind: "unsupported-envelope", version: envelopeVersion, raw };
      }
      const validated = validateRichContent(content);
      return { kind: "invalid", text: formatValidationIssues(validated.ok ? [] : validated.issues) };
    }
  }
  return { kind: "missing" };
}
var TYPE_LABELS = {
  line_plot: "\u51FD\u6570\u56FE\u50CF",
  scatter_plot: "\u6563\u70B9\u56FE",
  basic_diagram: "\u793A\u610F\u56FE",
  message_card: "\u6D88\u606F\u5361\u7247"
};
function Frame(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
    "section",
    {
      "data-dsh-rich": "tool-card",
      "data-dsh-rich-phase": props.phase,
      "data-dsh-rich-status": props.status,
      "data-dsh-rich-call-id": props.callId,
      "data-dsh-rich-session": props.sessionId,
      style: cardStyle,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("header", { style: { marginBottom: "6px", fontSize: "12px", color: DSW.muted }, children: props.title }),
        props.children
      ]
    }
  );
}
function Note(props) {
  const color = props.tone === "error" ? DSW.error : DSW.muted;
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { color, fontSize: "12px", padding: "4px 0" }, children: props.children });
}
function createToolView(ctx, options = {}) {
  const previewArgs = options.previewArgs !== false;
  return function RichRenderToolView(props) {
    const stage = stageOf(props, previewArgs);
    const theme4 = (0, import_react6.useMemo)(themeOf, []);
    const [action, setAction] = (0, import_react6.useState)({ status: "idle" });
    const mounted = (0, import_react6.useRef)(true);
    const requestSeq = (0, import_react6.useRef)(0);
    (0, import_react6.useEffect)(() => () => {
      mounted.current = false;
    }, []);
    const content = stage.kind === "ready" ? stage.content : stage.kind === "preview" ? stage.content : void 0;
    const questionId = content?.type === "message_card" ? content.questionId : void 0;
    const runAction = (actionId) => {
      if (action.status === "busy" || action.status === "settled") return;
      if (content === void 0) return;
      const chosen = content.type === "message_card" ? content.actions?.find((candidate) => candidate.id === actionId) : void 0;
      if (chosen === void 0) return;
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      setAction({ status: "busy", actionId });
      void submitInteraction({
        ctx,
        sessionId: props.sessionId,
        callId: props.callId,
        ...questionId === void 0 ? {} : { questionId },
        actionId: chosen.id,
        answer: chosen.submitText,
        inputActions: props.inputActions,
        submitText: chosen.submitText
      }).then((outcome) => {
        if (!mounted.current || requestSeq.current !== seq) return;
        setAction(outcome.ok ? { status: "settled", actionId, outcome } : { status: "error", actionId, outcome });
      });
    };
    const busy = action.status === "busy";
    const settledActionId = action.status === "settled" ? action.actionId : void 0;
    const feedback = action.outcome === void 0 ? void 0 : action.status === "settled" ? action.outcome.text + (action.outcome.followUpQueued ? " \xB7 \u5DF2\u5728\u672C\u4F1A\u8BDD\u6392\u961F\u540E\u7EED\u56DE\u590D" : "") + (action.outcome.duplicate ? " \xB7 Host \u5DF2\u8BB0\u5F55\u91CD\u590D\u4F5C\u7B54" : "") : action.outcome.text;
    const title = content === void 0 ? "\u56FE\u5F62" : TYPE_LABELS[content.type];
    const status = stage.kind === "ready" ? action.status === "error" ? "action-error" : action.status === "settled" ? "interacted" : "ok" : stage.kind;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(Frame, { phase: props.phase, callId: props.callId, sessionId: props.sessionId, status, title, children: [
      stage.kind === "preparing" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Note, { children: "\u6B63\u5728\u51C6\u5907\u56FE\u5F62\u2026" }) : null,
      stage.kind === "preview" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Note, { children: "\u751F\u6210\u4E2D \xB7 \u6839\u636E\u5DF2\u6821\u9A8C\u7684\u53C2\u6570\u5B9E\u65F6\u9884\u89C8" }) : null,
      stage.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-dsh-rich": "error-state", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(Note, { tone: "error", children: [
          "\u5DE5\u5177\u8C03\u7528\u5931\u8D25\uFF08",
          stage.code,
          "\uFF09"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { fontSize: "12px", opacity: 0.8, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: stage.text })
      ] }) : null,
      stage.kind === "unsupported" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-dsh-rich": "unsupported-version", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(Note, { tone: "error", children: [
          "\u4E0D\u652F\u6301\u7684\u56FE\u5F62\u5185\u5BB9\u7248\u672C ",
          String(stage.version ?? "\u672A\u77E5"),
          "\uFF1B\u9700\u8981 schemaVersion 1\u3002"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("summary", { style: { cursor: "pointer", fontSize: "12px" }, children: "\u539F\u59CB\u6570\u636E" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("pre", { style: { maxHeight: "180px", overflow: "auto", fontSize: "11px" }, children: stage.raw })
        ] })
      ] }) : null,
      stage.kind === "unsupported-envelope" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-dsh-rich": "unsupported-envelope", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(Note, { tone: "error", children: [
          "\u4E0D\u652F\u6301\u7684\u56FE\u5F62\u8BB0\u5F55\u7248\u672C ",
          String(stage.version ?? "\u672A\u77E5"),
          "\uFF1B\u9700\u8981 envelopeVersion 1\u3002"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("summary", { style: { cursor: "pointer", fontSize: "12px" }, children: "\u539F\u59CB\u6570\u636E" }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("pre", { style: { maxHeight: "180px", overflow: "auto", fontSize: "11px" }, children: stage.raw })
        ] })
      ] }) : null,
      stage.kind === "invalid" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { "data-dsh-rich": "invalid-payload", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Note, { tone: "error", children: "\u4FDD\u5B58\u7684\u56FE\u5F62\u6570\u636E\u672A\u901A\u8FC7\u6821\u9A8C\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { style: { fontSize: "12px", opacity: 0.8, wordBreak: "break-word" }, children: stage.text })
      ] }) : null,
      stage.kind === "missing" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { "data-dsh-rich": "missing-payload", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Note, { children: "\u6B64\u5DE5\u5177\u7ED3\u679C\u6CA1\u6709\u56FE\u5F62\u6570\u636E\uFF0C\u4EC5\u663E\u793A\u5DE5\u5177\u6587\u672C\u3002" }) }) : null,
      content !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        RichContentView,
        {
          content,
          theme: theme4,
          onAction: runAction,
          busy,
          feedback,
          settledActionId
        }
      ) : null,
      action.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { "data-dsh-rich": "action-error", style: { color: DSW.error, fontSize: "12px", marginTop: "4px" }, children: feedback }) : null,
      action.status === "settled" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { "data-dsh-rich": "action-ack", style: { color: DSW.success, fontSize: "12px", marginTop: "4px" }, children: feedback }) : null
    ] });
  };
}

// rich/src/client/physics-view.tsx
var import_react7 = require("react");

// rich/src/shared/physics.ts
function boundedNumber(value, name4, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name4} must be finite and between ${minimum} and ${maximum}`);
  }
}
function boundedInteger(value, name4, minimum, maximum) {
  boundedNumber(value, name4, minimum, maximum);
  if (!Number.isInteger(value)) throw new RangeError(`${name4} must be an integer`);
}
function infiniteWell(n, intervals = 512) {
  boundedInteger(n, "n", 1, 10);
  boundedInteger(intervals, "intervals", Math.max(32, 16 * n), 2048);
  const points = Array.from({ length: intervals + 1 }, (_, index) => {
    const x = index / intervals;
    const psi = index === 0 || index === intervals ? 0 : Math.SQRT2 * Math.sin(n * Math.PI * x);
    return { x, psi, density: psi * psi };
  });
  let integral = 0;
  for (let index = 1; index < points.length; index++) {
    integral += (points[index - 1].density + points[index].density) / (2 * intervals);
  }
  const nodes = Array.from({ length: n - 1 }, (_, index) => (index + 1) / n);
  return { points, integral, nodes, energyRatio: n * n };
}
function harmonicOscillator(options, intervals = 256) {
  const { mass, spring, amplitude, phase } = options;
  boundedNumber(mass, "mass", 0.1, 10);
  boundedNumber(spring, "spring", 0.1, 100);
  boundedNumber(amplitude, "amplitude", 0, 5);
  boundedNumber(phase, "phase", 0, 2 * Math.PI);
  boundedInteger(intervals, "intervals", 32, 2048);
  const omega = Math.sqrt(spring / mass);
  const period = 2 * Math.PI / omega;
  const totalEnergy = 0.5 * spring * amplitude * amplitude;
  const points = Array.from({ length: intervals + 1 }, (_, index) => {
    const t = index * period / intervals;
    const angle = omega * t + phase;
    const x = amplitude * Math.cos(angle);
    const v = -amplitude * omega * Math.sin(angle);
    const kinetic = 0.5 * mass * v * v;
    const potential = 0.5 * spring * x * x;
    return { t, x, v, kinetic, potential, total: kinetic + potential };
  });
  return { omega, period, totalEnergy, points };
}
function isingExample(size, kind, seed = 1) {
  boundedInteger(size, "size", 4, 32);
  boundedInteger(seed, "seed", 0, 4294967295);
  if (kind !== "ordered" && kind !== "random") throw new RangeError("kind must be ordered or random");
  let state = seed === 0 ? 1 : seed;
  const spins = Array.from({ length: size * size }, () => {
    if (kind === "ordered") return 1;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0 < 2147483648 ? -1 : 1;
  });
  let magnetization = 0;
  let energy = 0;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const spin = spins[row * size + column];
      const right = spins[row * size + (column + 1) % size];
      const down = spins[(row + 1) % size * size + column];
      magnetization += spin;
      energy -= spin * (right + down);
    }
  }
  return { size, spins, magnetization: magnetization / spins.length, energyPerSpin: energy / spins.length };
}

// rich/src/shared/physics-protocol.ts
var PHYSICS_DEMOS = ["infinite_well", "harmonic_oscillator", "ising"];
function physicsArgs(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a named physics demo");
  const record = value;
  if (Object.keys(record).some((k) => k !== "demo") || !PHYSICS_DEMOS.includes(record.demo)) throw new Error("Unsupported physics demo or extra fields");
  return { demo: record.demo };
}
function readPhysicsMeta(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const record = value;
  if (record.kind !== "rich-physics" || record.version !== 1 || Object.keys(record).some((k) => !["kind", "version", "demo"].includes(k))) return;
  try {
    return physicsArgs({ demo: record.demo });
  } catch {
    return;
  }
}

// rich/src/client/physics-export.ts
var PHYSICS_SVG_THEME = {
  text: "#182433",
  muted: "#667085",
  border: "#ccd3dc",
  surface: "#f7f9fc",
  accent: "#247bbf",
  series: ["#247bbf", "#c95132", "#258545"]
};
function physicsSvgDetails(demo, p) {
  if (demo === "infinite_well") return {
    title: "\u4E00\u7EF4\u65E0\u9650\u6DF1\u65B9\u52BF\u9631",
    parameters: [
      `n=${p.n}\uFF1B\u663E\u793A\u91CF=${p.density ? "\u5F52\u4E00\u5316\u6982\u7387\u5BC6\u5EA6" : "\u5F52\u4E00\u5316\u6CE2\u51FD\u6570"}\uFF1BE\u2099/E\u2081=${p.n * p.n}`,
      `\u79EF\u5206=${infiniteWell(p.n).integral.toFixed(9)}\uFF1B\u5185\u90E8\u8282\u70B9=${p.n - 1}`
    ],
    legend: [{ label: p.density ? "|\u03C8|\xB2 \u6982\u7387\u5BC6\u5EA6" : "\u03C8 \u6CE2\u51FD\u6570", color: "#247bbf" }],
    model: ["\u7406\u60F3\u65E0\u9650\u6DF1\u52BF\u9631\uFF1BL=1\uFF0C\u65E0\u91CF\u7EB2\u5750\u6807 0\u2264x\u22641\u3002", "\u03C8\u2099(x)=\u221A2 sin(n\u03C0x)\uFF1B\u4E24\u7AEF\u6CE2\u51FD\u6570\u4E3A\u96F6\u3002"]
  };
  if (demo === "harmonic_oscillator") return {
    title: "\u7ECF\u5178\u7B80\u8C10\u632F\u5B50",
    parameters: [
      `m=${p.mass} kg\uFF1Bk=${p.spring} N/m\uFF1BA=${p.amplitude} m\uFF1B\u03C6=${p.phase} rad`,
      `\u663E\u793A\u91CF=${p.quantity === "energy" ? "\u80FD\u91CF (J)" : p.quantity === "velocity" ? "\u901F\u5EA6 (m/s)" : "\u4F4D\u79FB (m)"}\uFF1B\u65F6\u95F4\u5355\u4F4D s`,
      `\u03C9=${harmonicOscillator(p).omega.toFixed(6)} rad/s\uFF1B\u603B\u80FD\u91CF=${harmonicOscillator(p).totalEnergy.toFixed(6)} J`
    ],
    legend: p.quantity === "energy" ? [{ label: "\u52A8\u80FD", color: "#247bbf" }, { label: "\u52BF\u80FD", color: "#c95132" }, { label: "\u603B\u80FD\u91CF", color: "#258545" }] : [{ label: p.quantity === "velocity" ? "v \u901F\u5EA6" : "x \u4F4D\u79FB", color: "#247bbf" }],
    model: ["\u7ECF\u5178\u8D28\u91CF-\u5F39\u7C27\u6A21\u578B\uFF1B\u65E0\u963B\u5C3C\u3001\u65E0\u9A71\u52A8\uFF1B\u53EA\u5C55\u793A\u4E00\u4E2A\u5468\u671F\u3002", "x=A cos(\u03C9t+\u03C6)\uFF0Cv=\u2212A\u03C9 sin(\u03C9t+\u03C6)\uFF0C\u03C9=\u221A(k/m)\u3002"]
  };
  return {
    title: "\u4E8C\u7EF4 Ising \u6709\u9650\u6784\u578B",
    parameters: [
      `N=${p.size}\uFF1B\u6784\u578B=${p.kind === "ordered" ? "\u6709\u5E8F +1" : "\u72EC\u7ACB\u968F\u673A"}\uFF1Bseed=${p.seed}\uFF1BJ=1`,
      `M/N\xB2=${isingExample(p.size, p.kind, p.seed).magnetization.toFixed(6)}\uFF1B\u6BCF\u81EA\u65CB\u80FD\u91CF=${isingExample(p.size, p.kind, p.seed).energyPerSpin.toFixed(6)}`
    ],
    legend: [{ label: "\u7EA2 +1", color: "#c95132" }, { label: "\u84DD \u22121", color: "#247bbf" }],
    model: ["\u5468\u671F\u8FB9\u754C\uFF0CJ=1\uFF1B\u6BCF\u6761\u53F3\u5411\u548C\u4E0B\u5411\u76F8\u90BB\u952E\u53EA\u8BA1\u4E00\u6B21\u3002", "\u5355\u4E2A\u6709\u9650\u6784\u578B\uFF1B\u975E Monte Carlo \u91C7\u6837\uFF1B\u975E\u70ED\u529B\u5B66\u6781\u9650\u3002", "\u4E0D\u80FD\u636E\u6B64\u5224\u5B9A\u4E34\u754C\u6E29\u5EA6\u3002"]
  };
}
function createPhysicsSvgExport(source, details) {
  const document2 = source.ownerDocument;
  const namespace = "http://www.w3.org/2000/svg";
  const output = document2.createElementNS(namespace, "svg");
  const width = 800, plotWidth = width - 48;
  const box = (source.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  const sourceWidth = box[2] ?? 640, sourceHeight = box[3] ?? 240;
  const ratio = sourceWidth > 0 && sourceHeight > 0 ? sourceHeight / sourceWidth : 240 / 640;
  const plotHeight = Math.min(480, Math.max(240, plotWidth * ratio));
  const plotTop = 64 + 24 * (details.parameters.length + details.legend.length);
  const modelTop = plotTop + plotHeight + 28;
  const height = modelTop + 24 * details.model.length + 20;
  for (const [name4, value] of Object.entries({ xmlns: namespace, width, height, viewBox: `0 0 ${width} ${height}`, "font-family": "Arial, Microsoft YaHei, sans-serif", fill: PHYSICS_SVG_THEME.text, role: "img", "aria-label": details.title })) {
    output.setAttribute(name4, String(value));
  }
  function append(name4, attributes, text3) {
    const node = document2.createElementNS(namespace, name4);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text3 !== void 0) node.textContent = text3;
    output.appendChild(node);
  }
  append("title", {}, details.title);
  append("rect", { x: 0, y: 0, width, height, fill: "#ffffff" });
  append("text", { x: 24, y: 32, "font-size": 22, "font-weight": 600 }, details.title);
  let y = 58;
  for (const text3 of details.parameters) {
    append("text", { x: 24, y, "font-size": 14 }, text3);
    y += 24;
  }
  for (const item of details.legend) {
    append("line", { x1: 24, x2: 44, y1: y - 4, y2: y - 4, stroke: item.color, "stroke-width": 4 });
    append("text", { x: 54, y, "font-size": 14 }, item.label);
    y += 24;
  }
  const chart = source.cloneNode(true);
  chart.removeAttribute("style");
  for (const [name4, value] of Object.entries({ x: 24, y: plotTop, width: plotWidth, height: plotHeight, preserveAspectRatio: "xMidYMid meet" })) chart.setAttribute(name4, String(value));
  output.appendChild(chart);
  details.model.forEach((text3, index) => append("text", { x: 24, y: modelTop + 24 * index, "font-size": 14 }, text3));
  return output;
}
async function copyPhysicsData(data, clipboard) {
  if (typeof clipboard?.writeText !== "function") return "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u526A\u8D34\u677F\u590D\u5236\uFF0C\u8BF7\u4F7F\u7528\u5BFC\u51FA SVG\u3002";
  try {
    await clipboard.writeText(JSON.stringify(data));
    return "\u5DF2\u590D\u5236\u8BA1\u7B97\u6570\u636E\u3002";
  } catch {
    return "\u6D4F\u89C8\u5668\u672A\u5141\u8BB8\u590D\u5236\uFF0C\u8BF7\u4F7F\u7528\u5BFC\u51FA SVG\u3002";
  }
}
async function enterPhysicsFullscreen(target) {
  if (typeof target?.requestFullscreen !== "function") return "\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u5168\u5C4F\u663E\u793A\u3002";
  try {
    await target.requestFullscreen();
    return "\u5DF2\u8FDB\u5165\u5168\u5C4F\u3002";
  } catch {
    return "\u5F53\u524D\u6D4F\u89C8\u5668\u672A\u8FDB\u5165\u5168\u5C4F\u3002";
  }
}

// rich/src/client/physics-view.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
var theme = PHYSICS_SVG_THEME;
var defaults = { n: 1, mass: 1, spring: 4, amplitude: 1, phase: 0, quantity: "position", density: false, size: 16, kind: "ordered", seed: 1 };
function readPreferences(key) {
  try {
    if (typeof window === "undefined") return { ...defaults };
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (raw?.version !== 1 || !raw.value) return { ...defaults };
    const p = raw.value;
    infiniteWell(p.n);
    harmonicOscillator(p);
    isingExample(p.size, p.kind, p.seed);
    if (!["position", "velocity", "energy"].includes(p.quantity) || typeof p.density !== "boolean") return { ...defaults };
    return { n: p.n, mass: p.mass, spring: p.spring, amplitude: p.amplitude, phase: p.phase, quantity: p.quantity, density: p.density, size: p.size, kind: p.kind, seed: p.seed };
  } catch {
    return { ...defaults };
  }
}
function graph(title, series, xLabel, xUnit, yLabel, yUnit) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(LinePlot, { theme, content: { schemaVersion: 1, type: "line_plot", title, data: { series, xAxis: { label: xLabel, unit: xUnit }, yAxis: { label: yLabel, unit: yUnit } } } });
}
function PhysicsDemoCard({ demo, storageKey }) {
  const [p, setPreferences] = (0, import_react7.useState)(() => readPreferences(storageKey)), [notice, setNotice] = (0, import_react7.useState)("");
  const root = (0, import_react7.useRef)(null);
  (0, import_react7.useEffect)(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, value: p }));
    } catch {
    }
  }, [storageKey, p]);
  function set(key, value) {
    setPreferences((previous) => ({ ...previous, [key]: value }));
  }
  const calculation = (0, import_react7.useMemo)(() => demo === "infinite_well" ? { kind: "well", data: infiniteWell(p.n) } : demo === "harmonic_oscillator" ? { kind: "oscillator", data: harmonicOscillator(p) } : { kind: "ising", data: isingExample(p.size, p.kind, p.seed) }, [demo, p.n, p.mass, p.spring, p.amplitude, p.phase, p.size, p.kind, p.seed]);
  function slider(label, key, min, max, step) {
    return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { style: { display: "grid", gridTemplateColumns: "minmax(80px, 130px) minmax(0, 1fr) 54px", gap: 8, alignItems: "center" }, children: [
      label,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("input", { "aria-label": label, type: "range", min, max, step, style: { minWidth: 0, width: "100%" }, value: p[key], onChange: (e) => set(key, Number(e.target.value)) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("output", { children: p[key].toFixed(key === "n" || key === "size" ? 0 : 2) })
    ] });
  }
  function exportSvg() {
    const svg = root.current?.querySelector("svg");
    if (!svg) {
      setNotice("\u56FE\u5F62\u5C1A\u672A\u51C6\u5907\u597D\u3002");
      return;
    }
    try {
      const copy = createPhysicsSvgExport(svg, physicsSvgDetails(demo, p));
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = demo + ".svg";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("\u5DF2\u5BFC\u51FA\u5F53\u524D SVG\u3002");
    } catch {
      setNotice("\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u5BFC\u51FA SVG\u3002");
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { ref: root, "data-physics-demo": demo, style: { ...cardStyle, overflow: "auto" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: demo === "infinite_well" ? "\u4E00\u7EF4\u65E0\u9650\u6DF1\u65B9\u52BF\u9631" : demo === "harmonic_oscillator" ? "\u7ECF\u5178\u7B80\u8C10\u632F\u5B50" : "\u4E8C\u7EF4 Ising \u6709\u9650\u6784\u578B" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { style: { ...noteStyle, marginTop: 2 }, children: "\u786E\u5B9A\u6027\u8BA1\u7B97 \xB7 \u53C2\u6570\u53D8\u5316\u4EC5\u5F71\u54CD\u6F14\u793A\uFF0C\u4E0D\u6539\u53D8\u5B66\u4E60\u6210\u7EE9\u3002" })
    ] }),
    calculation.kind === "well" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      slider("\u91CF\u5B50\u6570 n", "n", 1, 10, 1),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("input", { type: "checkbox", checked: p.density, onChange: (e) => set("density", e.target.checked) }),
        "\u663E\u793A\u6982\u7387\u5BC6\u5EA6"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "\u53D6 L=1 \u7684\u65E0\u91CF\u7EB2\u5750\u6807\uFF0C\u03C8\u2099(x)=\u221A2 sin(n\u03C0x)\uFF0C0\u2264x\u22641\u3002" }),
      graph(p.density ? "\u5F52\u4E00\u5316\u6982\u7387\u5BC6\u5EA6" : "\u5F52\u4E00\u5316\u6CE2\u51FD\u6570", [{ name: p.density ? "|\u03C8|\xB2" : "\u03C8", points: calculation.data.points.map((point) => ({ x: point.x, y: p.density ? point.density : point.psi })) }], "x/L", "1", p.density ? "L|\u03C8|\xB2" : "\u221AL \u03C8", "1"),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { "data-physics-integral": calculation.data.integral.toFixed(9), children: [
        "\u6570\u503C\u5F52\u4E00\u5316\u79EF\u5206\uFF1A",
        calculation.data.integral.toFixed(9),
        "\uFF1B\u5185\u90E8\u8282\u70B9\uFF1A",
        calculation.data.nodes.length,
        "\uFF1BE\u2099/E\u2081=",
        calculation.data.energyRatio,
        "\u3002"
      ] })
    ] }) : calculation.kind === "oscillator" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      slider("\u8D28\u91CF m (kg)", "mass", 0.1, 10, 0.1),
      slider("\u52B2\u5EA6 k (N/m)", "spring", 0.1, 100, 0.1),
      slider("\u632F\u5E45 A (m)", "amplitude", 0, 5, 0.1),
      slider("\u521D\u76F8 \u03C6 (rad)", "phase", 0, 2 * Math.PI, 0.01),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
        "\u663E\u793A\u91CF ",
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("select", { "aria-label": "\u663E\u793A\u91CF", value: p.quantity, onChange: (e) => set("quantity", e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "position", children: "\u4F4D\u79FB" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "velocity", children: "\u901F\u5EA6" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "energy", children: "\u80FD\u91CF" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "x=A cos(\u03C9t+\u03C6)\uFF0Cv=\u2212A\u03C9 sin(\u03C9t+\u03C6)\uFF0C\u03C9=\u221A(k/m)\u3002\u5FFD\u7565\u963B\u5C3C\u548C\u9A71\u52A8\u3002" }),
      graph("\u4E00\u4E2A\u5468\u671F\u5185\u7684" + (p.quantity === "energy" ? "\u80FD\u91CF" : p.quantity === "velocity" ? "\u901F\u5EA6" : "\u4F4D\u79FB"), p.quantity === "energy" ? [
        { name: "\u52A8\u80FD", points: calculation.data.points.map((v) => ({ x: v.t, y: v.kinetic })) },
        { name: "\u52BF\u80FD", points: calculation.data.points.map((v) => ({ x: v.t, y: v.potential })) },
        { name: "\u603B\u80FD\u91CF", points: calculation.data.points.map((v) => ({ x: v.t, y: v.total })) }
      ] : [{ name: p.quantity === "velocity" ? "v" : "x", points: calculation.data.points.map((v) => ({ x: v.t, y: p.quantity === "velocity" ? v.v : v.x })) }], "t", "s", p.quantity === "energy" ? "E" : p.quantity === "velocity" ? "v" : "x", p.quantity === "energy" ? "J" : p.quantity === "velocity" ? "m/s" : "m"),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { "data-physics-energy": calculation.data.totalEnergy, children: [
        "\u03C9=",
        calculation.data.omega.toFixed(4),
        " rad/s\uFF1BT=",
        calculation.data.period.toFixed(4),
        " s\uFF1B\u603B\u80FD\u91CF=",
        calculation.data.totalEnergy.toFixed(6),
        " J\u3002"
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      slider("\u683C\u70B9\u8FB9\u957F N", "size", 4, 32, 1),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { children: [
        "\u793A\u4F8B\u6784\u578B ",
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("select", { "aria-label": "\u793A\u4F8B\u6784\u578B", value: p.kind, onChange: (e) => set("kind", e.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "ordered", children: "\u6709\u5E8F +1" }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "random", children: "\u72EC\u7ACB\u968F\u673A" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", onClick: () => set("seed", p.seed + 1 >>> 0), children: "\u6362\u4E00\u7EC4\u968F\u673A\u79CD\u5B50" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("svg", { role: "img", "aria-label": `${p.size}\xD7${p.size} \u5468\u671F\u8FB9\u754C Ising \u81EA\u65CB\u6784\u578B`, viewBox: `0 0 ${p.size} ${p.size}`, style: { display: "block", width: "min(100%, 420px)", aspectRatio: "1", margin: "12px auto" }, children: calculation.data.spins.map((spin, i) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("rect", { x: i % p.size, y: Math.floor(i / p.size), width: 0.94, height: 0.94, fill: spin === 1 ? "#c95132" : "#247bbf" }, i)) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { "data-physics-magnetization": calculation.data.magnetization, children: [
        "\u7EA2 +1 / \u84DD \u22121\uFF1B\u78C1\u5316\u5F3A\u5EA6 M/N\xB2=",
        calculation.data.magnetization.toFixed(6),
        "\uFF1B\u6BCF\u81EA\u65CB\u80FD\u91CF=",
        calculation.data.energyPerSpin.toFixed(6),
        "\uFF08J=1\uFF09\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "\u5468\u671F\u8FB9\u754C\uFF1B\u8FD9\u662F\u5355\u4E2A\u6709\u9650\u6784\u578B\uFF0C\u968F\u673A\u793A\u4F8B\u4E0D\u662F\u6709\u9650\u6E29\u5EA6 Monte Carlo \u91C7\u6837\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u5B9A\u4E34\u754C\u6E29\u5EA6\u6216\u70ED\u529B\u5B66\u6781\u9650\u3002" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("footer", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", style: buttonStyle, onClick: exportSvg, children: "\u5BFC\u51FA SVG" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", style: buttonStyle, onClick: () => {
        void enterPhysicsFullscreen(root.current).then(setNotice);
      }, children: "\u5168\u5C4F" }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", style: buttonStyle, onClick: () => {
        void copyPhysicsData(calculation.data, typeof navigator === "undefined" ? void 0 : navigator.clipboard).then(setNotice);
      }, children: "\u590D\u5236\u6570\u636E" })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "status", "aria-live": "polite", children: notice })
  ] });
}
function PhysicsToolView(props) {
  if (props.phase !== "result") return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: "\u6B63\u5728\u51C6\u5907\u786E\u5B9A\u6027\u7269\u7406\u6F14\u793A\u2026" });
  const block = props.block, parsed = readPhysicsMeta(block.meta);
  if (block.isError || !parsed) return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { role: "alert", children: "\u7269\u7406\u6F14\u793A\u6570\u636E\u4E0D\u53EF\u7528\u3002" });
  const key = "dsh-rich-physics:v1:" + props.sessionId + ":" + props.callId;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(PhysicsDemoCard, { demo: parsed.demo, storageKey: key }, key);
}

// rich/src/client/heatmap-view.tsx
var import_react8 = require("react");

// rich/src/shared/plain-text.ts
var UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
var UNSAFE_TEXT_GLOBAL = new RegExp(UNSAFE_TEXT.source, "g");
function isPlainText(text3) {
  return !UNSAFE_TEXT.test(text3);
}

// rich/src/shared/heatmap.ts
var HEATMAP_SCHEMA_VERSION = 1;
var HEATMAP_META_KIND = "rich-heatmap";
var HEATMAP_ENVELOPE_VERSION = 1;
var HEATMAP_LIMITS = {
  maxSerializedBytes: 256 * 1024,
  maxTitleLength: 200,
  maxSubtitleLength: 500,
  maxLabelLength: 80,
  maxRows: 128,
  maxColumns: 128,
  maxCells: 4096,
  /** Largest absolute cell value, axis bound or scale bound. */
  maxAbsValue: 1e7
};
var SEQUENTIAL_STOPS = ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"];
var DIVERGING_STOPS = ["#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b"];
function issue2(code, path, detail) {
  return { code, path, detail };
}
function isCanonicalFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}
function text2(raw, path, maxLength, code, required, issues) {
  if (raw === void 0 || raw === null) {
    if (required) issues.push(issue2(code, path, "is required"));
    return void 0;
  }
  if (typeof raw !== "string") {
    issues.push(issue2(code, path, "must be a string"));
    return void 0;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    issues.push(issue2(code, path, `must be 1..${String(maxLength)} characters after trimming`));
    return void 0;
  }
  if (!isPlainText(trimmed)) {
    issues.push(issue2(code, path, "must be one line of plain text without control or bidirectional-control characters"));
    return void 0;
  }
  return trimmed;
}
function bounds(raw, path, code, issues) {
  const min = raw["min"];
  const max = raw["max"];
  if (min === void 0 && max === void 0) return void 0;
  if (!isCanonicalFinite(min) || !isCanonicalFinite(max)) {
    issues.push(issue2(code, path, "min and max must both be finite canonical numbers when either is given"));
    return void 0;
  }
  if (Math.abs(min) > HEATMAP_LIMITS.maxAbsValue || Math.abs(max) > HEATMAP_LIMITS.maxAbsValue) {
    issues.push(issue2(code, path, `bounds must satisfy |value| <= ${String(HEATMAP_LIMITS.maxAbsValue)}`));
    return void 0;
  }
  if (min >= max) {
    issues.push(issue2(code, path, "min must be strictly below max"));
    return void 0;
  }
  return { min, max };
}
function validateAxis2(raw, path, issues) {
  if (raw === void 0 || raw === null) return void 0;
  if (!isRecord(raw)) {
    issues.push(issue2("INVALID_AXIS", path, "must be an object"));
    return void 0;
  }
  const label = text2(raw["label"], `${path}.label`, HEATMAP_LIMITS.maxLabelLength, "INVALID_AXIS", false, issues);
  const unit2 = text2(raw["unit"], `${path}.unit`, HEATMAP_LIMITS.maxLabelLength, "INVALID_AXIS", false, issues);
  const range = bounds(raw, path, "INVALID_AXIS", issues);
  return {
    ...label === void 0 ? {} : { label },
    ...unit2 === void 0 ? {} : { unit: unit2 },
    ...range ?? {}
  };
}
function validateScale(raw, issues) {
  if (raw === void 0 || raw === null) return { palette: "sequential" };
  if (!isRecord(raw)) {
    issues.push(issue2("INVALID_SCALE", "colorScale", "must be an object"));
    return { palette: "sequential" };
  }
  let palette = "sequential";
  const rawPalette = raw["palette"];
  if (rawPalette === "sequential" || rawPalette === "diverging") palette = rawPalette;
  else if (rawPalette !== void 0) issues.push(issue2("INVALID_SCALE", "colorScale.palette", "must be sequential or diverging"));
  const label = text2(raw["label"], "colorScale.label", HEATMAP_LIMITS.maxLabelLength, "INVALID_SCALE", false, issues);
  const unit2 = text2(raw["unit"], "colorScale.unit", HEATMAP_LIMITS.maxLabelLength, "INVALID_SCALE", false, issues);
  const range = bounds(raw, "colorScale", "INVALID_SCALE", issues);
  return {
    palette,
    ...label === void 0 ? {} : { label },
    ...unit2 === void 0 ? {} : { unit: unit2 },
    ...range ?? {}
  };
}
function preScan(values) {
  if (!Array.isArray(values)) return void 0;
  if (values.length > HEATMAP_LIMITS.maxRows) {
    return issue2("TOO_MANY_CELLS", "values", `at most ${String(HEATMAP_LIMITS.maxRows)} rows are allowed`);
  }
  let total = 0;
  for (let row = 0; row < values.length; row += 1) {
    const candidate = values[row];
    if (!Array.isArray(candidate)) continue;
    if (candidate.length > HEATMAP_LIMITS.maxColumns) {
      return issue2("TOO_MANY_CELLS", `values[${String(row)}]`, `at most ${String(HEATMAP_LIMITS.maxColumns)} columns are allowed`);
    }
    total += candidate.length;
  }
  if (total > HEATMAP_LIMITS.maxCells) {
    return issue2("TOO_MANY_CELLS", "values", `at most ${String(HEATMAP_LIMITS.maxCells)} cells are allowed`);
  }
  return void 0;
}
function validateValues(raw, issues) {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(issue2("INVALID_VALUES", "values", "must be a non-empty array of rows"));
    return [];
  }
  const first = raw[0];
  const columns = Array.isArray(first) ? first.length : 0;
  if (columns === 0) {
    issues.push(issue2("INVALID_VALUES", "values[0]", "must be a non-empty array of numbers"));
    return [];
  }
  const rows = [];
  for (let r = 0; r < raw.length; r += 1) {
    const candidate = raw[r];
    if (!Array.isArray(candidate) || candidate.length !== columns) {
      issues.push(issue2("INVALID_VALUES", `values[${String(r)}]`, `every row must be an array of ${String(columns)} numbers`));
      return [];
    }
    const row = [];
    for (let c = 0; c < columns; c += 1) {
      const value = candidate[c];
      const path = `values[${String(r)}][${String(c)}]`;
      if (!isCanonicalFinite(value)) issues.push(issue2("NON_FINITE_NUMBER", path, "must be a finite, canonical JSON number (NaN, +/-Infinity and -0 are rejected)"));
      else if (Math.abs(value) > HEATMAP_LIMITS.maxAbsValue) issues.push(issue2("VALUE_OUT_OF_RANGE", path, `must satisfy |value| <= ${String(HEATMAP_LIMITS.maxAbsValue)}`));
      else row.push(value);
    }
    rows.push(row);
  }
  return rows;
}
function validateUnsafe(value) {
  if (!isRecord(value)) return { ok: false, issues: [issue2("NOT_AN_OBJECT", "", "payload must be a JSON object")] };
  if (value["schemaVersion"] !== HEATMAP_SCHEMA_VERSION) {
    return { ok: false, issues: [issue2("UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", `only schemaVersion ${String(HEATMAP_SCHEMA_VERSION)} is supported`)] };
  }
  const oversized = preScan(value["values"]);
  if (oversized !== void 0) return { ok: false, issues: [oversized] };
  const size = serializedByteSize(value);
  if (size > HEATMAP_LIMITS.maxSerializedBytes) {
    return { ok: false, issues: [issue2("PAYLOAD_TOO_LARGE", "", `serialized payload is ${String(size)} bytes (limit ${String(HEATMAP_LIMITS.maxSerializedBytes)})`)] };
  }
  const issues = [];
  const title = text2(value["title"], "title", HEATMAP_LIMITS.maxTitleLength, "INVALID_TITLE", true, issues);
  const subtitle = text2(value["subtitle"], "subtitle", HEATMAP_LIMITS.maxSubtitleLength, "INVALID_SUBTITLE", false, issues);
  const values = validateValues(value["values"], issues);
  let origin = "lower";
  const rawOrigin = value["origin"];
  if (rawOrigin === "lower" || rawOrigin === "upper") origin = rawOrigin;
  else if (rawOrigin !== void 0) issues.push(issue2("INVALID_ORIGIN", "origin", "must be lower or upper"));
  const xAxis = validateAxis2(value["xAxis"], "xAxis", issues);
  const yAxis = validateAxis2(value["yAxis"], "yAxis", issues);
  const colorScale = validateScale(value["colorScale"], issues);
  if (issues.length === 0 && colorScale.min !== void 0 && colorScale.max !== void 0) {
    const { min, max } = colorScale;
    values.forEach((row, r) => row.forEach((cell, c) => {
      if (cell < min || cell > max) {
        issues.push(issue2("VALUE_OUT_OF_SCALE", `values[${String(r)}][${String(c)}]`, "must lie inside the explicit colorScale range"));
      }
    }));
  }
  if (issues.length > 0 || title === void 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      schemaVersion: HEATMAP_SCHEMA_VERSION,
      title,
      ...subtitle === void 0 ? {} : { subtitle },
      values,
      origin,
      ...xAxis === void 0 ? {} : { xAxis },
      ...yAxis === void 0 ? {} : { yAxis },
      colorScale
    }
  };
}
function validateHeatmap(value) {
  try {
    return validateUnsafe(value);
  } catch {
    return { ok: false, issues: [issue2("NOT_AN_OBJECT", "", "payload could not be read as a JSON object")] };
  }
}
function readHeatmapMeta(value) {
  try {
    if (!isRecord(value)) return void 0;
    if (value["kind"] !== HEATMAP_META_KIND || value["envelopeVersion"] !== HEATMAP_ENVELOPE_VERSION) return void 0;
    const result = validateHeatmap(value["content"]);
    if (!result.ok) return void 0;
    return { kind: HEATMAP_META_KIND, envelopeVersion: HEATMAP_ENVELOPE_VERSION, content: result.value };
  } catch {
    return void 0;
  }
}
function heatmapExtent(content) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const row of content.values) {
    for (const value of row) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return { min, max };
}
function resolveHeatmapScale(content) {
  const { colorScale } = content;
  if (colorScale.min !== void 0 && colorScale.max !== void 0) {
    return { min: colorScale.min, max: colorScale.max, constant: false };
  }
  const extent = heatmapExtent(content);
  if (colorScale.palette === "diverging") {
    const bound = Math.max(Math.abs(extent.min), Math.abs(extent.max));
    return bound === 0 ? { min: 0, max: 0, constant: true } : { min: -bound, max: bound, constant: false };
  }
  return { min: extent.min, max: extent.max, constant: extent.min === extent.max };
}
function channel(hex, offset) {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}
function heatmapColor(palette, scale, value) {
  const stops = palette === "diverging" ? DIVERGING_STOPS : SEQUENTIAL_STOPS;
  const t = scale.constant ? 0.5 : Math.min(1, Math.max(0, (value - scale.min) / (scale.max - scale.min)));
  const position = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const fraction = position - index;
  const low = stops[index];
  const high = stops[index + 1];
  let color = "#";
  for (const offset of [1, 3, 5]) {
    const mixed = Math.round(channel(low, offset) + (channel(high, offset) - channel(low, offset)) * fraction);
    color += mixed.toString(16).padStart(2, "0");
  }
  return color;
}
function formatHeatmapNumber(value) {
  return String(Number(value.toPrecision(6)));
}
function formatHeatmapNumbers(values) {
  for (let precision = 6; ; precision += 1) {
    const labels = values.map((value) => String(Number(value.toPrecision(precision))));
    const seen = /* @__PURE__ */ new Map();
    const distinct = labels.every((label, index) => {
      const value = values[index] ?? 0;
      const prior = seen.get(label);
      seen.set(label, value);
      return prior === void 0 || prior === value;
    });
    if (distinct || precision >= 15) return labels;
  }
}

// rich/src/client/heatmap-view.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
var theme2 = PHYSICS_SVG_THEME;
var MARGIN = { top: 30, right: 92, bottom: 44, left: 60 };
var LEGEND_WIDTH = 14;
var LEGEND_STEPS = 32;
var FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
function px(value) {
  return String(Math.round(value * 1e3) / 1e3);
}
function withUnit(value, unit2) {
  return unit2 === void 0 ? formatHeatmapNumber(value) : `${formatHeatmapNumber(value)} ${unit2}`;
}
function rangeTicks(min, max, target) {
  const tolerance = (max - min) * 1e-9;
  const inside = [...new Set(niceTicks(min, max, target).filter((value) => value >= min - tolerance && value <= max + tolerance))];
  const values = inside.length >= 2 ? inside : [min, max];
  const labels = formatHeatmapNumbers(values);
  const seen = /* @__PURE__ */ new Set();
  return values.flatMap((value, index) => {
    const label = labels[index] ?? "";
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ value: Math.min(max, Math.max(min, value)), label }];
  });
}
function axisTicks(axis, count, length2) {
  if (axis?.min !== void 0 && axis.max !== void 0) {
    const { min, max } = axis;
    return rangeTicks(min, max, 6).map((tick) => ({ offset: (tick.value - min) / (max - min) * length2, label: tick.label }));
  }
  const step = Math.max(1, Math.ceil(count / 8));
  const ticks = [];
  for (let index = 0; index < count; index += step) ticks.push({ offset: (index + 0.5) / count * length2, label: String(index) });
  return ticks;
}
function cellCenter(axis, index, count) {
  if (axis?.min === void 0 || axis.max === void 0) return void 0;
  return axis.min + (index + 0.5) * (axis.max - axis.min) / count;
}
function HeatmapView({ content, width }) {
  const rows = content.values.length;
  const columns = content.values[0]?.length ?? 0;
  const scale = resolveHeatmapScale(content);
  const extent = heatmapExtent(content);
  const unit2 = content.colorScale.unit;
  const totalWidth = normalizeChartWidth(width);
  const plotWidth = totalWidth - MARGIN.left - MARGIN.right;
  const plotHeight = clamp(plotWidth * rows / columns, 120, 360);
  const totalHeight = MARGIN.top + plotHeight + MARGIN.bottom;
  const cellWidth = plotWidth / columns;
  const cellHeight = plotHeight / rows;
  const rowTop = (row) => MARGIN.top + (content.origin === "lower" ? rows - 1 - row : row) * cellHeight;
  const xTicks = axisTicks(content.xAxis, columns, plotWidth);
  const yTicks = axisTicks(content.yAxis, rows, plotHeight).map((tick) => ({
    ...tick,
    y: content.yAxis?.min !== void 0 || content.origin === "lower" ? MARGIN.top + plotHeight - tick.offset : MARGIN.top + tick.offset
  }));
  const legendX = MARGIN.left + plotWidth + 18;
  const legendTicks = scale.constant ? [{ value: scale.min, label: formatHeatmapNumber(scale.min), y: MARGIN.top + plotHeight / 2 }] : rangeTicks(scale.min, scale.max, 5).map((tick) => ({ ...tick, y: MARGIN.top + plotHeight - (tick.value - scale.min) / (scale.max - scale.min) * plotHeight }));
  const legendTitle = axisTitleText(content.colorScale.label, unit2);
  const xTitle = axisTitleText(content.xAxis?.label, content.xAxis?.unit);
  const yTitle = axisTitleText(content.yAxis?.label, content.yAxis?.unit);
  const [extentLow, extentHigh] = formatHeatmapNumbers([extent.min, extent.max]);
  const ariaLabel = `Heatmap ${content.title}: ${String(rows)} rows x ${String(columns)} columns, values ${String(extentLow)} to ${String(extentHigh)}${unit2 === void 0 ? "" : ` ${unit2}`}`;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "data-dsh-rich": "heatmap",
      role: "img",
      "aria-label": ariaLabel,
      viewBox: `0 0 ${String(totalWidth)} ${px(totalHeight)}`,
      width: "100%",
      style: { display: "block", maxWidth: "100%", height: "auto" },
      fontFamily: FONT,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("rect", { x: 0, y: 0, width: totalWidth, height: px(totalHeight), fill: "#ffffff" }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: MARGIN.left, y: 18, fontSize: 13, fontWeight: 600, fill: theme2.text, children: content.title }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("g", { "data-dsh-rich": "heatmap-cells", shapeRendering: "crispEdges", children: content.values.map((row, r) => row.map((value, c) => {
          const x = cellCenter(content.xAxis, c, columns);
          const y = cellCenter(content.yAxis, content.origin === "upper" ? rows - 1 - r : r, rows);
          const where = x === void 0 || y === void 0 ? "" : ` (x=${formatHeatmapNumber(x)}, y=${formatHeatmapNumber(y)})`;
          return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
            "rect",
            {
              "data-dsh-rich": "heatmap-cell",
              "data-dsh-rich-row": r,
              "data-dsh-rich-column": c,
              "data-dsh-rich-value": value,
              x: px(MARGIN.left + c * cellWidth),
              y: px(rowTop(r)),
              width: px(cellWidth),
              height: px(cellHeight),
              fill: heatmapColor(content.colorScale.palette, scale, value),
              children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("title", { children: `row ${String(r)}, column ${String(c)}${where}: ${withUnit(value, unit2)}` })
            },
            `${String(r)}:${String(c)}`
          );
        })) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("rect", { x: MARGIN.left, y: MARGIN.top, width: px(plotWidth), height: px(plotHeight), fill: "none", stroke: theme2.border }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("g", { "data-dsh-rich": "heatmap-x-axis", fontSize: 10, fill: theme2.muted, textAnchor: "middle", children: [
          xTicks.map((tick, index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: px(MARGIN.left + tick.offset), y: px(MARGIN.top + plotHeight + 14), children: tick.label }, index)),
          xTitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: px(MARGIN.left + plotWidth / 2), y: px(MARGIN.top + plotHeight + 34), fontSize: 11, fill: theme2.text, children: xTitle }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("g", { "data-dsh-rich": "heatmap-y-axis", fontSize: 10, fill: theme2.muted, textAnchor: "end", children: [
          yTicks.map((tick, index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: MARGIN.left - 6, y: px(tick.y + 3), children: tick.label }, index)),
          yTitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: 14, y: px(MARGIN.top + plotHeight / 2), fontSize: 11, fill: theme2.text, textAnchor: "middle", transform: `rotate(-90 14 ${px(MARGIN.top + plotHeight / 2)})`, children: yTitle }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("g", { "data-dsh-rich": "heatmap-legend", shapeRendering: "crispEdges", children: [
          Array.from({ length: LEGEND_STEPS }, (_unused, step) => {
            const value = scale.constant ? scale.min : scale.min + (step + 0.5) / LEGEND_STEPS * (scale.max - scale.min);
            const height = plotHeight / LEGEND_STEPS;
            return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
              "rect",
              {
                "data-dsh-rich": "heatmap-legend-step",
                x: legendX,
                y: px(MARGIN.top + plotHeight - (step + 1) * height),
                width: LEGEND_WIDTH,
                height: px(height + 0.5),
                fill: heatmapColor(content.colorScale.palette, scale, value)
              },
              step
            );
          }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("rect", { x: legendX, y: MARGIN.top, width: LEGEND_WIDTH, height: px(plotHeight), fill: "none", stroke: theme2.border }),
          legendTicks.map((tick, index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: legendX + LEGEND_WIDTH + 4, y: px(tick.y + 3), fontSize: 10, fill: theme2.muted, children: tick.label }, index)),
          legendTitle.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("text", { x: legendX, y: MARGIN.top - 8, fontSize: 10, fill: theme2.text, children: legendTitle }) : null
        ] })
      ]
    }
  );
}
function Heatmap({ content }) {
  const { ref, width } = useContainerWidth();
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { ref, "data-dsh-rich-container": "heatmap", style: { width: "100%", minWidth: 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(HeatmapView, { content, width }) });
}
function HeatmapCard({ content }) {
  const root = (0, import_react8.useRef)(null);
  const [notice, setNotice] = (0, import_react8.useState)("");
  function exportSvg() {
    const svg = root.current?.querySelector('svg[data-dsh-rich="heatmap"]');
    if (svg === null || svg === void 0) {
      setNotice("\u56FE\u5F62\u5C1A\u672A\u51C6\u5907\u597D\u3002");
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "heatmap.svg";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("\u5DF2\u5BFC\u51FA\u5F53\u524D SVG\u3002");
    } catch {
      setNotice("\u5F53\u524D\u6D4F\u89C8\u5668\u65E0\u6CD5\u5BFC\u51FA SVG\u3002");
    }
  }
  const scale = resolveHeatmapScale(content);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { ref: root, "data-dsh-rich": "heatmap-card", style: cardStyle, children: [
    content.subtitle === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { style: { ...noteStyle, marginBottom: 6 }, children: content.subtitle }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Heatmap, { content }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { style: { ...noteStyle, margin: "6px 0" }, children: `${content.colorScale.palette === "diverging" ? "\u53D1\u6563\u8272\u6807\uFF0C\u4E2D\u70B9" : "\u987A\u5E8F\u8272\u6807\uFF0C\u8303\u56F4"} ${formatHeatmapNumber(content.colorScale.palette === "diverging" ? (scale.min + scale.max) / 2 : scale.min)}${content.colorScale.palette === "diverging" ? "" : ` \u81F3 ${formatHeatmapNumber(scale.max)}`}\uFF1B${content.origin === "lower" ? "\u7B2C 0 \u884C\u5728\u5E95\u90E8" : "\u7B2C 0 \u884C\u5728\u9876\u90E8"}\uFF1B\u60AC\u505C\u683C\u5B50\u53EF\u67E5\u770B\u6570\u503C\u3002` }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("footer", { style: { display: "flex", gap: 8 }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", style: buttonStyle, onClick: exportSvg, children: "\u5BFC\u51FA SVG" }) }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { role: "status", "aria-live": "polite", style: { ...noteStyle, color: DSW.muted }, children: notice })
  ] });
}
function HeatmapToolView(props) {
  if (props.phase !== "result") return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { "data-dsh-rich": "heatmap-preparing", children: "\u6B63\u5728\u51C6\u5907\u70ED\u529B\u56FE\u2026" });
  const block = props.block;
  if (block.isError) {
    const detail = block.content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").slice(0, 600);
    return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { role: "alert", "data-dsh-rich": "heatmap-error", children: [
      "\u70ED\u529B\u56FE\u751F\u6210\u5931\u8D25\uFF1A",
      detail
    ] });
  }
  const envelope = readHeatmapMeta(block.meta);
  if (envelope === void 0) return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { role: "alert", "data-dsh-rich": "heatmap-invalid", children: "\u70ED\u529B\u56FE\u6570\u636E\u4E0D\u53EF\u7528\u6216\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002" });
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(HeatmapCard, { content: envelope.content });
}

// rich/src/client/image-view.tsx
var import_react9 = require("react");

// rich/src/shared/image.ts
var IMAGE_META_KIND = "rich-image";
var IMAGE_ENVELOPE_VERSION = 1;
var IMAGE_LIMITS = {
  maxPathLength: 1024,
  maxAltLength: 300,
  maxCaptionLength: 500,
  maxSourceNoteLength: 300,
  maxNameLength: 120,
  maxDimension: 8192,
  maxPixels: 4e7,
  /** Default per-image byte limit (`maxImageBytes` config). */
  defaultMaxImageBytes: 512 * 1024,
  minImageBytesLimit: 1024,
  maxImageBytesCeiling: 2 * 1024 * 1024
};
var IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
var IMAGE_SOURCES = ["computed", "user_provided"];
function fail(reason) {
  return { ok: false, reason };
}
function matches(data, offset, expected) {
  if (data.length < offset + expected.length) return false;
  return expected.every((byte, index) => data[offset + index] === byte);
}
function matchesAscii(data, offset, text3) {
  return matches(data, offset, [...text3].map((char) => char.charCodeAt(0)));
}
function u16be(data, offset) {
  return (data[offset] ?? 0) << 8 | (data[offset + 1] ?? 0);
}
function u16le(data, offset) {
  return (data[offset] ?? 0) | (data[offset + 1] ?? 0) << 8;
}
function u24le(data, offset) {
  return u16le(data, offset) | (data[offset + 2] ?? 0) << 16;
}
function u32le(data, offset) {
  return u16le(data, offset) + u16le(data, offset + 2) * 65536 >>> 0;
}
function u32be(data, offset) {
  return ((data[offset] ?? 0) << 24 >>> 0) + ((data[offset + 1] ?? 0) << 16 | (data[offset + 2] ?? 0) << 8 | (data[offset + 3] ?? 0));
}
function sized(mediaType, width, height) {
  if (width < 1 || height < 1) return fail("the header declares an empty image");
  return { ok: true, mediaType, width, height };
}
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
var JPEG_FRAME_MARKERS = /* @__PURE__ */ new Set([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207]);
function exifOrientation(data, start, end) {
  const little = matchesAscii(data, start, "II");
  if (!little && !matchesAscii(data, start, "MM")) return void 0;
  const read16 = (at) => little ? u16le(data, at) : u16be(data, at);
  const read32 = (at) => little ? u32le(data, at) : u32be(data, at);
  if (start + 8 > end || read16(start + 2) !== 42) return void 0;
  const ifd = start + read32(start + 4);
  if (ifd + 2 > end) return void 0;
  const count = read16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) return void 0;
    if (read16(entry) === 274) return read16(entry + 2) === 3 ? read16(entry + 8) : void 0;
  }
  return void 0;
}
function inspectJpeg(data) {
  let offset = 2;
  let orientation;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 255) return fail("the JPEG marker sequence is malformed");
    const marker = data[offset + 1] ?? 0;
    if (marker === 255) {
      offset += 1;
      continue;
    }
    if (marker === 1 || marker >= 208 && marker <= 215) {
      offset += 2;
      continue;
    }
    if (marker === 217 || marker === 218) return fail("the JPEG has no frame header before its image data");
    const length2 = u16be(data, offset + 2);
    if (length2 < 2) return fail("the JPEG marker sequence is malformed");
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > data.length) return fail("the JPEG frame header is truncated");
      const width = u16be(data, offset + 7);
      const height = u16be(data, offset + 5);
      return orientation !== void 0 && orientation >= 5 && orientation <= 8 ? sized("image/jpeg", height, width) : sized("image/jpeg", width, height);
    }
    if (marker === 225 && orientation === void 0 && matchesAscii(data, offset + 4, "Exif") && data[offset + 8] === 0 && data[offset + 9] === 0) {
      orientation = exifOrientation(data, offset + 10, Math.min(data.length, offset + 2 + length2));
    }
    offset += 2 + length2;
  }
  return fail("the JPEG frame header is missing or truncated");
}
function inspectWebp(data) {
  if (matchesAscii(data, 12, "VP8X")) {
    if (data.length < 30) return fail("the WebP header is truncated");
    return sized("image/webp", u24le(data, 24) + 1, u24le(data, 27) + 1);
  }
  if (matchesAscii(data, 12, "VP8L")) {
    if (data.length < 25 || data[20] !== 47) return fail("the WebP lossless header is malformed");
    const b1 = data[21] ?? 0;
    const b2 = data[22] ?? 0;
    const b3 = data[23] ?? 0;
    const b4 = data[24] ?? 0;
    return sized("image/webp", 1 + (b1 | (b2 & 63) << 8), 1 + (b2 >> 6 | b3 << 2 | (b4 & 15) << 10));
  }
  if (matchesAscii(data, 12, "VP8 ")) {
    if (data.length < 30 || !matches(data, 23, [157, 1, 42])) return fail("the WebP lossy header is malformed");
    return sized("image/webp", u16le(data, 26) & 16383, u16le(data, 28) & 16383);
  }
  return fail("the WebP container has no image header");
}
function colorTableBytes(packed) {
  return (packed & 128) === 0 ? 0 : 3 * (1 << (packed & 7) + 1);
}
function skipSubBlocks(data, offset) {
  let at = offset;
  while (at < data.length) {
    const size = data[at] ?? 0;
    at += 1;
    if (size === 0) return at;
    at += size;
  }
  return void 0;
}
function inspectGif(data) {
  if (data.length < 13) return fail("the GIF header is truncated");
  const width = u16le(data, 6);
  const height = u16le(data, 8);
  if (width < 1 || height < 1) return fail("the header declares an empty image");
  let offset = 13 + colorTableBytes(data[10] ?? 0);
  let frames = 0;
  let area = 0;
  while (offset < data.length) {
    const introducer = data[offset];
    if (introducer === 59) return frames === 0 ? fail("the GIF contains no image") : { ok: true, mediaType: "image/gif", width, height };
    if (introducer === 33) {
      const next2 = skipSubBlocks(data, offset + 2);
      if (next2 === void 0) break;
      offset = next2;
      continue;
    }
    if (introducer !== 44) return fail("the GIF block sequence is malformed");
    if (offset + 10 > data.length) break;
    const left = u16le(data, offset + 1);
    const top = u16le(data, offset + 3);
    const frameWidth = u16le(data, offset + 5);
    const frameHeight = u16le(data, offset + 7);
    if (frameWidth < 1 || frameHeight < 1 || left + frameWidth > width || top + frameHeight > height) {
      return fail("a GIF frame is empty or extends beyond the logical screen");
    }
    frames += 1;
    area += frameWidth * frameHeight;
    if (area > IMAGE_LIMITS.maxPixels) return fail(`the GIF frames total more than ${String(IMAGE_LIMITS.maxPixels)} pixels`);
    offset += 10 + colorTableBytes(data[offset + 9] ?? 0);
    const next = skipSubBlocks(data, offset + 1);
    if (next === void 0) break;
    offset = next;
  }
  return fail("the GIF stream is truncated");
}
function inspectImage(data) {
  if (matches(data, 0, PNG_SIGNATURE)) {
    if (data.length < 24 || u32be(data, 8) !== 13 || !matchesAscii(data, 12, "IHDR")) return fail("the PNG header is truncated or malformed");
    return sized("image/png", u32be(data, 16), u32be(data, 20));
  }
  if (matchesAscii(data, 0, "GIF87a") || matchesAscii(data, 0, "GIF89a")) return inspectGif(data);
  if (matches(data, 0, [255, 216, 255])) return inspectJpeg(data);
  if (matchesAscii(data, 0, "RIFF") && matchesAscii(data, 8, "WEBP")) return inspectWebp(data);
  return fail("the content is not a PNG, JPEG, GIF or WebP image");
}
function imageSizeAllowed(width, height) {
  return width <= IMAGE_LIMITS.maxDimension && height <= IMAGE_LIMITS.maxDimension && width * height <= IMAGE_LIMITS.maxPixels;
}
function imageText(value, maxLength) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength || !isPlainText(trimmed)) return void 0;
  return trimmed;
}
var BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
var SHA256 = /^[0-9a-f]{64}$/;
function decodeBase64(text3) {
  try {
    const binary = globalThis.atob(text3);
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
  } catch {
    return void 0;
  }
}
function imageBytes(image) {
  const binary = globalThis.atob(image.data);
  const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}
function readImageData(raw) {
  if (!isRecord(raw)) return void 0;
  const { mediaType, bytes, width, height, sha256, data } = raw;
  const name4 = imageText(raw["name"], IMAGE_LIMITS.maxNameLength);
  if (typeof mediaType !== "string" || !IMAGE_MEDIA_TYPES.includes(mediaType)) return void 0;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > IMAGE_LIMITS.maxImageBytesCeiling) return void 0;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height)) return void 0;
  if (typeof sha256 !== "string" || !SHA256.test(sha256) || name4 === void 0) return void 0;
  if (typeof data !== "string" || data.length !== 4 * Math.ceil(bytes / 3) || !BASE64.test(data)) return void 0;
  const decoded = decodeBase64(data);
  if (decoded === void 0 || decoded.length !== bytes) return void 0;
  const inspection = inspectImage(decoded);
  if (!inspection.ok || inspection.mediaType !== mediaType || inspection.width !== width || inspection.height !== height) return void 0;
  if (!imageSizeAllowed(width, height)) return void 0;
  return { mediaType: inspection.mediaType, bytes, width, height, sha256, name: name4, data };
}
function readImageMeta(value) {
  try {
    if (!isRecord(value)) return void 0;
    if (value["kind"] !== IMAGE_META_KIND || value["envelopeVersion"] !== IMAGE_ENVELOPE_VERSION) return void 0;
    const image = readImageData(value["image"]);
    const alt = imageText(value["alt"], IMAGE_LIMITS.maxAltLength);
    const source = value["source"];
    if (image === void 0 || alt === void 0) return void 0;
    if (typeof source !== "string" || !IMAGE_SOURCES.includes(source)) return void 0;
    const caption2 = value["caption"] === void 0 ? void 0 : imageText(value["caption"], IMAGE_LIMITS.maxCaptionLength);
    const sourceNote = value["sourceNote"] === void 0 ? void 0 : imageText(value["sourceNote"], IMAGE_LIMITS.maxSourceNoteLength);
    if (value["caption"] !== void 0 && caption2 === void 0 || value["sourceNote"] !== void 0 && sourceNote === void 0) return void 0;
    return {
      kind: IMAGE_META_KIND,
      envelopeVersion: IMAGE_ENVELOPE_VERSION,
      image,
      alt,
      ...caption2 === void 0 ? {} : { caption: caption2 },
      source,
      ...sourceNote === void 0 ? {} : { sourceNote }
    };
  } catch {
    return void 0;
  }
}

// rich/src/client/image-view.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
var theme3 = { text: DSW.text, muted: DSW.muted };
var SOURCE_LABELS = {
  computed: "\u8BA1\u7B97\u751F\u6210",
  user_provided: "\u7528\u6237\u63D0\u4F9B"
};
var FORMAT_LABELS = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WebP"
};
function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
var DIGEST_LABELS = {
  pending: "\u6821\u9A8C\u4E2D",
  verified: "\u5DF2\u6821\u9A8C",
  unavailable: "\u672A\u6821\u9A8C"
};
async function verifyImageDigest(image) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === void 0) return "unavailable";
  try {
    const digest = new Uint8Array(await subtle.digest("SHA-256", imageBytes(image)));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return hex === image.sha256 ? "verified" : "mismatch";
  } catch {
    return "unavailable";
  }
}
function ImageFigure({ envelope, digest }) {
  const { image } = envelope;
  if (digest === "mismatch") {
    return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { role: "alert", "data-dsh-rich": "image-digest-mismatch", children: "\u56FE\u7247\u6570\u636E\u4E0E\u8BB0\u5F55\u7684 SHA-256 \u4E0D\u4E00\u81F4\uFF0C\u5DF2\u505C\u6B62\u663E\u793A\u3002" });
  }
  const provenance = `\u6765\u6E90\uFF08\u6A21\u578B\u58F0\u660E\uFF09\uFF1A${SOURCE_LABELS[envelope.source]}${envelope.sourceNote === void 0 ? "" : ` \xB7 ${envelope.sourceNote}`}`;
  const facts = `${image.name} \xB7 ${FORMAT_LABELS[image.mediaType]} \xB7 ${String(image.width)}\xD7${String(image.height)} px \xB7 ${formatBytes(image.bytes)} \xB7 sha256 ${image.sha256.slice(0, 12)}\uFF08${DIGEST_LABELS[digest]}\uFF09`;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
    "figure",
    {
      "data-dsh-rich": "image-card",
      style: { ...cardStyle, margin: "6px 0" },
      children: [
        digest === "pending" ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { "data-dsh-rich": "image-verifying", style: { margin: 0, padding: "24px 0", textAlign: "center", color: theme3.muted }, children: "\u6B63\u5728\u6821\u9A8C\u56FE\u7247\u2026" }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          "img",
          {
            "data-dsh-rich": "image",
            src: `data:${image.mediaType};base64,${image.data}`,
            alt: envelope.alt,
            width: image.width,
            height: image.height,
            style: { display: "block", maxWidth: "100%", maxHeight: 480, width: "auto", height: "auto", margin: "0 auto", objectFit: "contain" }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("figcaption", { style: { marginTop: 8, fontSize: 12 }, children: [
          envelope.caption === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { color: theme3.text, marginBottom: 4 }, children: envelope.caption }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { "data-dsh-rich": "image-provenance", style: { color: theme3.muted }, children: provenance }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { "data-dsh-rich": "image-facts", style: { color: theme3.muted }, children: facts }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { style: { color: theme3.muted }, children: "\u53EA\u6709\u4F60\u80FD\u770B\u5230\u8FD9\u5F20\u56FE\u7247\uFF0C\u6A21\u578B\u770B\u4E0D\u5230\u56FE\u7247\u5185\u5BB9\u3002" })
        ] })
      ]
    }
  );
}
function ImageCard({ envelope }) {
  const [checked, setChecked] = (0, import_react9.useState)(void 0);
  const { sha256, data } = envelope.image;
  (0, import_react9.useEffect)(() => {
    let live = true;
    void verifyImageDigest(envelope.image).then((digest2) => {
      if (live) setChecked({ sha256, data, digest: digest2 });
    });
    return () => {
      live = false;
    };
  }, [sha256, data]);
  const digest = checked !== void 0 && checked.sha256 === sha256 && checked.data === data ? checked.digest : "pending";
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ImageFigure, { envelope, digest });
}
function ImageToolView(props) {
  if (props.phase !== "result") return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { "data-dsh-rich": "image-preparing", children: "\u6B63\u5728\u8BFB\u53D6\u56FE\u7247\u2026" });
  const block = props.block;
  if (block.isError) {
    const detail = block.content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").slice(0, 600);
    return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { role: "alert", "data-dsh-rich": "image-error", children: [
      "\u56FE\u7247\u65E0\u6CD5\u663E\u793A\uFF1A",
      detail
    ] });
  }
  const envelope = readImageMeta(block.meta);
  if (envelope === void 0) return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { role: "alert", "data-dsh-rich": "image-invalid", children: "\u56FE\u7247\u6570\u636E\u4E0D\u53EF\u7528\u3001\u4E0D\u4E00\u81F4\u6216\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002" });
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ImageCard, { envelope });
}

// rich/src/shared/svg-sanitize.ts
var SVG_META_KIND = "rich-svg";
var SVG_ENVELOPE_VERSION = 1;
var SVG_LIMITS = { maxSourceChars: 65536, maxElements: 1500, maxDepth: 12, maxTextChars: 8e3, maxAbsNumber: 1e6, maxViewBox: 1e4 };
var NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:px)?$/;
var LENGTH = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:px|%)?$/;
var NUMBER_LIST = /^[\d \t\n\r,.eE+-]*$/;
var PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d \t\n\r,.eE+-]*$/;
var TRANSFORM = /^[ \t\n\r]*(?:(?:translate|rotate|scale|matrix|skewX|skewY)[ \t\n\r]*\([-+\d.eE \t\n\r,]*\)[ \t\n\r,]*)+$/;
var XML_CHARS = /^[\t\n\r -퟿-�\u{10000}-\u{10ffff}]*$/u;
var MAX_SCALAR = 64;
function xmlText(text3) {
  return XML_CHARS.test(text3);
}
var COLOR = /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla)\(\s*[-+\d.%\s,/]*\)|[a-zA-Z]{3,24})$/;
var ID = /^[A-Za-z][\w-]{0,63}$/;
var finite = (value) => Number.isFinite(Number.parseFloat(value)) && Math.abs(Number.parseFloat(value)) <= SVG_LIMITS.maxAbsNumber;
var number = (v) => v.length <= MAX_SCALAR && NUMBER.test(v.trim()) && finite(v);
var length = (v) => v.length <= MAX_SCALAR && LENGTH.test(v.trim()) && finite(v);
var unit = (v) => number(v) && Number.parseFloat(v) >= 0 && Number.parseFloat(v) <= 1;
var oneOf = (...values) => (v) => values.includes(v.trim());
var list = (v) => v.length <= 2e4 && NUMBER_LIST.test(v) && v.split(/[ \t\n\r,]+/).filter(Boolean).every((part) => part.length <= MAX_SCALAR && finite(part));
var dash = (v) => v.trim() === "none" || list(v);
var PAINT = {
  fill: (v) => COLOR.test(v.trim()),
  stroke: (v) => COLOR.test(v.trim()),
  "stroke-width": length,
  "stroke-opacity": unit,
  "fill-opacity": unit,
  opacity: unit,
  "stroke-dasharray": dash,
  "stroke-dashoffset": number,
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel"),
  "stroke-miterlimit": number,
  "fill-rule": oneOf("nonzero", "evenodd"),
  transform: (v) => v.length <= 500 && TRANSFORM.test(v)
};
var FONT2 = {
  "font-size": (v) => number(v) && Number.parseFloat(v) > 0 && Number.parseFloat(v) <= 200,
  "font-weight": oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"),
  "font-style": oneOf("normal", "italic"),
  "text-anchor": oneOf("start", "middle", "end"),
  "dominant-baseline": oneOf("auto", "middle", "central", "hanging", "alphabetic", "mathematical", "text-before-edge", "text-after-edge")
};
var ELEMENTS = {
  g: { ...FONT2 },
  defs: {},
  marker: { id: (v) => ID.test(v), viewBox: list, markerWidth: number, markerHeight: number, refX: number, refY: number, orient: (v) => v === "auto" || v === "auto-start-reverse" || number(v), markerUnits: oneOf("strokeWidth", "userSpaceOnUse") },
  line: { x1: length, y1: length, x2: length, y2: length },
  rect: { x: length, y: length, width: length, height: length, rx: length, ry: length },
  circle: { cx: length, cy: length, r: length },
  ellipse: { cx: length, cy: length, rx: length, ry: length },
  polyline: { points: list },
  polygon: { points: list },
  path: { d: (v) => v.length <= 2e4 && PATH_DATA.test(v) },
  text: { x: list, y: list, dx: list, dy: list, ...FONT2 },
  tspan: { x: list, y: list, dx: list, dy: list, "baseline-shift": (v) => oneOf("sub", "super")(v) || length(v), ...FONT2 },
  title: {},
  desc: {}
};
var MAX_CARD_CHARS = 262144;
function readSvgMeta(meta) {
  const record = meta;
  if (record === null || typeof record !== "object" || record.kind !== SVG_META_KIND || record.envelopeVersion !== SVG_ENVELOPE_VERSION) return void 0;
  if (typeof record.title !== "string" || typeof record.svg !== "string" || record.svg.length > MAX_CARD_CHARS) return void 0;
  if (!xmlText(record.title) || !xmlText(record.svg)) return void 0;
  if (!record.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ') || !record.svg.endsWith("</svg>")) return void 0;
  if (record.subtitle !== void 0 && typeof record.subtitle !== "string") return void 0;
  return { kind: SVG_META_KIND, envelopeVersion: SVG_ENVELOPE_VERSION, title: record.title, ...record.subtitle === void 0 ? {} : { subtitle: record.subtitle }, svg: record.svg };
}

// rich/src/client/svg-view.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
function SvgFigure({ envelope }) {
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("figure", { "data-dsh-rich": "svg-card", style: { margin: "6px 0", maxWidth: "100%" }, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
    "img",
    {
      "data-dsh-rich": "svg-image",
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(envelope.svg)}`,
      alt: envelope.title,
      style: { display: "block", maxWidth: "min(100%, 640px)", height: "auto", borderRadius: DSW.radius }
    }
  ) });
}
function SvgToolView(props) {
  if (props.phase !== "result") return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { "data-dsh-rich": "svg-preparing", style: noteStyle, children: "\u6B63\u5728\u7ED8\u5236\u56FE\u5F62\u2026" });
  const block = props.block;
  if (block.isError) {
    const detail = block.content.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text).join("\n").slice(0, 600);
    return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { role: "alert", "data-dsh-rich": "svg-error", style: { ...noteStyle, color: DSW.error, whiteSpace: "pre-wrap", wordBreak: "break-word" }, children: [
      "\u56FE\u5F62\u672A\u901A\u8FC7\u68C0\u67E5\uFF1A",
      detail
    ] });
  }
  const envelope = readSvgMeta(block.meta);
  if (envelope === void 0) return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { role: "alert", "data-dsh-rich": "svg-invalid", style: { ...noteStyle, color: DSW.error }, children: "\u56FE\u5F62\u6570\u636E\u4E0D\u53EF\u7528\u6216\u7248\u672C\u4E0D\u53D7\u652F\u6301\u3002" });
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(SvgFigure, { envelope });
}

// rich/src/client/apply.ts
function apply2(ctx) {
  const ToolView = createToolView(ctx);
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_render"
  }, ToolView));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_physics_demo"
  }, PhysicsToolView));
  const MermaidToolView = createToolView(ctx, { previewArgs: false });
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_mermaid"
  }, MermaidToolView));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_heatmap"
  }, HeatmapToolView));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_image"
  }, ImageToolView));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "rich_svg"
  }, SvgToolView));
  ctx.logger.info("rich-response: client half registered tool.call.toolview keys=rich_render,rich_physics_demo,rich_mermaid,rich_heatmap,rich_image,rich_svg");
}

// rich/src/client/index.ts
var name2 = "dsh-rich-response";
var inject2 = ["slots", "remote", "remote.commands", "remote.session"];

// src/client.ts
var name3 = "dsh-study-mode";
function apply3(ctx) {
  ctx.plugin(client_exports);
  ctx.plugin(client_exports2);
}
return module.exports; } });
