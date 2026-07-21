# Strategic Learning Promotion Gate — slice architecture

Implements the founder-explicit **Promotion Gate**: an append-only ledger of `PromotionEvent`s by which a founder
promotes an **exact learning revision** into **Business Understanding (BU)** or **Founder Strategic Context (FSC)**, with
the effective promoted set **derived from events** (never from the latest learning revision). Recorded before
implementation; governed by [`strategic-learning-promotion-contract.md`](../governance/strategic-learning-promotion-contract.md)
and [ADR-013](../adr/ADR-013-strategic-learning-promotion-gate.md).

---

## Part 1 — Repository audit (recorded before any code change)

- **BU** = `business.understanding` (`id, founder_id, version, supersedes_id, model_version, source_fragment_ids,
  conclusions, created_at`) — **model-generated**, versioned; written **only** by `pg-understanding.repository.save`.
- **FSC** = `business.founder_strategic_context_item` (`logical_item_id, version, kind, statement, category, scope,
  source, status, …`) — **founder-declared**, append-only; written **only** by
  `pg-founder-strategic-context.repository`.
- **No promotion table exists.** The only `promotion` references in `apps/*/src` are the boundary comments that reserved
  this capability (Strategic Learning Record + Lifecycle, Law 14).
- Strategic Learning revisions (`business.strategic_learning_record`, V076–V078) are append-only immutable, keyed by
  `(founder, logical_learning_id, revision)`; each revision has a stable `id`.

**Design consequence (Laws 15, 16):** the Promotion Gate must **not** write to `business.understanding` or
`business.founder_strategic_context_item`, and must not regenerate recommendations or edit any chain record. It is an
additive, separate governance ledger.

---

## Part 2 — Schema (forward migration **V079**)

New table `business.learning_promotion_event` (append-only):

- `id` (ULID) · `founder_id`
- `target TEXT NOT NULL` — enum `BUSINESS_UNDERSTANDING | FOUNDER_STRATEGIC_CONTEXT`
- `logical_learning_id TEXT NOT NULL` · `learning_revision_id TEXT NOT NULL` · `revision_number INTEGER NOT NULL`
  (the **exact** promoted revision — Laws 5, 18)
- `promotion_action TEXT NOT NULL` — enum `PROMOTE | REPLACE | REMOVE`
- `rationale TEXT NOT NULL` (Law 8) · `scope TEXT NOT NULL` (Law 9)
- `idempotency_key TEXT NOT NULL` · `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`

**Constraints:** `CHECK (target IN (...))`; `CHECK (promotion_action IN (...))`; `CHECK (revision_number > 0)`;
`UNIQUE (founder_id, idempotency_key)` (idempotent create); indexes on `(founder_id, target, logical_learning_id,
created_at)` and `(founder_id, learning_revision_id)`. **Append-only:** a BEFORE-UPDATE trigger forbids UPDATE; a
BEFORE-DELETE trigger forbids individual DELETE unless the account-deletion transaction sets
`bb.allow_promotion_delete = 'on'` (mirrors the V078 learning delete guard). No FK cascade; account deletion is the only
destructive path. No mutation of the learning table, BU, or FSC.

---

## Part 3 — Domain (`strategic-learning-promotion.ts`)

- Types: `PromotionTarget`, `PromotionAction`, `PromotionScope`, `PromotionEvent`, `PromotionInput`.
- `assertPromotionAdmissible(revision, existingEffective, input)` — deterministic gate:
  - the referenced learning **revision must exist and be owned** by the founder (exact revision — Law 18);
  - `rationale` required (Law 8); `scope` required + valid (Law 9); idempotency key required;
  - `PROMOTE` requires the thread is **not already promoted** for that target; `REPLACE`/`REMOVE` require it **is**
    currently promoted for that target (else a deterministic rejection). No model, no similarity.
- `deriveEffectivePromotion(events, target)` — for each `logicalLearningId`, the **latest** event wins; PROMOTE/REPLACE →
  promoted (pinned revision), REMOVE → not promoted. Returns the effective promoted revisions (Laws 5, 6, 12).
- `toPromotionView(event)` / `toPromotedItemView(...)` — founder-safe views; carry `doesNotModifyLearning`,
  `doesNotModifyReviewPlanCommitmentDecision`, `regeneratesNothing` reminders.

## Part 4 — Repository (`pg-learning-promotion.repository.ts`)
Append-only, transactional: `record(founderId, action, revision, input, now)` — resolve current effective promotion for
the `(target, thread)` under a lock, assert admissibility, insert the event; idempotent on `(founder, idempotency_key)`.
`listEvents(founderId)`, `listEventsForThread(founderId, logicalLearningId)`, `getEffective(founderId, target)` (derives
via `deriveEffectivePromotion`, then hydrates each pinned revision from the learning repo).

## Part 5 — Effective state
`getPromotedBusinessUnderstanding(founderId)` / `getPromotedFounderStrategicContext(founderId)` = `getEffective(founderId,
target)` — the governed set of promoted learning revisions for that target, derived from events. **Never** the latest
learning revision. These are a *distinct ledger view*, not the model-generated `business.understanding`/FSC content.

## Part 6 — API (founder-owned)
`POST /strategy/learnings/revision/:revisionId/promote` (body: `{ target, scope, rationale, idempotencyKey }`) ·
`POST /strategy/learnings/revision/:revisionId/replace-promotion` · `POST …/remove-promotion` ·
`GET /strategy/promotions/business-understanding` · `GET /strategy/promotions/founder-strategic-context` ·
`GET /strategy/promotions` (full ledger). No PATCH. Responses carry `doesNotModifyLearning: true`,
`doesNotModify{Review,Plan,Commitment,Decision}: true`, `regeneratesRecommendations: false`.

## Part 7 — UI
On each learning **revision** in the thread history: **Promote to Business Understanding** / **Promote to Founder
Strategic Context**; if already promoted for a target: **Replace promoted revision** / **Remove promotion**. Each states:
"This affects Business Understanding." / "This does NOT modify the learning." / "This does NOT modify review, plan,
commitment or decision." A page-level **"Promoted into Business Understanding / Founder Strategic Context"** list shows the
effective promoted revisions (derived), each with its pinned revision, scope, rationale, and source thread.

## Part 8 — Export / delete
Export adds `learningPromotions` (the full append-only event history, ordered). Account deletion removes
`business.learning_promotion_event` (with the delete-guard bypass); zero orphans.

## Migration & versions
- **V079** `business.learning_promotion_event` (+ append-only UPDATE/DELETE guards). Latest after V078.
- No change to `business.understanding`, `business.founder_strategic_context_item`, or the learning table.

## Deferred (own future gate)
Any consumption of the promoted set to regenerate recommendations or adapt reasoning; Strategic Execution; model-assisted
promotion suggestions; memory/knowledge/relationship graphs; semantic retrieval.

---

## Remediation architecture (2026-07-21) — canonical effective composition (classification B)

**Audit (code-traced):** canonical BU read = `assembleStrategicContext` → `understanding.latest()` and `GET /understanding`
→ `understanding.latest()` (native only); canonical FSC read = assembler → `resolveEffectiveStrategicContext(listActive())`
and `GET /founder-strategic-context/effective` (native only). Promotion routes `/strategy/promotions/*` are parallel and
read by nothing canonical. Promoted revisions never entered a canonical read path → **classification B**.

**Added:**
- **V080** `learning_promotion_event` gains `promotion_sequence INT` + `predecessor_promotion_event_id TEXT`; backfilled
  from existing rows by stable `(created_at, id)` key per (founder, target, logical thread); constraints below.
- **Domain composer** (`effective-context.ts`): `deriveEffectivePromotionForThread(events)` (sequence/predecessor chain →
  highest-sequence event; promoted iff PROMOTE/REPLACE), `composeEffectiveBusinessUnderstanding(nativeBU, promotedItems)`,
  `composeEffectiveFounderStrategicContext(nativeFSC, promotedItems)` → `{ target, native, promotedLearningItems[] }` with
  `EffectiveContextItem` provenance. Not aliases for ledger listing.
- **Repository** lineage: `record` computes next sequence + predecessor under the advisory lock; `getEffective` derives
  from sequence, not `created_at`.
- **Canonical routes:** `GET /strategy/effective-business-understanding`, `GET /strategy/effective-founder-strategic-context`
  (native + promoted composition, provenance-carrying, GET-only). Ledger routes remain for audit.
- **UI:** "Current effective Business Understanding / Founder Strategic Context" views built from the composer, with
  native vs promoted-learning badges + exact revision + rationale + scope. Promotion History remains separate.

**Lineage constraints (V080):** `promotion_sequence > 0`; `UNIQUE(founder, target, logical_learning_id, promotion_sequence)`;
partial `UNIQUE(founder, predecessor_promotion_event_id)` (no-fork); `CHECK`: sequence 1 ⇒ predecessor null ∧ action
PROMOTE; sequence > 1 ⇒ predecessor non-null. Rows immutable; individual delete blocked; account-deletion bypass retained.

**Reasoning stays native-only** — the Strategic Learning Consumption Gate is deferred.
