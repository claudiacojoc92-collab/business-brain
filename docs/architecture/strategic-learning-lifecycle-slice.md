# Strategic Learning Lifecycle — slice architecture

Implements the founder-directed **single-thread lifecycle** for Strategic Learning Records: `CREATE → REFINE / CONTEST /
SUPERSEDE / RETIRE`, each an explicit founder act that **appends a new immutable revision** of one logical thread and
preserves complete history. Recorded before implementation; governed by
[`strategic-learning-lifecycle-contract.md`](../governance/strategic-learning-lifecycle-contract.md),
[ADR-012](../adr/ADR-012-strategic-learning-lifecycle.md), [ADR-011](../adr/ADR-011-knowledge-architecture.md). Extends the
Strategic Learning Record ([slice](strategic-learning-record-slice.md), V076+V077). **Dual-layer decision (ADR-012):**
single-thread lifecycle now; **inter-thread relationships deferred** — no relationship table, contradiction graph,
semantic matching, similarity, clustering, or knowledge graph.

---

## Part 1 — Repository audit (recorded before any code change)

- `business.strategic_learning_record` (V076+V077) already carries `logical_learning_id` + `revision` (both provisioned
  "for shape parity"; every existing row has `logical_learning_id = id`, `revision = 1`), all content fields
  (statement/category/confidence/prior/revised/change/scope/broad-ack/causal/boundary/counter/unknowns/observations/
  evidence), lineage (review/review_revision/plan/commitment/decision/session/manifest), and authorship. Append-only via
  the `slr_no_update` BEFORE-UPDATE trigger. Indexes: pkey, `uniq_slr_founder_idempotency`, `idx_slr_founder`,
  `idx_slr_review`.
- **Missing for lifecycle:** `lifecycle_action`, `root_learning_id`, `predecessor_learning_id`, `lifecycle_reason`,
  `replacement_summary`, `retained_validity`, `counterevidence_resolution`, `unknowns_resolution`; a per-thread revision
  uniqueness constraint; a no-fork constraint; a DELETE guard.
- **No existing structure implements a learning lifecycle.** The Decision/Commitment/Plan records already use
  `(logical_id, revision)` + supersede semantics — the discipline to mirror. There is **no** relationship/edge table for
  learnings and none is added.
- **Confirmed inert:** BU written only by `pg-understanding.repository.save`; FSC only by explicit FSC create/revise/
  retire; no strategy path mutates them; legacy `memory.*` / dead `founder.belief_chains` untouched (KA-2).

---

## Part 2 — Schema (forward migration **V078**; V076/V077 unedited)

`ALTER TABLE business.strategic_learning_record` add (the DDL runs after dropping, then recreating, the append-only
trigger so existing rows can be backfilled once):

- `lifecycle_action TEXT NOT NULL DEFAULT 'CREATE'` — closed enum `CREATE|REFINE|CONTEST|SUPERSEDE|RETIRE`.
- `root_learning_id TEXT` — the CREATE revision's id (stable); backfilled to `id`, then set NOT NULL.
- `predecessor_learning_id TEXT` — the exact immediate predecessor revision id; NULL for CREATE.
- `lifecycle_reason TEXT` — founder rationale for the transition (NULL for CREATE).
- `replacement_summary TEXT`, `retained_validity TEXT` — SUPERSEDE payload.
- `counterevidence_resolution TEXT`, `unknowns_resolution TEXT` — explanations when prior counterevidence/unknowns are
  dropped (Laws 14/15).

**Backfill (once, inside V078):** existing rows → `lifecycle_action='CREATE'`, `root_learning_id=id`,
`predecessor_learning_id=NULL`. Content, ownership, lineage, evidence, epistemic state, `created_at` unchanged.

**Constraints:**
- `CHECK (revision > 0)`; `CHECK (lifecycle_action IN ('CREATE','REFINE','CONTEST','SUPERSEDE','RETIRE'))`.
- `CHECK ((lifecycle_action='CREATE' AND revision=1 AND predecessor_learning_id IS NULL) OR (lifecycle_action<>'CREATE'
  AND revision>1 AND predecessor_learning_id IS NOT NULL))`.
- `UNIQUE (founder_id, logical_learning_id, revision)` — contiguous, non-duplicated revisions.
- **No-fork:** `UNIQUE (founder_id, predecessor_learning_id)` (partial, where predecessor not null) — each predecessor is
  consumed by **at most one** successor; two concurrent transitions on the same effective revision → the second violates
  the unique index → conflict.
- **Immutability:** the existing `slr_no_update` BEFORE-UPDATE trigger is retained (recreated post-backfill).
- **Individual DELETE rejected (Law 2 / criterion 104):** a new `slr_no_delete` BEFORE-DELETE trigger raises unless the
  transaction sets `SET LOCAL bb.allow_learning_delete = 'on'`. **Only account deletion** sets it (Law 26) — so bulk
  founder deletion works, while any individual/app delete is rejected.

Predecessor same-founder + same-thread + effective-current checks are enforced deterministically in the repository within
a `SELECT … FOR UPDATE` transaction (a row trigger cannot see other rows cheaply).

---

## Part 3 — Domain (`strategic-learning-lifecycle.ts`)

- `LearningLifecycleAction = CREATE|REFINE|CONTEST|SUPERSEDE|RETIRE`; `LearningLifecycleStatus =
  ACTIVE|CONTESTED|SUPERSEDED|RETIRED` (distinct type from epistemic `LearningConfidence` — Law 11).
- `deriveLifecycleStatus(action)`: CREATE/REFINE/SUPERSEDE→ACTIVE, CONTEST→CONTESTED, RETIRE→RETIRED.
- `getEffectiveRevision(revisions)`: the max-revision row of a contiguous chain (deterministic; no timestamps/LLM).
- `assertContiguousChain(revisions)`: revisions 1..N, each predecessor = the prior id, one root.
- `validateLifecycleTransition(action, currentEffective, input)`: exact-current-revision + expected-revision match;
  RETIRED is terminal (any further action → conflict/terminal error); per-action required fields; REFINE no-op rejection;
  scope-broadening acknowledgement; causal guard; evidence/observation validity; counterevidence/unknowns-drop
  explanations. **No model, no similarity.**
- Reuses the existing SLR admission helpers (scope set, broad-scope set, causal guard, evidence-in-lineage, observation
  source) so REFINE/SUPERSEDE inherit the same content guards.

---

## Part 4 — Repository (`pg-strategic-learning.repository.ts`, extended)

Append-only, transactional, no-fork:
- `appendRevision(founderId, logicalLearningId, action, expectedRevision, input, now)`: in one transaction — lock the
  thread's current effective revision (`FOR UPDATE`), assert ownership + that `expectedRevision` = current + not RETIRED,
  validate the transition, insert `revision = current+1`, `predecessor_learning_id = currentId`, `root_learning_id =
  root`, `logical_learning_id` copied. Idempotent on `(founder, idempotency_key)`. The no-fork unique index turns a
  concurrent double-append into a caught conflict.
- `getThread(founderId, logicalLearningId)` → ordered revisions + derived effective + status. `listThreads(founderId)` →
  effective revision per thread. `getRevision(founderId, revisionId)`.

## Part 5 — API (`strategy.routes.ts`, extended)
`POST /strategy/learnings/:learningId/{refine|contest|supersede|retire}` (each: `sourceRevisionId`, `expectedRevision`,
`idempotencyKey`, founder confirmation, action payload → 201 new revision or 409 conflict / 400 rejection).
`GET /strategy/learning-threads`, `GET /strategy/learning-threads/:logicalLearningId`, `GET /strategy/learnings/:id`. No
PATCH. Responses carry the created revision + lineage + `doesNotModify{BusinessUnderstanding,FounderStrategicContext,
Review,Plan,Commitment,Decision}` / `creates{Recommendation,Execution,Relationship}: false`.

## Part 6 — UI (`StrategyPage.tsx`, extended)
Each thread renders effective revision + lifecycle status + epistemic status + revision count + source review + scope +
boundary/counterevidence/unknowns; a **revision history** (every revision, never collapsed/hidden, never labelled
"wrong"); and — for ACTIVE/CONTESTED threads — Refine / Contest / Supersede / Retire forms with the governed copy. RETIRED
threads show history but no action buttons. Every form states it does not modify BU/FSC/review/plan/commitment/decision.
No "wrong/failed/stale/invalid/progress/complete/fix/promote/contradiction detected" vocabulary.

## Part 7 — Export / delete
Export emits each thread's full ordered revision history (lifecycle action + derived status + predecessor/root + all
content + lineage + reasons + replacement/retained-validity/resolutions). Account deletion (already deletes the table)
gains `SET LOCAL bb.allow_learning_delete='on'` so the new DELETE guard permits the bulk founder delete; zero orphans.

## Migration & versions
- **V078** lifecycle metadata + constraints + `slr_no_delete` guard (V076/V077 unedited). Latest after V077.
- Schema stays `strategic-learning-1` (additive). Prior CREATE records readable and unchanged.

## Deferred (own future gate)
Inter-thread relationship layer (`CONTRADICTS`/`QUALIFIES`/`SUPPORTS`/`DEPENDS_ON`), contradiction detection, semantic
similarity/clustering, REACTIVATE, Strategic Learning Promotion into BU/FSC (Law 14), model-suggested lifecycle actions,
execution/tasks, generic Strategic Memory, `memory.*` reconciliation.
