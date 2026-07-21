# Strategic Learning Promotion Gate — Governance Contract

**Status: FROZEN** (governance gate, committed *before* implementation). Governs the **only** explicit path by which a
Strategic Learning may influence **Business Understanding (BU)** or **Founder Strategic Context (FSC)**. Companion:
[ADR-013](../adr/ADR-013-strategic-learning-promotion-gate.md); architecture:
[`strategic-learning-promotion-slice.md`](../architecture/strategic-learning-promotion-slice.md). Within
[ADR-011](../adr/ADR-011-knowledge-architecture.md); realizes Law 14 of the Strategic Learning Record + Lifecycle.

## What gives a learning the right to influence BU?

**Explicit founder judgment — nothing else.** Not confidence, age, popularity, number of revisions, `ACTIVE` lifecycle,
`SUPPORTED` epistemic state, model recommendation, frequency, or recency. **Promotion is not evidence; promotion is
governance.** Nothing becomes BU merely because it exists, has many revisions, or is ACTIVE. Promotion is **rarer than
Learning** — most learnings never become BU or FSC. It is rare, deliberate, inspectable, append-only.

## The twenty-two laws

1. **Explicit founder action.** Nothing promotes automatically.
2. **Lifecycle never implies promotion.** ACTIVE ≠ promoted; CONTESTED ≠ demoted; SUPERSEDED ≠ removed; RETIRED ≠
   automatically removed from BU/FSC.
3. **Promotion creates a governance record.** It does not mutate history.
4. **Promotion never rewrites the learning thread.**
5. **Promotion preserves the exact source revision.** BU references a *specific immutable learning revision*, never
   "latest".
6. **Future revisions do not change promoted understanding.** If revision 6 was promoted, a later revision 7 does
   nothing; the founder must later explicitly keep / replace / remove.
7. **BU promotion is independent from FSC promotion.** BU-only, FSC-only, both, or neither are all possible.
8. **Promotion requires founder rationale.**
9. **Promotion records intended scope** (e.g. Offer, Customer, Pricing, Positioning, Messaging, Acquisition, Retention,
   Business, Founder, Other).
10. **Demotion is explicit.** Nothing leaves BU/FSC automatically.
11. **Replacement is explicit.** Replacing a promoted revision creates a new governance event; history remains.
12. **BU never contains "latest".** It contains explicitly selected revisions.
13. **FSC follows identical governance.**
14. **Learning threads remain independent.** Promoting one does not affect another.
15. **Promotion never regenerates recommendations.**
16. **Promotion never edits** Decision, Commitment, Plan, Review, Learning, or Execution (nor existing BU/FSC content).
17. **Promotion is append-only.**
18. **Promotion requires exact revision identity** — no logical-thread promotion; only revision promotion.
19. **Export preserves complete promotion history.**
20. **Deletion removes promotion history** (founder-account deletion; zero orphans).
21. **No model authority.** The model cannot decide promotion.
22. **Constitutional supremacy.** Promotion convenience yields to founder sovereignty, withheld verdict, named unknowns,
    bounded claims, visible work, ungamed departure.

## Domain model — PromotionEvent (append-only)

`PromotionEvent { id, founderId, target (BUSINESS_UNDERSTANDING | FOUNDER_STRATEGIC_CONTEXT), logicalLearningId,
learningRevisionId, revisionNumber, promotionAction (PROMOTE | REPLACE | REMOVE), rationale, scope, idempotencyKey,
createdAt }`. Immutable; never updated or individually deleted (only account deletion removes). A `REPLACE` pins a new
revision of the same thread for the same target; a `REMOVE` withdraws the thread from the target. The learning thread and
existing BU/FSC content are untouched.

## Effective-state rule (deterministic; no model)

The **effective promoted set** for `(founder, target)` is derived only from PromotionEvents: for each
`(logicalLearningId)`, take the **latest** event by `createdAt`; if its action is `PROMOTE`/`REPLACE`, the pinned
`learningRevisionId` is promoted; if `REMOVE`, it is not. **Latest event wins — never the latest learning revision**
(Laws 5, 6, 12). No LLM, no similarity, no timestamp-of-learning inference.

## Boundary (this slice)

Implements only the explicit promotion ledger + its derived effective set + founder UI/API. It does **not** add Strategic
Execution, recommendation regeneration, automatic adaptation, agents, autonomous behavior, memory, knowledge graphs,
relationship graphs, semantic retrieval, or any consumption of the promoted set by reasoning. It does **not** mutate the
learning thread, the existing `business.understanding`, or `business.founder_strategic_context_item`. A future,
separately-gated slice may consume the promoted set.

## Model role
**None.** Every promotion/replacement/removal is a founder act, validated deterministically.

## Acceptance criteria (summary)

Explicit founder promotion only; no automatic promotion from lifecycle/confidence/state; each promotion references the
**exact** revision; a later refine/contest/supersede/retire changes the promoted revision **not at all**; replace and
remove work and are explicit; BU/FSC promoted set is empty until an explicit promote; BU-independent-from-FSC; append-only
(UPDATE + individual DELETE rejected); idempotency; no-fork/concurrency safe; cross-founder isolation; export full
promotion history; account deletion zero orphans; existing BU/FSC/learning/decision/commitment/plan/review unchanged; no
recommendation regenerated; the model has no authority; frozen engine byte-identical.

---

## Remediation clarification (2026-07-21) — canonical effective composition

The initial slice recorded promotion in a ledger but **no canonical BU/FSC read consumed it** (audit classification B).
This clarification adds the canonical-composition laws. It is documentation only.

**C-1 (authority, not content).** A `PromotionEvent` is not BU or FSC; it is the governance authority by which an exact
immutable learning revision enters the **effective** BU/FSC projection.

**C-2 (canonical effective state exists now).** *Effective Business Understanding* = deterministic composition of native
BU + effective BU promotions resolved to exact pinned revisions. *Effective Founder Strategic Context* = native effective
FSC + effective FSC promotions resolved to exact pinned revisions. The composer (`composeEffectiveBusinessUnderstanding` /
`composeEffectiveFounderStrategicContext`) is canonical, reusable, and authoritative. Any "Promoted into BU/FSC" list is
generated from it, not from a separate answer. Ledger views remain **for audit only**.

**C-3 (one canonical answer).** The system maintains exactly one authoritative answer to "what is the founder's current
effective BU / current effective FSC?" — the composer. No route may call a bare ledger list "Business Understanding."

**C-4 (provenance preserved).** Each effective item carries `sourceType` (`NATIVE_BUSINESS_UNDERSTANDING` /
`NATIVE_FOUNDER_STRATEGIC_CONTEXT` / `PROMOTED_LEARNING`). Promoted items also expose `promotionEventId`, `target`,
`logicalLearningId`, `learningRevisionId`, `learningRevisionNumber`, `rationale`, `scope`, the pinned revision's epistemic
status + original source lineage, and (separately labelled) the thread lifecycle status at read time. Never flatten a
promoted learning into an indistinguishable native record.

**C-5 (no historical mutation).** Composition writes nothing: no insert into `business.understanding`/FSC history, no
native-version rewrite, no learning mutation, no recommendation regeneration, no session creation, no Decision/Commitment/
Plan/Review edit. GET-only.

**C-6 (exact pinning).** The composed promoted item references the exact pinned revision. Later REFINE/CONTEST/SUPERSEDE/
RETIRE change it not at all; only explicit REPLACE/REMOVE do.

**C-7 (reasoning separation is explicit + deferred).** `assembleStrategicContext` (reasoning input) intentionally reads
**native context only**. Consuming the promoted set in reasoning is the **Strategic Learning Consumption Gate** — a named,
future, separately-governed slice. This remediation adds canonical *reads* now; it activates **no** reasoning adaptation.

**C-8 (deterministic lineage; V080).** Effective promotion state derives from an explicit `promotion_sequence` +
`predecessor_promotion_event_id` chain per (founder, target, logical thread) — **never `created_at` alone.** Chosen
PROMOTE-after-REMOVE rule (**simpler alternative**): one contiguous chain; first event is PROMOTE at sequence 1 with null
predecessor; REPLACE/REMOVE and any re-PROMOTE-after-REMOVE append the next sequence pointing to the exact current
effective event. Effective = highest-sequence event; promoted iff its action ∈ {PROMOTE, REPLACE}. Guarantees: contiguous
sequence, exact predecessor, no fork, stale predecessor rejected, concurrent transitions cannot both win, idempotent retry
returns the same event.

**C-9 (revised acceptance).** Accept only when PROMOTE changes canonical effective BU/FSC; a later learning revision leaves
it pinned; REPLACE changes it to the new exact revision; REMOVE removes it — with native history unchanged and no
recommendation regenerated.
