# Strategic Outcome Review Boundary — slice closure record

Closes the constitutional boundary between an **Execution Report** and **Strategic Learning** (ADR-016). Introduces one
new append-only immutable object — the **Strategic Outcome Review** — that lays intended action + founder-reported
execution + available evidence + observed outcome side by side and produces **only an immutable historical assessment**.
Nothing downstream changes automatically. Governance committed **before** implementation (`d93a306`).

## Core question — answered YES
Business Brain can now faithfully **describe what happened** without rewriting history, updating Business Understanding,
generating Strategic Learning, changing Recommendations, changing Effective Context, or changing future Plans — because the
Strategic Outcome Review is deterministic, immutable, reproducible, and writes to nothing else.

## Two commits
- **Commit 1 — governance `d93a306`** (docs only): ADR-016 + contract (Laws 1–13) + architecture + pre-implementation audit.
- **Commit 2 — implementation + closure** (this record).

## What was built
- **V086** `business.strategic_outcome_review` — append-only, immutable (BEFORE-UPDATE forbidden; BEFORE-DELETE gated on
  `bb.allow_strategic_review_delete`). Each row freezes: exact Plan revision (+ lineage), exact Context Snapshot id + hash,
  the deterministic `assessment` payload (intended / reported / evidence / observed / unknowns), the observed outcome,
  the founder statement, the unknowns, the method provenance (`assessment_method` = DETERMINISTIC_COMPOSITION,
  `prompt_template_hash`, `model_configuration = {}`), the `review_schema_version`, and a SHA-256 `content_hash`. CHECK
  `sor_deterministic_no_model` enforces the model-free method; `uniq_sor_revision_sequence` orders reviews per revision.
- **Domain** [`strategic-outcome-review.ts`](../../apps/api/src/business-model/strategic-outcome-review.ts): the
  `ObservedOutcome` enum with **UNKNOWN first-class**; `composeOutcomeReviewAssessment` (deterministic, sorted, no model);
  `canonicalReviewSerialize` + `computeReviewContentHash` (SHA-256 → reproducible forever); `assertOutcomeReviewAdmissible`
  (no next-step accepted); `toOutcomeReviewView` (constant `notVerified`/`notAScore`/`describesNotDecides`; **no score, no
  disposition, no next-step** field).
- **Repository** [`pg-strategic-outcome-review.repository.ts`](../../apps/api/src/business-model/pg-strategic-outcome-review.repository.ts):
  `create` (freeze + hash + insert under a per-(founder, plan revision) advisory lock; idempotent), `getById`,
  `listForRevision`, `listByFounder`. Append-only, founder-isolated.
- **API** (`strategy.routes.ts`): `POST /strategy/plans/:planId/outcome-reviews` (exact revision + exact snapshot;
  execution frozen at review time; **no "latest"**), `GET .../outcome-reviews`, `GET /strategy/outcome-reviews/:reviewId`.
  Stable errors PLAN_NOT_FOUND / CONTEXT_SNAPSHOT_NOT_FOUND / REVIEW_OUTCOME_REQUIRED / REVIEW_STATEMENT_REQUIRED /
  IDEMPOTENCY_KEY_REQUIRED.
- **UI** (`StrategyPage.tsx` `OutcomeReviewPanel`): a **distinct** "Strategic outcome review" section per Plan revision
  (separate from the Execution Report section and from the mid-flight Plan Review). Shows intended / reported / evidence /
  observed outcome / unknowns read-only; **Unknown displayed explicitly**; wording is founder-reported and unverified; a
  self-contained "Create context snapshot" affordance; **no success/performance/AI/rating score**. A second review renders
  alongside the first; the first never changes.
- **Export / Delete**: export adds `strategicOutcomeReviews` (full frozen payload + hash + reproducibility provenance);
  account deletion removes them under `bb.allow_strategic_review_delete` → zero orphans.

## Acceptance
- **Deterministic** `strategic-outcome-review.test.ts` (**8**): admission gate; UNKNOWN first-class; deterministic
  composition (sorted, order-independent); reproducible hash; integrity (different outcome/statement → different hash);
  UNKNOWN/empty survive; model-free method provenance; the view carries no score / next-step / disposition.
- **Live A–H** `strategic-outcome-review.live.test.ts` (**8**): freeze + reproducible hash; immutable (UPDATE + individual
  DELETE rejected); changes NOTHING (plan/execution/decision/commitment unchanged; no learning/promotion/session/snapshot
  created); later evidence → a NEW review while the earlier is byte-identical (no hindsight); UNKNOWN survives; idempotency
  + isolation; zero-orphan governed deletion; frozen assessment == fresh recomposition.
- **Playwright** `strategic-outcome-review.spec.ts` (genuine UI): create Plan (seeded) → report execution → create snapshot
  → record review #1 (visible, describes, no score, Unknown shown) → the review edits no Plan, edits no Execution report,
  creates no Learning → a second review (UNKNOWN) is a new record and leaves review #1 byte-identical (content hash
  unchanged) → deterministic/model-free provenance in the DB. Evidence: `outcome-review-1.png`, `outcome-review-2.png`.
- **Regression** — full **`backend` project** (repo root): **1073 pass / 1 skip / 0 fail** (1057 + 16). Web build green;
  **73** web unit; API + web typechecks clean; migrations through **V086**. Playwright regressions green: Strategic
  Execution Boundary, Consumption Gate, Consumption, Promotion Gate, Strategic Learning lifecycle. Frozen strategist hashes
  byte-identical (`a39ea88` / `79802e9` / `f9df116`). Zero temp founders, zero orphans, servers stopped, nothing pushed.

## Known pre-existing (not this slice)
`strategic-learning.spec.ts` (the SLR create-from-review end-to-end) fails in this dev environment **independently of this
slice** — it fails identically with the ADR-016 web changes stashed (a schema-drift issue in that spec's seeded session,
unrelated to the Review boundary). Not introduced here; recorded for follow-up.

## Scope discipline
No Learning creation, no Promotion, no BU/FSC/Effective-Context change, no Recommendation regeneration, no Plan/Execution/
Decision/Commitment mutation, no external call, no founder action, no verification, no scoring/coaching, no "what next".
The pre-existing Strategic Plan Review is untouched. Frozen engine byte-identical. Not deployed, not pushed, no prior commit
amended.

## Remaining debt
- **SOR-1** — reconcile whether Strategic Learning should attach to the Strategic Outcome Review vs the Strategic Plan
  Review (no wiring changed here). Product-performed execution, outcome attribution/causation, and any judgment/scoring
  surface remain permanently out of scope.
