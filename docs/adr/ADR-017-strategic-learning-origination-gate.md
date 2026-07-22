# ADR-017 — Strategic Learning Origination Gate

Status: Accepted (governance) — 2026-07-22. Branch `feature/axe-wave2-understanding`. Opens debt **SOR-1** from ADR-016.
Builds on ADR-016 (Strategic Outcome Review), ADR-011 cat 12 / V075 (Strategic Plan Review), and V076–V078 (Strategic
Learning + lifecycle). Governs **how a Strategic Learning may originate** — and closes the question the Outcome Review
boundary deliberately left open: *may a retrospective become a learning, and if so, how?*

## The question (SOR-1)
The canonical lifecycle is Execution Report → **Review → Strategic Learning** → Promotion. Two Review objects now exist:
- **Strategic Plan Review** (V075) — evaluates Plan coherence; proposes a disposition. It is, and remains, the source of
  **plan-coherence learning** (`POST /strategy/plan-reviews/:reviewId/learnings`).
- **Strategic Outcome Review** (V086) — an immutable retrospective of what happened; produces nothing downstream.

May the Outcome Review also feed learning? **Yes — but only through an explicit gate**, never by replacing either Review,
never generically, never automatically.

## Decision — two DISTINCT, EXPLICIT origination paths (never generic)
1. **Plan-coherence learning (unchanged).** Strategic Plan Review → `POST /strategy/plan-reviews/:reviewId/learnings` →
   Strategic Learning with `learning_origin = 'PLAN_REVIEW'`. Untouched by this slice.
2. **Retrospective learning (new, gated).** Strategic Outcome Review → **Learning Candidate** → **explicit founder
   judgment** → Strategic Learning with `learning_origin = 'OUTCOME_REVIEW'`.

There is **no** generic "Review → Learning" source, **no** implicit fallback, **no** direct Outcome-Review→Learning route.
Every Strategic Learning records its exact origin (which review type + which review id).

## The Learning Candidate
A **Learning Candidate** is an immutable, append-only *proposal* that a retrospective *might* be worth keeping, derived
from one exact Outcome Review. It is **not** a Strategic Learning. Creating a candidate:
- produces **no** Strategic Learning, **no** Promotion, and changes **no** Understanding / Effective Context / Plan /
  Execution / Decision / Commitment;
- freezes the exact Outcome Review id + its content hash + the plan lineage the Outcome Review froze (reproducible
  provenance).

## Explicit founder judgment (the gate)
A candidate becomes a Strategic Learning **only** by an explicit founder **ACCEPT**; the founder may instead **DISMISS**.
- **ACCEPT** — in one atomic act, creates a Strategic Learning (`origin = OUTCOME_REVIEW`, carrying `outcome_review_id` +
  `learning_candidate_id`) and records the decision.
- **DISMISS** — records a dismissal; **no** learning is created.
- **Exactly one decision per candidate** (no-fork). A dismissed candidate stays dismissed; another look is a *new*
  candidate.

## Hard boundaries (fail closed)
- **No automatic learning.** Nothing — no model, no schedule, no side effect — creates a Strategic Learning from an Outcome
  Review without the founder's explicit ACCEPT. Candidate creation itself creates nothing.
- **No automatic promotion.** ACCEPT creates a Strategic Learning only; it **never** promotes into Business Understanding /
  Founder Strategic Context. Promotion remains ADR-013's separate, later, explicit gate — unchanged.
- **No generic source.** A learning's origin is always exactly one of `PLAN_REVIEW` / `OUTCOME_REVIEW`, with the matching
  source id set and the other null (DB CHECK-enforced). No union lookup, no `if (planReview) … else if (outcomeReview)`.
- **Both Review types preserved.** Neither Review is replaced; the Plan Review learning path is byte-for-byte unchanged.

## Downstream sameness
An `OUTCOME_REVIEW`-origin learning is a **normal** Strategic Learning: it lives in the same thread/lifecycle
(refine/contest/supersede/retire) and may — separately and explicitly — be promoted. Its origin (`learning_origin`,
`outcome_review_id`, `learning_candidate_id`) is carried forward **verbatim** through every lifecycle revision.

## Acceptance
Accept only if: a retrospective learning can be created **only** via Outcome Review → Candidate → explicit ACCEPT; the Plan
Review path is unchanged; every learning records an explicit non-generic origin; candidate creation and DISMISS create no
learning; ACCEPT creates a learning but never a promotion; candidate + decision are append-only and reproducible; both
Review types keep their distinct roles; and the lifecycle carries origin forward.
