---
name: session-start
description: Start a work session with continuity. Loads the last handoff, Linear (in-progress/next issues, blockers, latest notes), git state, active work records and relevant memory, then gives a short briefing and asks what to do. Use when the user types /session-start, says "let's start", "where were we", "continue", or opens a new session to pick up work.
---

# Session start

Goal: in under a minute, know where we left off without re-reading everything. Read, don't act.
Mapping and rules: `docs/operations/linear-workflow.md`.

1. **Last handoff** (if any): `~/.claude/handoffs/<cwd-slug>/latest.md` (`<cwd-slug>` = absolute working
   directory, leading `/` removed, every `/` → `-`, e.g. `Users-claudiacojoc-Desktop-business_brain`).
   Note its date; ignore it if older than ~3 days unless the user says to continue it.
2. **Linear** (team "Business Brain", via the Linear connector):
   - `list_issues` with `state: "In Progress"` (team Business Brain), then `state: "Todo"`.
   - For the 1–3 most relevant issues, `list_comments` and read the latest progress comment.
   - Blockers: issues labelled `Needs approval`, and *blocked by* relations on the next issue.
   - `get_status_updates` for the active projects (latest only).
   If the connector is unavailable, say so and continue with the repo-only steps.
3. **Git state:** `git branch --show-current && git status --short | head -20 && git log --oneline -5`.
4. **Active work records:** `grep -l "Status:\*\* in-build\|Status:\*\* approved" intent/*/intent.md`; for each,
   the last 3 lines of the `## Status log` in its `plan.md`.
5. **Memory:** skim the MEMORY.md index already in context; open at most 2 memory files matching the active work.

Then reply with this briefing (no more than ~10 lines) and stop:

```
**Where we are** (<branch>, <n> uncommitted files)
- Last session: <one line from the handoff / latest Linear comment, with date>
- In progress: <BUS-xx title (project)> …
- Next up: <BUS-xx title> — <why it's next / what it unblocks>
- Waiting on you: <Needs-approval items with the phrase needed, open questions, or "nothing">
What should we do: continue with <BUS-xx>, or something else?
```

Rules: don't start working until the user confirms. If Linear, the handoff and git disagree, say which and
trust git for code state and Linear for task state. Content tasks (Instagram, project P-BUS-15) only come up if
they were the last focus or the user asks.
