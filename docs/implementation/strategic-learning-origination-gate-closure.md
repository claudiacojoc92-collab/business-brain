# Strategic Learning Origination Gate — slice closure record

Closes SOR-1 (ADR-016). Adds a second, EXPLICIT, GATED path by which a Strategic Learning may originate — from a Strategic
Outcome Review — without replacing either Review type, without a generic source, and without any automatic learning or
promotion. Governance committed **before** implementation (`a16fab1`).

## Two commits
- **Commit 1 — governance `a16fab1`** (docs only): ADR-017 + contract (Laws 1–12) + architecture + audit.
- **Commit 2 — implementation + closure** (this record).

## The gate
`Strategic Outcome Review → Learning Candidate (a PROPOSAL — creates nothing) → explicit founder judgment (ACCEPT/DISMISS)
→ Strategic Learning (origin=OUTCOME_REVIEW)`. The Strategic **Plan** Review path is unchanged (origin=PLAN_REVIEW). There
is no direct Outcome-Review→Learning route and no generic Review→Learning source.

## What was built
- **V087** — `business.learning_candidate` + `business.learning_candidate_decision` (both append-only, immutable:
  BEFORE-UPDATE forbidden, individual DELETE gated on `bb.allow_learning_candidate_delete`). A candidate freezes the exact
  Outcome Review id + content hash + plan lineage + observed outcome. A decision is `ACCEPT|DISMISS` with
  `resulting_learning_id` (ACCEPT only, CHECK `lcdec_result_shape`); partial UNIQUE `(founder, candidate_id)` → **no-fork**
  (a candidate is decided at most once). `strategic_learning_record` gains `learning_origin` (CHECK enum) +
  `outcome_review_id` + `learning_candidate_id`; `review_record_id` made nullable; CHECK `slr_origin_consistency` ties each
  learning to **exactly one unambiguous origin** (data-audited first).
- **Domain** — `learning-candidate.ts` (proposal + one-time judgment + status derivation + views); `strategic-learning.ts`
  gains `learningOrigin`/`outcomeReviewId`/`learningCandidateId` (the `Omit<…>` return type compiler-forces both builders to
  set them), a new `buildLearningFieldsFromCandidate` (origin=OUTCOME_REVIEW, `reviewRecordId=null`), and
  `assertLearningFromCandidateAdmissible` (same bounded epistemics, candidate lineage for evidence refs).
  `strategic-learning-lifecycle.ts` `buildRevisionFields` copies the origin **verbatim** → carried through refine/contest/
  supersede/retire.
- **Repositories** — `pg-learning-candidate.repository.ts`: `create` (from a SOR; makes no learning), `decide` (ONE
  transaction under an advisory lock: verify no prior decision, on ACCEPT create the learning via
  `learningRepo.createFromCandidateTx` + insert the decision, on DISMISS insert the decision only). `pg-strategic-learning`
  gains `createFromCandidate`/`createFromCandidateTx` + origin columns in `rowValues`/`toDomain`.
- **API** — `POST/GET /strategy/outcome-reviews/:reviewId/learning-candidates`, `GET /strategy/learning-candidates/:id`,
  `POST /strategy/learning-candidates/:id/accept` (creates the learning), `POST …/dismiss` (creates nothing). The Plan
  Review learning route is untouched.
- **UI** — `LearningCandidatesForReview` under each Outcome Review: propose a candidate (a *proposal*), then explicitly
  **Accept** (a bounded learning form) or **Dismiss**; wording makes clear a candidate creates nothing until accepted and
  never promotes. An accepted learning appears in the existing learnings list tagged `origin=OUTCOME_REVIEW`.
- **Export/Delete** — export adds `learningCandidates` + `learningCandidateDecisions` and `origin`/`outcomeReviewId` on the
  learning; account deletion removes candidates + decisions (gated) → zero orphans.

## Acceptance
- **Deterministic** `learning-candidate.test.ts` (**7**): candidate admission; frozen provenance; explicit one-time judgment
  (verdict bounded, judgment required, second decision rejected); status derivation; view (proposal / never-auto-promotes);
  distinct non-generic origins; candidate-origin admissibility (bounded epistemics + own lineage; Plan Review path intact).
- **Live A–J** `learning-candidate.live.test.ts` (**8**): propose → NO learning; ACCEPT → an `OUTCOME_REVIEW` learning +
  decision, NEVER a promotion / BU-FSC change; DISMISS → nothing; decided at most once; DB CHECK rejects a generic origin;
  lifecycle carries origin forward; Plan Review path stays `PLAN_REVIEW`; append-only + isolation + zero-orphan delete.
- **Playwright** `strategic-learning-origination-gate.spec.ts` (genuine UI): report → outcome review → propose a candidate
  (NO learning) → dismiss (NO learning) → propose + **Accept** → exactly one learning, `learning_origin=OUTCOME_REVIEW`
  bound to the review + candidate, `review_record_id` null, **0 promotion events**. Evidence:
  `logate-candidate-proposed.png`, `logate-candidate-accepted.png`.
- **Regression** — full **`backend` project**: **1092 pass / 1 skip / 0 fail** (1077 + 15). Web build green; **73** web
  unit; API + web typechecks clean; migrations through **V087**. All eight required Playwright suites green
  (origination-gate, outcome-review, strategic-learning, execution-boundary, consumption, consumption-gate, promotion,
  lifecycle). Frozen strategist hashes byte-identical (`a39ea88` / `79802e9` / `f9df116`). Zero temp founders, zero orphans,
  servers stopped, nothing pushed.

## Scope discipline
No automatic learning, no automatic promotion, no BU/FSC/Effective-Context change, no Plan/Execution/Decision/Commitment
mutation, no external action, no generic review source. Neither Review type replaced; the Plan Review learning path is
behavior-unchanged. Frozen engine byte-identical. Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **LOG-1** — a model-*suggested* candidate (still requiring explicit founder ACCEPT): out of scope; candidates are
  founder-drafted here. Promotion of `OUTCOME_REVIEW`-origin learnings uses the existing ADR-013 gate unchanged.
