# Strategic Learning Origination Gate — architecture (pre-implementation)

Implements ADR-017 + its contract. Adds the gated retrospective-learning path without touching the Plan Review path.
Governance committed **before** implementation.

## New objects (V087)
- `business.learning_candidate` — append-only, immutable (BEFORE-UPDATE forbidden; BEFORE-DELETE gated on
  `bb.allow_learning_candidate_delete`). A proposal derived from one exact Outcome Review; freezes `outcome_review_id` +
  `outcome_review_content_hash` + plan lineage (`plan_record_id`, `plan_logical_id`, `plan_revision`,
  `commitment_record_id`) + `source_observed_outcome` + the founder's `candidate_statement` / `candidate_rationale`.
- `business.learning_candidate_decision` — append-only, immutable (same guards, gated on
  `bb.allow_learning_candidate_delete`). One decision per candidate: `verdict ∈ {ACCEPT, DISMISS}`, `founder_judgment`,
  `resulting_learning_id` (set on ACCEPT). Partial UNIQUE `(founder_id, candidate_id)` → no-fork (a candidate is decided at
  most once).
- ALTER `business.strategic_learning_record`: `review_record_id` made nullable; add `learning_origin TEXT NOT NULL DEFAULT
  'PLAN_REVIEW'` (CHECK enum) + `outcome_review_id TEXT` + `learning_candidate_id TEXT`; add CHECK
  `sor_origin_consistency`: `(origin='PLAN_REVIEW' AND outcome_review_id IS NULL AND learning_candidate_id IS NULL) OR
  (origin='OUTCOME_REVIEW' AND outcome_review_id IS NOT NULL AND learning_candidate_id IS NOT NULL)`. Existing rows default
  to PLAN_REVIEW and satisfy it (data-audited first).

## Domain
- `learning-candidate.ts` — `LearningCandidate` + `LearningCandidateInput`; `buildCandidateFromOutcomeReview(outcomeReview,
  input)` (derive lineage + freeze hash + `source_observed_outcome`); `LearningCandidateDecision` + verdict; admission
  gates; `deriveCandidateStatus` (PROPOSED if no decision, else the verdict); views.
- `strategic-learning.ts` — `StrategicLearningRecord` gains `learningOrigin` / `outcomeReviewId` / `learningCandidateId`;
  `reviewRecordId` becomes `string | null`. `buildLearningFields` (Plan Review path) sets `PLAN_REVIEW` / null / null (the
  `Omit<…>` return type compiler-forces this). New `buildLearningFieldsFromCandidate(candidate, input)` sets `OUTCOME_REVIEW`
  + ids, `reviewRecordId=null`, lineage from the candidate. `toLearningView` surfaces the origin.
- `strategic-learning-lifecycle.ts` — `buildRevisionFields` copies `learningOrigin` / `outcomeReviewId` /
  `learningCandidateId` from the predecessor verbatim (origin carried forward through refine/contest/supersede/retire).

## Repositories
- `pg-learning-candidate.repository.ts` — `create` (from a SOR; idempotent), `getById`, `listForOutcomeReview`,
  `listByFounder`, `getDecision`, and `decide(founderId, candidate, verdict, judgment, learningInput?, now)`: in ONE
  transaction under an advisory lock on the candidate, verify no prior decision (no-fork), on ACCEPT create the learning via
  `learningRepo.createFromCandidateTx(tx, …)` then insert the decision with `resulting_learning_id`; on DISMISS just insert
  the decision.
- `pg-strategic-learning.repository.ts` — `rowValues`/`toDomain` gain the origin columns; add
  `createFromCandidate(founderId, candidate, input, now)` and a tx variant used inside the atomic ACCEPT.

## API (`strategy.routes.ts`)
- `POST /strategy/outcome-reviews/:reviewId/learning-candidates` — create a candidate from an exact owned Outcome Review.
  Creates NO learning. Stable errors OUTCOME_REVIEW_NOT_FOUND / CANDIDATE_STATEMENT_REQUIRED / IDEMPOTENCY_KEY_REQUIRED.
- `GET  /strategy/outcome-reviews/:reviewId/learning-candidates` — list candidates (with effective status) for a SOR.
- `GET  /strategy/learning-candidates/:candidateId` — one candidate + its decision/status.
- `POST /strategy/learning-candidates/:candidateId/accept` — explicit founder judgment → creates a Strategic Learning
  (`origin=OUTCOME_REVIEW`). Body carries the founder's `LearningInput` (bounded epistemics, same validation as the Plan
  Review learning). Rejects a second decision (`CANDIDATE_ALREADY_DECIDED`).
- `POST /strategy/learning-candidates/:candidateId/dismiss` — records DISMISS; creates NO learning.
  The Plan Review learning route (`POST /strategy/plan-reviews/:reviewId/learnings`) is unchanged.

## UI (`StrategyPage.tsx`)
In `OutcomeReviewPanel`, per review: a "Propose a learning candidate" affordance; a list of candidates with **explicit
status** (Proposed / Accepted / Dismissed); on a Proposed candidate, **Accept** (opens the bounded learning-judgment form)
or **Dismiss**. On Accept, the learning appears in the existing learnings list tagged **"from a retrospective outcome
review"** (origin visible). No score; nothing auto-promotes; wording makes clear a candidate is a proposal, not a learning.

## Export / Delete
Export adds `learningCandidates` + `learningCandidateDecisions`, and the learning export gains `origin` +
`outcomeReviewId`. Account deletion removes candidates + decisions under `bb.allow_learning_candidate_delete` (before the
learning rows) → zero orphans.

## Non-negotiable boundaries
No automatic learning, no automatic promotion, no BU/FSC/Effective-Context change, no Plan/Execution/Decision/Commitment
mutation, no external action, no generic review source, no replacement of either Review type. Frozen strategist engine
byte-identical. Not deployed, not pushed.

## Deferred (debt)
LOG-1: a model-*suggested* candidate (still requiring explicit founder ACCEPT) — out of scope; candidates are founder-drafted
here. Promotion of OUTCOME_REVIEW-origin learnings uses the existing ADR-013 gate unchanged.
