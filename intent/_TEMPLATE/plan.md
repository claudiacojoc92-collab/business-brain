# Plan: <short name>

<!-- Written by Claude in plan mode, corrected and approved by the operator BEFORE implementation. -->

- **Intent:** ./intent.md
- **Approved by:** <operator> on YYYY-MM-DD (or: NOT YET APPROVED)

## Approach
2-5 sentences. Why this approach over the obvious alternative.

## Files to change
| File | Change |
|---|---|
| `path/to/file.ts` | what and why |

## Work order
1. ...

## Tests / verification
- Unit: `npx vitest run <path>`
- Types: `npx tsc --noEmit -p <project>/tsconfig.json`
- Lint: `npx eslint <paths> --max-warnings 0`
- Live check (browser / curl / DB query) that proves the Outcome in intent.md

## Risks
Frozen code touched? Migration? Prod data? Env/secrets? Rollback path?

## Status log
<!-- Append one line per session. This is the continuation handoff. -->
- YYYY-MM-DD: plan drafted.
