# Strategic Learning Origination Gate — pre-implementation audit (2026-07-22)

Confirms the current learning-origination surface before adding the gate, and records that the design fails closed.

## What exists today (audited)
- **Strategic Learning** (`business.strategic_learning_record`, V076–V078): append-only threads; a learning is created ONLY
  from a Strategic **Plan** Review via `POST /strategy/plan-reviews/:reviewId/learnings` → `learningRepo.create(founderId,
  planReview, input, now)` → `buildLearningFields(planReview, input)`. Lineage (`review_record_id`, `plan_record_id`,
  `commitment_record_id`, …) is derived from the plan review; `review_record_id` is currently **NOT NULL**.
- **Strategic Plan Review** (V075) and **Strategic Outcome Review** (V086): distinct objects, fully segregated (ADR-016
  boundary-closure remediation — disjoint tables/repos/routes/id-namespaces, no generic review lookup). The Outcome Review
  currently feeds **nothing** downstream.
- **Promotion** (ADR-013, V079–V080): a separate, explicit gate that promotes an exact learning revision into BU/FSC. Not
  triggered by learning creation.
- **Lifecycle** (`buildRevisionFields`): copies lineage from the predecessor **verbatim** (Law 5) — so any new origin
  columns will be carried forward through refine/contest/supersede/retire automatically once added to the copy.

## Gap
There is no way for a Strategic Outcome Review to become a learning — SOR-1 left this open deliberately (to avoid an
implicit or automatic path). The gate must add a retrospective path that is explicit, founder-judged, non-generic, and
promotes nothing.

## Design decision — a gated candidate, not a second learning route
Rather than a direct Outcome-Review→Learning route (which would create a second, generic-feeling origination and risk
implicit creation), introduce a **Learning Candidate** intermediate:
`Outcome Review → Learning Candidate (proposal) → explicit founder ACCEPT/DISMISS → Strategic Learning (origin=OUTCOME_REVIEW)`.
The Plan Review path stays exactly as-is. The learning gains an explicit `learning_origin` discriminator with a DB CHECK so
no learning can exist without a single, unambiguous origin.

## Risk table (fails closed)
| Risk | Mitigation |
|---|---|
| Implicit/automatic learning from a retrospective | Candidate creation makes nothing; only an explicit ACCEPT creates a learning (Laws 4/6); no model/schedule path |
| Automatic promotion | ACCEPT creates a learning only; promotion is the untouched ADR-013 gate (Law 7); tests assert 0 promotion events |
| Generic review source / implicit fallback | `learning_origin` CHECK ties each learning to exactly one review type + id; separate candidate table keyed on `outcome_review_id`; no union lookup (Laws 1/10) |
| Plan Review path regressed | `buildLearningFields` unchanged in behavior (adds PLAN_REVIEW/null); its route untouched; full plan-review + learning regression re-run |
| Double-decision / fork | partial UNIQUE `(founder, candidate_id)` on decisions + advisory lock (Law 5) |
| Origin lost across lifecycle | `buildRevisionFields` copies origin verbatim (Law 12); test refines an OUTCOME_REVIEW learning and asserts origin preserved |
| Mutable candidate/decision | append-only triggers (BEFORE-UPDATE forbidden; BEFORE-DELETE gated) (Law 9) |

## Verdict
The Learning Candidate gate makes retrospective learning possible **only** through explicit founder judgment, preserves
both Review roles, records a non-generic origin, and promotes nothing. Implementation follows in Commit 2.
