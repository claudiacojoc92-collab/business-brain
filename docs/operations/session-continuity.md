# Session continuity: setup and daily use

How Business Brain is configured so every Claude Code session starts with the right context and the
next session picks up where the last one stopped. Desktop app (Code tab) or terminal: same setup.

## 1. What Claude sees automatically (the context layers)

| Layer | File | Loaded | Holds |
|---|---|---|---|
| Project rules | `CLAUDE.md` (repo root) | every session | what the product is, map, commands, hard rules, operating practices |
| Area rules | `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/workers/CLAUDE.md`, `database/CLAUDE.md` | when Claude works in that folder | local conventions only |
| Memory | `~/.claude/projects/-Users-claudiacojoc-Desktop-business-brain/memory/MEMORY.md` (index) + one file per fact | index every session, files on demand | decisions, preferences, project state, lessons |
| Session-start hooks | `.claude/hooks/session-start.mjs` (+ user-level handoff hook, step 5) | every session start | active guardrails; the last handoff for this folder |
| Skills | `.claude/skills/*/SKILL.md` (+ `~/.claude/skills/`) | name + one-line description always; body when used | procedures: `/session-start`, `/session-end`, `spec-pack`, `reel-studio`, `hypit` |
| Human docs | `README.md`, `docs/operations/*.md`, `intent/*` | only when read | setup, SOP, cheat sheet, work records |
| Task status | Linear team "Business Brain" (BUS-xx), via the Linear connector | read by `/session-start`, written by `/session-end` | what's in progress, next, blocked, done; progress notes; project health (see `linear-workflow.md`) |

**Rule of thumb:** short, always-true rules → `CLAUDE.md`. Facts that change → memory. Procedures →
a skill or the SOP. Work in progress → `intent/<date>-<slug>/plan.md` status log. Never rely on chat
history for anything that must survive.

## 2. One-time setup (status as of 2026-10-07)

1. ✅ **Repo in one place:** `~/Desktop/business_brain` (extra Desktop copies removed; use `.worktrees/`).
2. ✅ **`CLAUDE.md` files:** root plus api/web/workers/database.
3. ✅ **Work-record templates:** `intent/_TEMPLATE/` (intent, spec pack, plan with status log).
4. ✅ **Guardrail hooks:** `.claude/hooks/` (approve-phrase gates), shared via `.claude/settings.json`.
5. ⏳ **Context-handoff hooks (user level):** scripts are in `~/.claude/handoff/`, not wired yet. Type
   `approve rules` and ask Claude to "wire the context-handoff hooks". That adds to `~/.claude/settings.json`:
   the status line (context meter), a 70%/85% check on each message, a pre-compaction safety net, and
   handoff injection at session start. Handoffs live in `~/.claude/handoffs/<project>/`, never in the repo.
6. ✅ **Session commands:** `/session-start` and `/session-end` (`.claude/skills/session-*`).
7. ⏳ **Tidy memory:** `MEMORY.md` is ~21 KB and loads every session. Run the `consolidate-memory` skill to
   merge duplicates and shorten index lines (target under ~200 short lines).
8. ⏳ **Commit** the setup files (needs `approve commit`); push only with `approve push`.

## 3. Daily loop

**Start a session**
> `/session-start`

Claude reads the last handoff, git state and active work records, then gives a short briefing:
where we are, what's next, what's waiting on you. Confirm or redirect, then work.

**During the session**
- New feature? `intent.md` → spec pack → `plan.md` (see `operator-cheatsheet.md`).
- If Claude says context is at ~70% (once the hooks are wired), let it write the handoff, then start a
  new session with the resume prompt it gives you.

**End a session**
> `/session-end`

Claude updates the plan status log, writes the handoff (`latest.md`), saves durable lessons to
memory/SOP, lists uncommitted work and gives you a **resume prompt**.

**Next time:** open a new session in the same folder and type `/session-start`. With the handoff hook
wired, the handoff is already in context and Claude mentions it first.

## 4. Copy-paste prompts (if you prefer not to use the commands)

**Start:**
> Orient yourself: read the latest handoff in ~/.claude/handoffs for this folder, git status, and the
> status logs of active intents. Give me a short briefing and the proposed next step. Don't start yet.

**End:**
> Wrap up: append done/next/blockers to the active plan.md status log, write a handoff (goal, done,
> in progress, next steps, decisions, key files, open questions, resume prompt) to latest.md, save
> anything durable to memory, list uncommitted files, and give me the resume prompt.

**Resume in a new session:**
> Continue from the latest handoff for this project. Confirm with me before acting.
