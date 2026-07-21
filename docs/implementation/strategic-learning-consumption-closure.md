# Strategic Learning Consumption Gate — slice closure record

Implements the **only** way the Recommendation Engine may consume the canonical Effective Business Understanding + Founder
Strategic Context: a founder-created, **immutable Context Snapshot** that freezes the currently-effective BU/FSC (native +
promoted learning revisions), which a recommendation reasons over — never live context. **Consumption is explicit;
promotion never implies consumption; nothing is consumed automatically.** Governance gate committed *before* implementation
(`619ec84`, atop `f0162ba`).

## Architectural answer (ADR-014)
**When may the Recommendation Engine consume Effective BU/FSC?** — *Only when the founder explicitly creates an immutable
Context Snapshot and generates a recommendation from it.* Promotion changes **availability**; consumption is a separate,
explicit act that **freezes** an immutable snapshot as the reasoning input. Not on promotion, not on a learning change, not
on a lifecycle transition, not when context changes.

## Two commits
- **Commit 1 — governance gate `619ec84`** (docs only): [ADR-014](../adr/ADR-014-strategic-learning-consumption-gate.md) +
  [`strategic-learning-consumption-contract.md`](../governance/strategic-learning-consumption-contract.md) (12 laws) +
  [`strategic-learning-consumption-slice.md`](../architecture/strategic-learning-consumption-slice.md). No code/migration/test.
- **Commit 2 — implementation + closure** (this record).

## What was built
- **V081** — `business.context_snapshot` (append-only, immutable): frozen `business_understanding` + `founder_strategic_context`
  (jsonb, assembler-shaped, promoted merged) + `provenance` + `content_hash` + `created_at`; BEFORE-UPDATE + BEFORE-DELETE
  guards (delete gated on `bb.allow_snapshot_delete`). Plus a nullable `context_snapshot_id` on `business.strategic_session`
  (null = the unchanged legacy live path).
- **Domain** [`context-snapshot.ts`](../../apps/api/src/business-model/context-snapshot.ts): `ContextSnapshot`,
  `RecommendationInput`, `FrozenPromotedLearning`, `SnapshotProvenance`; deterministic `hashSnapshotPayload` (canonical
  stringify + FNV-1a); `buildContextSnapshot`; `snapshotToFrozenContext` (assembler override); `toRecommendationInput`
  (L7); `toSnapshotView`.
- **Capture** [`context-snapshot.capture.ts`](../../apps/api/src/business-model/context-snapshot.capture.ts): assembles the
  live native context once, merges the effective promoted BU learnings (→ `promoted_learning` conclusions) and FSC
  learnings (→ `founderContext.promotedLearnings`) with provenance, and returns the frozen payload.
- **Assembler** — optional `frozen` param: a snapshot-bound session consumes the frozen BU + FSC verbatim (live reads
  skipped); every existing caller passes nothing → byte-identical live behaviour.
- **Worker** — a session carrying `context_snapshot_id` loads its snapshot and reasons over the frozen input; records the
  snapshot id. **Repository** [`pg-context-snapshot.repository.ts`](../../apps/api/src/business-model/pg-context-snapshot.repository.ts):
  `create`/`getById`/`list` (append-only, founder-isolated).
- **API** — `POST /strategy/context-snapshots` (explicit create from current effective), `GET /strategy/context-snapshots`,
  `GET /strategy/context-snapshots/:id`; `POST /strategy/sessions` accepts an optional `contextSnapshotId`. No PATCH, no
  auto path.
- **UI** [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx) `ContextSnapshots`: create a snapshot, inspect
  it (frozen hash, timestamp, BU conclusion + promoted counts, promoted strategic-context learnings), and generate a
  recommendation from a snapshot. Each affordance states it changes nothing / regenerates nothing.
- **Export/Delete** — export adds `contextSnapshots` (frozen payload + provenance + hash); account-deletion removes them
  (bypass guard) → zero orphans.

## Acceptance evidence
- **Deterministic** — `context-snapshot.test.ts` (**7**): deterministic + content-sensitive hash; frozen-payload
  projections (`snapshotToFrozenContext`, `toRecommendationInput`); promoted-FSC survives the freeze; view regenerates
  nothing.
- **Live DB (A–E)** — `context-snapshot.live.test.ts` (**5**): a snapshot freezes context and a later PROMOTE (A) or
  learning revision (B) does not alter it; a snapshot-bound recommendation **consumes the frozen snapshot** (2 BU
  conclusions = native + promoted), references it forever, and stays reproducible after later changes (C); the legacy live
  path still reads live context (1 conclusion, D); append-only + isolation + account-delete zero orphans (E).
- **Genuine rendered-UI** — Playwright `strategic-learning-consumption.spec.ts`: create snapshot (freezes native +
  promoted) → REMOVE the promotion (current effective context changes) → the snapshot is **unchanged** (same hash, same
  counts) → a new snapshot reflects the changed context → generate a recommendation from the frozen snapshot → the session
  binds to that exact snapshot (DB `context_snapshot_id`). Native BU never rewritten; learning intact. Evidence:
  `consumption-snapshot-{created,frozen}.png`, `consumption-generate-from-snapshot.png`.
- **Regression** — full **`backend` project** (repo root): **1002 pass / 1 skip / 0 fail** (990 + 12 new). Web build green;
  **73** web unit tests; API + web typechecks clean; migrations through **V081**; promotion Playwright still green; frozen
  strategist hashes byte-identical (`a39ea88…` / `79802e9…` / `f9df116…`).

## Scope discipline
No Strategic Execution, autonomous adaptation, automatic regeneration, background agents, event-driven orchestration,
memory, knowledge/relationship graphs, embeddings, or semantic retrieval. Snapshot creation + consumption are deterministic
founder acts; the model has no authority. The reasoning assembler's live path is unchanged. Frozen engine byte-identical.
Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **Automatic reaction** to context change (regeneration, invalidation, background recomputation) — future, separately
  governed. **Freezing public-positioning/market context** into the snapshot — documented future extension. Strategic
  **Execution**; agents; memory/graphs/embeddings/retrieval — future-only. **PI-1 / KA-2** unchanged.
