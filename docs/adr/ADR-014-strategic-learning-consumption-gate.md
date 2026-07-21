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

---

## Remediation amendment (2026-07-21) — mandatory gate + full reasoning-input reproducibility

**Verdict of the audit:** the initial slice (`4a6648c`) made snapshot binding **optional** (`contextSnapshotId?`) and kept a
**live-context fallback** for unbound sessions — so consumption was a *capability*, not a *constitutional gate*. Worse, the
code-traced reasoning-input audit found inputs consumed **live and unrecorded**, breaking the reproducibility claim:

- **E — public-positioning / market context**: `assembleStrategicContext` reads `effectiveMarketContext` +
  `findings.listByFounder` + `listEntityViews` live; the snapshot never froze it, yet the strategist's user message is the
  **whole** `StrategicContext` (incl. `publicPositioningContext`).
- **E — objective/question**: `session.questionText` + `decisionHorizon` reach the model but were never frozen or pinned.
- **E — live BU/FSC fallback** for unbound sessions.
- **C (unrecorded)** — the `SYSTEM` prompt template and model configuration (`max_tokens`) were not hashed/recorded.

### The gate is now mandatory (not optional)
For **every new** recommendation-generation command: an immutable Context Snapshot is **required**; it must belong to the
same founder; the worker consumes **exactly** that frozen input; **no live-context fallback exists.** A new command with no
snapshot / a foreign snapshot / a missing snapshot is **rejected before the worker runs** (`CONTEXT_SNAPSHOT_REQUIRED`).
Enforced server-side at the API, the domain command, session creation, a DB CHECK, and the worker — never UI-only.

### Legacy compatibility (read-only)
Sessions created before enforcement carry `context_snapshot_id = NULL` and `generation_contract_version = 0`. They remain
**readable historical records** but are **not** reproducible snapshot-bound sessions and **cannot be regenerated via a live
fallback**. Any retry/rerun/regenerate/duplicate of such a session is rejected with `CONTEXT_SNAPSHOT_REQUIRED`; the founder
must create a **new** snapshot and generate anew. No retrospective snapshots are invented for historical recommendations.

### Full reasoning-input reproducibility (freeze or version-pin everything actually consumed)
The snapshot now freezes the **entire governed reasoning input** the strategist consumes: Effective BU (native + promoted),
Effective FSC (native + promoted), **and public-positioning/market context**, each with provenance + deterministic
ordering. The **objective/question** is pinned into the generation record (stored + hashed). Code-artifact inputs — the
`SYSTEM` prompt template and the model configuration — are recorded by exact hash/value. Nothing the model reads is left as
an unrecorded mutable input.

### Generation provenance (server-resolved; client cannot supply)
Every new generation record preserves: context snapshot id + **SHA-256 content hash** + payload schema version; strategist
(prompt) version + **prompt-template SHA-256**; model id + material model configuration; objective hash; generation
timestamp. The client may **not** submit snapshot content, any hash, the prompt hash, or model provenance — the server
resolves and records them. No hidden chain-of-thought is stored — only reproducibility metadata + governed visible inputs.

### Integrity hash — SHA-256 replaces FNV-1a
The authoritative snapshot-integrity hash is **`SHA-256(canonical-serialized payload)`**, lowercase hex, computed
server-side, never client-supplied, content-sensitive, key-order-stable, preserved in export, and re-verifiable by a domain
function (`computeContextSnapshotHash`). A `hash_algorithm` column records the algorithm. Snapshot rows in the dev DB are all
test/removable (audited: 0 persistent rows), so the switch is a clean forward migration — the old FNV value is **not**
relabelled as SHA-256.

### No automatic reaction (unchanged)
This remediation authorizes **no** automatic snapshot creation, recommendation regeneration, invalidation, background
recomputation, reaction to promotion, or downstream decision/execution. The founder still explicitly (1) creates a snapshot
and (2) requests generation from it.

### Revised acceptance rule
Accept only when: no new recommendation can be generated without a founder-owned snapshot; no live-context fallback remains;
every newly-generated session is snapshot-bound (`generation_contract_version = 1`, non-null snapshot); every actually-
consumed input is frozen or exact-version-pinned; prompt/model provenance is recorded; legacy null sessions remain readable
but cannot regenerate live; SHA-256 is authoritative; and Playwright proves the mandatory gate.
