# Strategic Learning Origination Gate — governance contract

Governs how a Strategic Learning may originate (ADR-017). Two explicit paths, never generic, never automatic. Fail closed:
nothing creates a learning without an explicit founder act; nothing promotes.

## Law 1 — Two explicit origins, never generic
Every Strategic Learning records `learning_origin ∈ {PLAN_REVIEW, OUTCOME_REVIEW}` plus the exact source id(s). There is no
generic "review" source, no implicit fallback, and no union/ambiguous lookup. The DB CHECK-enforces the origin/source
consistency.

## Law 2 — Plan Review path unchanged
Plan-coherence learning is created directly from a Strategic Plan Review (`POST /strategy/plan-reviews/:reviewId/learnings`),
`learning_origin = 'PLAN_REVIEW'`. This slice does not alter that path in behavior.

## Law 3 — Outcome Review path is gated
Retrospective learning can be created ONLY via: Strategic Outcome Review → Learning Candidate → explicit founder ACCEPT.
There is no direct Outcome-Review→Learning route and no generic Review→Learning route.

## Law 4 — A Learning Candidate is a proposal, not a learning
Creating a Learning Candidate from an exact Outcome Review produces NO Strategic Learning, NO Promotion, and changes NO
Understanding / Effective Context / Plan / Execution / Decision / Commitment. It is an append-only, immutable proposal.

## Law 5 — Explicit founder judgment, exactly once
A candidate becomes a learning only by an explicit founder ACCEPT; the founder may DISMISS. Exactly one decision per
candidate (no-fork). A dismissed candidate stays dismissed; another look is a new candidate.

## Law 6 — No automatic learning
Nothing — no model, no schedule, no reaction, no side effect — creates a Strategic Learning from an Outcome Review without
the founder's explicit ACCEPT. Candidate creation and DISMISS create nothing.

## Law 7 — No automatic promotion
ACCEPT creates a Strategic Learning only. It never promotes into Business Understanding or Founder Strategic Context;
promotion remains the separate, later, explicit gate (ADR-013). No candidate action touches BU/FSC/Effective Context.

## Law 8 — Frozen, reproducible provenance
A candidate freezes the exact Outcome Review id + its content hash + the plan lineage the Outcome Review froze. An accepted
learning records `outcome_review_id` + `learning_candidate_id`. The origination is reconstructable forever.

## Law 9 — Immutable + append-only
Learning Candidate and Learning Candidate Decision are append-only: BEFORE-UPDATE forbidden; individual DELETE gated
(founder-account deletion only). Decisions are immutable events.

## Law 10 — Both Review types preserved and distinct
Strategic Plan Review and Strategic Outcome Review keep their roles; neither is replaced. No generic review lookup exists
(per the ADR-016 boundary-closure remediation); a Plan Review id never resolves as an Outcome Review and vice-versa.

## Law 11 — Founder-owned, isolated, exportable, forgettable
Candidates, decisions, and origin-tagged learnings belong to exactly one founder; never cross-founder readable; appear in
the founder export; removed by account deletion (zero orphans). Nothing is ever created automatically on the founder's
behalf.

## Law 12 — Downstream sameness; origin carried forward
An OUTCOME_REVIEW-origin learning is a normal Strategic Learning: same thread/lifecycle (refine/contest/supersede/retire)
and the same separate promotion gate. `learning_origin` / `outcome_review_id` / `learning_candidate_id` are carried forward
verbatim through every lifecycle revision.

---

## Completion laws (2026-07-22, V088) — revisioned candidate + four-way judgment

**Law 13 — Candidate revisions are append-only.** A Learning Candidate is a revisioned thread. Editing appends a new
revision; historical revisions are immutable. A predecessor must be the immediately-preceding revision of the SAME founder
+ logical candidate + source Outcome Review (DB-enforced: no fork, no cross-founder/cross-source/non-adjacent predecessor).
Each revision has a SHA-256 content hash.

**Law 14 — Admission targets one EXACT revision.** ADOPT applies to a specific candidate revision and the resulting
learning retains that exact revision (`learning_candidate_id`). A stale (non-head) revision cannot be adopted.

**Law 15 — Epistemic content is preserved.** A revision freezes the selected source observations (which must exist in the
source review), unknown markers, contradiction markers, applicability scope, epistemic status, and the founder's own
wording (distinct from the proposed learning). ADOPT derives the learning deterministically so these are never silently
dropped or strengthened; no unqualified causation.

**Law 16 — Four-way judgment.** The founder judgment is ADOPT / REJECT / DEFER / WITHDRAW, append-only, targeting an exact
revision. At most one TERMINAL judgment (ADOPT/REJECT/WITHDRAW) per thread; DEFER is non-terminal (the candidate stays
eligible). ADOPT → exactly one learning; the others create nothing.

**Law 17 — Adoption is idempotent.** An identical ADOPT (same idempotency key) returns the same learning (one row); a
conflicting second terminal returns a stable domain error, not a raw constraint violation.

**Law 18 — Source is frozen.** A candidate records the exact Outcome Review id + revision (immutable id = revision 1) +
snapshot id + content hash. Candidate creation fails closed on a source-hash mismatch; later source records never rewrite
an existing candidate.

**Law 19 — Origin consistency is database-enforced.** `slr_origin_consistency` guarantees a PLAN_REVIEW learning has its
plan review reference and no outcome/candidate refs, and an OUTCOME_REVIEW learning has both refs and no plan review
reference. No consumer assumes every learning has a Plan Review.
