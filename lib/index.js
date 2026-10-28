var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name4 in all)
    __defProp(target, name4, { get: all[name4], enumerable: true });
};

// core/src/host/index.ts
var host_exports = {};
__export(host_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
import { readFileSync, lstatSync, mkdirSync as mkdirSync2 } from "node:fs";
import { homedir } from "node:os";
import { resolve, relative, dirname as dirname2, isAbsolute, join } from "node:path";

// core/src/integration/engine.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// core/src/storage/journal.ts
import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// core/src/shared/validation.ts
function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value;
}
function fields(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unexpected field: ${key}`);
}
function text(value, name4, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name4}`);
  return value;
}
function finite(value, name4) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name4} must be a finite number`);
  return value;
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

// core/src/storage/journal.ts
var digest = (value) => createHash("sha256").update(value).digest("hex");
var StudyStore = class {
  db;
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error("Unsupported study database schema version");
      if (version !== 0) this.verify();
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS questions (id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, learner TEXT NOT NULL, aggregate_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, previous_hash TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_aggregate ON events(learner,aggregate_id,seq);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS course_plans (id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
        CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event history'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event history'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_questions_update BEFORE UPDATE ON questions BEGIN SELECT RAISE(ABORT,'immutable question revision'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_questions_delete BEFORE DELETE ON questions BEGIN SELECT RAISE(ABORT,'immutable question revision'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_plans_update BEFORE UPDATE ON course_plans BEGIN SELECT RAISE(ABORT,'immutable course plan'); END;
        CREATE TRIGGER IF NOT EXISTS immutable_plans_delete BEFORE DELETE ON course_plans BEGIN SELECT RAISE(ABORT,'immutable course plan'); END;
        PRAGMA user_version=3; COMMIT;`);
      this.verify();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  verify() {
    const integrity = this.db.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") throw new Error("Study database integrity check failed");
    let previous = "";
    for (const row of this.db.prepare("SELECT * FROM events ORDER BY seq").all()) {
      const body = String(row.body);
      if (row.previous_hash !== previous || row.hash !== digest(previous + "\n" + body)) throw new Error("Study event integrity chain mismatch");
      JSON.parse(body);
      previous = String(row.hash);
    }
    for (const row of this.db.prepare("SELECT * FROM questions").all()) if (row.hash !== digest(String(row.payload))) throw new Error("Question integrity mismatch");
    if (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='course_plans'").get()) {
      for (const row of this.db.prepare("SELECT * FROM course_plans").all()) if (row.hash !== digest(String(row.payload))) throw new Error("Course plan integrity mismatch");
    }
  }
  registerQuestion(id, version, payload) {
    const body = canonical(payload), hash = digest(body);
    const current = this.db.prepare("SELECT hash FROM questions WHERE id=? AND version=?").get(id, version);
    if (current && current.hash !== hash) throw new Error("Question revision is immutable; increment version");
    this.db.prepare("INSERT OR IGNORE INTO questions VALUES(?,?,?,?)").run(id, version, hash, body);
    if (this.db.prepare("SELECT hash FROM questions WHERE id=? AND version=?").get(id, version)?.hash !== hash) throw new Error("Question revision is immutable; concurrent catalog version conflict");
  }
  registerPlan(id, version, payload) {
    const body = canonical(payload), hash = digest(body);
    this.db.prepare("INSERT OR IGNORE INTO course_plans VALUES(?,?,?,?)").run(id, version, hash, body);
    if (this.db.prepare("SELECT hash FROM course_plans WHERE id=? AND version=?").get(id, version)?.hash !== hash) throw new Error("Course plan revision is immutable; increment version");
  }
  question(id, version) {
    const row = this.db.prepare("SELECT payload FROM questions WHERE id=? AND version=?").get(id, version);
    if (!row) throw new Error("Unknown question revision");
    return JSON.parse(String(row.payload));
  }
  transact(id, request, work) {
    const hash = digest(canonical(request));
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db.prepare("SELECT request_hash,result FROM operations WHERE id=?").get(id);
      if (prior) {
        if (prior.request_hash !== hash) throw new Error("Idempotency key conflict");
        this.db.exec("COMMIT");
        return JSON.parse(String(prior.result));
      }
      const result = work();
      this.db.prepare("INSERT INTO operations VALUES(?,?,?)").run(id, hash, canonical(result));
      this.db.exec("COMMIT");
      return JSON.parse(canonical(result));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  append(event) {
    const value = { ...event, id: randomUUID() }, body = canonical(value);
    const previous = String(this.db.prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1").get()?.hash ?? "");
    this.db.prepare("INSERT INTO events(id,learner,aggregate_id,kind,body,previous_hash,hash) VALUES(?,?,?,?,?,?,?)").run(value.id, value.learnerId, value.aggregate, value.kind, body, previous, digest(previous + "\n" + body));
  }
  events(learner, aggregate) {
    const rows = aggregate === void 0 ? this.db.prepare("SELECT body FROM events WHERE learner=? ORDER BY seq").all(learner) : this.db.prepare("SELECT body FROM events WHERE learner=? AND aggregate_id=? ORDER BY seq").all(learner, aggregate);
    return rows.map((row) => JSON.parse(String(row.body)));
  }
  latest(learner, aggregate) {
    const row = this.db.prepare("SELECT body FROM events WHERE learner=? AND aggregate_id=? ORDER BY seq DESC LIMIT 1").get(learner, aggregate);
    return row ? JSON.parse(String(row.body)).payload : void 0;
  }
  async backupTo(path) {
    await backup(this.db, path);
  }
  close() {
    this.db.close();
  }
};

// core/src/domain/assessment/question.ts
var dimensions = ["concept", "modeling", "derivation", "calculation", "transfer"];
var helps = ["H0", "H1", "H2", "H3", "H4"];
var promptKey = (prompt) => prompt.normalize("NFKC").replace(/\s+/g, "");
function parseCatalog(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1e4) throw new Error("Invalid question catalog");
  const seen = /* @__PURE__ */ new Set();
  return value.map((raw) => {
    const q = record(raw);
    fields(q, ["id", "version", "courseId", "topicId", "familyId", "kind", "prompt", "options", "answer", "unit", "absoluteTolerance", "relativeTolerance", "dimensions", "coverage", "hints"]);
    for (const key of ["id", "courseId", "topicId", "familyId"]) text(q[key], key);
    text(q.prompt, "prompt", 1e4);
    if (!Number.isSafeInteger(q.version) || Number(q.version) < 1) throw new Error("Invalid question version");
    if (seen.has(String(q.id))) throw new Error("Duplicate question ID");
    seen.add(String(q.id));
    if (!["single_choice", "multiple_choice", "numeric", "open"].includes(String(q.kind))) throw new Error("Invalid question kind");
    if (q.coverage !== "steps" && q.coverage !== "final_answer_only") throw new Error("Invalid grading coverage");
    if (q.kind !== "open" && q.coverage === "steps") throw new Error("Objective answers cannot establish steps coverage or reasoning");
    if (!Array.isArray(q.dimensions) || !q.dimensions.length || q.dimensions.some((d) => !dimensions.includes(d))) throw new Error("Invalid evidence dimensions");
    const hints = record(q.hints);
    fields(hints, ["H1", "H2", "H3", "H4"]);
    for (const hint of Object.values(hints)) text(hint, "hint", 1e4);
    if (q.kind === "single_choice" || q.kind === "multiple_choice") {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 64) throw new Error("Invalid options");
      const ids = q.options.map((raw2) => {
        const option = record(raw2);
        fields(option, ["id", "label"]);
        text(option.label, "option label", 2e3);
        return text(option.id, "option ID");
      });
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate option ID");
      if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some((a) => !ids.includes(a)) || new Set(q.answer).size !== q.answer.length || q.kind === "single_choice" && q.answer.length !== 1) throw new Error("Invalid answer key");
    } else if (q.kind === "numeric") {
      finite(q.answer, "answer");
      text(q.unit, "unit");
      for (const key of ["absoluteTolerance", "relativeTolerance"]) if (finite(q[key], key) < 0) throw new Error("Negative tolerance");
    } else if (q.answer !== void 0) throw new Error("Open question cannot have an automatic answer key");
    return JSON.parse(JSON.stringify(q));
  });
}
function publicQuestion(q) {
  const { answer: _a, hints: _h, absoluteTolerance: _at, relativeTolerance: _rt, blanks, referenceAnswer: _r, sessionId: _s, authoredAt: _t, ...result } = q;
  return blanks === void 0 ? result : { ...result, blanks: blanks.map((b) => b.unit === void 0 ? {} : { unit: b.unit }) };
}

// core/src/domain/assessment/grading.ts
var normalize = (value) => value.normalize("NFC").replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 65248)).replace(/−/g, "-").replace(/\s+/g, "");
function blankNumber(answer, unit2) {
  let s = normalize(answer);
  const u = unit2 === void 0 ? "" : normalize(unit2);
  if (u && s.endsWith(u)) s = s.slice(0, -u.length);
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+)|[×xX*·]10\^\{?([+-]?\d+)\}?)?$/.exec(s);
  return m ? Number(m[1]) * 10 ** Number(m[2] ?? m[3] ?? 0) : Number.NaN;
}
function blankCorrect(blank, answer) {
  if (blank.accepted !== void 0) return blank.accepted.some((accepted) => normalize(accepted) === normalize(answer));
  const value = blankNumber(answer, blank.unit), expected = blank.value;
  return Number.isFinite(value) && Math.abs(value - expected) <= (blank.tolerance ?? 0) + Number.EPSILON * Math.max(1, Math.abs(expected));
}
function gradeAnswer(q, answer) {
  if (q.kind === "open") {
    text(answer, "open answer", 1e4);
    return { outcome: "pending_review", basis: "Open work requires human review of reasoning and applicability.", source: "deterministic" };
  }
  if (q.kind === "fill_blank") {
    const blanks = q.blanks ?? [];
    if (!Array.isArray(answer) || answer.length !== blanks.length || answer.some((a) => typeof a !== "string" || a.length > 500)) throw new Error("Fill-in answer must give one text (at most 500 characters) per blank");
    const parts = blanks.map((blank, index) => blankCorrect(blank, answer[index]));
    return { outcome: parts.every(Boolean) ? "correct" : "incorrect", basis: "Each blank against the model-authored answer key locked at issue: normalized text or number within tolerance.", source: "deterministic", parts };
  }
  let correct = false;
  if (q.kind === "numeric") {
    const a = record(answer);
    fields(a, ["value", "unit"]);
    const value = finite(a.value, "answer value"), unit2 = text(a.unit, "answer unit");
    const expected = q.answer;
    const tolerance = Math.max(q.absoluteTolerance ?? 0, Math.abs(expected) * (q.relativeTolerance ?? 0));
    correct = unit2 === q.unit && Math.abs(value - expected) <= tolerance + Number.EPSILON * Math.max(1, Math.abs(expected));
  } else {
    if (!Array.isArray(answer) || !answer.length || answer.length > 64 || answer.some((a) => typeof a !== "string" || !q.options?.some((o) => o.id === a))) throw new Error("Invalid choice answer");
    if (new Set(answer).size !== answer.length) throw new Error("Choice answers must be unique; duplicate option");
    if (q.kind === "single_choice" && answer.length !== 1) throw new Error("Single-choice answer must contain one option");
    const expected = q.answer;
    correct = answer.length === expected.length && answer.every((a) => expected.includes(a));
  }
  const basis = q.kind === "numeric" ? "Host answer key, exact unit and configured absolute/relative tolerance." : q.source === "model" ? "Exact option set against the model-authored answer key locked at issue." : "Exact option set against Host answer key.";
  return { outcome: correct ? "correct" : "incorrect", basis, source: "deterministic" };
}

// core/src/domain/assessment/attempt.ts
var modelVerdicts = ["correct", "partially_correct", "incorrect"];
function capability(a, q) {
  if (!a.grade || a.grade.outcome === "pending_review") return "U";
  if (a.grade.outcome === "incorrect") return "N";
  if (!a.independent) return a.maxHelp === "H0" ? "U" : "S";
  return a.grade.source === "human_review" && q.kind === "open" && q.coverage === "steps" && typeof a.answer === "string" && a.answer.trim().length > 0 ? "P" : "U";
}

// core/src/domain/assessment/authored.ts
var authoredTypes = ["single_choice", "multiple_choice", "true_false", "fill_blank", "open"];
var COMMON = ["courseId", "topicId", "familyId", "type", "prompt", "hints", "dimensions"];
var SPECIFIC = { single_choice: ["options", "answer"], multiple_choice: ["options", "answer"], true_false: ["answer"], fill_blank: ["blanks"], open: ["referenceAnswer"] };
var LETTERS = "ABCDEFGHIJ";
function parseAuthoredQuestion(value, context) {
  const q = record(value);
  if (!authoredTypes.includes(q.type)) throw new Error("Invalid question type: use " + authoredTypes.join(", "));
  const type = q.type;
  fields(q, [...COMMON, ...SPECIFIC[type]]);
  const courseId = text(q.courseId, "course ID"), topicId = text(q.topicId, "topic ID"), familyId = text(q.familyId, "family ID");
  if (!context.knownTopic(courseId, topicId)) throw new Error("Unknown course/topic: use a courseId and topicId from study_get_state");
  const prompt = text(q.prompt, "prompt", 4e3);
  const hints = record(q.hints);
  fields(hints, ["H1", "H2", "H3", "H4"]);
  for (const level of ["H1", "H2", "H3", "H4"]) if (typeof hints[level] !== "string" || !String(hints[level]).trim() || String(hints[level]).length > 4e3) throw new Error("Authored questions need hints H1, H2, H3 and H4 (each 1..4000 characters)");
  if (new Set(Object.values(hints).map((h) => String(h).trim())).size !== 4) throw new Error("Authored hints H1-H4 must differ from each other");
  if (!Array.isArray(q.dimensions) || !q.dimensions.length || q.dimensions.some((d) => !dimensions.includes(d)) || new Set(q.dimensions).size !== q.dimensions.length) throw new Error("Invalid evidence dimensions");
  if (type !== "open" && q.dimensions.some((d) => d === "derivation" || d === "transfer")) throw new Error("Invalid evidence dimensions: derivation and transfer need an open question");
  const result = {
    id: context.id,
    version: 1,
    courseId,
    topicId,
    familyId,
    kind: type === "true_false" ? "single_choice" : type,
    prompt,
    dimensions: q.dimensions,
    coverage: type === "open" ? "steps" : "final_answer_only",
    hints,
    source: "model",
    sessionId: context.sessionId,
    authoredAt: context.time
  };
  if (type === "single_choice" || type === "multiple_choice") {
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) throw new Error("Invalid options: give 2 to 10 option texts");
    result.options = q.options.map((label, index) => ({ id: LETTERS[index], label: text(label, "option text", 500) }));
    if (new Set(result.options.map((o) => o.label.trim())).size !== result.options.length) throw new Error("Invalid options: duplicate option text");
    const ids = result.options.map((o) => o.id);
    if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some((a) => !ids.includes(a)) || new Set(q.answer).size !== q.answer.length || type === "single_choice" && q.answer.length !== 1) throw new Error("Invalid answer key: list the correct option letters");
    result.answer = [...q.answer];
  } else if (type === "true_false") {
    if (typeof q.answer !== "boolean") throw new Error("Invalid answer key: true/false questions take answer true or false");
    result.format = "true_false";
    result.options = [{ id: "true", label: "\u6B63\u786E" }, { id: "false", label: "\u9519\u8BEF" }];
    result.answer = [String(q.answer)];
  } else if (type === "fill_blank") {
    if (!Array.isArray(q.blanks) || q.blanks.length < 1 || q.blanks.length > 20) throw new Error("Invalid blanks: give 1 to 20 blanks");
    result.blanks = q.blanks.map((raw, index) => parseBlank(raw, index + 1));
    const markers = [...prompt.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    if (markers.length !== result.blanks.length || result.blanks.some((_b, index) => markers.filter((n2) => n2 === index + 1).length !== 1)) throw new Error("Blank markers must be {{1}}..{{" + result.blanks.length + "}}, each exactly once in the prompt");
  } else result.referenceAnswer = text(q.referenceAnswer, "reference answer: open questions need a reference answer", 1e4);
  return result;
}
function parseBlank(value, n2) {
  const b = record(value);
  fields(b, ["accepted", "value", "tolerance", "unit"]);
  if (b.accepted === void 0 === (b.value === void 0)) throw new Error(`Invalid blank ${n2}: give accepted texts or a value, not both`);
  if (b.accepted !== void 0) {
    if (b.tolerance !== void 0 || b.unit !== void 0) throw new Error(`Invalid blank ${n2}: tolerance and unit apply only to a value`);
    if (!Array.isArray(b.accepted) || b.accepted.length < 1 || b.accepted.length > 10) throw new Error(`Invalid blank ${n2}: give 1 to 10 accepted texts`);
    return { accepted: b.accepted.map((a) => text(a, `blank ${n2} accepted text`)) };
  }
  const blank = { value: finite(b.value, `blank ${n2} value`) };
  if (b.tolerance !== void 0 && (blank.tolerance = finite(b.tolerance, `blank ${n2} tolerance`)) < 0) throw new Error(`Invalid blank ${n2}: negative tolerance`);
  const tolerance = blank.tolerance ?? 0, expected = blank.value;
  if (expected === 0 ? tolerance > 1 : tolerance >= Math.abs(expected)) throw new Error(`Invalid blank ${n2}: tolerance must be smaller than the value (at most 1 for a zero value)`);
  if (b.unit !== void 0) blank.unit = text(b.unit, `blank ${n2} unit`, 50);
  return blank;
}

// core/src/domain/lesson/state.ts
var stages = ["concept", "mathematical_modeling", "derivation", "worked_examples", "guided_practice", "independent_assessment", "review_and_consolidation"];
function allowedNext(current) {
  if (current === "not_started") return ["concept", "mathematical_modeling"];
  const next = stages[stages.indexOf(current) + 1];
  return next === void 0 ? [] : [next];
}
function lessonView(lesson) {
  return { ...lesson, nextStage: allowedNext(lesson.stage)[0] ?? null };
}
function nextStage(current, next) {
  if (allowedNext(current).includes(next)) return next;
  const expected = allowedNext(current)[0];
  throw new Error(`Teaching stage sequence violation: current stage is ${current}; next allowed stage is ${expected ?? "none (lesson complete)"}. Stages in order: ${stages.join(", ")}`);
}

// core/src/domain/evidence/progress.ts
function deriveProgress(items) {
  const empty = () => ({ state: "U", attemptIds: [] });
  const result = { concept: empty(), modeling: empty(), derivation: empty(), calculation: empty(), transfer: empty() };
  for (const dimension of dimensions) {
    const records = items.filter((i) => i.question.dimensions.includes(dimension) && i.attempt.grade).sort((a, b) => Date.parse(a.attempt.review?.at ?? a.attempt.submittedAt ?? a.attempt.issuedAt) - Date.parse(b.attempt.review?.at ?? b.attempt.submittedAt ?? b.attempt.issuedAt));
    const supported = records.filter((i) => capability(i.attempt, i.question) !== "U");
    result[dimension].attemptIds = supported.map((i) => i.attempt.attemptId);
    const latest = supported.at(-1);
    if (!latest) continue;
    result[dimension].state = capability(latest.attempt, latest.question);
    if (result[dimension].state === "P") {
      const last = latest.attempt;
      const earlier = supported.slice(0, -1).some((i) => capability(i.attempt, i.question) === "P" && i.question.id !== latest.question.id && promptKey(i.question.prompt) !== promptKey(latest.question.prompt) && i.question.familyId === latest.question.familyId && Date.parse(last.issuedAt) - Date.parse(i.attempt.submittedAt ?? i.attempt.issuedAt) >= 24 * 60 * 60 * 1e3);
      if (earlier) result[dimension].state = "R";
    }
  }
  return result;
}

// core/src/domain/course/catalog.ts
function courseCatalog(questions) {
  const courses = /* @__PURE__ */ new Map();
  for (const question of questions) {
    if (!courses.has(question.courseId)) courses.set(question.courseId, /* @__PURE__ */ new Set());
    courses.get(question.courseId).add(question.topicId);
  }
  return [...courses].map(([courseId, topics]) => ({ courseId, topicIds: [...topics] }));
}

// core/src/domain/progress/mode.ts
var modes = ["systematic_teaching", "guided_practice", "independent_assessment", "review", "ordinary_qa", "research_discussion"];
function teachingMode(value) {
  if (!modes.includes(value)) throw new Error("Invalid teaching mode");
  return value;
}

// core/src/domain/course/plan.ts
function parsePlans(value) {
  if (value === void 0) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid course plans");
  const ids = /* @__PURE__ */ new Set();
  return value.map((raw) => {
    const p = record(raw);
    fields(p, ["courseId", "title", "version", "startDate", "endDate", "evidenceStatus", "sources", "days"]);
    text(p.courseId, "course ID");
    text(p.title, "course title", 1e3);
    if (ids.has(String(p.courseId))) throw new Error("Duplicate course plan");
    ids.add(String(p.courseId));
    if (!Number.isSafeInteger(p.version) || Number(p.version) < 1) throw new Error("Invalid plan version");
    for (const key of ["startDate", "endDate"]) if (typeof p[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(String(p[key])) || !Number.isFinite(Date.parse(String(p[key])))) throw new Error("Invalid fixed plan date");
    if (String(p.endDate) < String(p.startDate)) throw new Error("Invalid plan date order");
    if (p.evidenceStatus !== "not_imported") throw new Error("Plan definitions cannot import learner evidence");
    if (!Array.isArray(p.sources) || !p.sources.length || p.sources.length > 10) throw new Error("Plan provenance is required");
    for (const source of p.sources) {
      const s = record(source);
      fields(s, ["path", "sha256"]);
      text(s.path, "source path", 2e3);
      if (typeof s.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(s.sha256)) throw new Error("Invalid source hash");
    }
    if (!Array.isArray(p.days) || !p.days.length || p.days.length > 366) throw new Error("Invalid plan days");
    const days = /* @__PURE__ */ new Set();
    for (const day of p.days) {
      const d = record(day);
      fields(d, ["day", "unit", "title", "topics", "tasks"]);
      if (!Number.isSafeInteger(d.day) || Number(d.day) < 1 || days.has(Number(d.day))) throw new Error("Invalid/duplicate plan day");
      days.add(Number(d.day));
      text(d.unit, "topic ID");
      text(d.title, "day title", 1e3);
      if (!Array.isArray(d.topics) || d.topics.length > 100) throw new Error("Invalid topics");
      for (const topic of d.topics) text(topic, "topic", 2e3);
      if (!Array.isArray(d.tasks) || d.tasks.length > 30) throw new Error("Invalid teaching tasks");
      for (const task of d.tasks) {
        const item = record(task);
        fields(item, ["id", "kind", "title", "minutes"]);
        text(item.id, "task ID");
        text(item.kind, "task kind");
        text(item.title, "task title", 1e3);
        const minutes = finite(item.minutes, "minutes");
        if (minutes < 0 || minutes > 1440) throw new Error("Invalid task duration");
      }
    }
    return JSON.parse(JSON.stringify(p));
  });
}

// core/src/integration/engine.ts
var StudyEngine = class {
  store;
  learnerId;
  catalog;
  now;
  plans;
  constructor(options) {
    this.learnerId = text(options.learnerId, "learner ID");
    this.catalog = parseCatalog(options.catalog);
    this.plans = parsePlans(options.plans);
    this.now = options.now ?? Date.now;
    this.store = new StudyStore(options.databasePath);
    try {
      for (const q of this.catalog) this.store.registerQuestion(q.id, q.version, q);
      for (const p of this.plans) this.store.registerPlan(p.courseId, p.version, p);
    } catch (error) {
      this.store.close();
      throw error;
    }
  }
  time() {
    return new Date(this.now()).toISOString();
  }
  transaction(sessionId, requestId, request, work) {
    text(sessionId, "session ID");
    text(requestId, "request ID");
    return this.store.transact(JSON.stringify([this.learnerId, sessionId, requestId]), { sessionId, request }, work);
  }
  append(kind, aggregate, sessionId, payload) {
    this.store.append({ kind, aggregate, sessionId, payload, learnerId: this.learnerId, time: this.time() });
  }
  internal(id) {
    text(id, "attempt ID");
    const a = this.store.latest(this.learnerId, "attempt:" + id);
    if (!a) throw new Error("Unknown attempt");
    return a;
  }
  question(a) {
    return this.store.question(a.questionId, a.questionVersion);
  }
  bound(session3, id, open = true) {
    const a = this.internal(id);
    if (a.sessionId !== session3) throw new Error("Attempt session mismatch");
    if (open && a.status !== "issued") throw new Error("Attempt is closed/submitted");
    return a;
  }
  promptKeys = /* @__PURE__ */ new Map();
  /** Revisions are immutable, so a prompt key is computed once per question revision. */
  promptKeyOf(a) {
    const id = a.questionId + "@" + a.questionVersion;
    let key = this.promptKeys.get(id);
    if (key === void 0) {
      key = promptKey(this.store.question(a.questionId, a.questionVersion).prompt);
      this.promptKeys.set(id, key);
    }
    return key;
  }
  /** The same item: the same question, or another one with an identical prompt (a copied or re-authored question). */
  sameItem(old, a) {
    return old.questionId === a.questionId || this.promptKeyOf(old) === this.promptKeyOf(a);
  }
  allAttempts() {
    const latest = /* @__PURE__ */ new Map();
    for (const e of this.store.events(this.learnerId)) if (e.aggregate.startsWith("attempt:")) latest.set(e.aggregate, e.payload);
    return [...latest.values()];
  }
  exposure(a, all = this.allAttempts()) {
    if (a.status !== "issued") return;
    for (const old of all) if (old.attemptId !== a.attemptId && this.sameItem(old, a)) {
      if (helps.indexOf(old.maxHelp) > helps.indexOf(a.maxHelp)) a.maxHelp = old.maxHelp;
      if (old.submittedAt || old.maxHelp !== "H0") a.independent = false;
    }
  }
  view(a, all) {
    this.exposure(a, all);
    const q = this.question(a);
    return { ...a, question: publicQuestion(q), capability: capability(a, q), ...a.submittedAt !== void 0 && q.referenceAnswer !== void 0 ? { referenceAnswer: q.referenceAnswer } : {} };
  }
  knownTopic(courseId, topicId) {
    return this.catalog.some((q) => q.courseId === courseId && q.topicId === topicId) || this.plans.some((p) => p.courseId === courseId && p.days.some((d) => d.unit === topicId));
  }
  questions() {
    return this.catalog.map(publicQuestion);
  }
  attempt(id) {
    return this.view(this.internal(id));
  }
  issue(sessionId, questionId, requestId) {
    return this.transaction(sessionId, requestId, { operation: "issue", questionId }, () => {
      const q = this.catalog.find((q2) => q2.id === questionId);
      if (!q) throw new Error("Unknown trusted question");
      let maxHelp = "H0";
      let previouslyAnswered = false;
      for (const old of this.allAttempts().filter((a2) => this.sameItem(a2, { questionId: q.id, questionVersion: q.version }))) {
        if (helps.indexOf(old.maxHelp) > helps.indexOf(maxHelp)) maxHelp = old.maxHelp;
        if (old.submittedAt) previouslyAnswered = true;
      }
      const a = { attemptId: randomUUID2(), learnerId: this.learnerId, sessionId, questionId: q.id, questionVersion: q.version, issuedAt: this.time(), status: "issued", maxHelp, independent: maxHelp === "H0" && !previouslyAnswered, hints: [] };
      this.append("issued", "attempt:" + a.attemptId, sessionId, a);
      return this.view(a);
    });
  }
  /** Store a model-written question as an immutable revision and issue it, in one transaction (D-015). */
  author(sessionId, input, requestId) {
    return this.transaction(sessionId, requestId, { operation: "author", input }, () => {
      const q = parseAuthoredQuestion(input, { id: "m-" + randomUUID2(), sessionId, time: this.time(), knownTopic: (c, t) => this.knownTopic(c, t) });
      this.store.registerQuestion(q.id, q.version, q);
      const a = { attemptId: randomUUID2(), learnerId: this.learnerId, sessionId, questionId: q.id, questionVersion: q.version, issuedAt: this.time(), status: "issued", maxHelp: "H0", independent: true, hints: [] };
      this.exposure(a);
      this.append("issued", "attempt:" + a.attemptId, sessionId, a);
      return this.view(a);
    });
  }
  /** Append a model opinion on a submitted open answer; the grade, status and capability stay as they are. */
  modelReview(sessionId, attemptId, verdict, comment, requestId) {
    return this.transaction(sessionId, requestId, { operation: "model-review", attemptId, verdict, comment }, () => {
      if (!modelVerdicts.includes(verdict)) throw new Error("Invalid model review verdict: use " + modelVerdicts.join(", "));
      const note = text(comment, "model review comment", 4e3);
      const a = this.bound(sessionId, attemptId, false);
      if (!a.submittedAt) throw new Error("Cannot review an unsubmitted attempt");
      const q = this.question(a);
      if (q.kind !== "open" || q.source !== "model") throw new Error("Model review applies only to model-written open (short-answer or derivation) answers, which carry a reference answer");
      if ((a.modelReviews?.length ?? 0) >= 20) throw new Error("Model review limit reached for this attempt");
      a.modelReviews = [...a.modelReviews ?? [], { verdict, comment: note, at: this.time() }];
      this.append("model_reviewed", "attempt:" + attemptId, sessionId, a);
      return this.view(a);
    });
  }
  hint(sessionId, attemptId, level, requestId) {
    return this.transaction(sessionId, requestId, { operation: "hint", attemptId, level }, () => {
      if (!helps.includes(level) || level === "H0") throw new Error("Invalid help level");
      const a = this.bound(sessionId, attemptId), q = this.question(a), hintText = q.hints[level];
      if (!hintText) throw new Error("Requested hint is unavailable");
      a.independent = false;
      a.maxHelp = helps[Math.max(helps.indexOf(a.maxHelp), helps.indexOf(level))];
      a.hints.push({ level, at: this.time() });
      if (level === "H4") a.revealedAt = this.time();
      this.append(level === "H4" ? "answer_revealed" : "hint_requested", "attempt:" + attemptId, sessionId, a);
      return { ...this.view(a), hintText };
    });
  }
  submit(sessionId, attemptId, answer, requestId) {
    return this.transaction(sessionId, requestId, { operation: "submit", attemptId, answer }, () => {
      const a = this.bound(sessionId, attemptId);
      this.exposure(a);
      const q = this.question(a), grade = gradeAnswer(q, answer);
      a.answer = answer;
      a.grade = grade;
      a.submittedAt = this.time();
      a.status = grade.outcome === "pending_review" ? "pending_review" : "graded";
      this.append("submitted", "attempt:" + attemptId, sessionId, a);
      return this.view(a);
    });
  }
  review(sessionId, attemptId, correct, reason, reviewer, requestId) {
    return this.transaction(sessionId, requestId, { operation: "review", attemptId, correct, reason, reviewer }, () => {
      text(reason, "review reason", 2e3);
      text(reviewer, "reviewer");
      if (typeof correct !== "boolean") throw new Error("Invalid review verdict");
      const a = this.bound(sessionId, attemptId, false);
      if (!a.submittedAt) throw new Error("Cannot review an unsubmitted attempt");
      a.grade = { outcome: correct ? "correct" : "incorrect", basis: reason, source: "human_review" };
      a.status = "graded";
      a.review = { reviewer, reason, at: this.time() };
      this.append("reviewed", "attempt:" + attemptId, sessionId, a);
      return this.view(a);
    });
  }
  lesson(courseId, topicId) {
    const events = this.store.events(this.learnerId).filter((e) => e.kind === "teaching_exposure");
    const lesson = events.map((e) => e.payload).filter((v) => v.courseId === courseId && v.topicId === topicId).at(-1);
    return lesson ?? { courseId, topicId, stage: "not_started", exposureOnly: true };
  }
  advanceLesson(sessionId, courseId, topicId, stage, requestId) {
    return this.transaction(sessionId, requestId, { operation: "teaching", courseId, topicId, stage }, () => {
      if (!this.knownTopic(courseId, topicId)) throw new Error("Unknown course/topic");
      const current = this.lesson(courseId, topicId);
      if (stage === current.stage) return lessonView(current);
      const lesson = { ...current, stage: nextStage(current.stage, stage) };
      this.append("teaching_exposure", JSON.stringify(["lesson", courseId, topicId]), sessionId, lesson);
      return lessonView(lesson);
    });
  }
  history(attemptId) {
    return this.store.events(this.learnerId, "attempt:" + attemptId);
  }
  plan(courseId, day) {
    const plan = this.plans.find((p) => p.courseId === courseId);
    if (!plan) throw new Error(`No course plan for ${courseId}. study_get_state.plans lists the courses that have plans: ${this.plans.map((p) => p.courseId).join(", ") || "none"}`);
    const { days, ...meta } = plan;
    if (day !== void 0) {
      const selected = days.find((d) => d.day === day);
      if (!selected) throw new Error("Unknown plan day");
      return { ...meta, day: selected, days: [] };
    }
    return { ...meta, days: days.map((d) => ({ day: d.day, unit: d.unit, title: d.title })) };
  }
  mode() {
    return this.store.latest(this.learnerId, "teaching-mode")?.mode ?? "systematic_teaching";
  }
  setMode(sessionId, value, requestId) {
    return this.transaction(sessionId, requestId, { operation: "set-mode", value }, () => {
      const mode = teachingMode(value);
      this.append("mode_selected", "teaching-mode", sessionId, { mode });
      return { mode };
    });
  }
  progress(courseId, topicId, all = this.allAttempts()) {
    return deriveProgress(all.map((attempt) => ({ attempt, question: this.question(attempt) })).filter((i) => i.question.courseId === courseId && i.question.topicId === topicId));
  }
  state() {
    const all = this.allAttempts();
    const evidence = all.map((attempt) => ({ attempt, question: this.question(attempt) }));
    const lessons = /* @__PURE__ */ new Map();
    for (const event of this.store.events(this.learnerId)) if (event.kind === "teaching_exposure") {
      const value = event.payload;
      lessons.set(JSON.stringify([value.courseId, value.topicId]), value);
    }
    const catalog = new Map(courseCatalog(this.catalog).map((c) => [c.courseId, new Set(c.topicIds)]));
    for (const plan of this.plans) {
      const topics = catalog.get(plan.courseId) ?? /* @__PURE__ */ new Set();
      for (const day of plan.days) topics.add(day.unit);
      catalog.set(plan.courseId, topics);
    }
    const courses = [...catalog].map(([courseId, topicIds]) => ({ courseId, topicIds: [...topicIds], topics: [...topicIds].map((topicId) => ({
      topicId,
      lesson: lessonView(lessons.get(JSON.stringify([courseId, topicId])) ?? { courseId, topicId, stage: "not_started", exposureOnly: true }),
      evidence: deriveProgress(evidence.filter((i) => i.question.courseId === courseId && i.question.topicId === topicId))
    })) }));
    return { learnerId: this.learnerId, mode: this.mode(), courses, plans: this.plans.map((p) => ({ courseId: p.courseId, title: p.title, startDate: p.startDate, endDate: p.endDate, evidenceStatus: p.evidenceStatus })), attempts: all.map((a) => this.view(a, all)) };
  }
  close() {
    this.store.close();
  }
};

// core/src/host/api.ts
import { randomUUID as randomUUID3 } from "node:crypto";
var AUTHOR_DESCRIPTION = 'Write your own question and issue it as an answer card in this session (use study_issue_question for a fitting question listed in study_get_state.questions). Write the prompt, options, hints and reference answer in the language the learner uses. Types: single_choice and multiple_choice (options are plain texts; answer lists the correct option letters "A", "B", ...), true_false (answer is true or false), fill_blank (mark each blank in the prompt as {{1}}, {{2}}, ...; each blank gives accepted texts, or a value with optional tolerance and unit), open (short answer or derivation; give referenceAnswer). dimensions: derivation and transfer need an open question. Hints: H1 quantities and directions, H2 the key equation or theorem, H3 steps or intermediate results, H4 the full solution. courseId and topicId must come from study_get_state. The answer key, hints and reference answer are locked at issue: you cannot change them or the grade later. The Host checks the structure, not whether your key is right, and the card is labelled as model-written. The learner answers on the card; never answer for them or reveal the answer in your reply.';
var AUTHOR_PARAMETERS = { type: "object", properties: {
  courseId: { type: "string" },
  topicId: { type: "string" },
  familyId: { type: "string", description: "Short id of the skill being tested. R evidence needs a different prompt in the same family at least 24 h later; copying a prompt keeps its earlier help and exposure." },
  type: { type: "string", enum: [...authoredTypes] },
  prompt: { type: "string", description: "Question text, at most 4000 characters; fill_blank marks blanks as {{1}}, {{2}}, ..." },
  options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 10, description: "single_choice / multiple_choice only; lettered A, B, ... in order." },
  answer: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "boolean" }], description: "Option letters for choice questions; true or false for true_false." },
  blanks: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: { accepted: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 10 }, value: { type: "number" }, tolerance: { type: "number", minimum: 0 }, unit: { type: "string" } }, additionalProperties: false }, description: "fill_blank only, in marker order." },
  referenceAnswer: { type: "string", description: "open only; shown to the learner after they submit." },
  hints: { type: "object", properties: { H1: { type: "string" }, H2: { type: "string" }, H3: { type: "string" }, H4: { type: "string" } }, required: ["H1", "H2", "H3", "H4"], additionalProperties: false },
  dimensions: { type: "array", minItems: 1, items: { type: "string", enum: [...dimensions] } }
}, required: ["courseId", "topicId", "familyId", "type", "prompt", "hints", "dimensions"], additionalProperties: false };
function session(exec) {
  if (exec.signal.aborted) throw new Error("Study tool aborted");
  return text(exec.agent?.id, "receiving session");
}
function args(value, allowed) {
  const v = record(value);
  fields(v, allowed);
  return v;
}
function registerApi(ctx, engine, enableHumanReview) {
  const tools = [
    { name: "study_get_plan", description: "Read a trusted course-plan definition and optional day, only for a courseId listed in study_get_state.plans. A plan does not import or prove learner mastery.", parameters: { type: "object", properties: { courseId: { type: "string" }, day: { type: "integer", minimum: 1, maximum: 366 } }, required: ["courseId"], additionalProperties: false }, execute: async (value, exec) => {
      session(exec);
      const a = args(value, ["courseId", "day"]);
      if (a.day !== void 0 && (!Number.isSafeInteger(a.day) || Number(a.day) < 1)) throw new Error("Invalid plan day");
      return engine.plan(text(a.courseId, "course ID"), a.day);
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }] } },
    { name: "study_get_state", description: "Read Host-owned learning evidence and trusted question catalog. Teaching is separate from mastery.", parameters: { type: "object", properties: {}, additionalProperties: false }, execute: async (value, exec) => {
      session(exec);
      args(value, []);
      return { ...engine.state(), questions: engine.questions() };
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }] } },
    { name: "study_issue_question", description: "Issue a trusted synthetic question in this session. Never submit a student answer or invent grades. Use only after teaching and worked examples.", parameters: { type: "object", properties: { questionId: { type: "string" } }, required: ["questionId"], additionalProperties: false }, execute: async (value, exec) => {
      const id = session(exec), a = args(value, ["questionId"]);
      return engine.issue(id, text(a.questionId, "question ID"), exec.callId);
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }], presentationMeta: (_a, v) => ({ kind: "study-attempt", version: 1, attempt: v }) } },
    { name: "study_author_question", description: AUTHOR_DESCRIPTION, parameters: AUTHOR_PARAMETERS, execute: async (value, exec) => {
      const id = session(exec);
      return engine.author(id, value, exec.callId);
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }], presentationMeta: (_a, v) => ({ kind: "study-attempt", version: 1, attempt: v }) } },
    { name: "study_model_review", description: "Record your review of a submitted open (short-answer or derivation) answer from this session: a verdict and a comment the learner sees. Compare the answer with the reference answer locked at issue. The review is stored separately and does not change the Host grade, the pending human review or any capability level.", parameters: { type: "object", properties: { attemptId: { type: "string" }, verdict: { type: "string", enum: [...modelVerdicts] }, comment: { type: "string", description: "What is right, what is missing or wrong, in the learner's language; at most 4000 characters." } }, required: ["attemptId", "verdict", "comment"], additionalProperties: false }, execute: async (value, exec) => {
      const id = session(exec), a = args(value, ["attemptId", "verdict", "comment"]);
      return engine.modelReview(id, text(a.attemptId, "attempt ID"), a.verdict, a.comment, exec.callId);
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }], presentationMeta: (_a, v) => {
      const value = v;
      return { kind: "study-model-review", version: 1, attemptId: value.attemptId, review: value.modelReviews?.at(-1) };
    } } },
    { name: "study_teaching_step", description: "Record a sequential teaching-stage exposure after teaching it. Stages in order: " + stages.join(", ") + ". A new topic starts at concept; study_get_state shows each lesson stage and nextStage, and repeating the current stage records nothing. This creates no mastery and does not claim student understanding.", parameters: { type: "object", properties: { courseId: { type: "string" }, topicId: { type: "string" }, stage: { type: "string", enum: [...stages] } }, required: ["courseId", "topicId", "stage"], additionalProperties: false }, execute: async (value, exec) => {
      const id = session(exec), a = args(value, ["courseId", "topicId", "stage"]);
      return engine.advanceLesson(id, text(a.courseId, "course ID"), text(a.topicId, "topic ID"), a.stage, exec.callId);
    }, output: { schema: { type: "object" }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }] } }
  ];
  for (const tool of tools) ctx.effect(() => ctx.tools.register(tool));
  ctx.effect(() => ctx.commands.register({
    name: "study-mode",
    description: "Select a teaching mode without changing learning evidence.",
    input: { hint: "systematic_teaching | guided_practice | independent_assessment | review | ordinary_qa | research_discussion" },
    recordInput: true,
    async handler(invocation) {
      try {
        if (invocation.signal.aborted) throw new Error("Mode selection aborted");
        const result = engine.setMode(invocation.agent.id, invocation.rawInput.trim(), invocation.commandId ?? randomUUID3());
        return { kind: "success", text: "\u5B66\u4E60\u6A21\u5F0F\uFF1A" + result.mode + "\u3002\u65E2\u6709\u5B66\u4E60\u8BB0\u5F55\u4FDD\u6301\u3002" };
      } catch (error) {
        return { kind: "error", text: error instanceof Error ? error.message : "Mode selection failed" };
      }
    }
  }));
  ctx.effect(() => ctx.commands.register({
    name: "study-attempt",
    description: "Human-only attempt status, hint or answer submission.",
    input: { hint: "Internal learning card command" },
    recordInput: false,
    async handler(invocation) {
      try {
        if (invocation.signal.aborted) throw new Error("Study command aborted");
        if (invocation.rawInput.length > 16384) throw new Error("Study command payload exceeds size limit");
        const a = args(JSON.parse(invocation.rawInput), ["operation", "attemptId", "requestId", "level", "answer"]);
        const id = text(a.attemptId, "attempt ID"), sessionId = invocation.agent.id;
        if (engine.attempt(id).sessionId !== sessionId) throw new Error("Attempt session mismatch");
        let result;
        if (a.operation === "read") {
          fields(a, ["operation", "attemptId"]);
          result = engine.attempt(id);
        } else if (a.operation === "hint") {
          fields(a, ["operation", "attemptId", "requestId", "level"]);
          result = engine.hint(sessionId, id, a.level, text(a.requestId, "request ID"));
        } else if (a.operation === "submit") {
          fields(a, ["operation", "attemptId", "requestId", "answer"]);
          result = engine.submit(sessionId, id, a.answer, text(a.requestId, "request ID"));
        } else throw new Error("Unknown study operation");
        return { kind: "success", text: JSON.stringify(result) };
      } catch (error) {
        return { kind: "error", text: (error instanceof Error ? error.message : "Study command failed").slice(0, 300) };
      }
    }
  }));
  if (enableHumanReview) ctx.effect(() => ctx.commands.register({
    name: "study-review",
    description: "Operator-enabled human grading review with mandatory justification.",
    input: { hint: "JSON attemptId, requestId, correct, reason" },
    recordInput: false,
    async handler(invocation) {
      try {
        if (invocation.signal.aborted) throw new Error("Review aborted");
        if (invocation.rawInput.length > 8192) throw new Error("Review payload too large");
        const a = args(JSON.parse(invocation.rawInput), ["attemptId", "requestId", "correct", "reason"]);
        const result = engine.review(invocation.agent.id, text(a.attemptId, "attempt ID"), a.correct, text(a.reason, "review reason", 2e3), "local-human-operator", text(a.requestId, "request ID"));
        return { kind: "success", text: JSON.stringify(result) };
      } catch (error) {
        return { kind: "error", text: (error instanceof Error ? error.message : "Review failed").slice(0, 300) };
      }
    }
  }));
}

// core/src/host/index.ts
var name = "dsh-study-core";
var inject = ["tools", "commands"];
function apply(ctx, config = {}) {
  const configured = process.env.DSH_HOME?.trim();
  const root = configured ? configured : join(homedir(), ".dsh");
  if (!isAbsolute(root)) throw new Error("Study Core requires DSH_HOME to be an absolute path");
  const path = resolve(config.databasePath ?? resolve(root, "study-core/study.db"));
  const rel = relative(resolve(root), path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Study database must remain inside explicit DSH_HOME");
  for (let cursor = path; ; cursor = dirname2(cursor)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error("Study storage cannot traverse a symbolic link");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (dirname2(cursor) === cursor) break;
  }
  mkdirSync2(dirname2(path), { recursive: true });
  const catalog = JSON.parse(readFileSync(config.catalogPath ?? new URL("../data/synthetic.json", import.meta.url), "utf8"));
  const plans = config.plansPath ? JSON.parse(readFileSync(config.plansPath, "utf8")) : [];
  const engine = new StudyEngine({ databasePath: path, catalog, plans, learnerId: config.learnerId ?? "local-learner" });
  ctx.effect(() => () => engine.close());
  registerApi(ctx, engine, config.enableHumanReview === true);
}

// rich/src/host/index.ts
var host_exports2 = {};
__export(host_exports2, {
  apply: () => apply2,
  inject: () => inject2,
  name: () => name2
});

// rich/src/host/audit.ts
import { appendFileSync, mkdirSync as mkdirSync3 } from "node:fs";
import { dirname as dirname3 } from "node:path";
var AttemptTracker = class {
  #seen = /* @__PURE__ */ new Set();
  #order = [];
  #limit;
  constructor(limit) {
    this.#limit = Number.isInteger(limit) && limit > 0 ? limit : 512;
  }
  /**
   * Record one attempt id.
   * @param attemptId - client-minted identity.
   * @returns true when this identity was already observed.
   */
  observe(attemptId) {
    const duplicate = this.#seen.has(attemptId);
    if (!duplicate) {
      this.#seen.add(attemptId);
      this.#order.push(attemptId);
      while (this.#order.length > this.#limit) {
        const evicted = this.#order.shift();
        if (evicted !== void 0) this.#seen.delete(evicted);
      }
    }
    return duplicate;
  }
  /** Current number of retained identities (diagnostics only). */
  get size() {
    return this.#seen.size;
  }
};
function appendAuditRecord(path, record2, logger) {
  try {
    mkdirSync3(dirname3(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(record2)}
`, { encoding: "utf8" });
  } catch (error) {
    logger.warn("rich-response: interaction audit append failed: %s", String(error));
  }
}

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
var RICH_CONTENT_TYPES = [
  "line_plot",
  "scatter_plot",
  "basic_diagram",
  "message_card"
];

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
  let text5;
  try {
    text5 = JSON.stringify(value);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof text5 !== "string") return Number.POSITIVE_INFINITY;
  if (typeof TextEncoder === "undefined") return text5.length;
  return new TextEncoder().encode(text5).length;
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
  const axis2 = {};
  const label = boundedString(raw["label"], `${path}.label`, RICH_LIMITS.maxAxisLabelLength, "INVALID_AXIS", false);
  if (!label.ok) issues.push(label.issue);
  else if (label.value !== void 0) axis2.label = label.value;
  const unit2 = boundedString(raw["unit"], `${path}.unit`, RICH_LIMITS.maxAxisLabelLength, "INVALID_AXIS", false);
  if (!unit2.ok) issues.push(unit2.issue);
  else if (unit2.value !== void 0) axis2.unit = unit2.value;
  for (const key of ["min", "max"]) {
    if (raw[key] === void 0) continue;
    const read = finiteNumber(raw[key], `${path}.${key}`);
    if (!read.ok) issues.push(read.issue);
    else axis2[key] = read.value;
  }
  if (axis2.min !== void 0 && axis2.max !== void 0 && axis2.min >= axis2.max) {
    issues.push(issue("INVALID_AXIS_RANGE", path, "min must be strictly below max"));
  }
  return axis2;
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
  const card2 = {
    schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
    type: "message_card",
    title: title.value,
    ...subtitleValue === void 0 ? {} : { subtitle: subtitleValue },
    ...questionId === void 0 ? {} : { questionId },
    body: bodyText,
    ...actions.length === 0 ? {} : { actions }
  };
  return { ok: true, value: card2 };
}
function validateRichContent(value) {
  try {
    return validateRichContentUnsafe(value);
  } catch {
    return { ok: false, issues: [issue("NOT_AN_OBJECT", "", "payload could not be read as a JSON object")] };
  }
}
function summarizeRichContent(value) {
  switch (value.type) {
    case "line_plot":
    case "scatter_plot": {
      const count = value.data.series.reduce((sum, series) => sum + series.points.length, 0);
      return `${value.type} "${value.title}": ${String(value.data.series.length)} series, ${String(count)} points`;
    }
    case "basic_diagram":
      return `basic_diagram "${value.title}": ${String(value.data.nodes.length)} nodes, ${String(value.data.edges.length)} edges`;
    case "message_card":
      return `message_card "${value.title}": ${String(value.actions?.length ?? 0)} actions`;
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
function text2(value, field, maxLength, issues) {
  if (typeof value !== "string") {
    issues.push({ field, detail: "must be a string" });
    return void 0;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ field, detail: "must not be empty" });
    return void 0;
  }
  if (trimmed.length > maxLength) {
    issues.push({ field, detail: `must be at most ${String(maxLength)} characters` });
    return void 0;
  }
  return trimmed;
}
function readInteractionPayload(value) {
  const issues = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [{ field: "", detail: "payload must be a JSON object" }] };
  }
  const record2 = value;
  if (record2["protocol"] !== RICH_INTERACTION_PROTOCOL) {
    issues.push({ field: "protocol", detail: `must be "${RICH_INTERACTION_PROTOCOL}"` });
  }
  if (record2["protocolVersion"] !== 1) {
    issues.push({ field: "protocolVersion", detail: "must be 1" });
  }
  const sessionId = text2(record2["sessionId"], "sessionId", RICH_LIMITS.maxNodeIdLength + 64, issues);
  const callId = text2(record2["callId"], "callId", RICH_LIMITS.maxNodeIdLength + 64, issues);
  const cardKey = text2(record2["cardKey"], "cardKey", 200, issues);
  const actionId = text2(record2["actionId"], "actionId", RICH_LIMITS.maxActionIdLength, issues);
  if (actionId !== void 0 && !SAFE_ID2.test(actionId)) {
    issues.push({ field: "actionId", detail: "must match [A-Za-z0-9._:-]{1,64}" });
  }
  const attemptId = text2(record2["attemptId"], "attemptId", 128, issues);
  const submittedAt = text2(record2["submittedAt"], "submittedAt", 64, issues);
  let questionId;
  if (record2["questionId"] !== void 0) {
    if (typeof record2["questionId"] !== "string" || !SAFE_ID2.test(record2["questionId"])) {
      issues.push({ field: "questionId", detail: "must match [A-Za-z0-9._:-]{1,64}" });
    } else questionId = record2["questionId"];
  }
  let answer;
  if (record2["answer"] !== void 0) {
    answer = text2(record2["answer"], "answer", RICH_LIMITS.maxSubmitTextLength, issues);
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

// rich/src/host/tools/rich-interaction.ts
function createRichInteractionCommand(options) {
  const now = options.now ?? (() => Date.now());
  return {
    name: "rich-interaction",
    description: "Record one interactive-card action against its originating session (host audit).",
    input: { hint: "internal: called by the rich-response card, not typed by users" },
    recordInput: true,
    handler(invocation) {
      const raw = invocation.rawInput.trim();
      if (raw.length === 0) return { kind: "error", text: "rich-interaction: empty payload" };
      if (raw.length > MAX_INTERACTION_RAW_INPUT) {
        return { kind: "error", text: "rich-interaction: payload too large" };
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { kind: "error", text: "rich-interaction: payload is not valid JSON" };
      }
      const validation = validateInteractionPayload(parsed);
      if (!validation.ok) {
        return {
          kind: "error",
          text: `rich-interaction: invalid payload: ${formatValidationIssues(validation.issues.map((item) => ({
            code: "INVALID_ACTION",
            path: item.field,
            detail: item.detail
          })))}`
        };
      }
      const payload = validation.value;
      const agentId = invocation.agent.id;
      if (payload.sessionId !== agentId) {
        return {
          kind: "error",
          text: `rich-interaction: session mismatch (payload=${payload.sessionId}, agent=${agentId})`
        };
      }
      const submittedMs = Date.parse(payload.submittedAt);
      const skew = Math.abs(now() - submittedMs);
      if (skew > MAX_INTERACTION_SKEW_MS) {
        return { kind: "error", text: `rich-interaction: stale submission (skew ${String(skew)}ms)` };
      }
      const expectedCardKey = cardKeyFor(payload.callId, payload.questionId);
      if (payload.cardKey !== expectedCardKey) {
        return { kind: "error", text: "rich-interaction: cardKey does not match call/question identity" };
      }
      const duplicate = options.tracker.observe(payload.attemptId);
      const record2 = {
        ...payload,
        receivedAt: new Date(now()).toISOString(),
        agentId,
        duplicate
      };
      if (options.auditLog !== void 0) appendAuditRecord(options.auditLog, record2, options.logger);
      options.logger.info(
        "rich-response: interaction recorded session=%s card=%s action=%s attempt=%s duplicate=%s",
        agentId,
        payload.cardKey,
        payload.actionId,
        payload.attemptId,
        String(duplicate)
      );
      return {
        kind: "success",
        text: `rich-interaction recorded: card=${payload.cardKey} action=${payload.actionId} attempt=${payload.attemptId}${duplicate ? " (duplicate)" : ""}`
      };
    }
  };
}

// rich/src/shared/plain-text.ts
var UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
var UNSAFE_TEXT_GLOBAL = new RegExp(UNSAFE_TEXT.source, "g");
function isPlainText(text5) {
  return !UNSAFE_TEXT.test(text5);
}
function stripUnsafeText(text5) {
  return text5.replace(UNSAFE_TEXT_GLOBAL, "");
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
function text3(raw, path, maxLength, code, required, issues) {
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
  const label = text3(raw["label"], `${path}.label`, HEATMAP_LIMITS.maxLabelLength, "INVALID_AXIS", false, issues);
  const unit2 = text3(raw["unit"], `${path}.unit`, HEATMAP_LIMITS.maxLabelLength, "INVALID_AXIS", false, issues);
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
  const label = text3(raw["label"], "colorScale.label", HEATMAP_LIMITS.maxLabelLength, "INVALID_SCALE", false, issues);
  const unit2 = text3(raw["unit"], "colorScale.unit", HEATMAP_LIMITS.maxLabelLength, "INVALID_SCALE", false, issues);
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
  const title = text3(value["title"], "title", HEATMAP_LIMITS.maxTitleLength, "INVALID_TITLE", true, issues);
  const subtitle = text3(value["subtitle"], "subtitle", HEATMAP_LIMITS.maxSubtitleLength, "INVALID_SUBTITLE", false, issues);
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
function summarizeHeatmap(content) {
  const extent = heatmapExtent(content);
  const scale = resolveHeatmapScale(content);
  const unit2 = content.colorScale.unit === void 0 ? "" : ` ${content.colorScale.unit}`;
  const rows = content.values.length;
  const columns = content.values[0]?.length ?? 0;
  const [low, high] = formatHeatmapNumbers([extent.min, extent.max]);
  const [scaleLow, scaleHigh] = formatHeatmapNumbers([scale.min, scale.max]);
  return `heatmap "${content.title}": ${String(rows)}x${String(columns)} cells, values ${String(low)} to ${String(high)}${unit2} (${content.colorScale.palette} scale ${String(scaleLow)} to ${String(scaleHigh)}${scale.constant ? ", constant" : ""})`;
}
function formatHeatmapIssues(issues) {
  const head = issues.slice(0, 8).map((item) => `${item.code}@${item.path || "<root>"}: ${item.detail}`);
  const suffix = issues.length > head.length ? ` (+${String(issues.length - head.length)} more)` : "";
  return head.join("; ") + suffix;
}

// rich/src/shared/tool-schemas.ts
var text4 = (description) => ({ type: "string", description });
var number = (description) => ({ type: "number", description });
var axis = (description) => ({
  type: "object",
  description,
  properties: {
    label: text4("Axis title, plain text."),
    unit: text4('Unit appended to the axis title and tick labels, e.g. "s".'),
    min: number("Optional lower bound, given together with max."),
    max: number("Optional upper bound, given together with min.")
  }
});
var RICH_RENDER_CONTENT_SCHEMA = {
  type: "object",
  description: "RichContentV1. line_plot/scatter_plot use data.series (+ optional data.xAxis/data.yAxis); basic_diagram uses data.nodes and data.edges; message_card uses body and optional actions instead of data.",
  properties: {
    schemaVersion: { type: "integer", enum: [RICH_CONTENT_SCHEMA_VERSION] },
    type: { type: "string", enum: [...RICH_CONTENT_TYPES] },
    title: text4(`Card title, at most ${String(RICH_LIMITS.maxTitleLength)} characters.`),
    subtitle: text4("Optional one-line caption."),
    data: {
      type: "object",
      description: "Plot or diagram data. Axes belong inside data, not at the top level.",
      properties: {
        series: {
          type: "array",
          description: `Plot series, at most ${String(RICH_LIMITS.maxSeries)}, each with at most ${String(RICH_LIMITS.maxPointsPerSeries)} points.`,
          items: {
            type: "object",
            properties: {
              name: text4('Legend name of the series (required; not "label").'),
              points: {
                type: "array",
                description: "Finite coordinates; a line plot joins them in order.",
                items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }
              },
              color: text4('Optional hex color "#rrggbb".')
            },
            required: ["name", "points"]
          }
        },
        xAxis: axis("Horizontal axis."),
        yAxis: axis("Vertical axis."),
        nodes: {
          type: "array",
          description: `Diagram nodes, at most ${String(RICH_LIMITS.maxDiagramNodes)}, placed on a 0..1000 grid.`,
          items: {
            type: "object",
            properties: {
              id: text4("Unique node id, referenced by edges."),
              label: text4("Node text."),
              x: { type: "integer", description: "Column on the 0..1000 grid." },
              y: { type: "integer", description: "Row on the 0..1000 grid." },
              shape: { type: "string", enum: ["box", "rounded", "diamond", "circle"] },
              tone: { type: "string", enum: ["default", "accent", "muted"] }
            },
            required: ["id", "label", "x", "y"]
          }
        },
        edges: {
          type: "array",
          description: `Diagram edges, at most ${String(RICH_LIMITS.maxDiagramEdges)}.`,
          items: {
            type: "object",
            properties: {
              from: text4("Source node id."),
              to: text4("Target node id."),
              label: text4("Optional edge label."),
              dashed: { type: "boolean" }
            },
            required: ["from", "to"]
          }
        }
      }
    },
    body: text4("message_card text."),
    questionId: text4("Optional stable message_card question id."),
    actions: {
      type: "array",
      description: `Optional message_card buttons, at most ${String(RICH_LIMITS.maxCardActions)}.`,
      items: {
        type: "object",
        properties: { id: text4("Action id."), label: text4("Button text."), submitText: text4("Plain text sent back to this session when pressed.") },
        required: ["id", "label", "submitText"]
      }
    }
  },
  required: ["schemaVersion", "type", "title"]
};
var HEATMAP_CONTENT_SCHEMA = {
  type: "object",
  description: "HeatmapV1.",
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    title: text4(`Card title, at most ${String(HEATMAP_LIMITS.maxTitleLength)} characters.`),
    subtitle: text4("Optional one-line caption."),
    values: {
      type: "array",
      description: `Row-major rectangular matrix values[row][column], at most ${String(HEATMAP_LIMITS.maxRows)}x${String(HEATMAP_LIMITS.maxColumns)} and ${String(HEATMAP_LIMITS.maxCells)} cells.`,
      items: { type: "array", items: { type: "number" } }
    },
    origin: { type: "string", enum: ["lower", "upper"], description: '"lower" (default): values[0] is the bottom row; "upper": the top row.' },
    xAxis: axis("Columns; min/max are the coordinates of the outer grid edges."),
    yAxis: axis("Rows; min/max run bottom to top."),
    colorScale: {
      type: "object",
      properties: {
        palette: { type: "string", enum: ["sequential", "diverging"] },
        label: text4("Color bar title."),
        unit: text4("Color bar unit."),
        min: number("Optional lower bound; must not exceed the smallest value."),
        max: number("Optional upper bound; must not be below the largest value.")
      }
    }
  },
  required: ["schemaVersion", "title", "values"]
};

// rich/src/shared/chart-scale.ts
var CHART_DEFAULT_WIDTH = 640;
var CHART_DEFAULT_HEIGHT = 240;
var CHART_MIN_WIDTH = 240;
var CHART_MIN_HEIGHT = 220;
var CHART_MAX_HEIGHT = 260;
var CHART_MARGINS = { top: 12, right: 16, bottom: 44, left: 64 };
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
  const text5 = rounded.toFixed(digits);
  if (/^-0(?:\.0+)?$/.test(text5)) return text5.slice(1);
  return text5;
}
function formatTickLabel(value, decimals, unit2) {
  const number3 = formatNumber(value, decimals);
  if (unit2 === void 0) return number3;
  const trimmed = unit2.trim();
  return trimmed.length === 0 ? number3 : `${number3} ${trimmed}`;
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

// rich/src/shared/text-width.ts
var WIDE_CHAR = new RegExp("[\\u1100-\\u115F\\u2600-\\u27BF\\u2B00-\\u2BFF\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE30-\\uFE4F\\uFF00-\\uFF60\\uFFE0-\\uFFE6\\u{1F300}-\\u{1FAFF}\\u{20000}-\\u{3FFFD}\\uFE0F\\u20E3]|\\p{Extended_Pictographic}|\\p{Regional_Indicator}", "u");
var LATIN_WIDE = /* @__PURE__ */ new Map([["W", 1.75], ["@", 1.75], ["%", 1.6], ["M", 1.55], ["m", 1.55]]);
var LATIN_CAPITAL = /^[A-HK-Zw]$/;
var segmenter;
function graphemes(text5) {
  if (segmenter === void 0) {
    segmenter = typeof Intl === "object" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
  }
  if (segmenter === null) return Array.from(text5);
  return Array.from(segmenter.segment(text5), (part) => part.segment);
}
function graphemeWidth(cluster) {
  if (WIDE_CHAR.test(cluster)) return 2;
  return LATIN_WIDE.get(cluster) ?? (LATIN_CAPITAL.test(cluster) ? 1.35 : 1);
}
function displayWidth(text5) {
  let total = 0;
  for (const cluster of graphemes(text5)) total += graphemeWidth(cluster);
  return total;
}

// rich/src/shared/diagram-geometry.ts
var DIAGRAM_VIEW = { width: 1e3, height: 560 };
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

// rich/src/shared/figure-svg.ts
var FIGURE_THEME = {
  background: "#ffffff",
  border: "#d0d7de",
  text: "#1f2328",
  muted: "#59636e",
  grid: "#e6eaef",
  node: "#f6f8fa",
  accent: "#247bbf"
};
var FIGURE_WIDTH = 640;
var FIGURE_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
var PAD = 20;
var PLOT_HEIGHT = 260;
function escapeXml(value) {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
var n = (value) => formatCoordinate(value);
function headerHeight(header) {
  return header.subtitle !== void 0 && header.subtitle.length > 0 ? 56 : 38;
}
function card(header, body, bodyWidth, bodyHeight, scale = 1) {
  const top = headerHeight(header);
  const width = Math.max(FIGURE_WIDTH, Math.ceil(bodyWidth * scale + PAD * 2));
  const height = Math.ceil(top + bodyHeight * scale + PAD * 0.75);
  const subtitle = header.subtitle !== void 0 && header.subtitle.length > 0 ? `<text x="${String(PAD)}" y="46" font-size="13" fill="${FIGURE_THEME.muted}">${escapeXml(header.subtitle)}</text>` : "";
  const offsetX = (width - bodyWidth * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}" font-family="${escapeXml(FIGURE_FONT_FAMILY)}"><title>${escapeXml(header.title)}</title><rect x="0.5" y="0.5" width="${String(width - 1)}" height="${String(height - 1)}" rx="12" fill="${FIGURE_THEME.background}" stroke="${FIGURE_THEME.border}"/><text x="${String(PAD)}" y="26" font-size="15" font-weight="600" fill="${FIGURE_THEME.text}">${escapeXml(header.title)}</text>${subtitle}<g transform="translate(${n(offsetX)} ${String(top)}) scale(${n(scale)})">${body}</g></svg>`;
}
function plotBody(model, scatter) {
  const { plot } = model;
  const parts = [];
  for (const tick of model.yTicks.ticks) {
    const y = model.yScale.map(tick.value);
    parts.push(`<line x1="${n(plot.left)}" y1="${n(y)}" x2="${n(plot.left + plot.width)}" y2="${n(y)}" stroke="${FIGURE_THEME.grid}"/>`);
    parts.push(`<text x="${n(plot.left - 6)}" y="${n(y)}" dy="0.32em" text-anchor="end" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(tick.label)}</text>`);
  }
  for (const tick of model.xTicks.ticks) {
    const x2 = model.xScale.map(tick.value);
    parts.push(`<line x1="${n(x2)}" y1="${n(plot.top)}" x2="${n(x2)}" y2="${n(plot.top + plot.height)}" stroke="${FIGURE_THEME.grid}"/>`);
    parts.push(`<text x="${n(x2)}" y="${n(plot.top + plot.height + 16)}" text-anchor="middle" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(tick.label)}</text>`);
  }
  parts.push(`<rect x="${n(plot.left)}" y="${n(plot.top)}" width="${n(plot.width)}" height="${n(plot.height)}" fill="none" stroke="${FIGURE_THEME.border}"/>`);
  for (const series of model.series) {
    if (scatter) {
      for (const mark of series.marks) parts.push(`<circle cx="${n(mark.pixel.x)}" cy="${n(mark.pixel.y)}" r="3" fill="${escapeXml(series.color)}"/>`);
    } else if (series.marks.length > 0) {
      parts.push(`<polyline points="${series.polyline}" fill="none" stroke="${escapeXml(series.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }
  const xTitle = axisTitleText(model.xLabel, model.xUnit);
  const yTitle = axisTitleText(model.yLabel, model.yUnit);
  if (xTitle.length > 0) parts.push(`<text x="${n(plot.left + plot.width / 2)}" y="${n(plot.top + plot.height + 34)}" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(xTitle)}</text>`);
  if (yTitle.length > 0) parts.push(`<text transform="translate(14 ${n(plot.top + plot.height / 2)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(yTitle)}</text>`);
  let x = plot.left;
  for (const series of model.series) {
    parts.push(`<rect x="${n(x)}" y="${n(plot.top - 13)}" width="10" height="10" rx="2" fill="${escapeXml(series.color)}"/>`);
    parts.push(`<text x="${n(x + 14)}" y="${n(plot.top - 4)}" font-size="11" fill="${FIGURE_THEME.text}">${escapeXml(series.name)}</text>`);
    x += 30 + Math.min(series.name.length, 24) * 11;
  }
  return parts.join("");
}
function plotFigureSvg(content) {
  const model = createChartModel(content.data, { width: FIGURE_WIDTH - PAD * 2, height: PLOT_HEIGHT });
  return card(content, `<g transform="translate(0 16)">${plotBody(model, content.type === "scatter_plot")}</g>`, model.layout.width, model.layout.height + 16);
}
function nodeShape(geometry) {
  const { center, halfWidth, halfHeight } = geometry;
  const tone = geometry.node.tone;
  const fill = tone === "accent" ? FIGURE_THEME.accent : FIGURE_THEME.node;
  const stroke = tone === "accent" ? FIGURE_THEME.accent : FIGURE_THEME.border;
  const textFill = tone === "accent" ? "#ffffff" : tone === "muted" ? FIGURE_THEME.muted : FIGURE_THEME.text;
  const paint = `fill="${fill}" stroke="${stroke}" stroke-width="1.4"`;
  let shape;
  switch (geometry.shape) {
    case "diamond":
      shape = `<polygon points="${n(center.x)},${n(center.y - halfHeight)} ${n(center.x + halfWidth)},${n(center.y)} ${n(center.x)},${n(center.y + halfHeight)} ${n(center.x - halfWidth)},${n(center.y)}" ${paint}/>`;
      break;
    case "circle":
      shape = `<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(geometry.radius)}" ${paint}/>`;
      break;
    default:
      shape = `<rect x="${n(center.x - halfWidth)}" y="${n(center.y - halfHeight)}" width="${n(halfWidth * 2)}" height="${n(halfHeight * 2)}" rx="${geometry.shape === "rounded" ? "14" : "3"}" ${paint}/>`;
  }
  return shape + `<text x="${n(center.x)}" y="${n(center.y)}" dy="0.34em" text-anchor="middle" font-size="12" fill="${textFill}">${escapeXml(truncateLabel(geometry.node.label, geometry.labelMaxChars))}</text>`;
}
function diagramFigureSvg(content) {
  const geometry = buildDiagramGeometry(content.data.nodes, content.data.edges);
  if (geometry.nodes.length === 0) return card(content, "", FIGURE_WIDTH - PAD * 2, 24);
  const left = Math.min(...geometry.nodes.map((g) => g.center.x - g.halfWidth)) - 12;
  const right = Math.max(...geometry.nodes.map((g) => g.center.x + g.halfWidth)) + 12;
  const top = Math.min(...geometry.nodes.map((g) => g.center.y - g.halfHeight)) - 12;
  const bottom = Math.max(...geometry.nodes.map((g) => g.center.y + g.halfHeight)) + 12;
  const width = right - left, height = bottom - top;
  const scale = Math.min(1, (FIGURE_WIDTH - PAD * 2) / width);
  const edges = geometry.edges.map((edge) => {
    const dash2 = edge.edge.dashed === true ? ' stroke-dasharray="7 5"' : "";
    const label = edge.labelText.length > 0 ? `<text x="${n(edge.label.x)}" y="${n(edge.label.y)}" text-anchor="middle" font-size="11" fill="${FIGURE_THEME.muted}" stroke="${FIGURE_THEME.background}" stroke-width="3" paint-order="stroke">${escapeXml(truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS))}</text>` : "";
    return `<line x1="${n(edge.start.x)}" y1="${n(edge.start.y)}" x2="${n(edge.end.x)}" y2="${n(edge.end.y)}" stroke="${FIGURE_THEME.muted}" stroke-width="1.4"${dash2} marker-end="url(#arrow)"/>${label}`;
  }).join("");
  const body = `<defs><marker id="arrow" viewBox="0 0 10 7" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,3.5 L0,7 Z" fill="${FIGURE_THEME.muted}"/></marker></defs><g transform="translate(${n(-left)} ${n(-top)})">${edges}${geometry.nodes.map(nodeShape).join("")}</g>`;
  return card(content, body, width, height, scale);
}
function heatmapFigureSvg(content) {
  const rows = content.values.length, columns = content.values[0]?.length ?? 0;
  const scale = resolveHeatmapScale(content);
  const gridLeft = 56, gridTop = 4, barWidth = 14, barGap = 18, labelRoom = 64;
  const available = FIGURE_WIDTH - PAD * 2 - gridLeft - barGap - barWidth - labelRoom;
  const cell = Math.max(2, Math.min(available / Math.max(columns, 1), 260 / Math.max(rows, 1)));
  const gridWidth = cell * columns, gridHeight = cell * rows;
  const parts = [];
  for (let row = 0; row < rows; row++) {
    const drawRow = content.origin === "upper" ? row : rows - 1 - row;
    for (let column = 0; column < columns; column++) {
      const value = content.values[row]?.[column] ?? 0;
      parts.push(`<rect x="${n(gridLeft + column * cell)}" y="${n(gridTop + drawRow * cell)}" width="${n(cell)}" height="${n(cell)}" fill="${heatmapColor(content.colorScale.palette, scale, value)}"/>`);
    }
  }
  parts.push(`<rect x="${n(gridLeft)}" y="${n(gridTop)}" width="${n(gridWidth)}" height="${n(gridHeight)}" fill="none" stroke="${FIGURE_THEME.border}"/>`);
  const barX = gridLeft + gridWidth + barGap, steps = 32;
  for (let step = 0; step < steps; step++) {
    const value = scale.max - (scale.max - scale.min) * (step + 0.5) / steps;
    parts.push(`<rect x="${n(barX)}" y="${n(gridTop + gridHeight * step / steps)}" width="${String(barWidth)}" height="${n(gridHeight / steps + 0.5)}" fill="${heatmapColor(content.colorScale.palette, scale, value)}"/>`);
  }
  const [maxLabel, minLabel] = formatHeatmapNumbers([scale.max, scale.min]);
  parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + 10)}" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(maxLabel ?? "")}</text>`);
  parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + gridHeight)}" font-size="11" fill="${FIGURE_THEME.muted}">${escapeXml(minLabel ?? "")}</text>`);
  const barTitle = axisTitleText(content.colorScale.label, content.colorScale.unit);
  if (barTitle.length > 0) parts.push(`<text x="${n(barX + barWidth + 4)}" y="${n(gridTop + gridHeight / 2)}" font-size="11" fill="${FIGURE_THEME.text}">${escapeXml(barTitle)}</text>`);
  const xTitle = axisTitleText(content.xAxis?.label, content.xAxis?.unit);
  const yTitle = axisTitleText(content.yAxis?.label, content.yAxis?.unit);
  if (xTitle.length > 0) parts.push(`<text x="${n(gridLeft + gridWidth / 2)}" y="${n(gridTop + gridHeight + 20)}" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(xTitle)}</text>`);
  if (yTitle.length > 0) parts.push(`<text transform="translate(${String(gridLeft - 14)} ${n(gridTop + gridHeight / 2)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${FIGURE_THEME.text}">${escapeXml(yTitle)}</text>`);
  return card(content, parts.join(""), barX + barWidth + labelRoom, gridTop + gridHeight + 28);
}
function richContentFigureSvg(content) {
  switch (content.type) {
    case "line_plot":
    case "scatter_plot":
      return plotFigureSvg(content);
    case "basic_diagram":
      return diagramFigureSvg(content);
    default:
      return void 0;
  }
}
function drawingFigureSvg(header, viewBox, inner) {
  const [, , width, height] = viewBox;
  const scale = Math.min((FIGURE_WIDTH - PAD * 2) / width, 720 / height);
  const body = `<svg x="0" y="0" width="${n(width)}" height="${n(height)}" viewBox="${viewBox.map(n).join(" ")}" overflow="hidden">${inner}</svg>`;
  return card(header, body, width, height, scale);
}

// rich/src/host/figures.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync, lstatSync as lstatSync2, mkdirSync as mkdirSync4, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve2, sep } from "node:path";
function defaultFiguresDir(env = process.env) {
  const configured = env["DSH_HOME"]?.trim();
  return join2(configured !== void 0 && configured.length > 0 ? configured : join2(homedir2(), ".dsh"), "rich-response", "figures");
}
function figureAlt(text5) {
  const flat = text5.replace(/[[\]()\\`<>*_!\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return (chars.length > 80 ? `${chars.slice(0, 79).join("")}\u2026` : flat) || "figure";
}
function markdownPath(path) {
  return [...path.replace(/\\/g, "/")].map((ch) => /[A-Za-z0-9._~/:-]/.test(ch) ? ch : encodeURIComponent(ch).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("");
}
function session2(sessionId) {
  const safe = (sessionId ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return safe.length > 0 ? safe : "unscoped";
}
function createFigureStore(dir) {
  const root = resolve2(dir);
  return {
    root,
    write(sessionId, bytes, extension, alt) {
      let temporary;
      try {
        if (!isAbsolute2(dir)) return { ok: false, reason: "figure directory is not absolute" };
        const folder = join2(root, session2(sessionId));
        mkdirSync4(folder, { recursive: true });
        if (lstatSync2(root).isSymbolicLink() || lstatSync2(folder).isSymbolicLink()) return { ok: false, reason: "figure directory is a symbolic link" };
        const digest2 = createHash2("sha256").update(bytes).digest("hex").slice(0, 20);
        const path = join2(folder, `fig-${digest2}.${extension}`);
        const markdown = `![${figureAlt(alt)}](${markdownPath(path)})`;
        if (!existsSync(path)) {
          temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
          writeFileSync(temporary, bytes, { flag: "wx" });
          renameSync(temporary, path);
          temporary = void 0;
        }
        return { ok: true, figure: { path, markdown } };
      } catch (error) {
        if (temporary !== void 0) try {
          unlinkSync(temporary);
        } catch {
        }
        return { ok: false, reason: error instanceof Error ? error.message.slice(0, 200) : "write failed" };
      }
    }
  };
}
var FIGURE_OUTPUT_PROPERTIES = {
  figure: { type: "object", properties: { path: { type: "string" }, markdown: { type: "string" } }, required: ["path", "markdown"], additionalProperties: false },
  figureUnavailable: { type: "string" }
};
var FIGURE_TOOL_NOTE = " The result contains one Markdown image line for the drawn figure: copy it onto its own line in your answer where the figure belongs, so the learner sees the figure next to the text that discusses it.";
function figureSession(exec) {
  const id = exec.agent?.id;
  return typeof id === "string" ? id : void 0;
}
function writeFigure(store, exec, bytes, extension, alt) {
  if (store === void 0 || bytes === void 0) return {};
  const result = store.write(figureSession(exec), bytes, extension, alt);
  return result.ok ? { figure: result.figure } : { figureUnavailable: result.reason };
}
function figureInstruction(value, store) {
  const record2 = value;
  const markdown = record2?.figure?.markdown, path = record2?.figure?.path;
  const alt = typeof markdown === "string" ? /^!\[([^\]\n]*)\]\(/.exec(markdown)?.[1] : void 0;
  const line = store !== void 0 && alt !== void 0 && typeof path === "string" && isAbsolute2(path) && resolve2(path).startsWith(store.root + sep) ? `![${figureAlt(alt)}](${markdownPath(resolve2(path))})` : void 0;
  if (line !== void 0 && line === markdown) {
    return `
To show this figure inside your answer, put this line on its own line where the figure belongs (copy it exactly; do not write SVG or image data yourself):
${markdown}`;
  }
  return typeof record2?.figureUnavailable === "string" ? `
The inline figure file is unavailable (${record2.figureUnavailable.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").slice(0, 200)}); the learner sees the figure only in the tool record.` : "";
}

// rich/src/host/tools/rich-render.ts
var OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    content: { type: "object" },
    summary: { type: "string" },
    ...FIGURE_OUTPUT_PROPERTIES
  },
  required: ["content", "summary"],
  additionalProperties: false
};
function valueOf(value) {
  const record2 = value;
  return {
    content: record2?.content,
    summary: typeof record2?.summary === "string" ? record2.summary : ""
  };
}
function createRichRenderTool(options = {}) {
  return {
    name: "rich_render",
    description: `Render one structured visual response card in the conversation. Use it for function curves (line_plot), charts (scatter_plot), simple diagrams (basic_diagram), and interactive message cards (message_card). The payload must be RichContentV1 with schemaVersion ${String(RICH_CONTENT_SCHEMA_VERSION)}; at most ${String(RICH_LIMITS.maxSeries)} series, ${String(RICH_LIMITS.maxPointsPerSeries)} points per series, finite coordinates only. Never put HTML, SVG source, URLs, or executable expressions in the payload.` + (options.figures === void 0 ? "" : FIGURE_TOOL_NOTE),
    // Raw model-facing JSON Schema (a plain ToolDefinition passes `parameters`
    // straight through to the provider). The author-side schema DSL is only
    // compiled by `defineTool`, which this zero-dependency plugin does not use;
    // bounds and semantics are enforced by validateRichContent in `execute`.
    parameters: {
      type: "object",
      properties: {
        content: RICH_RENDER_CONTENT_SCHEMA
      },
      required: ["content"],
      additionalProperties: false
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, rawValue) => {
        const value = valueOf(rawValue);
        return [{ type: "text", text: value.summary + figureInstruction(rawValue, options.figures) }];
      },
      presentationMeta: (_args, rawValue) => {
        const value = valueOf(rawValue);
        return {
          kind: RICH_META_KIND,
          envelopeVersion: RICH_META_ENVELOPE_VERSION,
          content: value.content
        };
      }
    },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("rich_render: aborted before dispatch");
      const candidate = args2?.content;
      const result = validateRichContent(candidate);
      if (!result.ok) {
        throw new Error(`rich_render: invalid RichContentV1 payload: ${formatValidationIssues(result.issues)}`);
      }
      return {
        content: result.value,
        summary: summarizeRichContent(result.value),
        ...writeFigure(options.figures, exec, richContentFigureSvg(result.value), "svg", result.value.title)
      };
    }
  };
}

// rich/src/shared/physics-protocol.ts
var PHYSICS_DEMOS = ["infinite_well", "harmonic_oscillator", "ising"];
function physicsArgs(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a named physics demo");
  const record2 = value;
  if (Object.keys(record2).some((k) => k !== "demo") || !PHYSICS_DEMOS.includes(record2.demo)) throw new Error("Unsupported physics demo or extra fields");
  return { demo: record2.demo };
}

// rich/src/host/tools/physics-demo.ts
function createPhysicsTool() {
  return {
    name: "rich_physics_demo",
    description: "Show a deterministic interactive physics demonstration: normalized infinite well, classical harmonic oscillator, or finite Ising example. No executable expressions or model-generated curve data. Ising is a finite configuration example, not a phase-transition simulation.",
    parameters: { type: "object", properties: { demo: { type: "string", enum: [...PHYSICS_DEMOS] } }, required: ["demo"], additionalProperties: false },
    output: { schema: { type: "object", properties: { demo: { type: "string", enum: [...PHYSICS_DEMOS] } }, required: ["demo"], additionalProperties: false }, render: (_a, value) => [{ type: "text", text: "Interactive deterministic physics demo: " + physicsArgs(value).demo + ". It stays in the tool record and has no inline figure; for a figure inside your answer use rich_render, rich_svg, rich_mermaid or rich_heatmap." }], presentationMeta: (_a, value) => ({ kind: "rich-physics", version: 1, ...physicsArgs(value) }) },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("Physics demo aborted");
      return physicsArgs(args2);
    }
  };
}

// rich/src/shared/mermaid.ts
var MERMAID_LIMITS = {
  maxSourceBytes: 8 * 1024,
  maxLines: 200,
  maxLineLength: 400,
  maxLayers: 5
};
var KEYWORDS = /* @__PURE__ */ new Set(["subgraph", "end", "classDef", "class", "style", "linkStyle", "click", "direction", "callback", "graph", "flowchart"]);
var DIRECTIONS = /* @__PURE__ */ new Map([["TD", "TD"], ["TB", "TD"], ["BT", "BT"], ["LR", "LR"], ["RL", "RL"]]);
var FORBIDDEN_CHAR = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F\p{Cf}\p{Zl}\p{Zp}\u034F\u115F\u1160\u17B4\u17B5\u2065\u3164\uFFA0\u{E0000}-\u{E007F}]/u;
var LABEL_FORBIDDEN = /[[\](){}"|]/;
var LABEL_MARKUP = /<\/?(?:a|abbr|b|big|blockquote|br|center|code|del|div|em|font|h[1-6]|hr|i|iframe|img|ins|li|mark|math|ol|p|pre|q|s|script|small|span|strike|strong|style|sub|sup|svg|table|td|th|tr|u|ul)(?=[\s/>])[^<>]*>|&(?:#\d+|#x[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);|#(?:\d+|[A-Za-z][A-Za-z0-9]*);|^`/i;
var INLINE_LINK_TEXT = /--|-\.|\.-|==|-$/;
var ID_CHAR = /[A-Za-z0-9_]/;
var LINK_CHAR = /[-.=<>~]/;
var OPENERS = [
  ["(((", ")))", null],
  ["((", "))", "circle"],
  ["([", "])", "rounded"],
  ["[[", "]]", null],
  ["[(", ")]", null],
  ["[/", "/]", null],
  ["[\\", "\\]", null],
  ["{{", "}}", null],
  ["(", ")", "rounded"],
  ["[", "]", "box"],
  ["{", "}", "diamond"],
  [">", "]", null]
];
var LineError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var Cursor = class {
  constructor(text5) {
    this.text = text5;
  }
  text;
  index = 0;
  get done() {
    return this.index >= this.text.length;
  }
  peek(offset = 0) {
    return this.text[this.index + offset] ?? "";
  }
  startsWith(token) {
    return this.text.startsWith(token, this.index);
  }
  skipSpace() {
    while (this.peek() === " " || this.peek() === "	") this.index += 1;
  }
};
function checkLabel(raw, maxLength) {
  const label = raw.trim();
  if (label.length === 0) throw new LineError("INVALID_LABEL", "labels must not be empty");
  if (label.length > maxLength) throw new LineError("INVALID_LABEL", `labels are limited to ${String(maxLength)} characters`);
  if (LABEL_MARKUP.test(label)) {
    throw new LineError("INVALID_LABEL", "labels are plain text: HTML tags such as <br> or <p>, entity codes such as &amp; or #quot; and `markdown` strings are not supported; write averages as \u27E8p\u27E9");
  }
  return label;
}
function readId(cursor) {
  const start = cursor.index;
  while (ID_CHAR.test(cursor.peek())) cursor.index += 1;
  const id = cursor.text.slice(start, cursor.index);
  if (id.length === 0) throw new LineError("UNSUPPORTED_STATEMENT", "expected a node id ([A-Za-z0-9_])");
  if (id.length > RICH_LIMITS.maxNodeIdLength) {
    throw new LineError("INVALID_ID", `node ids are limited to ${String(RICH_LIMITS.maxNodeIdLength)} characters`);
  }
  return id;
}
function readShape(cursor) {
  const opener = OPENERS.find(([open2]) => cursor.startsWith(open2));
  if (opener === void 0) {
    let ahead = cursor.index;
    while (cursor.text[ahead] === " " || cursor.text[ahead] === "	") ahead += 1;
    if (ahead > cursor.index && "[({".includes(cursor.text[ahead] ?? "-")) {
      throw new LineError("UNSUPPORTED_SHAPE", "a shape must follow its node id without a space, e.g. A[label]");
    }
    return void 0;
  }
  const [open, close, shape] = opener;
  if (shape === null) throw new LineError("UNSUPPORTED_SHAPE", `shape "${open}...${close}" is not supported; use [ ], ( ), ([ ]), { } or (( ))`);
  cursor.index += open.length;
  let raw;
  if (cursor.peek() === '"') {
    const end = cursor.text.indexOf('"', cursor.index + 1);
    if (end < 0) throw new LineError("INVALID_LABEL", "unterminated quoted label");
    raw = cursor.text.slice(cursor.index + 1, end);
    cursor.index = end + 1;
    if (!cursor.startsWith(close)) throw new LineError("INVALID_LABEL", `expected "${close}" right after the quoted label`);
  } else {
    const end = cursor.text.indexOf(close, cursor.index);
    if (end < 0) throw new LineError("INVALID_LABEL", `unclosed label; expected "${close}"`);
    raw = cursor.text.slice(cursor.index, end);
    if (LABEL_FORBIDDEN.test(raw)) throw new LineError("INVALID_LABEL", "unquoted labels must not contain brackets, braces, quotes or |; quote the label");
    cursor.index = end;
  }
  cursor.index += close.length;
  return { label: checkLabel(raw, RICH_LIMITS.maxNodeLabelLength), shape };
}
function readPipeLabel(cursor) {
  cursor.skipSpace();
  if (cursor.peek() !== "|") return void 0;
  const end = cursor.text.indexOf("|", cursor.index + 1);
  if (end < 0) throw new LineError("INVALID_LABEL", "unclosed |link label|");
  let raw = cursor.text.slice(cursor.index + 1, end).trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  if (raw.includes('"')) throw new LineError("INVALID_LABEL", "link labels must not contain quotes");
  cursor.index = end + 1;
  return checkLabel(raw, RICH_LIMITS.maxEdgeLabelLength);
}
var UNSUPPORTED_LINK_MESSAGE = "supported links are -->, -.->, -->|label|, -- label --> and -. label .->";
function readLink(cursor) {
  const start = cursor.index;
  while (LINK_CHAR.test(cursor.peek())) cursor.index += 1;
  const token = cursor.text.slice(start, cursor.index);
  if (token === "-->" || token === "-.->") {
    const label = readPipeLabel(cursor);
    return { dashed: token === "-.->", ...label === void 0 ? {} : { label } };
  }
  if ((token === "--" || token === "-.") && (cursor.peek() === " " || cursor.peek() === "	")) {
    const closer = token === "--" ? "-->" : ".->";
    const end = cursor.text.indexOf(closer, cursor.index);
    if (end < 0) throw new LineError("UNSUPPORTED_LINK", UNSUPPORTED_LINK_MESSAGE);
    const raw = cursor.text.slice(cursor.index, end);
    if (LABEL_FORBIDDEN.test(raw) || INLINE_LINK_TEXT.test(raw.trim())) throw new LineError("INVALID_LABEL", "inline link labels must be plain text without link characters");
    cursor.index = end + closer.length;
    cursor.skipSpace();
    if (cursor.peek() === "|") throw new LineError("INVALID_LABEL", "a link takes either an inline label or a |label|, not both");
    return { dashed: token === "-.", label: checkLabel(raw, RICH_LIMITS.maxEdgeLabelLength) };
  }
  throw new LineError("UNSUPPORTED_LINK", UNSUPPORTED_LINK_MESSAGE);
}
function atStatementEnd(cursor) {
  cursor.skipSpace();
  return cursor.done || cursor.peek() === ";" || cursor.startsWith("%%");
}
function useNode(graph, id, shape) {
  const existing = graph.nodes.get(id);
  if (existing === void 0) {
    graph.nodes.set(id, shape === void 0 ? { id } : { id, label: shape.label, shape: shape.shape });
    graph.order.push(id);
    return;
  }
  if (shape === void 0) return;
  if (existing.label === void 0) {
    existing.label = shape.label;
    existing.shape = shape.shape;
    return;
  }
  if (existing.label !== shape.label || existing.shape !== shape.shape) {
    throw new LineError("CONFLICTING_NODE", `node "${id}" is already defined with a different label or shape`);
  }
}
function parseStatement(cursor, graph) {
  const first = readId(cursor);
  if (KEYWORDS.has(first)) throw new LineError("UNSUPPORTED_STATEMENT", `"${first}" statements are not supported`);
  const pending = [];
  const declared = [];
  declared.push({ id: first, shape: readShape(cursor) });
  let previous = first;
  while (!atStatementEnd(cursor)) {
    const link = readLink(cursor);
    cursor.skipSpace();
    if (cursor.done || cursor.peek() === ";" || cursor.startsWith("%%")) throw new LineError("INCOMPLETE_LINK", "a link must end at a node");
    const id = readId(cursor);
    if (KEYWORDS.has(id)) throw new LineError("UNSUPPORTED_STATEMENT", `"${id}" cannot be used as a node id`);
    declared.push({ id, shape: readShape(cursor) });
    pending.push({ from: previous, to: id, link });
    previous = id;
  }
  for (const entry of declared) useNode(graph, entry.id, entry.shape);
  for (const { from, to, link } of pending) {
    if (from === to) throw new LineError("SELF_LINK", `self links (${from} -> ${from}) are not supported`);
    const parallel = graph.edges.some((edge) => edge.from === from && edge.to === to || edge.from === to && edge.to === from);
    if (parallel) throw new LineError("PARALLEL_LINK", `${from} and ${to} are already linked; combine the labels into one link`);
    graph.edges.push({ from, to, ...link.label === void 0 ? {} : { label: link.label }, ...link.dashed ? { dashed: true } : {} });
  }
}
function parseHeader(text5) {
  const match = /^(flowchart|graph)(?=$|[\s;])[ \t]*([A-Za-z]*)[ \t]*(.*)$/.exec(text5);
  if (match === null) return { code: "MISSING_HEADER", message: 'the first statement must be "flowchart <TD|TB|BT|LR|RL>" (or "graph ...")' };
  const word = match[2] ?? "";
  const rest = match[3] ?? "";
  const direction = word === "" ? "TD" : DIRECTIONS.get(word);
  if (direction === void 0) return { code: "UNSUPPORTED_DIRECTION", message: "direction must be TD, TB, BT, LR or RL" };
  if (rest === "" || rest.startsWith("%%")) return { direction, rest: "" };
  if (rest.startsWith(";")) return { direction, rest: rest.slice(1) };
  return { code: "UNSUPPORTED_STATEMENT", message: 'put statements after the header on a new line or after ";"' };
}
var HALF = {
  box: { w: 74, h: 30 },
  rounded: { w: 74, h: 30 },
  diamond: { w: 88, h: 46 },
  circle: { w: 40, h: 40 }
};
var INSET = 8;
var MIN_GAP = 12;
var MIN_VISIBLE_LINK = 18;
var CLEARANCE = 4;
var LABEL_CLEARANCE = 2;
var LABEL_UNIT_WIDTH = 6.6;
var LINK_ROOM = 5 + 8 + MIN_VISIBLE_LINK + 5 + 1;
var LABEL_ROOM_ACROSS = 47;
var LABEL_ROOM_ALONG = 13;
var X_RANGE = [HALF.diamond.w + INSET, DIAGRAM_VIEW.width - HALF.diamond.w - INSET];
var Y_RANGE = [HALF.diamond.h + INSET, DIAGRAM_VIEW.height - HALF.diamond.h - INSET];
var DUMMY = "\0";
function assignLayers(order, edges) {
  const out = new Map(order.map((id) => [id, []]));
  for (const edge of edges) out.get(edge.from)?.push(edge.to);
  const state = /* @__PURE__ */ new Map();
  const forward = new Map(order.map((id) => [id, []]));
  for (const root of order) {
    if (state.has(root)) continue;
    const stack = [{ id: root, next: 0 }];
    state.set(root, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const targets = out.get(top.id);
      if (top.next >= targets.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const target = targets[top.next];
      top.next += 1;
      const seen = state.get(target);
      if (seen === 1) continue;
      forward.get(top.id).push(target);
      if (seen === void 0) {
        state.set(target, 1);
        stack.push({ id: target, next: 0 });
      }
    }
  }
  const indegree = new Map(order.map((id) => [id, 0]));
  for (const targets of forward.values()) for (const target of targets) indegree.set(target, indegree.get(target) + 1);
  const layer = new Map(order.map((id) => [id, 0]));
  const queue = order.filter((id) => indegree.get(id) === 0);
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head];
    for (const target of forward.get(id)) {
      layer.set(target, Math.max(layer.get(target), layer.get(id) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return layer;
}
function orderLayers(order, edges, layer, count) {
  const neighbours = new Map(order.map((id) => [id, []]));
  const link = (a, b) => {
    neighbours.get(a).push(b);
    neighbours.get(b).push(a);
  };
  const nodes = [...order];
  let dummies = 0;
  for (const edge of edges) {
    const [low, high] = layer.get(edge.from) < layer.get(edge.to) ? [edge.from, edge.to] : [edge.to, edge.from];
    let previous = low;
    for (let level = layer.get(low) + 1; level < layer.get(high); level += 1) {
      const id = `${DUMMY}${String(dummies)}`;
      dummies += 1;
      layer.set(id, level);
      neighbours.set(id, []);
      nodes.push(id);
      link(previous, id);
      previous = id;
    }
    link(previous, high);
  }
  const layers = Array.from({ length: count }, () => []);
  for (const id of nodes) layers[layer.get(id)].push(id);
  const centred = () => {
    const pos = /* @__PURE__ */ new Map();
    for (const row of layers) row.forEach((id, index) => pos.set(id, index - (row.length - 1) / 2));
    return pos;
  };
  const sweep = (index, below) => {
    const pos = centred();
    const keys = layers[index].map((id, current) => {
      const related = neighbours.get(id).filter((other) => below ? layer.get(other) < index : layer.get(other) > index);
      const key = related.length === 0 ? pos.get(id) : related.reduce((sum, other) => sum + pos.get(other), 0) / related.length;
      return { id, key, current };
    });
    keys.sort((a, b) => a.key - b.key || a.current - b.current);
    layers[index] = keys.map((entry) => entry.id);
  };
  for (let round = 0; round < 4; round += 1) {
    for (let index = 1; index < count; index += 1) sweep(index, true);
    for (let index = count - 2; index >= 0; index -= 1) sweep(index, false);
  }
  return { rows: layers, neighbours };
}
function assignSlots(rows, neighbours, layer) {
  const width = Math.max(...rows.map((row) => row.length));
  const pos = /* @__PURE__ */ new Map();
  for (const row of rows) row.forEach((id, index) => pos.set(id, (width - 1) / 2 - (row.length - 1) / 2 + index));
  const mean = (ids) => ids.reduce((sum, id) => sum + pos.get(id), 0) / ids.length;
  const desire = (id, below) => {
    const all = neighbours.get(id);
    if (id.startsWith(DUMMY)) return mean(all);
    const reserved = all.filter((other) => other.startsWith(DUMMY));
    if (reserved.length > 0) return mean(reserved);
    const level = layer.get(id);
    const preferred = all.filter((other) => below ? layer.get(other) < level : layer.get(other) > level);
    if (preferred.length > 0) return mean(preferred);
    return all.length > 0 ? mean(all) : pos.get(id);
  };
  const place = (row, below) => {
    const blocks = [];
    row.forEach((id, index) => {
      blocks.push({ sum: desire(id, below) - index, count: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].count > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].count) {
        const last = blocks.pop();
        blocks[blocks.length - 1].sum += last.sum;
        blocks[blocks.length - 1].count += last.count;
      }
    });
    const placed = [];
    for (const block of blocks) for (let k = 0; k < block.count; k += 1) placed.push(block.sum / block.count + placed.length);
    for (let i = 0; i < placed.length; i += 1) placed[i] = Math.max(placed[i], i === 0 ? 0 : placed[i - 1] + 1);
    for (let i = placed.length - 1; i >= 0; i -= 1) placed[i] = Math.min(placed[i], i === placed.length - 1 ? width - 1 : placed[i + 1] - 1);
    row.forEach((id, index) => pos.set(id, placed[index]));
  };
  for (let round = 0; round < 4; round += 1) {
    for (let index = 0; index < rows.length; index += 1) place(rows[index], true);
    for (let index = rows.length - 1; index >= 0; index -= 1) place(rows[index], false);
  }
  return pos;
}
function levelPositions(rows, graph, layer, vertical, reversed) {
  const view = vertical ? DIAGRAM_VIEW.height : DIAGRAM_VIEW.width;
  if (rows.length === 1) return [view / 2];
  const reach = rows.map((row) => Math.max(0, ...row.filter((id) => !id.startsWith(DUMMY)).map((id) => {
    const half = HALF[graph.nodes.get(id).shape ?? "box"];
    return vertical ? half.h : half.w;
  })));
  const need = reach.slice(1).map((next, index) => reach[index] + next + LINK_ROOM);
  for (const edge of graph.edges) {
    const a = layer.get(edge.from), b = layer.get(edge.to);
    if (edge.label === void 0 || edge.label.length === 0 || Math.abs(a - b) !== 1) continue;
    const gap = Math.min(a, b);
    const room = vertical ? LABEL_ROOM_ACROSS : displayWidth(truncateLabel(edge.label, DIAGRAM_EDGE_LABEL_UNITS)) * LABEL_UNIT_WIDTH + LABEL_ROOM_ALONG;
    need[gap] = Math.max(need[gap], reach[gap] + reach[gap + 1] + room);
  }
  const available = view - 2 * INSET - reach[0] - reach[reach.length - 1];
  const cap = vertical ? 140 : 360;
  const total = (level) => need.reduce((sum, value) => sum + Math.max(value, level), 0);
  let gaps;
  if (total(0) >= available) {
    gaps = need.map(() => available / need.length);
  } else {
    let low = 0, high = cap;
    if (total(cap) > available) {
      for (let step = 0; step < 50; step += 1) {
        const mid = (low + high) / 2;
        if (total(mid) > available) high = mid;
        else low = mid;
      }
    } else low = cap;
    gaps = need.map((value) => Math.max(value, low));
  }
  const span = reach[0] + gaps.reduce((sum, value) => sum + value, 0) + reach[reach.length - 1];
  const positions = [(view - span) / 2 + reach[0]];
  for (const gap of gaps) positions.push(positions[positions.length - 1] + gap);
  return reversed ? positions.map((value) => view - value) : positions;
}
function spread(count, range, maxSpacing) {
  if (count === 1) return [(range[0] + range[1]) / 2];
  const spacing = Math.min(maxSpacing, (range[1] - range[0]) / (count - 1));
  const start = (range[0] + range[1]) / 2 - spacing * (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => start + spacing * index);
}
function outlineOf(node, pad) {
  const { x, y } = node.center;
  if (node.shape === "circle") return { kind: "circle", center: node.center, radius: node.radius + pad };
  if (node.shape === "diamond") {
    const edge = Math.hypot(node.halfWidth, node.halfHeight);
    const w2 = node.halfWidth + pad * edge / node.halfHeight, h2 = node.halfHeight + pad * edge / node.halfWidth;
    return { kind: "polygon", points: [{ x: x + w2, y }, { x, y: y + h2 }, { x: x - w2, y }, { x, y: y - h2 }] };
  }
  const w = node.halfWidth + pad, h = node.halfHeight + pad;
  return { kind: "polygon", points: [{ x: x - w, y: y - h }, { x: x + w, y: y - h }, { x: x + w, y: y + h }, { x: x - w, y: y + h }] };
}
function boxPoints(box) {
  return [{ x: box.l, y: box.t }, { x: box.r, y: box.t }, { x: box.r, y: box.b }, { x: box.l, y: box.b }];
}
function convexMeet(a, b) {
  for (const set of [a, b]) {
    for (let i = 0; i < set.length; i += 1) {
      const p = set[i], q = set[(i + 1) % set.length];
      const axis2 = { x: q.y - p.y, y: p.x - q.x };
      if (axis2.x === 0 && axis2.y === 0) continue;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) {
        const d = v.x * axis2.x + v.y * axis2.y;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = v.x * axis2.x + v.y * axis2.y;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function segmentMeetsOutline(a, b, outline) {
  if (outline.kind === "circle") return distanceToSegment(outline.center, a, b) < outline.radius;
  return convexMeet([a, b], outline.points);
}
function boxMeetsOutline(box, outline) {
  if (outline.kind === "circle") {
    const nearX = Math.max(box.l, Math.min(outline.center.x, box.r)), nearY = Math.max(box.t, Math.min(outline.center.y, box.b));
    return Math.hypot(outline.center.x - nearX, outline.center.y - nearY) < outline.radius;
  }
  return convexMeet(boxPoints(box), outline.points);
}
function boxesMeet(a, b) {
  return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}
function legibility(geometry) {
  const all = geometry.nodes;
  const bounds2 = (node, pad) => ({ l: node.center.x - node.halfWidth - pad, r: node.center.x + node.halfWidth + pad, t: node.center.y - node.halfHeight - pad, b: node.center.y + node.halfHeight + pad });
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      if (boxesMeet(bounds2(all[i], MIN_GAP / 2), bounds2(all[j], MIN_GAP / 2))) {
        return { code: "LAYOUT_OVERCROWDED", message: "too many nodes share one level to draw without overlap; split the flowchart or use fewer siblings" };
      }
    }
  }
  if (geometry.droppedEdges > 0) return { code: "LAYOUT_OVERCROWDED", message: "linked nodes are too close to draw the link" };
  const labels = geometry.edges.filter((edge) => edge.labelText.length > 0).map((edge) => {
    const width = displayWidth(truncateLabel(edge.labelText, DIAGRAM_EDGE_LABEL_UNITS)) * LABEL_UNIT_WIDTH;
    return { edge, box: { l: edge.label.x - width / 2, r: edge.label.x + width / 2, t: edge.label.y - 10, b: edge.label.y + 3 } };
  });
  for (const edge of geometry.edges) {
    const name4 = `${edge.edge.from} -> ${edge.edge.to}`;
    if (Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y) < MIN_VISIBLE_LINK) {
      return { code: "LAYOUT_OVERCROWDED", message: `levels are too close to show the arrow of ${name4}; use fewer levels or smaller shapes` };
    }
    for (const other of all) {
      if (other === edge.from || other === edge.to) continue;
      if (segmentMeetsOutline(edge.start, edge.end, outlineOf(other, CLEARANCE))) {
        return { code: "LAYOUT_OCCLUDED", message: `the link ${name4} would be drawn through node ${other.node.id}; restructure the flowchart` };
      }
    }
    for (const label of labels) {
      if (label.edge === edge) continue;
      if (convexMeet([edge.start, edge.end], boxPoints(label.box))) {
        return { code: "LAYOUT_OCCLUDED", message: `the link ${name4} would run through the label of ${label.edge.edge.from} -> ${label.edge.edge.to}; restructure or drop a label` };
      }
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    const { edge, box } = labels[i];
    const name4 = `${edge.edge.from} -> ${edge.edge.to}`;
    for (const other of all) {
      if (boxMeetsOutline(box, outlineOf(other, LABEL_CLEARANCE))) {
        return { code: "LAYOUT_OCCLUDED", message: `the label of ${name4} would be hidden by node ${other.node.id}; shorten it, use fewer levels, or try another direction` };
      }
    }
    for (let j = i + 1; j < labels.length; j += 1) {
      if (boxesMeet(box, labels[j].box)) {
        return { code: "LAYOUT_OCCLUDED", message: `the labels of ${name4} and ${labels[j].edge.edge.from} -> ${labels[j].edge.edge.to} would overlap; restructure or drop a label` };
      }
    }
  }
  return void 0;
}
function compileMermaidFlowchart(input) {
  const fail2 = (code, line, message) => ({ ok: false, issues: [{ code, line, message }] });
  const source = input?.source;
  if (typeof source !== "string") return fail2("INVALID_SOURCE", 0, "source must be a string of Mermaid flowchart text");
  if (new TextEncoder().encode(source).length > MERMAID_LIMITS.maxSourceBytes) {
    return fail2("SOURCE_TOO_LARGE", 0, `source is limited to ${String(MERMAID_LIMITS.maxSourceBytes)} UTF-8 bytes`);
  }
  const lines = source.split(/\r?\n/);
  while (lines.length > 1 && /^[ \t]*$/.test(lines[lines.length - 1])) lines.pop();
  if (lines.length > MERMAID_LIMITS.maxLines) return fail2("TOO_MANY_LINES", 0, `source is limited to ${String(MERMAID_LIMITS.maxLines)} lines`);
  const issues = [];
  const graph = { nodes: /* @__PURE__ */ new Map(), order: [], edges: [] };
  let direction;
  let headerLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const raw = lines[index];
    if (raw.length > MERMAID_LIMITS.maxLineLength) {
      issues.push({ code: "LINE_TOO_LONG", line: lineNo, message: `lines are limited to ${String(MERMAID_LIMITS.maxLineLength)} characters` });
      continue;
    }
    if (FORBIDDEN_CHAR.test(raw)) {
      issues.push({ code: "CONTROL_CHARACTER", line: lineNo, message: "control, invisible and bidirectional characters are not allowed" });
      continue;
    }
    const text5 = raw.trim();
    if (text5.length === 0) continue;
    if (text5.startsWith("%%")) {
      if (text5.startsWith("%%{")) issues.push({ code: "UNSUPPORTED_STATEMENT", line: lineNo, message: "Mermaid directives (%%{...}%%) are not supported" });
      continue;
    }
    let body = text5;
    if (direction === void 0) {
      if (issues.some((issue3) => issue3.code === "LINE_TOO_LONG" || issue3.code === "CONTROL_CHARACTER")) return { ok: false, issues };
      const header = parseHeader(text5);
      if ("code" in header) {
        if (header.code !== "UNSUPPORTED_STATEMENT") return { ok: false, issues: [...issues, { code: header.code, line: lineNo, message: header.message }] };
        issues.push({ code: header.code, line: lineNo, message: header.message });
        direction = "TD";
        headerLine = lineNo;
        continue;
      }
      direction = header.direction;
      headerLine = lineNo;
      body = header.rest;
    }
    const cursor = new Cursor(body);
    try {
      while (true) {
        cursor.skipSpace();
        while (cursor.peek() === ";") {
          cursor.index += 1;
          cursor.skipSpace();
        }
        if (cursor.done || cursor.startsWith("%%")) break;
        parseStatement(cursor, graph);
      }
    } catch (error) {
      if (!(error instanceof LineError)) throw error;
      issues.push({ code: error.code, line: lineNo, message: error.message });
    }
  }
  if (direction === void 0) {
    if (issues.some((issue3) => issue3.code === "LINE_TOO_LONG" || issue3.code === "CONTROL_CHARACTER")) return { ok: false, issues };
    return { ok: false, issues: [...issues, { code: "MISSING_HEADER", line: 1, message: 'the first statement must be "flowchart <TD|TB|BT|LR|RL>"' }] };
  }
  if (issues.length > 0) return { ok: false, issues };
  if (graph.order.length === 0) return fail2("EMPTY_DIAGRAM", headerLine, "the flowchart declares no nodes");
  if (graph.order.length > RICH_LIMITS.maxDiagramNodes) return fail2("TOO_MANY_NODES", 0, `at most ${String(RICH_LIMITS.maxDiagramNodes)} nodes are allowed`);
  if (graph.edges.length > RICH_LIMITS.maxDiagramEdges) return fail2("TOO_MANY_EDGES", 0, `at most ${String(RICH_LIMITS.maxDiagramEdges)} links are allowed`);
  const layer = assignLayers(graph.order, graph.edges);
  const layerCount = Math.max(...graph.order.map((id) => layer.get(id))) + 1;
  if (layerCount > MERMAID_LIMITS.maxLayers) {
    return fail2("LAYOUT_TOO_DEEP", 0, `the longest path spans ${String(layerCount)} levels; at most ${String(MERMAID_LIMITS.maxLayers)} fit the diagram`);
  }
  const { rows, neighbours } = orderLayers(graph.order, graph.edges, layer, layerCount);
  const slots = assignSlots(rows, neighbours, layer);
  const width = Math.max(...rows.map((row) => row.length));
  const vertical = direction === "TD" || direction === "BT";
  const mainPositions = levelPositions(rows, graph, layer, vertical, direction === "BT" || direction === "RL");
  const crossSlots = spread(width, vertical ? X_RANGE : Y_RANGE, vertical ? 200 : 120);
  const crossStep = width > 1 ? crossSlots[1] - crossSlots[0] : 0;
  const grid = /* @__PURE__ */ new Map();
  rows.forEach((row, index) => {
    row.forEach((id) => {
      if (id.startsWith(DUMMY)) return;
      const main = mainPositions[index], cross = crossSlots[0] + slots.get(id) * crossStep;
      grid.set(id, {
        x: Math.round(vertical ? cross : main),
        y: Math.round((vertical ? main : cross) / DIAGRAM_VIEW.height * 1e3)
      });
    });
  });
  const nodes = graph.order.map((id) => {
    const parsed = graph.nodes.get(id);
    return { id, label: parsed.label ?? id, ...grid.get(id), shape: parsed.shape ?? "box" };
  });
  const problem = legibility(buildDiagramGeometry(nodes, graph.edges));
  if (problem !== void 0) return fail2(problem.code, 0, problem.message);
  const candidate = {
    schemaVersion: RICH_CONTENT_SCHEMA_VERSION,
    type: "basic_diagram",
    title: input.title,
    ...input.subtitle === void 0 ? {} : { subtitle: input.subtitle },
    data: { nodes, edges: graph.edges }
  };
  const validated = validateRichContent(candidate);
  if (!validated.ok) return fail2("INVALID_CONTENT", 0, formatValidationIssues(validated.issues));
  if (validated.value.type !== "basic_diagram") return fail2("INVALID_CONTENT", 0, "compiled content is not a basic_diagram");
  return { ok: true, content: validated.value, direction, layers: layerCount };
}

// rich/src/host/tools/rich-mermaid.ts
var ARG_KEYS = ["title", "subtitle", "source"];
var OUTPUT_SCHEMA2 = {
  type: "object",
  properties: {
    content: { type: "object" },
    summary: { type: "string" },
    direction: { type: "string", enum: ["TD", "BT", "LR", "RL"] },
    layers: { type: "integer" },
    ...FIGURE_OUTPUT_PROPERTIES
  },
  required: ["content", "summary", "direction", "layers"],
  additionalProperties: false
};
function valueOf2(value) {
  const record2 = value;
  return {
    content: record2?.content,
    summary: typeof record2?.summary === "string" ? record2.summary : "",
    direction: record2?.direction ?? "TD",
    layers: typeof record2?.layers === "number" ? record2.layers : 0
  };
}
function createMermaidTool(options = {}) {
  return {
    name: "rich_mermaid",
    description: `Draw a small flowchart from a bounded subset of Mermaid flowchart syntax (Mermaid itself is not run). First line: "flowchart TD" (or TB, BT, LR, RL). Nodes: id, id[box], id(rounded), id([stadium]), id{decision}, id((circle)); quote labels that contain brackets, e.g. A["F = m[a]"]. Links: A --> B, A -.-> B (dashed), A -->|label| B, A -- label --> B; chains allowed. Ids use letters, digits and _; ([stadium]) is drawn as a rounded box. Labels are plain text (no <br>, HTML, entities or markdown); write averages as \u27E8p\u27E9, not <p>. Not supported: subgraph, click, style/classDef/linkStyle, other diagram types, &, ---, ==>, two links between the same pair of nodes. At most ${String(MERMAID_LIMITS.maxLayers)} levels along the main direction and about 5 nodes side by side; unsupported syntax, overcrowded levels, or links that would cross other nodes or hide their labels fail with issues to fix.` + (options.figures === void 0 ? "" : FIGURE_TOOL_NOTE),
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Card title shown above the diagram." },
        subtitle: { type: "string", description: "Optional short caption." },
        source: { type: "string", description: "Mermaid flowchart text in the supported subset." }
      },
      required: ["title", "source"],
      additionalProperties: false
    },
    output: {
      schema: OUTPUT_SCHEMA2,
      render: (_args, rawValue) => [{ type: "text", text: valueOf2(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue) => ({
        kind: RICH_META_KIND,
        envelopeVersion: RICH_META_ENVELOPE_VERSION,
        content: valueOf2(rawValue).content
      })
    },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("rich_mermaid: aborted before dispatch");
      if (args2 === null || typeof args2 !== "object" || Array.isArray(args2)) throw new Error("rich_mermaid: arguments must be an object");
      const record2 = args2;
      const extra = Object.keys(record2).filter((key) => !ARG_KEYS.includes(key));
      if (extra.length > 0) throw new Error(`rich_mermaid: unexpected field(s): ${extra.slice(0, 5).join(", ")}`);
      if (typeof record2["title"] !== "string" || record2["title"].trim().length === 0) throw new Error("rich_mermaid: title must be a non-empty string");
      if (record2["subtitle"] !== void 0 && typeof record2["subtitle"] !== "string") throw new Error("rich_mermaid: subtitle must be a string");
      const result = compileMermaidFlowchart({
        title: record2["title"],
        source: record2["source"],
        ...record2["subtitle"] === void 0 ? {} : { subtitle: record2["subtitle"] }
      });
      if (!result.ok) {
        const detail = result.issues.slice(0, 8).map((issue3) => `${issue3.code}${issue3.line > 0 ? ` (line ${String(issue3.line)})` : ""}: ${issue3.message}`).join("; ");
        throw new Error(`rich_mermaid: unsupported Mermaid source: ${detail}`);
      }
      const summary = `Mermaid flowchart (${result.direction}, ${String(result.layers)} levels) rendered as ${summarizeRichContent(result.content)}`;
      return {
        content: result.content,
        summary,
        direction: result.direction,
        layers: result.layers,
        ...writeFigure(options.figures, exec, diagramFigureSvg(result.content), "svg", result.content.title)
      };
    }
  };
}

// rich/src/host/tools/rich-heatmap.ts
var OUTPUT_SCHEMA3 = {
  type: "object",
  properties: {
    content: { type: "object" },
    summary: { type: "string" },
    ...FIGURE_OUTPUT_PROPERTIES
  },
  required: ["content", "summary"],
  additionalProperties: false
};
function valueOf3(value) {
  const record2 = value;
  return {
    content: record2?.content,
    summary: typeof record2?.summary === "string" ? record2.summary : ""
  };
}
function createHeatmapTool(options = {}) {
  return {
    name: "rich_heatmap",
    description: `Show a numeric matrix as a colored grid card: a 2D field, probability density, lattice configuration, correlation or confusion matrix. Use only numbers you actually computed or were given; never invent data. values is row-major (values[row][column]), rectangular, at most ${String(HEATMAP_LIMITS.maxRows)} rows, ${String(HEATMAP_LIMITS.maxColumns)} columns and ${String(HEATMAP_LIMITS.maxCells)} cells, finite numbers with |v| <= 1e7. origin "lower" (default) draws values[0] as the bottom row like a y-up plot; "upper" draws it on top like a matrix. yAxis min/max always run bottom to top, so with origin "upper" values[0] lies at yAxis.max. Axis min/max give the coordinates of the grid edges. colorScale.palette is "sequential" (default) or "diverging" (centered on the scale midpoint; without an explicit range it is symmetric around 0). An explicit colorScale range must contain every value. The learner sees the picture; you receive only a summary line.` + (options.figures === void 0 ? "" : FIGURE_TOOL_NOTE),
    parameters: {
      type: "object",
      properties: {
        content: HEATMAP_CONTENT_SCHEMA
      },
      required: ["content"],
      additionalProperties: false
    },
    output: {
      schema: OUTPUT_SCHEMA3,
      render: (_args, rawValue) => [{ type: "text", text: valueOf3(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue) => ({
        kind: HEATMAP_META_KIND,
        envelopeVersion: HEATMAP_ENVELOPE_VERSION,
        content: valueOf3(rawValue).content
      })
    },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("rich_heatmap: aborted before dispatch");
      if (args2 === null || typeof args2 !== "object" || Array.isArray(args2)) throw new Error("rich_heatmap: arguments must be an object");
      const extra = Object.keys(args2).filter((key) => key !== "content");
      if (extra.length > 0) throw new Error(`rich_heatmap: unexpected argument ${extra.slice(0, 3).join(", ")}`);
      const result = validateHeatmap(args2.content);
      if (!result.ok) throw new Error(`rich_heatmap: invalid HeatmapV1 payload: ${formatHeatmapIssues(result.issues)}`);
      return {
        content: result.value,
        summary: summarizeHeatmap(result.value),
        ...writeFigure(options.figures, exec, heatmapFigureSvg(result.value), "svg", result.value.title)
      };
    }
  };
}

// rich/src/host/tools/rich-image.ts
import { createHash as createHash3 } from "node:crypto";
import { basename, extname, isAbsolute as isAbsolute3, relative as relative2, resolve as resolve3, sep as sep2 } from "node:path";

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
var IMAGE_SOURCES = ["computed", "user_provided"];
function fail(reason) {
  return { ok: false, reason };
}
function matches(data, offset, expected) {
  if (data.length < offset + expected.length) return false;
  return expected.every((byte, index) => data[offset + index] === byte);
}
function matchesAscii(data, offset, text5) {
  return matches(data, offset, [...text5].map((char) => char.charCodeAt(0)));
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
function imageMediaTypeForExtension(extension) {
  switch (extension.toLowerCase()) {
    case "":
      return void 0;
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
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

// rich/src/host/tools/rich-image.ts
var ARG_KEYS2 = ["path", "alt", "caption", "source", "sourceNote"];
var OUTPUT_SCHEMA4 = {
  type: "object",
  properties: {
    image: { type: "object" },
    alt: { type: "string" },
    caption: { type: "string" },
    source: { type: "string", enum: [...IMAGE_SOURCES] },
    sourceNote: { type: "string" },
    path: { type: "string" },
    summary: { type: "string" },
    ...FIGURE_OUTPUT_PROPERTIES
  },
  required: ["image", "alt", "source", "path", "summary"],
  additionalProperties: false
};
function valueOf4(value) {
  return value;
}
function resolveByteLimit(value) {
  if (value === void 0) return IMAGE_LIMITS.defaultMaxImageBytes;
  if (!Number.isInteger(value) || value < IMAGE_LIMITS.minImageBytesLimit || value > IMAGE_LIMITS.maxImageBytesCeiling) {
    throw new Error(`rich_image: maxImageBytes must be an integer from ${String(IMAGE_LIMITS.minImageBytesLimit)} to ${String(IMAGE_LIMITS.maxImageBytesCeiling)}`);
  }
  return value;
}
function optionalText(record2, key, maxLength) {
  if (record2[key] === void 0) return void 0;
  const text5 = imageText(record2[key], maxLength);
  if (text5 === void 0) throw new Error(`rich_image: ${key} must be 1..${String(maxLength)} characters of plain text`);
  return text5;
}
function readArgs(args2) {
  if (args2 === null || typeof args2 !== "object" || Array.isArray(args2)) throw new Error("rich_image: arguments must be an object");
  const record2 = args2;
  const extra = Object.keys(record2).filter((key) => !ARG_KEYS2.includes(key));
  if (extra.length > 0) throw new Error(`rich_image: unexpected argument ${extra.slice(0, 3).join(", ")}`);
  const path = imageText(record2["path"], IMAGE_LIMITS.maxPathLength);
  if (path === void 0) throw new Error(`rich_image: path must be a non-empty path of at most ${String(IMAGE_LIMITS.maxPathLength)} characters`);
  const alt = imageText(record2["alt"], IMAGE_LIMITS.maxAltLength);
  if (alt === void 0) throw new Error(`rich_image: alt must describe the image in 1..${String(IMAGE_LIMITS.maxAltLength)} characters of plain text`);
  const source = record2["source"];
  if (typeof source !== "string" || !IMAGE_SOURCES.includes(source)) {
    throw new Error("rich_image: source must be computed or user_provided");
  }
  const caption = optionalText(record2, "caption", IMAGE_LIMITS.maxCaptionLength);
  const sourceNote = optionalText(record2, "sourceNote", IMAGE_LIMITS.maxSourceNoteLength);
  return {
    path,
    alt,
    ...caption === void 0 ? {} : { caption },
    source,
    ...sourceNote === void 0 ? {} : { sourceNote }
  };
}
function fileName(displayPath) {
  const name4 = stripUnsafeText(basename(displayPath.replace(/\\/g, "/"))).trim();
  return name4.length === 0 ? "image" : name4.slice(0, IMAGE_LIMITS.maxNameLength);
}
var FIGURE_EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
var NON_LOCAL_PATH = /^(?:[\\/]{2}|[A-Za-z]:(?![\\/]))/;
function lexicalWorkspacePath(cwd, path, shown) {
  if (NON_LOCAL_PATH.test(path)) {
    throw new Error(`rich_image: ${shown}: use a path inside the session working directory; network, device or drive-relative paths are refused`);
  }
  const absolute = resolve3(cwd, path);
  const rel = relative2(cwd, absolute);
  if (rel === ".." || rel.startsWith(`..${sep2}`) || isAbsolute3(rel)) throw new Error(`rich_image: ${shown}: the file is outside the session working directory`);
  return absolute;
}
function createImageTool(options) {
  const maxBytes = resolveByteLimit(options.maxImageBytes);
  return {
    name: "rich_image",
    description: `Show the learner one existing PNG, JPEG, GIF or WebP file from the session working directory, for example a figure your own code saved or an image the learner supplied. The file must be inside the working directory, not a symbolic link, at most ${String(maxBytes)} bytes and ${String(IMAGE_LIMITS.maxDimension)} px per side. SVG and other formats are refused; use rich_render, rich_heatmap or rich_mermaid for data you can express directly. source is "computed" (made by code run for this task) or "user_provided"; never claim an origin you do not know, and never show a file you did not find or create. alt must describe what the image shows. Only the learner sees the image; you receive a summary line without the picture, and the bytes are stored in the session log. Call it directly, not from run_code.` + (options.figures === void 0 ? "" : FIGURE_TOOL_NOTE),
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Image file path, relative to the session working directory." },
        alt: { type: "string", description: "Plain-text description of the image for screen readers." },
        caption: { type: "string", description: "Optional plain-text caption shown under the image." },
        source: { type: "string", enum: [...IMAGE_SOURCES], description: "Where the image came from." },
        sourceNote: { type: "string", description: "Optional plain-text detail of the origin, e.g. the script or handout." }
      },
      required: ["path", "alt", "source"],
      additionalProperties: false
    },
    output: {
      schema: OUTPUT_SCHEMA4,
      render: (_args, rawValue) => [{ type: "text", text: valueOf4(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue) => {
        const value = valueOf4(rawValue);
        return {
          kind: IMAGE_META_KIND,
          envelopeVersion: IMAGE_ENVELOPE_VERSION,
          image: value.image,
          alt: value.alt,
          ...value.caption === void 0 ? {} : { caption: value.caption },
          source: value.source,
          ...value.sourceNote === void 0 ? {} : { sourceNote: value.sourceNote }
        };
      }
    },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("rich_image: aborted before dispatch");
      if (exec.parent !== void 0) throw new Error("rich_image: call rich_image directly, not from run_code, so the image bytes stay out of the model context");
      const request = readArgs(args2);
      const { fs, workingDirectory } = options.services();
      if (fs === void 0 || workingDirectory === void 0 || exec.agent === void 0) {
        throw new Error("rich_image: the session filesystem is not available");
      }
      const cwd = await workingDirectory.ensure(exec.agent, exec.signal);
      const shown = `cannot show "${request.path}"`;
      const absolute = lexicalWorkspacePath(cwd, request.path, shown);
      const entry = await fs.lstat(absolute, { cwd }, exec.signal);
      if (entry === void 0) throw new Error(`rich_image: ${shown}: not found`);
      if (entry.type === "symlink") throw new Error(`rich_image: ${shown}: the path is a symbolic link`);
      if (entry.type !== "file") throw new Error(`rich_image: ${shown}: not a regular file`);
      const target = await fs.resolve(absolute, { cwd, signal: exec.signal });
      const root = await fs.resolve(cwd, { signal: exec.signal });
      if (!fs.contains(root, target)) throw new Error(`rich_image: ${shown}: the file is outside the session working directory`);
      const declared = imageMediaTypeForExtension(extname(target.displayPath));
      if (declared === null) {
        throw new Error(`rich_image: ${shown}: rich_image shows PNG, JPEG, GIF or WebP files, not ${extname(target.displayPath)} files`);
      }
      const info = await fs.stat(target, exec.signal);
      if (info === void 0 || info.type !== "file") throw new Error(`rich_image: ${shown}: not a regular file`);
      const tooLarge = `rich_image: ${shown}: the file exceeds the ${String(maxBytes)}-byte limit`;
      if (info.size !== void 0 && info.size > maxBytes) throw new Error(tooLarge);
      let data;
      try {
        data = await fs.readBytes(target, exec.signal, maxBytes);
      } catch (error) {
        if (error?.code === "FS_TOO_LARGE") throw new Error(tooLarge, { cause: error });
        throw error;
      }
      const inspection = inspectImage(data);
      if (!inspection.ok) throw new Error(`rich_image: ${shown}: ${inspection.reason}; rich_image shows PNG, JPEG, GIF or WebP files`);
      if (declared !== void 0 && declared !== inspection.mediaType) {
        throw new Error(`rich_image: ${shown}: the ${extname(target.displayPath)} extension declares ${declared}, but the file content is ${inspection.mediaType}`);
      }
      if (!imageSizeAllowed(inspection.width, inspection.height)) {
        throw new Error(`rich_image: ${shown}: the image is ${String(inspection.width)}x${String(inspection.height)} px; each side must be at most ${String(IMAGE_LIMITS.maxDimension)} px and the total at most ${String(IMAGE_LIMITS.maxPixels)} pixels`);
      }
      const sha256 = createHash3("sha256").update(data).digest("hex");
      const name4 = fileName(target.displayPath);
      const image = {
        mediaType: inspection.mediaType,
        bytes: data.length,
        width: inspection.width,
        height: inspection.height,
        sha256,
        name: name4,
        data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64")
      };
      const summary = `Displayed image "${name4}" to the learner (${image.mediaType}, ${String(image.width)}x${String(image.height)} px, ${String(image.bytes)} bytes, sha256 ${sha256.slice(0, 12)}). You cannot see this image; describe it only from how it was produced or what the learner told you.`;
      return {
        image,
        alt: request.alt,
        ...request.caption === void 0 ? {} : { caption: request.caption },
        source: request.source,
        ...request.sourceNote === void 0 ? {} : { sourceNote: request.sourceNote },
        path: target.displayPath,
        summary,
        ...writeFigure(options.figures, exec, data, FIGURE_EXTENSIONS[inspection.mediaType], request.alt)
      };
    }
  };
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
function xmlText(text5) {
  return XML_CHARS.test(text5);
}
var COLOR = /^(?:none|currentColor|transparent|#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla)\(\s*[-+\d.%\s,/]*\)|[a-zA-Z]{3,24})$/;
var ID = /^[A-Za-z][\w-]{0,63}$/;
var MARKER_REF = /^url\(#([A-Za-z][\w-]{0,63})\)$/;
var finite2 = (value) => Number.isFinite(Number.parseFloat(value)) && Math.abs(Number.parseFloat(value)) <= SVG_LIMITS.maxAbsNumber;
var number2 = (v) => v.length <= MAX_SCALAR && NUMBER.test(v.trim()) && finite2(v);
var length = (v) => v.length <= MAX_SCALAR && LENGTH.test(v.trim()) && finite2(v);
var unit = (v) => number2(v) && Number.parseFloat(v) >= 0 && Number.parseFloat(v) <= 1;
var oneOf = (...values) => (v) => values.includes(v.trim());
var list = (v) => v.length <= 2e4 && NUMBER_LIST.test(v) && v.split(/[ \t\n\r,]+/).filter(Boolean).every((part) => part.length <= MAX_SCALAR && finite2(part));
var dash = (v) => v.trim() === "none" || list(v);
var markerRef = (ids) => (v) => v.trim() === "none" || ids.has(MARKER_REF.exec(v.trim())?.[1] ?? "");
var PAINT = {
  fill: (v) => COLOR.test(v.trim()),
  stroke: (v) => COLOR.test(v.trim()),
  "stroke-width": length,
  "stroke-opacity": unit,
  "fill-opacity": unit,
  opacity: unit,
  "stroke-dasharray": dash,
  "stroke-dashoffset": number2,
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel"),
  "stroke-miterlimit": number2,
  "fill-rule": oneOf("nonzero", "evenodd"),
  transform: (v) => v.length <= 500 && TRANSFORM.test(v)
};
var FONT = {
  "font-size": (v) => number2(v) && Number.parseFloat(v) > 0 && Number.parseFloat(v) <= 200,
  "font-weight": oneOf("normal", "bold", "bolder", "lighter", "100", "200", "300", "400", "500", "600", "700", "800", "900"),
  "font-style": oneOf("normal", "italic"),
  "text-anchor": oneOf("start", "middle", "end"),
  "dominant-baseline": oneOf("auto", "middle", "central", "hanging", "alphabetic", "mathematical", "text-before-edge", "text-after-edge")
};
var MARKERS = ["marker-start", "marker-mid", "marker-end"];
var ELEMENTS = {
  g: { ...FONT },
  defs: {},
  marker: { id: (v) => ID.test(v), viewBox: list, markerWidth: number2, markerHeight: number2, refX: number2, refY: number2, orient: (v) => v === "auto" || v === "auto-start-reverse" || number2(v), markerUnits: oneOf("strokeWidth", "userSpaceOnUse") },
  line: { x1: length, y1: length, x2: length, y2: length },
  rect: { x: length, y: length, width: length, height: length, rx: length, ry: length },
  circle: { cx: length, cy: length, r: length },
  ellipse: { cx: length, cy: length, rx: length, ry: length },
  polyline: { points: list },
  polygon: { points: list },
  path: { d: (v) => v.length <= 2e4 && PATH_DATA.test(v) },
  text: { x: list, y: list, dx: list, dy: list, ...FONT },
  tspan: { x: list, y: list, dx: list, dy: list, "baseline-shift": (v) => oneOf("sub", "super")(v) || length(v), ...FONT },
  title: {},
  desc: {}
};
var MARKABLE = /* @__PURE__ */ new Set(["line", "polyline", "polygon", "path"]);
var TEXT_PARENTS = /* @__PURE__ */ new Set(["text", "tspan", "title", "desc"]);
var ROOT_IGNORED = /* @__PURE__ */ new Set(["xmlns", "width", "height", "version", "font-family", "preserveAspectRatio", "role", "aria-label"]);
function decode(text5, issues) {
  return text5.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z]+);?/g, (all, entity) => {
    if (entity.startsWith("#")) {
      const code = entity[1] === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (code <= 1114111 && XML_CHARS.test(String.fromCodePoint(code))) return String.fromCodePoint(code);
    }
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (named[entity] !== void 0 && all.endsWith(";")) return named[entity];
    issues.push(`entity "${all.slice(0, 12)}" is not allowed`);
    return "";
  });
}
function parse(source, issues) {
  let index = 0;
  const stack = [];
  let root;
  const skip = (pattern) => {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (match === null) return false;
    index = pattern.lastIndex;
    return true;
  };
  while (index < source.length && issues.length === 0) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) {
        issues.push("unclosed comment");
        break;
      }
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index);
      if (end < 0) {
        issues.push("unclosed processing instruction");
        break;
      }
      index = end + 2;
      continue;
    }
    if (source.startsWith("<!", index)) {
      issues.push(`${source.startsWith("<!DOCTYPE", index) ? "DOCTYPE" : "markup declaration or CDATA"} is not allowed`);
      break;
    }
    if (source.startsWith("</", index)) {
      const match = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(source.slice(index, index + 80));
      const open = stack.pop();
      if (match === null || open === void 0 || open.name !== match[1]) {
        issues.push(`mismatched closing tag near offset ${String(index)}`);
        break;
      }
      index += match[0].length;
      continue;
    }
    if (source[index] === "<") {
      const head = /^<([A-Za-z][\w:.-]*)/.exec(source.slice(index, index + 80));
      if (head === null) {
        issues.push(`invalid tag near offset ${String(index)}`);
        break;
      }
      index += head[0].length;
      const element = { name: head[1] ?? "", attrs: /* @__PURE__ */ new Map(), children: [] };
      const attribute = /\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
      while (skip(/\s*/y), !source.startsWith(">", index) && !source.startsWith("/>", index)) {
        attribute.lastIndex = index - (/\s/.test(source[index - 1] ?? "") ? 1 : 0);
        const match = attribute.exec(source);
        if (match === null) {
          issues.push(`invalid attribute in <${element.name}>`);
          return void 0;
        }
        index = attribute.lastIndex;
        if (element.attrs.has(match[1] ?? "")) {
          issues.push(`duplicate attribute "${match[1] ?? ""}"`);
          return void 0;
        }
        element.attrs.set(match[1] ?? "", decode(match[2] ?? match[3] ?? "", issues));
      }
      const selfClosing = source.startsWith("/>", index);
      index += selfClosing ? 2 : 1;
      const parent2 = stack.at(-1);
      if (parent2 === void 0) {
        if (root !== void 0) {
          issues.push("more than one root element");
          break;
        }
        root = element;
      } else parent2.children.push(element);
      if (!selfClosing) stack.push(element);
      continue;
    }
    const next = source.indexOf("<", index);
    const raw = source.slice(index, next < 0 ? source.length : next);
    index = next < 0 ? source.length : next;
    const parent = stack.at(-1);
    if (raw.trim().length === 0) {
      if (parent !== void 0 && TEXT_PARENTS.has(parent.name)) parent.children.push({ text: raw });
      continue;
    }
    if (parent === void 0) {
      issues.push("text outside the root element");
      break;
    }
    parent.children.push({ text: decode(raw, issues) });
  }
  if (issues.length === 0 && stack.length > 0) issues.push(`unclosed <${stack.at(-1)?.name ?? ""}>`);
  if (issues.length === 0 && root === void 0) issues.push("no <svg> root element");
  return issues.length === 0 ? root : void 0;
}
function attributeString(attrs) {
  return [...attrs].map(([name4, value]) => ` ${name4}="${escapeXml(value.trim().replace(/^currentColor$/, FIGURE_THEME.text))}"`).join("");
}
function sanitizeSvg(source) {
  const issues = [];
  if (typeof source !== "string" || source.length === 0) return { ok: false, issues: ["svg must be a non-empty string"] };
  if (source.length > SVG_LIMITS.maxSourceChars) return { ok: false, issues: [`svg exceeds ${String(SVG_LIMITS.maxSourceChars)} characters`] };
  if (!xmlText(source)) return { ok: false, issues: ["svg contains characters that XML does not allow (control characters, U+FFFE/U+FFFF or unpaired surrogates)"] };
  const root = parse(source.trim(), issues);
  if (root === void 0) return { ok: false, issues };
  if (root.name !== "svg") return { ok: false, issues: [`root must be <svg>, not <${root.name}>`] };
  const parts = (root.attrs.get("viewBox") ?? "").trim().split(/[ \t\n\r,]+/);
  const viewBox = parts.map(Number);
  if (parts.length !== 4 || !parts.every((part) => number2(part) && Number.isFinite(Number(part))) || (viewBox[2] ?? 0) < 1e-3 || (viewBox[3] ?? 0) < 1e-3 || (viewBox[2] ?? 0) > SVG_LIMITS.maxViewBox || (viewBox[3] ?? 0) > SVG_LIMITS.maxViewBox) {
    return { ok: false, issues: ['the root <svg> needs viewBox="minX minY width height" with width and height from 0.001 to 10000'] };
  }
  const markerIds = /* @__PURE__ */ new Set();
  const collect = (element) => {
    if (element.name === "marker" && ID.test(element.attrs.get("id") ?? "")) markerIds.add(element.attrs.get("id") ?? "");
    for (const child of element.children) if ("name" in child) collect(child);
  };
  collect(root);
  let elements = 0, textChars = 0;
  const rootPaint = /* @__PURE__ */ new Map();
  for (const [name4, value] of root.attrs) {
    if (name4 === "viewBox" || ROOT_IGNORED.has(name4) || name4.startsWith("xmlns:")) continue;
    const check = PAINT[name4] ?? FONT[name4];
    if (check === void 0) issues.push(`<svg> attribute "${name4}" is not allowed`);
    else if (!check(value)) issues.push(`<svg> attribute "${name4}" has an invalid value`);
    else rootPaint.set(name4, value);
  }
  const build = (element, depth, parentName) => {
    elements += 1;
    if (depth > SVG_LIMITS.maxDepth) {
      issues.push(`nesting deeper than ${String(SVG_LIMITS.maxDepth)}`);
      return "";
    }
    const allowed = ELEMENTS[element.name];
    if (allowed === void 0 || element.name === "tspan" && parentName !== "text" && parentName !== "tspan") {
      issues.push(`<${element.name}> is not allowed`);
      return "";
    }
    const attrs = /* @__PURE__ */ new Map();
    for (const [name4, value] of element.attrs) {
      const check = allowed[name4] ?? (element.name === "marker" || element.name === "defs" ? void 0 : PAINT[name4]) ?? (MARKABLE.has(element.name) && MARKERS.includes(name4) ? markerRef(markerIds) : void 0);
      if (check === void 0) {
        issues.push(`<${element.name}> attribute "${name4}" is not allowed`);
        continue;
      }
      if (!check(value)) {
        issues.push(`<${element.name}> attribute "${name4}" has an invalid value${MARKERS.includes(name4) ? " (use url(#id) of a defined marker)" : ""}`);
        continue;
      }
      attrs.set(name4, value);
    }
    let body = "";
    for (const child of element.children) {
      if ("name" in child) {
        body += build(child, depth + 1, element.name);
        continue;
      }
      if (!TEXT_PARENTS.has(element.name)) {
        issues.push(`text is not allowed inside <${element.name}>`);
        continue;
      }
      textChars += child.text.length;
      body += escapeXml(child.text);
    }
    return `<${element.name}${attributeString(attrs)}${body.length > 0 ? `>${body}</${element.name}>` : "/>"}`;
  };
  const inner = root.children.map((child) => "name" in child ? build(child, 1, "svg") : (issues.push("text is not allowed inside <svg>"), "")).join("");
  if (elements > SVG_LIMITS.maxElements) issues.push(`more than ${String(SVG_LIMITS.maxElements)} elements`);
  if (textChars > SVG_LIMITS.maxTextChars) issues.push(`more than ${String(SVG_LIMITS.maxTextChars)} text characters`);
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)].slice(0, 8) };
  return { ok: true, viewBox, inner, rootPaint: attributeString(rootPaint), elements };
}

// rich/src/host/tools/rich-svg.ts
var ARG_KEYS3 = ["title", "subtitle", "svg"];
var MAX_TITLE = 120;
var MAX_SUBTITLE = 200;
var OUTPUT_SCHEMA5 = {
  type: "object",
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    svg: { type: "string" },
    summary: { type: "string" },
    ...FIGURE_OUTPUT_PROPERTIES
  },
  required: ["title", "svg", "summary"],
  additionalProperties: false
};
function valueOf5(value) {
  const record2 = value;
  return {
    title: typeof record2?.title === "string" ? record2.title : "",
    ...typeof record2?.subtitle === "string" ? { subtitle: record2.subtitle } : {},
    svg: typeof record2?.svg === "string" ? record2.svg : "",
    summary: typeof record2?.summary === "string" ? record2.summary : ""
  };
}
function plainText(value, key, max) {
  const text5 = typeof value === "string" ? stripUnsafeText(value).replace(/\s+/g, " ").trim() : "";
  if (text5.length === 0 || !xmlText(text5) || [...text5].length > max) throw new Error(`rich_svg: ${key} must be 1..${String(max)} characters of plain text`);
  return text5;
}
function createSvgTool(options = {}) {
  return {
    name: "rich_svg",
    description: `Draw a schematic figure as plain SVG geometry: force and motion diagrams, geometry, circuits, apparatus, coordinate sketches. Prefer rich_render for data plots, rich_mermaid for flowcharts and rich_heatmap for matrices. svg is one <svg viewBox="minX minY width height"> element (viewBox required; width and height are ignored) containing only g, defs, marker, line, polyline, polygon, rect, circle, ellipse, path, text, tspan, title, desc. Use presentation attributes (fill, stroke, stroke-width, stroke-dasharray, opacity, transform, font-size, text-anchor, ...) with literal colours; arrowheads use a <marker id="..."> in <defs> referenced as marker-end="url(#id)". Not allowed: style attributes or <style>, script, event handlers, links, <image>, <use>, foreignObject, gradients, url() paints, entities other than &amp; &lt; &gt; &quot; &apos;. At most ${String(SVG_LIMITS.maxElements)} elements and ${String(SVG_LIMITS.maxSourceChars)} characters. The drawing is placed on a white card, scaled to 600 px wide; use font-size 12 to 16 at that scale. The check covers only allowed markup, not whether the drawing is correct; you cannot see the result.` + (options.figures === void 0 ? "" : FIGURE_TOOL_NOTE),
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: `Figure title shown on the card, at most ${String(MAX_TITLE)} characters.` },
        subtitle: { type: "string", description: "Optional one-line caption." },
        svg: { type: "string", description: 'Complete <svg viewBox="..."> markup in the allowed subset.' }
      },
      required: ["title", "svg"],
      additionalProperties: false
    },
    output: {
      schema: OUTPUT_SCHEMA5,
      render: (_args, rawValue) => [{ type: "text", text: valueOf5(rawValue).summary + figureInstruction(rawValue, options.figures) }],
      presentationMeta: (_args, rawValue) => {
        const value = valueOf5(rawValue);
        return {
          kind: SVG_META_KIND,
          envelopeVersion: SVG_ENVELOPE_VERSION,
          title: value.title,
          ...value.subtitle === void 0 ? {} : { subtitle: value.subtitle },
          svg: value.svg
        };
      }
    },
    async execute(args2, exec) {
      if (exec.signal.aborted) throw new Error("rich_svg: aborted before dispatch");
      if (args2 === null || typeof args2 !== "object" || Array.isArray(args2)) throw new Error("rich_svg: arguments must be an object");
      const record2 = args2;
      const extra = Object.keys(record2).filter((key) => !ARG_KEYS3.includes(key));
      if (extra.length > 0) throw new Error(`rich_svg: unexpected argument ${extra.slice(0, 3).join(", ")}`);
      const title = plainText(record2["title"], "title", MAX_TITLE);
      const subtitle = record2["subtitle"] === void 0 ? void 0 : plainText(record2["subtitle"], "subtitle", MAX_SUBTITLE);
      if (typeof record2["svg"] !== "string") throw new Error("rich_svg: svg must be a string of SVG markup");
      const result = sanitizeSvg(record2["svg"]);
      if (!result.ok) throw new Error(`rich_svg: invalid SVG drawing: ${result.issues.join("; ")}`);
      const inner = result.rootPaint.length > 0 ? `<g${result.rootPaint}>${result.inner}</g>` : result.inner;
      const svg = drawingFigureSvg({ title, subtitle }, result.viewBox, inner);
      const summary = `Drew "${title}" as an SVG figure (${String(result.elements)} elements, viewBox ${result.viewBox.join(" ")}). Only the allowed markup was checked; you cannot see the drawing.`;
      return {
        title,
        ...subtitle === void 0 ? {} : { subtitle },
        svg,
        summary,
        ...writeFigure(options.figures, exec, svg, "svg", title)
      };
    }
  };
}

// rich/src/host/index.ts
var name2 = "dsh-rich-response";
var inject2 = ["tools", "commands"];
function apply2(ctx, config) {
  const tracker = new AttemptTracker(config?.maxTrackedAttempts ?? 512);
  const auditLog = typeof config?.auditLog === "string" && config.auditLog.length > 0 ? config.auditLog : void 0;
  const figuresDir = typeof config?.figuresDir === "string" && config.figuresDir.length > 0 ? config.figuresDir : defaultFiguresDir();
  const figures = createFigureStore(figuresDir);
  ctx.effect(() => ctx.tools.register(createRichRenderTool({ figures })));
  ctx.effect(() => ctx.tools.register(createPhysicsTool()));
  ctx.effect(() => ctx.tools.register(createMermaidTool({ figures })));
  ctx.effect(() => ctx.tools.register(createHeatmapTool({ figures })));
  ctx.effect(() => ctx.tools.register(createSvgTool({ figures })));
  const imageTool = createImageTool({
    services: () => ({
      fs: ctx.get?.("fs"),
      workingDirectory: ctx.get?.("workingDirectory")
    }),
    ...config?.maxImageBytes === void 0 ? {} : { maxImageBytes: config.maxImageBytes },
    figures
  });
  ctx.effect(() => ctx.tools.register(imageTool));
  ctx.effect(() => ctx.commands.register(createRichInteractionCommand({
    logger: ctx.logger,
    tracker,
    ...auditLog === void 0 ? {} : { auditLog }
  })));
  ctx.logger.info(
    "rich-response: host half registered (rich_render, rich_physics_demo, rich_mermaid, rich_heatmap, rich_image, rich_svg tools, rich-interaction command, auditLog=%s, figuresDir=%s)",
    auditLog ?? "<none>",
    figuresDir
  );
}

// src/host.ts
var name3 = "dsh-study-mode";
function apply3(ctx, config = {}) {
  ctx.plugin(host_exports, config.core ?? {});
  ctx.plugin(host_exports2, config.rich ?? {});
}
export {
  apply3 as apply,
  name3 as name
};
