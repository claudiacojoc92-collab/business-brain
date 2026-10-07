# intent/

Stage-1 to stage-3 records of the AI-native SDLC loop (see `docs/operations/operator-cheatsheet.md`).

One folder per piece of work: `intent/<YYYY-MM-DD>-<slug>/`

| File | Written by | Approved by | When |
|---|---|---|---|
| `intent.md` | operator + Claude | operator (product owner) | before any design or code |
| `spec.md` (the spec pack) | Claude, by interviewing the operator | operator | after intent, before plan |
| `plan.md` | Claude in plan mode | operator | before implementation |

## How much to write (sizing)
| Work | Needs |
|---|---|
| Typo, one-line bug, copy tweak | nothing (just do it, verify, commit) |
| Change inside an existing feature | `intent.md` + `plan.md` |
| New feature, new surface, new integration, DB change, anything touching prod | `intent.md` + **`spec.md`** + `plan.md` |
| New product, app, website or service | the full spec pack, all 5 sections + `plan.md` |

**Principle: decide everything the builder would otherwise guess, before building.** The spec pack covers
what it does (product), what it's built on (technical), what happens next (flow), how it looks
(design), where data lives and who sees it (data). `plan.md` then fixes the build order.

`plan.md` ends with a **Status log**: one line per session. That log is how the next session (or the next
operator) picks up where the last one stopped.

Start a new one by copying `_TEMPLATE/`.
