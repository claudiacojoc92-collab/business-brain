# Strategic Learning Record — slice closure record

Adds the ADR-011 **category 14 precursor**: a founder-governed **Strategic Learning Record** — a durable strategic
understanding the founder *explicitly decides to keep* after a review. It is **not** journaling, notes, memory, or
execution, and it is **not** generic Strategic Memory. *History records events. Learning records durable changes in
understanding. Those are different objects.* Most reviews create **no** learning. Governance + architecture gate
committed *before* implementation (`b3d8f2e`, atop the SPRR line `a083f18`).

## Gate (committed first — `b3d8f2e`)

- **Audit (Part 1):** no existing structure is a durable strategic learning and nothing promotes one automatically.
  `founder.belief_chains` is dead legacy M2 with **zero code references** (not touched); Business Understanding is only
  ever written by `pg-understanding.repository.save`; Founder Strategic Context is only written by explicit
  create/revise/retire; the review/plan/commitment/decision records are append-only and never rewritten; the legacy
  `memory.*` is untouched (KA-2). No learning/execution/task/progress/habit/reminder table exists.
- **Governance contract** — [`strategic-learning-record-contract.md`](../governance/strategic-learning-record-contract.md):
  16 laws (learning is optional; explicit founder acceptance — no automatic promotion; not model authority; never
  rewrites Review/Plan/Commitment/Decision/Recommendation; preserves uncertainty — confidence is ESTABLISHED/TENTATIVE/
  CONDITIONAL, never absolute; append-only; historically linked to the full lineage; does **not** auto-modify Business
  Understanding (Law 12) or Founder Strategic Context (Law 13); promotion into BU/FSC is a future gate (Law 14);
  exportable; constitutional supremacy). **Model role: none this slice.**
- **Architecture record** — [`strategic-learning-record-slice.md`](../architecture/strategic-learning-record-slice.md):
  one append-only table, deterministic admission gate, schema `strategic-learning-1`, intentionally small domain (no
  lifecycle/status, no model, no BU/FSC mutation). ADR-011 + current-state map updated with the category-14 precursor.

## What was built (implementation — `b3d8f2e`+1)

**Domain** — [`strategic-learning.ts`](../../apps/api/src/business-model/strategic-learning.ts): the deterministic
admission gate `assertLearningAdmissible` (a readable, owned review; a founder statement; a category from the fixed set;
a confidence from {ESTABLISHED, TENTATIVE, CONDITIONAL} — never absolute; an idempotency key) and `buildLearningFields`
(lineage — review record/revision + plan + commitment + decision + recommendation session + provenance manifest — is
**SYSTEM_DERIVED** from the immutable review; the statement/category/confidence are **FOUNDER_AUTHORED** and explicitly
accepted; `modelSuggested=false`); `toLearningView` surfaces `doesNotModifyBusinessUnderstanding` and
`doesNotModifyFounderStrategicContext` as constant reminders. **No model, no BU/FSC mutation, no lifecycle.**

**Persistence** — `V076 business.strategic_learning_record` (append-only immutable records; **BEFORE-UPDATE trigger**
`slr_no_update`; unique `(founder, idempotency_key)`; full lineage columns; no task/progress/score column).
[`pg-strategic-learning.repository.ts`](../../apps/api/src/business-model/pg-strategic-learning.repository.ts):
idempotent create-only; `listByFounder`; `getById`; `byIdempotencyKey`.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts): `POST /strategy/plan-reviews/:reviewId/
learnings` (resolves the owned review → 404 if not owned; `assertLearningAdmissible` → 400 on rejection; idempotent
create → 201 `{learning}`); `GET /strategy/learnings`; `GET /strategy/learnings/:logicalLearningId` (→ 404 or
`{learning, history}`). Creating a learning writes **only** the learning row.

**Export/Delete** — [`export.service.ts`](../../apps/api/src/account/export.service.ts) emits `strategicLearnings` with
full lineage + authorship + schema version; [`delete.service.ts`](../../apps/api/src/account/delete.service.ts) removes
every learning (before the review delete) — zero orphans.

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx) + [`client.ts`](../../apps/web/src/api/client.ts):
a **`LearningPanel`** offered *only* from a recorded review's saved state ("Keep a learning from this review — Most
reviews won't"). On keeping, it states **"Durable strategic learning"**, **"It does not modify Business Understanding"**,
**"It does not modify Founder Strategic Context"**. Separate from the review surface; no task/progress/score control.

## Acceptance evidence

- **Deterministic (Part 11):** `strategic-learning.test.ts` — 11 tests (admission gate: owned review required, statement
  required, category from the fixed 11, confidence required and never absolute, idempotency key required; the confidence
  set is exactly {CONDITIONAL, ESTABLISHED, TENTATIVE} and excludes CERTAIN/ABSOLUTE; build carries the exact review +
  full lineage, founder-authored, not model-suggested, nullable lineage taken as-is; the view always reports it does not
  modify BU/FSC and leaks no status/progress/score/completedAt field).
- **Live DB (Part 11 A–D):** `strategic-learning.live.test.ts` — 4 tests: **(A)** recording a review creates **no**
  learning (and no execution/task/progress/habit/reminder table exists); **(B)** an explicit promotion writes exactly one
  learning, idempotent, with the exact review + full lineage, founder-authored, confidence preserved; **(C)** a learning
  mutates **nothing** — the review, Business Understanding (Law 12), and Founder Strategic Context (Law 13) are byte-for-
  byte unchanged and no new plan/commitment/decision revision appears; **(D)** append-only UPDATE rejected by the trigger,
  no `memory.*` write, cross-founder create/read rejected, export lineage faithful, delete zero orphans (the source review
  survives).
- **Browser (Part 11 UI):** through the real signed-in browser session (vite proxy → API bundle → dev Postgres) the full
  chain **decision → commitment → plan → review → learning** was exercised: decision `201` (`notACommitment:true`),
  commitment/plan/review `201`, then `POST …/learnings` `201` returning the lineage plus
  `doesNotModifyBusinessUnderstanding:true` / `doesNotModifyFounderStrategicContext:true`, `founderAuthored:true`,
  `modelSuggested:false`, `confidence:"TENTATIVE"`; a repeat with the same idempotency key returned the **same**
  learning id and the list stayed at **1**. DB verification confirmed exactly one learning with full lineage, the review
  unchanged (still `MIXED_EVIDENCE`), **no** BU version and **no** FSC item written, no execution/task/progress/habit/
  reminder table, and the `slr_no_update` append-only trigger present. The served UI bundle ships the exact `LearningPanel`
  copy ("Keep a learning from this review", "Most reviews won't", "Durable strategic learning", "It does not modify
  Business Understanding", "It does not modify Founder Strategic Context") and **no** progress/productivity/habit/task
  vocabulary; the recommendation surface renders the decision act as explicitly separate from recommendation feedback.
  (Tooling note: the in-app browser's `read_page` a11y tree would not build for this SPA, so the nested native `<select>`
  review/learning forms were driven through the browser's authenticated fetch session rather than click-by-click; every
  request went through the real cookie + vite proxy + API + DB path, and the persisted invariants were verified directly.)
- **Regression:** backend **656 pass / 1 skip** (84 files); web build (tsc + vite) + **73** web tests green; API + web
  typechecks clean; migrations through V076 present, V076 table + `slr_no_update` trigger live; frozen-engine hashes
  byte-identical (`prompt a39ea88…`, `schema 79802e9…`, `index f9df116…`); the Decision/Commitment/Plan/Review chain and
  provenance/conflict rules remain green.

## Scope discipline

No Strategic Execution Record, task management, progress tracking, productivity metrics, habit tracking, reminders,
scheduling, notifications, calendar integrations, autonomous agents, automatic context mutation, or generic Strategic
Memory added; legacy `memory.*` (KA-2) not reconciled; the model cannot create or silently promote a learning; creating a
learning performs **no** Review/Plan/Commitment/Decision/Recommendation rewrite and **never** auto-modifies Business
Understanding or Founder Strategic Context; the frozen strategist engine is untouched. Not deployed, not pushed, no prior
commit amended.

## Remaining debt
- **SLR-1** revision-based learning corrections (append another learning; currently one revision per logical learning);
  **SLR-2** governed promotion of a learning into Founder Strategic Context / Business Understanding (a separate future
  gate — Law 14); **SLR-3** broader learning provenance (linking specific evidence beyond the review lineage);
  **SLR-4** model-assisted *suggestion* of candidate learnings (MODEL_PROPOSED + founder acceptance + evaluation).
- Strategic **Execution Record** remains future-only; task/progress tracking stays outside the architecture; generic
  Strategic **Memory** is conceptual; **PI-1** / **KA-2** unchanged.
