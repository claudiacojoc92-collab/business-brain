# intent/

Stage-1 and stage-3 records of the AI-native SDLC loop (see `docs/operations/operator-cheatsheet.md`).

One folder per piece of work: `intent/<YYYY-MM-DD>-<slug>/`

| File | Written by | Approved by | When |
|---|---|---|---|
| `intent.md` | operator + Claude | operator (product owner) | before any design or code |
| `spec.md` (optional, larger work) | Claude | operator | after intent, before plan |
| `plan.md` | Claude in plan mode | operator | before implementation |

`plan.md` ends with a **Status log**: one line per session. That log is how the next session (or the next
operator) picks up where the last one stopped.

Start a new one by copying `_TEMPLATE/`. Small fixes (typo, one-line bug) don't need an intent folder;
anything that touches strategy/plan/create behavior, the DB schema, or prod does.
