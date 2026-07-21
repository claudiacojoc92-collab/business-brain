# ADR-013 — Strategic Learning Promotion Gate

**Status:** Accepted — governance gate. **Documentation only**; no runtime behavior, schema, API, migration, or
frozen-engine change in this record. Governs the **only** explicit path by which a Strategic Learning may influence
**Business Understanding (BU)** or **Founder Strategic Context (FSC)**.
**Relationship to prior records:** within [ADR-011](ADR-011-knowledge-architecture.md) (Knowledge Architecture); the
promotion capability was reserved by [ADR-012](ADR-012-strategic-learning-lifecycle.md) Law 14 and the Strategic Learning
Record contract (Law 14). Governed by [`strategic-learning-promotion-contract.md`](../governance/strategic-learning-promotion-contract.md);
architecture in [`strategic-learning-promotion-slice.md`](../architecture/strategic-learning-promotion-slice.md).

---

## Part 1 — The architectural question

**"What gives a learning the right to influence Business Understanding?"**

It is **not** confidence, age, popularity, number of revisions, `ACTIVE` lifecycle state, `SUPPORTED` epistemic state, a
model recommendation, frequency, or recency. **None of these promote anything.**

The answer is **explicit founder judgment.** A learning exists because the founder recorded it. It influences what
Business Brain reasons *from* only when the founder **explicitly promotes a specific immutable revision** into a target
(BU or FSC), with a rationale and an intended scope. **Promotion is not evidence — promotion is governance.** Nothing
becomes BU merely because it exists, has many revisions, or is ACTIVE. Promotion must remain **rarer than Learning**.

## Part 2 — Governance principle

Learning is the founder's durable understanding. **Promotion changes what Business Brain reasons from** — therefore
Promotion is a **constitutional gate**, not a data operation. Business Understanding is intentionally *much smaller* than
Strategic Learning; most learnings should never become BU (likewise FSC). Promotion is therefore **rare, deliberate, and
inspectable**, an explicit append-only founder act that creates a governance record and never mutates history.

---

## Decision — a separate append-only promotion ledger; effective state derived from events

The existing subsystems are untouched: BU is `business.understanding` (model-generated, versioned, written only by
`pg-understanding.repository`); FSC is `business.founder_strategic_context_item` (founder-declared, append-only, written
only by `pg-founder-strategic-context.repository`). **The Promotion Gate writes to neither** (Laws 15–16).

Instead it introduces one **append-only ledger** of `PromotionEvent`s (V079). Each event pins an **exact learning
revision** (`learningRevisionId`), a **target** (`BUSINESS_UNDERSTANDING` | `FOUNDER_STRATEGIC_CONTEXT`), an **action**
(`PROMOTE` | `REPLACE` | `REMOVE`), a **rationale**, and an intended **scope**. The **effective promoted set** for a
target is *derived* deterministically from the events — never from the latest learning revision:

> For each `(founder, target, logicalLearningId)`, the **latest** PromotionEvent wins. `PROMOTE`/`REPLACE` → its pinned
> revision is promoted; `REMOVE` → the thread is not promoted. Future learning revisions do **not** change a promoted
> revision (Law 6) — only an explicit `REPLACE`/`REMOVE` event does.

This yields: explicit-only promotion (Law 1); lifecycle ≠ promotion (Law 2); exact-revision identity, never "latest"
(Laws 5, 12, 18); BU-independent-from-FSC (Law 7); explicit demotion/replacement (Laws 10, 11); append-only, history
preserved (Laws 3, 17); no model authority (Law 21). Promotion **regenerates nothing** and edits **no** Decision/
Commitment/Plan/Review/Learning/Execution and neither existing BU nor FSC content (Laws 15, 16) — the promoted set is a
governed, inspectable ledger view that a *future, separately-gated* slice may consume; this slice wires it into no
automatic behavior.

### Why not mutate `business.understanding` / FSC directly?
Because that would make promotion indistinguishable from generation, entangle it with model-written content, and risk
"latest wins" leaking in. A separate ledger keeps promotion **rare, explicit, reversible, and auditable**, and keeps the
learning thread and the existing BU/FSC subsystems completely independent (Laws 4, 14).

## Scope guard (this slice)
No Strategic Execution, recommendation regeneration, automatic adaptation, agents, autonomous behavior, memory, knowledge
graphs, relationship graphs, or semantic retrieval. No mutation of the learning thread or of existing BU/FSC content. The
model cannot decide promotion. Constitutional supremacy (Law 22). Deferred: any flow that *consumes* the promoted set to
regenerate recommendations or adapt reasoning (a separate future gate).

---

## Remediation amendment (2026-07-21) — canonical effective composition

**Verdict of the audit (classification B):** the initial slice (`9e524da`) built the append-only `PromotionEvent`
ledger and *parallel* projection endpoints (`GET /strategy/promotions/*`), but **no canonical BU/FSC read path consumed
the promoted revisions.** `assembleStrategicContext` reads `understanding.latest()` + `strategicContext.listActive()`;
`GET /understanding` and `GET /founder-strategic-context/effective` read native only — all with **zero** promotion
references. So promotion recorded a governed intent that nothing effective honored. This amendment fixes that.

### Core distinction
A `PromotionEvent` **is not** Business Understanding or Founder Strategic Context. It is the **governance authority** by
which an exact immutable learning revision becomes part of the **effective** BU/FSC projection.

### Canonical effective state (must exist now; authoritative)
- **Effective Business Understanding** = a deterministic composition of the **native** BU (`business.understanding`
  aggregate) **+** the effective BU `PromotionEvent`s resolved to their **exact pinned learning revisions**.
- **Effective Founder Strategic Context** = the **native** effective FSC items **+** the effective FSC `PromotionEvent`s
  resolved to exact pinned revisions.
- The composition is **canonical and reusable** (`composeEffectiveBusinessUnderstanding` /
  `composeEffectiveFounderStrategicContext`), exposed by authoritative routes and used by the founder-facing "current
  effective BU/FSC" UI. A side-panel "Promoted into BU" list is **generated from the same composer** (not a separate
  answer). Ledger views remain available **for audit only**.
- **No historical mutation:** composition never inserts promoted content into `business.understanding`/FSC history,
  rewrites native versions, mutates learning records, regenerates recommendations, creates a session, or edits Decision/
  Commitment/Plan/Review/Learning history. Promotion changes **effective governed context**, not source objects.
- **Provenance is preserved, never flattened.** Every composed item carries `sourceType` ∈ {`NATIVE_BUSINESS_UNDERSTANDING`,
  `NATIVE_FOUNDER_STRATEGIC_CONTEXT`, `PROMOTED_LEARNING`}. A promoted item additionally exposes `promotionEventId`,
  `target`, `logicalLearningId`, `learningRevisionId`, `learningRevisionNumber`, promotion `rationale` + `scope`, the
  pinned revision's epistemic status + original source lineage, and (separately labelled) the thread's lifecycle status at
  read time. A promoted item is **never** presented as native model-generated BU.
- **Exact-revision pinning:** the composed item references the exact pinned revision. Later REFINE/CONTEST/SUPERSEDE/
  RETIRE change it **not at all** — only an explicit REPLACE/REMOVE promotion event does.

### The reasoning-assembler separation is explicit and governed
`assembleStrategicContext` (the recommendation/session **reasoning input**) **intentionally continues to read native
context only**. Wiring promoted context into reasoning — thereby altering model output — is a **named, deferred,
separately-governed gate: the *Strategic Learning Consumption Gate*.** This is not an accidental split: the canonical
*read* surfaces (this remediation) are authoritative for "what is the founder's current effective BU/FSC?", while
*reasoning adaptation* is future-only. This slice therefore adds no recommendation regeneration, session change, or model
output change (constitution + Laws 15/16 upheld).

### Event lineage (deterministic; not timestamp-only)
The initial ledger derived effective state from `created_at` + `id` ordering under an advisory lock. This remediation adds
explicit lineage (**V080**): `promotion_sequence` (1..N per founder/target/thread) + `predecessor_promotion_event_id`.
Effective state is derived from the **sequence/predecessor chain**, never `created_at` alone. **Chosen PROMOTE-after-
REMOVE rule (the simpler alternative):** one contiguous chain per (founder, target, logical thread); the **first** event
is a PROMOTE at sequence 1 with null predecessor; REPLACE/REMOVE (and a re-PROMOTE after a REMOVE) each append the next
sequence pointing to the exact current effective (highest-sequence) event. Effective = the highest-sequence event;
promoted iff its action ∈ {PROMOTE, REPLACE}. Guarantees: contiguous sequences, exact predecessor, no forks, stale
predecessor rejected, concurrent transitions cannot both succeed, idempotent retry returns the same event.

### Revised acceptance rule
Accepted only when: **PROMOTE → canonical effective BU/FSC changes; a later learning revision → canonical effective
BU/FSC stays pinned; REPLACE → canonical effective changes to the new exact revision; REMOVE → promoted content leaves
canonical effective BU/FSC** — while native history is unchanged and no recommendation is regenerated.
