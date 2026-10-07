# Linear workflow

Linear (workspace **Business Brain**, team **Business Brain**, issue prefix **BUS-**) is the tracker. The repo
stays the source of truth for *what and why* (intent/spec/plan, code, docs); Linear is the source of truth for
*status* (what's in progress, next, blocked, done). Sessions keep both in sync via `/session-start` and
`/session-end`.

## The hierarchy (SDLC → Linear)

| SDLC record | Linear | Notes |
|---|---|---|
| Roadmap phase (e.g. Canggu build plan) | **Project label** `Roadmap: A…D` + the team doc **"Roadmap — Business Brain"** | Linear's tools can't create Initiatives; labels can be converted to Initiatives in the app later |
| `intent/<date>-<slug>/intent.md` | **Project** (description = problem, outcome, link to the folder) | one intent folder ↔ one project |
| `spec.md` (spec pack) | **Project document** "Spec" (optional copy; repo file is canonical) | |
| `plan.md` stages / commit groups | **Milestones** (dated) | |
| `plan.md` work-order steps | **Issues** (with estimate in work-sessions: 1 ≈ half a session) | dependencies via *blocked by* |
| Sub-steps, tests, checklists | **Sub-issues** | |
| `plan.md` **Status log** line | **Comment** on the issue(s) worked + a **project status update** at session end | the plan's status log stays too |
| Open product question | **Backlog issue** labelled `Open question` (no project) | recorded verbatim, never interpreted |

**Never invent work.** If a roadmap step isn't written down (e.g. Canggu steps 3–6), don't create a placeholder
project; ask the operator to state it, record it in the build plan, then create it.

## Statuses and labels
- Issue states: **Backlog** (not next) → **Todo** (next up) → **In Progress** (being worked, or built but not yet
  live) → **Done** / **Canceled**. Only one or two issues actively worked at a time.
- **Definition of Done (canonical, CLAUDE.md + SOP §3.2):** a product issue moves to Done only when it is
  deployed to production AND exercised there through the founder's path on real data, with a
  `**Prod verification**` comment (deploy id/time, commit, what was checked, result). Anything short of that
  stays In Progress with the **`Awaiting prod`** label and a comment saying what's missing. Milestones and
  projects close only when all their issues are Done. Non-product exceptions: docs/tooling = committed and in
  effect; content = published; decision = recorded + operator-approved; open question = answered.
- Project states: Planned → In Progress → Completed / Canceled. Status updates use health
  `onTrack` / `atRisk` / `offTrack`.
- Labels: `Feature`, `Bug`, `Improvement`, `Open question`, **`Needs approval`** (blocked on an approve phrase:
  commit / push / deploy / rules / prod / prod-write / migration / frozen / delete), **`Awaiting prod`** (built but
  not yet live and verified in production).

## Project ↔ repo map (keep updated when projects are added)

| Project | ID | Repo record | State |
|---|---|---|---|
| Landing move arrives written | P-BUS-10 | `intent/2026-10-05-landing-move/` | In Progress |
| Licensed atoms | P-BUS-11 | `intent/2026-10-06-licensed-atoms/` | In Progress |
| Step 2b — Photos from the founder's phone | P-BUS-12 | `docs/operations/canggu-build-plan.md` (no intent yet) | Planned |
| Step 1 — Attribution by asking | P-BUS-9 | canggu-build-plan.md | Canceled |
| Dev setup & AI-native SDLC | P-BUS-13 | `docs/operations/*` | In Progress |
| Reel Studio (internal) | P-BUS-14 | `intent/2026-09-30-reel-studio-hypit/`, `services/reel-studio/` | In Progress |
| Founder-led Instagram (30-day plan) | P-BUS-15 | memory `instagram-content-plan`, `services/reel-studio/workspace/` | In Progress |
| Historical (Completed): Truth engine, Understanding & market, Governance chain, Platform shell, Product slices 3–8, MVP launch & Day One, Quality + Month two, Pre-validation hardening | P-BUS-1…8 | git history, `docs/adr/` | Completed |

## Session rules
- **Start** (`/session-start`): read in-progress + Todo issues of active projects and their latest comments,
  blockers (`Needs approval`, *blocked by*), and the latest project status updates; combine with the handoff and
  git state.
- **During:** move an issue to In Progress when you start it; create an issue for any new piece of work you're
  about to do (or a Backlog issue for something found but not done); link commits by mentioning the issue ID
  (`BUS-12`) in the commit message.
- **End** (`/session-end`): for each issue touched, set the state and add a progress comment (done / next /
  blockers, commits, files); create issues for new follow-ups; post a status update on each project worked on;
  append the plan status log as before.
- Linear writes are routine tracking, not outward publishing, but **never** paste secrets, credentials or
  private founder data into Linear.
