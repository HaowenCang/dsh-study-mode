# dsh-study-tutor

English | [中文](README.zh.md)

Study Mode for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a teaching agent preset for physics, mathematics and engineering in which the Host, not the model, owns attempts, grading and learning evidence. It also adds validated rich visuals: function plots, charts, diagrams, heatmaps, sanitized SVG drawings, workspace images, deterministic physics demos and a bounded Mermaid flowchart subset. Figures can appear inside the answer, next to the text that discusses them.

> **Status: 0.3.0.** Tested on DSH `0.2.2-rc.1` and `0.2.1-rc.5` with a deterministic mock model provider and real Host and browser processes. Earlier versions were also used in DSH Desktop with a real model (teaching, figure lines, model-written question cards). The new in-reply figures and question cards of 0.3.0 have **not** yet been used with a real model, and there is no systematic evaluation of teaching quality or of the questions a real model writes.
>
> 0.3.0 draws figures and question cards **in the reply** on DSH 0.2.2: the model writes restricted ` ```svg `, ` ```mermaid `, ` ```dsh-plot `, ` ```dsh-heatmap ` or ` ```dsh-physics ` blocks where a figure belongs, and they are drawn there while the answer streams, with a source toggle and light/dark colours; Study question cards appear where the tool was called. On DSH 0.2.1 nothing changes: figures keep the 0.2.x figure-file route (see [Figures in the answer](#figures-in-the-answer)). Native tool presentation stays on the Study preset's own `@deepseek-ai/dsh-agent-tool-presentation` row (since 0.2.2). The supported range is `>=0.2.1-rc.3 <0.2.3`.
>
> The npm package is **`dsh-study-tutor`** (the name `dsh-study-mode` on npm belongs to an unrelated project). This repository keeps the name `dsh-study-mode`.

## Install

Requires DSH `>=0.2.1-rc.3 <0.2.3` and Node.js `>=24.13.0`.

```sh
dsh plugin --profile <profile> add dsh-study-tutor
# or pinned from GitHub:
dsh plugin --profile <profile> add github:HaowenCang/dsh-study-mode#v0.3.0
```

**Upgrading from 0.2.x:** quit DSH Desktop completely, run `dsh plugin --profile <profile> add dsh-study-tutor@0.3.0` (or the GitHub tag above), then start a new session. The database schema is unchanged.

**Upgrading from 0.1.0 or a preview (package name `dsh-study-mode`):** quit DSH Desktop completely, run `dsh plugin --profile <profile> remove dsh-study-mode`, then add `dsh-study-tutor`, and start a new session. Installing while Desktop is running can leave the old Study preset code loaded. Learning data stays in `$DSH_HOME/study-core/study.db`, and the bundle row keeps the id `dsh-study-mode`, so existing `cordis.patch.yml` overrides still apply. 0.2.0 moves the database to schema 3, which 0.1.0 refuses: back up `study.db` first if you may go back.

The built `lib/` is committed, so a Git install runs no build script and needs no `allowBuilds` entry. Pin a tag or commit so a later push cannot change what you run. A packed tarball installs the same way: `dsh plugin --profile <profile> add ./dsh-study-tutor-<version>.tgz`. Remove it with `dsh plugin --profile <profile> remove dsh-study-tutor`.

## What it adds

**Study Mode preset** (`Study Mode` in the agent picker). The agent loads the bundled `study-systematic-teaching` Skill and teaches in order: concepts and conditions → modelling → line-by-line derivation → a fully worked example → guided practice one step at a time → independent assessment → feedback and review. Inside the preset only teaching and visual tools are available; changing the working directory is refused.

**Agent tools**

| Tool | Purpose |
|---|---|
| `study_get_state` | Read the Host's record of courses, lesson stages, attempts and evidence |
| `study_get_plan` | Read an imported course plan (a schedule, not completion evidence) |
| `study_teaching_step` | Record a teaching stage that was actually delivered; never sets mastery |
| `study_issue_question` | Issue a question from the trusted Host catalog as an answer card |
| `study_author_question` | Write a question and issue it as an answer card: single choice, multiple choice, true/false, fill-in-blank or short answer / derivation, with H1–H4 hints |
| `study_model_review` | Comment on a submitted short answer against its reference answer; recorded separately, never a grade |
| `rich_render` | Render a validated function plot, chart, diagram or message card |
| `rich_physics_demo` | Show a deterministic, parameterised physics demo (infinite well, oscillator, finite Ising) with SVG export |
| `rich_mermaid` | Draw a flowchart from a bounded Mermaid subset (see below) |
| `rich_heatmap` | Draw a numeric matrix as a heatmap (sequential or diverging palette, up to 128 x 128 / 4,096 cells) with SVG export |
| `rich_image` | Show an existing PNG, JPEG, GIF or WebP file from the session's working directory to the learner (see below) |
| `rich_svg` | Draw a schematic (force diagram, geometry, circuit, apparatus) from an allowlisted SVG subset (see below) |
| `rich_check_figure` | DSH 0.2.2: check a figure block before writing it in the answer; returns OK or line-numbered issues, draws and stores nothing |

**Commands**: `/study-mode` switches teaching mode without clearing history; `/study-attempt` is used by the answer cards; `/study-review` (human review) is registered only when `enableHumanReview` is on; `rich-interaction` records card button actions in the original session.

## Learning evidence

- Answers, hints, revealed solutions, grades and reviews are append-only. The model cannot submit a learner answer, perform human review or set mastery through any tool; learners answer on the card themselves.
- Help is recorded as H0–H4 (problem only → full solution), using the highest help seen for that question. Capability is recorded separately per dimension (concept, modelling, derivation, calculation, transfer) as U untested, N not passed, S solved with hints, P passed independently, R re-passed independently in a new context at least 24 hours later.
- Objective answers are graded deterministically; open derivations stay pending review without a reliable check.
- Model-written questions are labelled “模型出题” on the card. Their answer key, hints and reference answer are locked when the card is issued and are not shown on it; the Host checks the structure but not whether the model's key is right. They count toward capability under the same rules as catalog questions. For a subject with no configured course or topic, the model creates one with short lowercase ids (for example `math` / `laplace-pde`); `study_get_state` lists it as `modelCreated`. Fill-in blanks are graded per blank by normalized text or by value within tolerance. The reference answer appears after the learner submits. A model review is shown as “不计入判分” and never changes the grade, the pending human review or any capability level. The answer key is in the model's tool-call arguments, so it is in the session log.
- Storage is SQLite in `$DSH_HOME/study-core/study.db` (default `~/.dsh/study-core/study.db`), with hash-chained events, idempotent requests and refusal of unknown future schemas. 0.2.0 moves the database to schema 3; earlier versions refuse it, so back up `study.db` before upgrading if you may roll back.

## Bounded Mermaid

Mermaid itself never runs. `rich_mermaid` (and, on DSH 0.2.2, a ` ```mermaid ` block in the answer) compiles a strict subset to the built-in diagram renderer; DSH's own Markdown would show the block as plain code:

- `flowchart` / `graph` with `TD`, `TB`, `BT`, `LR`, `RL`; at most 5 levels and about 5 nodes side by side.
- Nodes `A`, `A[box]`, `A(rounded)`, `A([stadium])` (drawn rounded), `A{decision}`, `A((circle))`; links `-->`, `-.->`, `-->|label|`, `-- label -->`, chains.
- Labels are plain text: HTML, entities and markdown are refused (write averages as ⟨p⟩).
- Anything else, and any layout in which a link would cross a node, a label would be hidden or overlap, or an arrow would be invisible, fails with line-numbered issues instead of being drawn approximately.

## Figures in the answer

### DSH 0.2.2: figure blocks drawn in the reply

The plugin replaces DSH's renderer for assistant replies through the documented slot priority mechanism (it falls back to DSH's own renderer automatically if that contract changes). Top-level fenced blocks in an answer are drawn in place:

| Block | Content |
|---|---|
| ` ```svg `, ` ```dsh-svg ` | One `<svg viewBox=…>` from the `rich_svg` allowlist below; drawn element by element while it streams |
| ` ```mermaid `, ` ```dsh-mermaid ` | The bounded Mermaid subset above; `%% title: …` names the figure |
| ` ```dsh-plot ` | `rich_render` line/scatter plot JSON, or `{"title","fns":[{"expr","label"}],"x":[a,b]}` with expressions in `x`, numbers, `+ - * / ^`, parentheses and `sin cos tan exp log sqrt abs pi e` (at most 8 curves) |
| ` ```dsh-heatmap ` | `rich_heatmap` content JSON |
| ` ```dsh-physics ` | `{"demo":"infinite_well"}`, `"harmonic_oscillator"` or `"ising"` |

Every figure has a “source” toggle. A rejected ` ```svg ` or ` ```mermaid ` block is shown as ordinary code; a rejected `dsh-*` block shows its line-numbered issues. Nothing is written to disk and no local path enters the answer. Colours follow the light or dark theme (near-black ink becomes the text colour, near-white fills the page surface). This applies in every session, so ordinary ` ```svg ` and ` ```mermaid ` blocks are drawn too. The Study prompt teaches the block syntax and `rich_check_figure` when inline figures are on.

Study question cards (`study_issue_question`, `study_author_question`) appear in the reply where the tool was called. The card asks the Host which question that call issued in this session (a read-only lookup) and does not trust the transcript; answering, hints and grading work exactly as before, and the tool record shows a link to the card instead of a second copy.

`rich.inline` controls this: `auto` (default; on for DSH 0.2.2 and later, off on 0.2.1), `on` or `off`. In a browser, `localStorage['dsh-rich-inline'] = 'off'` turns the reply renderer off for that browser.

### DSH 0.2.1 (or `rich.inline: off`): figure lines

`rich_render`, `rich_mermaid`, `rich_heatmap`, `rich_svg` and `rich_image` write a static copy of their figure to `$DSH_HOME/rich-response/figures/<session>/` (default `~/.dsh/...`, or `rich.figuresDir`) and return one Markdown image line, `![title](<absolute path>)`. The model copies that line into its answer where the figure belongs, and DSH's Markdown shows it there through its authenticated file route. The interactive card stays in the tool record. Files are content-addressed and never overwritten, so an answer that was already shown keeps its picture.

`rich_svg` accepts only `g`, `defs`, `marker`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse`, `path`, `text`, `tspan`, `title` and `desc` with presentation attributes and literal colours; scripts, styles, links, images, `use`, `foreignObject`, gradients, `url()` paints and unknown entities are refused. The Host rebuilds the drawing from parsed tokens inside a light figure card; the model's source text is never shown.

The figure line contains an absolute local path, so that path becomes part of the answer and the session log.

## Images

`rich_image` is display-only: the learner sees the picture, the model never receives its bytes. It reads only files inside the session's working directory (no URLs, UNC or device paths, symbolic links or junctions leaving it), admits PNG/JPEG/GIF/WebP checked by header and structure, up to 512 KiB by default (`rich.maxImageBytes`, at most 2 MiB), 8,192 px per side and 40 M pixels. The browser shows the picture only after its SHA-256 matches the Host's record. Image generation is not provided.

The image bytes are stored in the tool result, so they are part of the session log; DSH's `session-log-deepseek` uploads that log with official DeepSeek API requests. Do not show images you would not upload.

## Configuration

The bundle row `dsh-study-mode` reads these launch environment variables; override the row in your profile's `cordis.patch.yml` to set values directly (a patch replaces the whole `config`).

| Variable | Row key | Meaning |
|---|---|---|
| `DSH_STUDY_DATABASE` | `core.databasePath` | Database file; must stay inside `$DSH_HOME` and not traverse symbolic links |
| `DSH_STUDY_CATALOG` | `core.catalogPath` | Trusted question catalog JSON; defaults to the synthetic sample `data/synthetic.json` |
| `DSH_STUDY_PLANS` | `core.plansPath` | Course plan definitions JSON (optional) |
| `DSH_RICH_RESPONSE_AUDIT_LOG` | `rich.auditLog` | Optional JSONL audit log of card interactions |

Other keys: `rich.inline` (`auto`, `on` or `off`; default `auto`, see [Figures in the answer](#figures-in-the-answer)), `core.learnerId` (default `local-learner`), `core.enableHumanReview` (default `false`), `rich.maxTrackedAttempts` (default `512`), `rich.maxImageBytes` (default `524288`), `rich.figuresDir` (default `$DSH_HOME/rich-response/figures`).

A **question catalog** is an array of versioned questions (`id`, `version`, `courseId`, `topicId`, `familyId`, `kind`, `prompt`, options or expected value, `answer`, `dimensions`, `coverage`, `hints.H1`…`H4`); see `data/synthetic.json`. A **course plan** is an array of `{ courseId, title, version, startDate, endDate, evidenceStatus: "not_imported", sources: [{ path, sha256 }], days: [{ day, unit, title, topics, tasks: [{ id, kind, title, minutes }] }] }`. Plans import definitions only, never learner grades.

## Repository layout

| Path | Contents |
|---|---|
| `src/host.ts`, `src/client.ts` | Package entries: one Loader row and one browser module mounting both plugins |
| `core/` | Study Core: domain, SQLite storage, Host tools and commands, answer cards, Study preset agent |
| `rich/` | Rich Response: payload validation, renderers, physics kernels, Mermaid compiler, Tool views |
| `data/`, `skills/` | Synthetic sample catalog and the teaching Skill, read by the built entries |
| `lib/` | Committed build output (`index.js`, `client.js`, `agent.js`) |

## Development

```sh
npm install
npm run verify   # typecheck, build lib/, Study Core + Rich Response + package tests
```

`lib/` must match a fresh build of the sources; the package test fails when it is stale, so run `npm run build` and commit `lib/` with source changes.

## Known limitations

- Real-model teaching behaviour (pedagogy, tool choice, Skill adherence) is not verified.
- Mermaid: crossing labelled links are refused; three labelled nested decisions need `LR`; no subgraphs, styles, clicks or other diagram types.
- The diagram canvas keeps a fixed layout; below 680 px it scrolls horizontally instead of shrinking the text.
- Images: workspace files only; no external URLs and no image generation.
- Figures in the reply (DSH 0.2.2): whether a real model writes the blocks correctly is not yet verified; a short left-to-right Mermaid flowchart is drawn in a tall, mostly empty canvas; there is no full-screen view; a rejected block is not reported back to the model automatically (`rich_check_figure` and the prompt are the mitigation). The renderer mirrors DSH's own reply view, so a future DSH release may need an update (it falls back to DSH's renderer when the contract changes).
- Question cards in the reply look up their question on the Host, which adds a few “学习记录已同步” rows to the session.
- Figure lines (DSH 0.2.1): DSH's Markdown preview caps images at 360 px high, so tall drawings shrink (click to enlarge). Figure files are not cleaned up automatically.

## License

[MIT](LICENSE)
