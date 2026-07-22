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

---

## Constitutional completion (2026-07-22) — revisioned candidate, four-way judgment, source freeze, idempotent adoption

The first slice shipped a minimal proposal→ACCEPT/DISMISS gate. A governance-to-implementation audit found the fuller
contract unmet (candidate revisions, epistemic preservation, four-way judgment, source freeze, idempotent adoption). This
remediation (V088, one commit) completes it. No prior commit amended.

**Candidate revision model.** `business.learning_candidate` is now append-only + REVISIONED: `logical_candidate_id` groups
revisions, `revision`/`predecessor_candidate_id` form the chain, and editing appends a new revision (history immutable). A
generated `predecessor_revision = revision - 1` + composite FK `fk_lcand_predecessor_same_chain` make the DATABASE reject a
predecessor from another founder, another source Outcome Review, or a non-adjacent revision; `uniq_lcand_predecessor` +
`uniq_lcand_thread_revision` enforce no-fork. Each revision carries a SHA-256 `content_hash`.

**Frozen epistemic content (preserved end-to-end).** A revision freezes: selected source observations (validated to exist
in the source review), unknown markers, contradiction markers, applicability scope, epistemic status, the founder's own
wording (`founder_statement`, kept distinct from the proposed `candidate_statement`), and the narrative
(prior/revised/change). An ADOPT derives the learning DETERMINISTICALLY from the exact revision, so unknowns →
`unresolved_unknowns`, contradictions → `counter_evidence`, scope → `learning_scope`, epistemic status → `confidence` are
never silently dropped or strengthened; the causal guard forbids an unqualified SUPPORTED causal claim.

**Source freeze.** Each candidate records the exact `outcome_review_id`, `source_outcome_review_revision` (the immutable
SOR record id = revision 1, documented — SOR has no separate revision concept), `source_snapshot_id`, and
`outcome_review_content_hash`. Creation fails closed (`SOURCE_HASH_MISMATCH`) if a supplied `expectedSourceHash` no longer
matches the source review.

**Four-way judgment (append-only).** `learning_candidate_decision.verdict ∈ {ADOPT, REJECT, DEFER, WITHDRAW}` targeting one
EXACT candidate revision. `uniq_lcdec_terminal` allows at most ONE terminal (ADOPT/REJECT/WITHDRAW) per thread; DEFER is
non-terminal (repeatable; the candidate stays eligible). ADOPT → one learning (`resulting_learning_id`, CHECK
`lcdec_result_shape`); REJECT/WITHDRAW/DEFER create nothing. A stale (non-head) revision cannot be adopted
(`STALE_CANDIDATE_REVISION`).

**Idempotent adoption.** `judge` is idempotent on `(founder, idempotency_key)` — an identical retry returns the SAME
decision + learning (one row), and a conflicting second terminal returns `CANDIDATE_ALREADY_DECIDED` (a stable domain
error, not a raw UNIQUE violation).

**Nullable Plan Review invariant (Part 8).** Every consumer of the learning's now-nullable Plan Review reference was
audited: `slr_origin_consistency` CHECK requires PLAN_REVIEW ⇒ review ref present + no outcome/candidate refs, and
OUTCOME_REVIEW ⇒ outcome + candidate refs present + no review ref. `effective-context.ts`, `export.service.ts`,
`strategic-learning-lifecycle.ts` (null-safe lineage set), the web promotion type, and two UI render lines (now
origin-aware — "from a retrospective outcome review") were all updated; no consumer assumes a Plan Review exists.

**Export reconstruction.** The export reconstructs Outcome Review → exact candidate revision lineage (with source ids,
selected observations, unknowns, contradictions, scope, epistemic status, founder wording, content hash) → four-way
judgment log → resulting learning (with origin). Candidate and Strategic Learning are separate keys, never flattened.

**Acceptance.** Deterministic `learning-candidate.test.ts` (**10**); live `learning-candidate.live.test.ts` (**9**) —
revisions + rev-1 immutability; DB rejection of fork/non-adjacent/cross-founder/cross-source predecessors; ADOPT preserves
epistemics; idempotent adoption + conflicting-terminal rejection; stale-revision rejection; REJECT/DEFER/WITHDRAW
semantics; zero promotion/snapshot/session/FSC on ADOPT; origin distinctness; append-only + isolation + source-freeze +
zero-orphan delete. Playwright `strategic-learning-origination-gate.spec.ts` drives the full rendered lifecycle
(propose→edit→defer→adopt→reject) with DB proof of one OUTCOME_REVIEW learning, preserved unknowns/contradictions, and zero
promotion. Backend **1096 pass / 1 skip** (was 1092, +4); web build + **73** unit; typechecks clean; migrations through
**V088**; all eight required Playwright suites green; frozen strategist hashes byte-identical. Zero temp founders / zero
orphans; not pushed.

## Remaining debt
- **LOG-1** — a model-*suggested* candidate (still requiring explicit founder ADOPT) remains out of scope; candidates are
  founder-drafted. Promotion of OUTCOME_REVIEW-origin learnings uses the existing ADR-013 gate unchanged.
