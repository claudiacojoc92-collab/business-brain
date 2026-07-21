# Strategic Outcome Review Boundary — architecture (pre-implementation)

Implements ADR-016 + its contract. A single new append-only immutable object, the **Strategic Outcome Review**, closes the
constitutional boundary between Execution Report and Strategic Learning. Governance committed **before** implementation.

## Object
`business.strategic_outcome_review` (V086) — append-only, immutable (BEFORE-UPDATE forbidden; BEFORE-DELETE gated on
`bb.allow_strategic_review_delete`), mirroring ADR-015 execution-report guarantees.

## Domain — `strategic-outcome-review.ts`
- `STRATEGIC_OUTCOME_REVIEW_SCHEMA_VERSION = 'strategic-outcome-review-1'`; `REVIEW_COMPOSITION_TEMPLATE_VERSION` (its
  SHA-256 is the `promptTemplateHash`).
- `ObservedOutcome = 'AS_INTENDED' | 'PARTIALLY_AS_INTENDED' | 'NOT_AS_INTENDED' | 'UNKNOWN'` — **UNKNOWN first-class**; no
  success/failure/score vocabulary.
- `StrategicOutcomeReviewInput` — founder-supplied: `contextSnapshotId` (exact), `founderOutcomeStatement`,
  `observedOutcome`, `unknowns: string[]`, `idempotencyKey`. No disposition, no next-step.
- `composeStrategicOutcomeReview(plan, executionEffective, snapshot, input, now)` — a **deterministic** assembly of the
  frozen payload: `intended` (plan title/intent + milestones intended state), `reported` (effective founder-reported state
  per subject, revision-scoped), `evidence` (bounded unverified refs from the execution chain + snapshot id/hash),
  `observedOutcome` + `founderOutcomeStatement`, `unknowns`. Plus `contentHash` = SHA-256 over a canonical serialization
  (stable key order) — the reproducibility proof. No model, no inference, no scoring.
- Views carry constant truth reminders: `notVerified: true`, `notAScore: true`, `productPerformedNothing: true`, and never
  a "what next".

## Repository — `pg-strategic-outcome-review.repository.ts`
`create` (freeze + hash + insert; idempotent via `(founder, idempotency_key)`), `getById`, `listForRevision(founder,
planId)`, `listByFounder`. Append-only; founder-isolated. No supersession — every Review stands.

## API (`strategy.routes.ts`)
- `POST /strategy/plans/:planId/outcome-reviews` — `:planId` is the **exact Plan revision**. Resolves the exact revision
  (`planRepo.getByRevisionId`), the exact Context Snapshot (`snapshotRepo.getById` — 404 if not owned/found), and the
  revision-scoped effective execution (`executionRepo.getEffectiveForRevision`). Freezes all, composes deterministically,
  stores. No "latest", no regeneration. Stable errors: `PLAN_NOT_FOUND`, `CONTEXT_SNAPSHOT_NOT_FOUND`,
  `REVIEW_OUTCOME_REQUIRED`, `REVIEW_STATEMENT_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`.
- `GET /strategy/plans/:planId/outcome-reviews` — every Review for that exact revision (append-only history).
- `GET /strategy/outcome-reviews/:reviewId` — one Review (founder-owned only).

## UI (`StrategyPage.tsx`)
A **distinct** "Strategic Outcome Review" section per Plan revision, separate from the Execution Report section and from the
existing Plan Review. Shows, read-only after creation: intended / founder-reported / evidence / observed outcome / unknowns
— with **Unknown displayed explicitly**. Create affordance requires an existing Context Snapshot. **Never** displays a
success score, performance score, AI confidence, or founder rating; wording never implies certainty beyond the evidence
("as the founder reported", "not independently verified"). A second Review renders alongside the first; the first is never
altered.

## Export / Delete
Export adds `strategicOutcomeReviews` (full frozen payload + hash). Account deletion removes them under
`bb.allow_strategic_review_delete` (delete before plan/snapshot/execution rows for cleanliness) → zero orphans.

## Non-negotiable boundaries
No Learning creation, no Promotion, no BU/FSC/Effective-Context change, no Recommendation regeneration, no Plan/Execution/
Decision/Commitment mutation, no external call, no founder action, no verification, no scoring/coaching. Frozen strategist
engine byte-identical. Not deployed, not pushed.

## Deferred (debt)
SOR-1: reconcile which review Strategic Learning attaches to (Plan Review vs Outcome Review). Product-performed execution,
outcome attribution/causation, and any judgment/scoring surface remain permanently out of scope.
