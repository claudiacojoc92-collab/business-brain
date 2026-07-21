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
