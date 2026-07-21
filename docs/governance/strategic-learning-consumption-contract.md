# Strategic Learning Consumption Gate — governance contract

Governs the **only** way the Recommendation Engine may consume the canonical Effective Business Understanding (BU) and
Effective Founder Strategic Context (FSC). Enacts [ADR-014](../adr/ADR-014-strategic-learning-consumption-gate.md). This is
documentation; the implementation slice must satisfy every law below.

## The distinction this gate exists to enforce

**Context Availability** (Promotion, ADR-013) ≠ **Reasoning Consumption** (this gate). Promotion makes an exact learning
revision available in Effective BU/FSC. Consumption is the Recommendation Engine reading Effective BU/FSC as its input —
and it may happen **only** through an explicit, immutable **Context Snapshot**.

## Constitutional laws

**L1 — Consumption is explicit.** The Recommendation Engine consumes Effective BU/FSC only via a founder-created
`ContextSnapshot` and an explicit "generate recommendation from snapshot" act. There is no implicit consumption path.

**L2 — Promotion never implies consumption.** Creating, replacing, or removing a promotion changes availability only. It
creates no snapshot, generates no recommendation, and alters no reasoning input.

**L3 — Consumption never mutates context.** Creating a snapshot or generating from it writes nothing to
`business.understanding`, `founder_strategic_context_item`, the learning tables, or the promotion ledger.

**L4 — Consumption never mutates learning.** No learning revision, lifecycle state, or promotion event is changed by
snapshotting or by generating a recommendation.

**L5 — Consumption never mutates recommendation history.** A generated recommendation is immutable. No later act rewrites
it.

**L6 — Existing recommendations remain reproducible.** A recommendation reasons over the exact frozen snapshot it consumed;
that snapshot is immutable, so the recommendation's inputs are reproducible forever.

**L7 — Every recommendation records the exact context snapshot consumed.** A snapshot-bound recommendation stores its
`contextSnapshotId`; the snapshot stores the exact frozen BU + FSC + provenance + timestamp + content hash.

**L8 — Later context changes never rewrite old recommendations.** A subsequent promotion, learning revision, lifecycle
change, or native BU/FSC change does not alter any prior snapshot or any recommendation bound to it.

**L9 — Recommendation regeneration is explicit.** Producing a new recommendation that reflects newer context requires a new
explicit snapshot + a new explicit generation. Nothing regenerates on its own.

**L10 — No automatic invalidation.** A snapshot or recommendation is never marked stale, invalid, or superseded
automatically by any context change. (It may be *shown* as older than current context — an inspection affordance, not a
mutation.)

**L11 — No background recomputation.** No scheduler, worker loop, agent, or event handler recomputes snapshots or
recommendations in the background.

**L12 — No hidden AI adaptation.** The model cannot create a snapshot, cannot decide to consume, and cannot alter a stored
recommendation. Snapshot creation and consumption are deterministic founder-initiated acts.

## Context Snapshot (the reasoning input)

`ContextSnapshot` is append-only and immutable (BEFORE-UPDATE + BEFORE-DELETE guards; account-deletion the only destructive
path). It freezes, at creation time:

- the canonical **Effective Business Understanding** (native BU conclusions **+** promoted learning revisions),
- the canonical **Effective Founder Strategic Context** (native FSC items **+** promoted learning revisions),
- **provenance** for every item (native vs `PROMOTED_LEARNING`, exact revision id/number, promotion event id, scope,
  rationale, epistemic status, lifecycle-at-snapshot),
- a **snapshot timestamp** and a **content hash** over the frozen payload.

`RecommendationInput = { snapshotId, businessUnderstanding, founderStrategicContext, provenance, snapshotTimestamp }`.

## Boundary (deferred; NOT in this slice)

Autonomous downstream reaction to context change — automatic regeneration, invalidation, background recomputation,
Strategic Execution, agents, event-driven orchestration, memory, knowledge/relationship graphs, embeddings, semantic
retrieval — all remain future, separately-governed work. Freezing public-positioning/market context into the snapshot is a
documented future extension. This gate defines only the **explicit, immutable read boundary** between Effective Context and
Recommendation Generation.

## Acceptance

Accepted only when: promotion changes context but creates no snapshot/recommendation (L2); a snapshot **freezes** context;
a later promotion does **not** alter an existing snapshot (L8); a later learning revision does **not** alter an existing
snapshot (L8); a recommendation **references** its snapshot (L7); history is **reproducible** (L6) — with native/learning
history unchanged (L3/L4), no automatic regeneration/invalidation/recomputation (L9/L10/L11), and no model authority (L12).
