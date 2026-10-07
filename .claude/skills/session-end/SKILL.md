---
name: session-end
description: Close a work session so the next one can continue seamlessly. Updates Linear (issue states, progress comments, new follow-up issues, project status updates), the plan status log and the handoff with a resume prompt; saves durable learnings to memory/SOP; lists anything uncommitted. Use when the user types /session-end, says "let's wrap up", "end of session", "write a handoff", or when context is getting full.
---

# Session end

Goal: the next session (or another person) can pick up in under a minute. Facts, not narration.
Mapping and rules: `docs/operations/linear-workflow.md`.

1. **Linear: issues** (team "Business Brain", via the Linear connector). For every issue worked this session:
   - `save_issue` to set the state, applying the **Definition of Done** (CLAUDE.md; SOP §3.2):
     - **Done** only if the capability is deployed to production AND was exercised there through the founder's
       path on real data. First post the `**Prod verification YYYY-MM-DD**` comment (deploy id/time from
       `railway deployment list`, prod commit, what was checked, result, evidence). Non-product work uses its own
       bar (docs/tooling committed and in effect; content published; decision recorded + approved).
     - Built / tested / committed / deployed-but-unverified → **In Progress + `Awaiting prod`** label, and say in
       the comment which step is missing (deploy needs `approve deploy`; never deploy just to close an issue).
     - Continuing → In Progress; paused → Todo/Backlog; blocked on an approve phrase → add `Needs approval`.
   - `save_comment` on the issue: `**YYYY-MM-DD session** — Done: … / Next: … / Blockers: … / Commits: <sha> /
     Files: …`. Keep it to ~5 lines.
   - Work that happened with no issue → create one now (`save_issue`, right project + milestone) and mark it.
   - Follow-ups discovered but not done → new Backlog issues (or sub-issues of the parent), with enough context
     to act without this conversation.
2. **Linear: projects.** For each project touched, `save_status_update` (type `project`) with health
   (`onTrack` / `atRisk` / `offTrack`) and 2–4 lines: what moved, what's next, what's blocked.
3. **Status log:** for each intent worked on, append one line to the `## Status log` in its `plan.md`:
   `- YYYY-MM-DD: done … / next … / blockers … (BUS-xx)`.
4. **Handoff:** write `~/.claude/handoffs/<cwd-slug>/<YYYY-MM-DD-HH-MM>.md` and overwrite `latest.md` (`<cwd-slug>`
   = absolute cwd, leading `/` removed, `/` → `-`). Max ~60 lines:
   ```
   # Handoff: <topic> (<date>)
   ## Goal
   ## Done (with BUS-xx IDs, commits, files, outputs)
   ## In progress (exact state)
   ## Next steps (ordered, with BUS-xx IDs)
   ## Decisions & constraints (choices, user preferences, rules that must hold)
   ## Key files, commands, IDs
   ## Open questions / blockers (incl. approvals the user still has to type)
   ## Resume prompt (one paragraph to paste into a new session)
   ```
5. **Durable learnings:** future-relevant facts → the matching memory file (or a new one + MEMORY.md line). A
   repeated procedure or a mistake made twice → one line in CLAUDE.md "Operating practices" + detail in
   `docs/operations/agent-sop.md`. Don't duplicate what git or Linear already record.
6. **Uncommitted work:** `git status --short`; list it and ask whether to commit (needs "approve commit" or an
   explicit request; mention the BUS-xx IDs in the commit message). Never push.

Never put secrets, credentials or private founder data into Linear, the handoff or memory.

Reply with: what was updated where (Linear issues + projects, plan log, handoff, memory) in 3–5 lines, the
uncommitted list, and the **Resume prompt** in a fenced block.
