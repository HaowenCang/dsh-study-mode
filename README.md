# dsh-study-mode

English | [中文](README.zh.md)

Study Mode for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH): a teaching agent preset for physics, mathematics and engineering in which the Host, not the model, owns attempts, grading and learning evidence. It also adds validated rich visuals: function plots, charts, diagrams, heatmaps, workspace images, deterministic physics demos and a bounded Mermaid flowchart subset.

> **Status: 0.1.0 pre-release.** Tested on DSH `0.2.1-rc.3` with a deterministic mock model provider and real Host and browser processes. Teaching quality with a real model has not been verified yet.

## Install

Requires DSH `>=0.2.1-rc.3 <0.2.2` and Node.js `>=24.13.0`.

```sh
dsh plugin --profile <profile> add github:HaowenCang/dsh-study-mode#v0.1.0
```

The built `lib/` is committed, so a Git install runs no build script and needs no `allowBuilds` entry. Pin a tag or commit so a later push cannot change what you run. Remove it with `dsh plugin --profile <profile> remove dsh-study-mode`.

## What it adds

**Study Mode preset** (`Study Mode` in the agent picker). The agent loads the bundled `study-systematic-teaching` Skill and teaches in order: concepts and conditions → modelling → line-by-line derivation → a fully worked example → guided practice one step at a time → independent assessment → feedback and review. Inside the preset only teaching and visual tools are available; changing the working directory is refused.

**Agent tools**

| Tool | Purpose |
|---|---|
| `study_get_state` | Read the Host's record of courses, lesson stages, attempts and evidence |
| `study_get_plan` | Read an imported course plan (a schedule, not completion evidence) |
| `study_teaching_step` | Record a teaching stage that was actually delivered; never sets mastery |
| `study_issue_question` | Issue a question from the trusted Host catalog as an answer card |
| `rich_render` | Render a validated function plot, chart, diagram or message card |
| `rich_physics_demo` | Show a deterministic, parameterised physics demo (infinite well, oscillator, finite Ising) with SVG export |
| `rich_mermaid` | Draw a flowchart from a bounded Mermaid subset (see below) |
| `rich_heatmap` | Draw a numeric matrix as a heatmap (sequential or diverging palette, up to 128 x 128 / 4,096 cells) with SVG export |
| `rich_image` | Show an existing PNG, JPEG, GIF or WebP file from the session's working directory to the learner (see below) |

**Commands**: `/study-mode` switches teaching mode without clearing history; `/study-attempt` is used by the answer cards; `/study-review` (human review) is registered only when `enableHumanReview` is on; `rich-interaction` records card button actions in the original session.

## Learning evidence

- Answers, hints, revealed solutions, grades and reviews are append-only. The model cannot submit a learner answer, perform human review or set mastery through any tool; learners answer on the card themselves.
- Help is recorded as H0–H4 (problem only → full solution), using the highest help seen for that question. Capability is recorded separately per dimension (concept, modelling, derivation, calculation, transfer) as U untested, N not passed, S solved with hints, P passed independently, R re-passed independently in a new context at least 24 hours later.
- Objective answers are graded deterministically; open derivations stay pending review without a reliable check.
- Storage is SQLite in `$DSH_HOME/study-core/study.db` (default `~/.dsh/study-core/study.db`), with hash-chained events, idempotent requests and refusal of unknown future schemas.

## Bounded Mermaid

DSH's chat Markdown shows a fenced `mermaid` block as plain code. `rich_mermaid` does not run Mermaid; it compiles a strict subset to the built-in diagram renderer:

- `flowchart` / `graph` with `TD`, `TB`, `BT`, `LR`, `RL`; at most 5 levels and about 5 nodes side by side.
- Nodes `A`, `A[box]`, `A(rounded)`, `A([stadium])` (drawn rounded), `A{decision}`, `A((circle))`; links `-->`, `-.->`, `-->|label|`, `-- label -->`, chains.
- Labels are plain text: HTML, entities and markdown are refused (write averages as ⟨p⟩).
- Anything else, and any layout in which a link would cross a node, a label would be hidden or overlap, or an arrow would be invisible, fails with line-numbered issues instead of being drawn approximately.

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

Other keys: `core.learnerId` (default `local-learner`), `core.enableHumanReview` (default `false`), `rich.maxTrackedAttempts` (default `512`), `rich.maxImageBytes` (default `524288`).

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

## License

[MIT](LICENSE)
