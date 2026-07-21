# Strategic Learning Consumption Gate — architecture record

Implements [ADR-014](../adr/ADR-014-strategic-learning-consumption-gate.md) /
[`strategic-learning-consumption-contract.md`](../governance/strategic-learning-consumption-contract.md).

## Repository audit (pre-implementation)

- **Recommendation Engine** = `strategic-session.worker.ts` → `assembleStrategicContext(founderId, question, subtype,
  deps.assembler)` (reads **live** BU via `understanding.latest()` + **live** FSC via
  `resolveEffectiveStrategicContext(listActive())`) → `model.reason(context)` → persisted on `business.strategic_session`.
- The assembler does **not** consume promoted learnings (the Promotion Gate deferred consumption). So today there is **no**
  path by which promoted context reaches reasoning — and reasoning reads **live** context, so a recommendation is not
  reproducible against an immutable input.

This slice adds the governed boundary: an immutable snapshot becomes the only way promoted+native Effective BU/FSC reaches
reasoning, and only via an explicit founder act.

## Design

- **V081** — `business.context_snapshot` (append-only, immutable): `id`, `founder_id`, `business_understanding` (jsonb —
  frozen assembler-shaped BU incl. promoted-learning conclusions), `founder_strategic_context` (jsonb — frozen
  assembler-shaped founderContext incl. promoted-learning items), `provenance` (jsonb), `content_hash`, `created_at`.
  BEFORE-UPDATE + BEFORE-DELETE guards (delete gated on `bb.allow_snapshot_delete`). Plus a nullable
  `context_snapshot_id` column on `business.strategic_session` (which snapshot a session consumed; null = live legacy path).
- **Domain** `context-snapshot.ts`: `ContextSnapshot`, `RecommendationInput`, `SnapshotProvenance`; `buildContextSnapshot`
  (freezes the assembler-shaped BU+FSC + composed promoted items + deterministic `content_hash`); `snapshotToFrozenContext`
  (maps a snapshot back into the assembler's `{ businessUnderstanding, founderContext }` override); `toSnapshotView`.
- **Capture** `context-snapshot.capture.ts` (or inline in the route): assemble live context once, merge the effective
  promoted BU/FSC items (from ADR-013 composers) into the assembler-shaped BU conclusions + founderContext, and freeze.
- **Repository** `pg-context-snapshot.repository.ts`: `create`, `getById`, `list` (founder-isolated, append-only).
- **Assembler**: optional `frozen?: { businessUnderstanding, founderContext }` param — when present, those two dimensions
  come from the snapshot verbatim and the live BU/FSC reads are skipped. Existing callers pass nothing → unchanged.
- **Worker**: if a session carries `context_snapshot_id`, load the snapshot and pass its frozen BU/FSC to the assembler;
  record the snapshot id. Sessions without a snapshot are byte-identical to today.
- **API**: `POST /strategy/context-snapshots` (create from current effective — explicit), `GET /strategy/context-snapshots`,
  `GET /strategy/context-snapshots/:id`; session-create accepts an optional `contextSnapshotId`. No PATCH, no auto path.
- **UI**: create a snapshot, inspect it (BU/FSC + provenance, native vs promoted badges, snapshot timestamp + hash),
  generate a recommendation from a snapshot, and show which snapshot a recommendation consumed.
- **Export/Delete**: export adds `contextSnapshots`; account-deletion removes them (bypass guard) → zero orphans.

## Invariants

Immutable snapshots (L3/L4/L5); explicit-only creation + consumption (L1/L2/L9); no auto invalidation/recompute (L10/L11);
recommendation references the exact snapshot (L7) and stays reproducible (L6/L8); no model authority (L12); frozen
strategist engine untouched. Deferred: automatic regeneration, market-context freeze, execution, agents, memory, graphs,
embeddings, semantic retrieval.
