# @bb/business-model-engine (frozen)

The M1-validated Business Model synthesis engine: `prompt.mjs` (reasoning instruction) +
`schema.mjs` (`validateModel` — the grounding / anti-fabrication validator).

## Why this package is JavaScript, not TypeScript (intentional invariant)

This is the one piece of code whose job is guaranteeing honesty. Its logic is **frozen**
under ADR-007's engine freeze: the byte-identical validator that already passed the test
suite must stay byte-identical. Recompiling it as TypeScript under the repo's strict
`tsconfig` would force type-only edits to `validateModel`/`schema.mjs` — touching the
anti-fabrication validator itself, which "probably no behavior change" does not justify.

So the freeze (a HARD rule) wins over the TS→dist package convention (a SOFT tidiness
rule): the `.mjs` files are moved in **unchanged** and TypeScript consumers get types from
the adjacent, hand-written `index.d.ts`. If `.d.ts` and `.mjs` ever disagree, the `.mjs`
is truth — fix the declaration, never the engine.

Provenance: reproduced byte-identically from the frozen M1.5 harness
(`feature/m15-synthesis-validation` branch) —
`prompt.mjs` sha256 `992666a6…`, `schema.mjs` sha256 `6dff794d…`.

## Known, accepted duplication (not debt)

Two byte-identical copies of the engine exist right now: this package (on the M2.1 branch)
and the frozen harness on the parked `feature/m15-synthesis-validation` branch. They are
hash-identical and this is expected; the harness copy is collapsed into this package during
the later m15 → main reconciliation. Do not touch the parked branch to "fix" it.

## Consuming it

ESM-only (`"type": "module"`). From a CJS consumer (e.g. `apps/api`, NodeNext/CJS), load
it with a dynamic `import()`, not a static `import`.
