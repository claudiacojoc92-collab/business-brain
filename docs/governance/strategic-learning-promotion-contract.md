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
