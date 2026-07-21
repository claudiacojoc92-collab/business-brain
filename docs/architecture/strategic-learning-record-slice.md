# Strategic Learning Record — slice architecture

Implements the founder-explicit **Strategic Learning Record (SLR)**, ADR-011 category 14 (Strategic Memory precursor —
*durable learning*, not generic memory). The **initial immutable creation slice** (CREATE-only) that lets a founder
**create/keep** a durable strategic understanding from a review, append-only, with the full lineage preserved and **no**
mutation of Review/Plan/Commitment/Decision/Recommendation/BU/FSC. Recorded before implementation; governed by
[`strategic-learning-record-contract.md`](../governance/strategic-learning-record-contract.md). Enriched + corrected by
the 2026-07-21 remediation — see [`strategic-learning-record-remediation.md`](strategic-learning-record-remediation.md).
(Creation from a review is **not** "promotion"; promotion into BU/FSC is a separate future gate — Law 14.)

---

## Part 1 — Repository audit (recorded before any code change)

**No existing structure stores durable strategic learning, and nothing creates it automatically.** Every learning/insight/belief-like
term:

| Term / structure | What it is | Durable learning? |
|---|---|---|
| `reflection.ts` + magic-moment services | Wave-2 OBSERVED/INFERRED **evidence rendering** (the ~30s "reflect the website back") | **No** — a rendered reflection of evidence, not a kept understanding |
| `@bb/business-model-engine` `Insight` | the **frozen engine's** business-model output type | **No** — model output inside the frozen engine; not founder learning |
| Review `reviewConclusion` / `selectedDisposition` | the founder's descriptive conclusion + intended next step on a plan | **No** — a review assessment; a learning may be *created/kept from* it, explicitly |
| `founder.belief_chains` (`founder_id`, `version_number`, `beliefs`, `is_current`) | **legacy M2/ADR-010-era** table; **zero code references** in `apps/api/src` or `apps/web/src` | **No** — dead legacy schema, unused; untouched (naming-collision noted → new capability is `StrategicLearningRecord`) |
| legacy `memory.*` (recommendations/threads/…) | M2/ADR-010 primitive | **No** — KA-2, untouched |

**Confirmed:** Review records observations/assessments; Learning records durable strategic understanding — different
objects. **Neither Business Understanding nor Founder Strategic Context is automatically mutated today** — BU is written
only by `pg-understanding.repository.save` (explicit understanding generation/response), FSC only by the FSC repo's
explicit founder `create`/`revise`/`retire`. No strategy/review path mutates them. There is no `learning`/`insight`
table.

**Conventions to mirror** (identical to the chain): ULID `generateId()`; append-only immutable rows + a **BEFORE-UPDATE
trigger forbidding UPDATE**; idempotent create via unique `(founder, idempotency_key)`; `db.transaction`; deletion
explicit per-table in `delete.service.ts`; export founder-safe sections; the plan-review repo's `getById(founderId,
reviewId)` resolves the exact review a learning is kept from.

---

## Part 2 — Domain model (schema `strategic-learning-1`) — intentionally small

One **append-only** table, `business.strategic_learning_record`. A learning is a **standalone immutable record** (a
correction is another append-only learning; `logical_learning_id` + `revision` kept for shape parity, each create at
revision 1).

- `id` (ULID) · `founder_id` · `logical_learning_id` · `revision` · `schema_version`
- **Lineage (SYSTEM_DERIVED, Law 11):** `review_record_id` (the **exact** review kept from), `review_revision`,
  `plan_record_id`, `commitment_record_id`, `decision_record_id`, `recommendation_session_id`, `provenance_manifest_version`
  (all inherited from the review)
- **Founder-authored:** `learning_statement`, `learning_category`, `confidence`
- **Authorship:** `founder_authored` (bool, true), `model_suggested` (bool, false this slice), `accepted_by_founder` (bool, true)
- `idempotency_key` · `created_at`

No `lifecycle`/status — a learning is descriptive and **never mutated** (append-only + trigger).

### Learning category
`MARKET | CUSTOMER | POSITIONING | OFFER | EXECUTION | DECISION_PROCESS | RESOURCE | RISK | ASSUMPTION | STRATEGY | OTHER`.

### Confidence (Law 9 — bounded, never truth-inflating)
`PROVISIONAL | SUPPORTED | CONTESTED | INSUFFICIENT_INFORMATION` (post-remediation; `ESTABLISHED/TENTATIVE/CONDITIONAL`
retired via V077). A causal hypothesis supported only by founder-reported material cannot be `SUPPORTED`.

### Enriched object (remediation, V077)
Beyond statement/category/confidence, the record separates **prior_understanding** / **revised_understanding** /
**change_statement**; carries **learning_scope** + **broad_scope_acknowledged** (broad scopes require it),
**is_causal_hypothesis**, and JSONB **boundary_conditions** / **counter_evidence** / **unresolved_unknowns** /
**observations** (source-classified) / **evidence_references** (restricted to the review's lineage). Added by the
forward migration **V077** (V076 unedited). Still no `lifecycle`/status column; still append-only.

---

## Part 3 — Admission gate (deterministic; no model)
All must hold: (1) explicit founder POST ("Record a learning"); (2) the `:reviewId` resolves to a review **owned** by
the founder (exact review + its revision); (3) `learning_statement` non-empty; (4) `confidence` selected + valid; (5)
`learning_category` selected + valid; (6) idempotency key present. **No automatic creation.** Creating a learning writes
**only** the learning record — **no** BU/FSC/Review/Plan/Commitment/Decision/Recommendation mutation.

## Part 4 — API (bounded)
`POST /strategy/plan-reviews/:reviewId/learnings` (create, gated, idempotent) · `GET /strategy/learnings` (all, newest
first) · `GET /strategy/learnings/:logicalLearningId` (one record + its lineage). No PATCH/UPDATE. Cross-founder → 404.

## Part 5 — UI
A **separate** "Record a learning from this review" action on a recorded review (distinct from the review act). States: "This creates a
durable strategic learning.", "It does not modify Business Understanding.", "It does not modify Founder Strategic
Context." The founder writes the learning statement, selects a category and a confidence (never "absolute"), and confirms.
Neutral language; no productivity/streak/celebration. The review is unchanged after the learning is kept. A page-level "Your durable strategic learnings" list loads persisted learnings so a kept learning survives a refresh, each showing its source review.

## Part 6 — Export / delete
Export adds `strategicLearnings` (all learnings + review/plan/commitment/decision/session/manifest lineage + statement +
category + confidence + authorship). Account deletion removes `business.strategic_learning_record`; zero orphans.

## Migration & versions
- **V076** `business.strategic_learning_record` (+ append-only trigger).
- **V077** forward ALTER — enrichment columns + confidence-vocabulary migration (V076 unedited). Latest after V076.
- Learning schema `strategic-learning-1` (independent). All prior schemas/prompt versions unchanged. Prior records
  untouched and readable.

## Deferred debt
- **SLR-1** governed **promotion into Business Understanding** (Law 14) — a separate future gate.
- **SLR-2** governed **promotion into Founder Strategic Context** (Law 14) — a separate future gate.
- **SLR-3** revision-based learning corrections; **SLR-4** model-assisted learning proposals (MODEL_PROPOSED + validation).
- Strategic **Execution Record** remains future-only; Strategic **Memory** remains conceptual; **PI-1** / **KA-2**
  (incl. the dead `founder.belief_chains`) unchanged.
