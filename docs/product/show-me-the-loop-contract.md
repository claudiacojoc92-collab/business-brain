# Show Me the Loop — product contract

Governs the rendered strategic-thread milestone. A read projection + UI over accepted canonical records. No new canonical
object, no migration, no model call, no automatic transition.

## Product laws
- **L1 — One visible strategic thread.** The founder can see one coherent chain from the original Recommendation to a later
  Recommendation in a single view.
- **L2 — Every canonical action stays explicit.** No automatic Decision / Commitment / Plan / Execution Report / Outcome
  Review / Candidate / Adoption / Promotion / Recommendation. The thread only *offers* the next action; the founder performs
  it through the existing accepted control.
- **L3 — Navigation is not inference.** The UI connects existing records; it never invents a relationship.
- **L4 — Exact lineage.** Where exact provenance exists, the UI navigates the exact Recommendation → Decision → Commitment →
  Plan revision → Execution Report → Outcome Review → Candidate revision → Strategic Learning → Promotion → Context Snapshot
  → later Recommendation.
- **L5 — Missing provenance stays missing.** Legacy/incomplete records show "Source relationship unavailable" (never a
  guess).
- **L6 — Bounded future-recommendation wording.** "This recommendation was generated with a context snapshot that included
  this promoted learning." Never "this learning caused this recommendation."
- **L7 — No architecture required.** No founder-facing dependence on hashes / UUIDs / repositories / snapshots-as-architecture
  / DB constraints / origin enums / revision-predecessor logic. Those live in an expandable secondary detail only.
- **L8 — Filmable.** The journey is demonstrable in one 3–5 minute recording without developer tools.
- **L9 — No new canonical object.** No persisted "loop"/"journey"/"thread"/"workflow" row.
- **L10 — Existing truth only.** The thread view is a deterministic read projection over accepted canonical records.

## Read projection (non-canonical)
`GET /strategy/threads/:rootSessionId` — `PgStrategicThreadProjection` (a read repository; no mutation, no persistence, no
model, founder-isolated, deterministic ordering). Returns, for the root recommendation session, when present:
- `recommendation` (the root session + its recommendation summary + snapshot binding);
- `decision` (the strategic_decision_record whose `recommendation_session_id` = root, effective revision);
- `commitment` (whose `decision_record_id` = the decision, effective revision);
- `plans` (strategic_plan_record revisions whose `commitment_logical_id`/`commitment_record_id` = the commitment) each with:
  - `executionReports` (execution_report rows for that exact `plan_id`, effective per subject);
  - `outcomeReviews` (strategic_outcome_review for that exact `plan_record_id`), each with:
    - `candidates` (learning_candidate threads whose `outcome_review_id` = the review; effective revision + judgment log);
    - `learnings` (strategic_learning_record whose `learning_candidate_id` = a candidate revision) with promotion status;
- `usedInLaterRecommendations` — strategic_session rows (other than the root) whose bound `context_snapshot` lists, in its
  frozen `founder_strategic_context.promotedLearnings`, a learning-revision id belonging to a learning in this thread. This
  is the ONLY later-recommendation link, and it is truthful (actual frozen-snapshot inclusion), never date- or
  correlation-based.
- Every node carries a `provenanceAvailable` flag; where an exact link is absent the node reports it unavailable (L5).

Backward traversal is the same projection read in reverse: a later session → its snapshot's promotedLearnings → the exact
learning → its `learning_candidate_id` → candidate revision → `outcome_review_id` → outcome review → `plan_record_id` → plan
revision → execution reports → the plan's commitment → decision → `recommendation_session_id` → original recommendation.

## Demo story (deterministic, dev-guarded, founder-isolated)
`POST /dev/demo/strategy-loop` (guarded to `NODE_ENV !== 'production'`) seeds ONE coherent business case for a demo founder
(`loop.demo@founder.test`), and `DELETE /dev/demo/strategy-loop` resets it (governed deletes; zero orphans):
- **Recommendation:** focus four weeks on validating one narrow founder segment instead of expanding features.
- **Decision:** validate early-stage service founders first.
- **Commitment:** interview five founders and run three guided product sessions.
- **Plan:** complete interviews + sessions within fourteen days.
- **Execution Report:** five interviews completed; two completed the full session.
- **Outcome Review:** founders valued continuity of reasoning but struggled to see how prior decisions shaped current
  recommendations. **Unknown:** whether the confusion was terminology or overall structure. **Contradiction:** participants
  said it felt valuable, yet two abandoned the full flow.
- **Possible Learning:** founders engage more deeply when prior reasoning stays visible and the next action is obvious.
  **Scope:** early-stage founders using the guided strategic loop.
- **Strategic Learning:** the founder-approved bounded wording (kept via the gate — explicit ADOPT).
- **Promotion:** explicitly promoted into Founder Strategic Context.
- **Later Recommendation:** prioritize a visible strategic thread before expanding model-generated features, reasoned over a
  snapshot that **includes** the promoted learning.

The seed performs each canonical write through the real repositories (no raw invented links); the later recommendation's
snapshot genuinely includes the promoted learning via `captureEffectiveContext` after promotion. No production data; no
hidden default founder; not registered in production.

## No-migration proof (L9/L10, Part 9)
Every relationship the thread navigates already exists as an accepted column or frozen reference — none is derivable-only or
missing:
- decision→session: `strategic_decision_record.recommendation_session_id`.
- commitment→decision: `strategic_commitment_record.decision_record_id`.
- plan→commitment: `strategic_plan_record.commitment_record_id` / `commitment_logical_id`.
- execution→plan: `execution_report.plan_id` (V084 revision-scoped).
- outcome-review→plan + snapshot: `strategic_outcome_review.plan_record_id`, `context_snapshot_id`.
- candidate→outcome-review: `learning_candidate.outcome_review_id`; judgment→candidate: `…decision.candidate_revision_id`,
  `resulting_learning_id`.
- learning→candidate/review: `strategic_learning_record.learning_candidate_id` (OUTCOME_REVIEW) / `review_record_id`
  (PLAN_REVIEW).
- promotion→learning: `learning_promotion_event.learning_revision_id`, `target`.
- later-session→learning: `strategic_session.context_snapshot_id` → `context_snapshot.founder_strategic_context.promotedLearnings[].learningRevisionId`.

The projection is a pure read join over these; adding a thread table would duplicate canonical truth and violate L9/L10.
**Decision: NO migration.** V088 remains the latest migration and is not edited.

## Acceptance criteria → mapping (filled in Commit 2 closure)
The deterministic tests (Part 14), live scenarios (Part 15), and the genuine `show-me-the-loop.spec.ts` (Part 16) must prove:
the complete loop reconstructs deterministically with no persisted loop object and no mutation; exact founder isolation and
lineage ordering; missing provenance stays missing; PLAN_REVIEW vs OUTCOME_REVIEW learning origins stay distinct; later
recommendations link ONLY through actual frozen-snapshot inclusion (date never implies influence); forward actions stay
explicit and return to the thread; backward links are exact; the later-recommendation disclosure is bounded (no causation);
all 18 partial states render with no null labels or fabricated links; the demo seed is deterministic + isolated + reset
leaves zero orphans + is unavailable in production; and no new canonical table / automatic transition / model call / frozen
hash change occurs.
