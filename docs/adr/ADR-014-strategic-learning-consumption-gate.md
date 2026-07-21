# ADR-014 — Strategic Learning Consumption Gate

**Status:** Accepted — governance gate. **Documentation only**; no runtime behavior, schema, API, migration, or
frozen-engine change in this record. Governs the **only** way the Recommendation Engine may consume the canonical
**Effective Business Understanding (BU)** and **Effective Founder Strategic Context (FSC)**.
**Relationship to prior records:** completes the chain reserved by [ADR-013](ADR-013-strategic-learning-promotion-gate.md)
(the Promotion Gate remediation deferred *consumption* to "a separate future gate — the Strategic Learning Consumption
Gate"). Within [ADR-011](ADR-011-knowledge-architecture.md). Governed by
[`strategic-learning-consumption-contract.md`](../governance/strategic-learning-consumption-contract.md); architecture in
[`strategic-learning-consumption-slice.md`](../architecture/strategic-learning-consumption-slice.md).

---

## Part 1 — The architectural question

**"When is the Recommendation Engine allowed to consume Effective Business Understanding and Founder Strategic Context?"**

It is **not** immediately after PROMOTE, **not** automatically, **not** on every learning, **not** on every lifecycle
change, and **not** whenever context changes.

The answer requires distinguishing two things the previous slices deliberately conflated in intuition but never in code:

- **Context Availability** — Promotion (ADR-013) makes an exact learning revision *available* in the canonical Effective
  BU/FSC. Availability is a property of the *read surface*. It changes what the founder *could* reason from.
- **Reasoning Consumption** — the Recommendation Engine reading Effective BU/FSC *as its input*. Consumption is a property
  of a *recommendation generation act*. It changes what Business Brain *did* reason from.

> **The Recommendation Engine may consume Effective BU/FSC only when the founder explicitly creates an immutable Context
> Snapshot and generates a recommendation from that snapshot.** Promotion makes information available; consumption is a
> separate, explicit, founder-initiated act that *freezes* the currently-effective BU/FSC into an immutable snapshot and
> binds a recommendation to it. Nothing is consumed automatically — not on promotion, not on a learning change, not on a
> lifecycle transition, not when context changes.

## Part 2 — The three constitutional actions (kept forever separate)

```
Strategic Learning → Promotion → Effective Context → Consumption → Recommendation Generation
```

- **Promotion** changes *available context* (ADR-013).
- **Consumption** changes *reasoning inputs* — by freezing an immutable snapshot (this ADR).
- **Recommendation generation** creates recommendations from that frozen snapshot.

These are three different constitutional actions. This slice adds the **Consumption** boundary and nothing downstream: no
Strategic Execution, no autonomous adaptation, no automatic regeneration, no background agents, no event-driven
orchestration, no memory, no knowledge graphs, no embeddings, no semantic retrieval.

---

## Decision — an immutable Context Snapshot is the only reasoning input; consumption is explicit

The Recommendation Engine must **never read live mutable Effective BU/FSC during recommendation generation.** Instead:

1. The founder **explicitly creates a Context Snapshot** (`ContextSnapshot`, V081) — an append-only, immutable freeze of
   the current canonical Effective BU + Effective FSC (native records **and** promoted learning revisions, with their
   provenance), stamped with a creation timestamp and a content hash.
2. The founder **explicitly generates a recommendation from a snapshot.** The recommendation records the **exact snapshot
   id** it consumed and reasons over the **frozen** snapshot, not live context.
3. **Later** promotion, learning, lifecycle, or context changes create **no** new snapshot and rewrite **no** prior
   recommendation. Old recommendations stay reproducible — the snapshot they consumed is immutable.

The `RecommendationInput` is therefore `{ snapshotId, businessUnderstanding (frozen), founderStrategicContext (frozen),
provenance, snapshotTimestamp }`. A recommendation references its snapshot **forever**.

### Why freeze, rather than read live?
Reading live context at generation time would make a recommendation un-reproducible (the same recommendation would
"change" as context evolved), would let promotion silently alter reasoning (violating ADR-013's availability≠consumption
separation), and would open the door to automatic invalidation/recomputation. Freezing makes consumption **explicit,
auditable, and reproducible**, and keeps every downstream reaction a *future, separately-governed* act.

### Scope boundary (this slice)
The snapshot freezes **Effective BU + Effective FSC** (Part 4). Public-positioning/market context remains a live assembler
input and is **out of this snapshot's scope** — freezing it is a documented future extension, not part of the Consumption
Gate. Existing recommendation sessions that are **not** snapshot-bound are byte-for-byte unchanged: no live flow is altered,
nothing is auto-consumed. The model has no authority to create snapshots or to decide consumption.
