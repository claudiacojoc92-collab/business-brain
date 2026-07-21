# Strategic Learning Record — slice closure record

Adds the ADR-011 **category 14 precursor**: a founder-governed **Strategic Learning Record** — a durable strategic
understanding the founder *explicitly decides to keep* after a review. It is **not** journaling, notes, memory, or
execution, and it is **not** generic Strategic Memory. *History records events. Learning records durable changes in
understanding. Those are different objects.* Most reviews create **no** learning. Governance + architecture gate
committed *before* implementation (`b3d8f2e`, atop the SPRR line `a083f18`); implementation `2aa9a23`.

> **Remediation (2026-07-21).** The initial `2aa9a23` acceptance was **not** justified and is superseded by this record.
> Corrections: (1) **genuine rendered-UI acceptance** via Playwright (the earlier "browser acceptance" drove the forms by
> authenticated *fetch*, not the rendered controls — that only ever counted as an integration check); (2) the object is
> **enriched** with before/after understanding, scope + broad-scope acknowledgement, a causal-claim guard, boundary
> conditions, counterevidence, unresolved unknowns, and source-classified observations/evidence; (3) the epistemic
> vocabulary drops truth-inflating `ESTABLISHED` for `PROVISIONAL | SUPPORTED | CONTESTED | INSUFFICIENT_INFORMATION`
> (forward migration **V077**); (4) "**promotion**" is reserved for the future BU/FSC capability — creation from a review
> is *create/keep/record*; (5) the **backend regression discrepancy** is explained (the earlier "656" was the `apps/api`
> project alone — the shell was `cd`'d into `apps/api`; the true full `backend` workspace project is ~924); (6) the
> lifecycle is documented honestly as **CREATE-only** (initial immutable creation slice). Full detail + criterion matrix:
> [`strategic-learning-record-remediation.md`](../architecture/strategic-learning-record-remediation.md).

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

The four evidence kinds are kept distinct (they are not one "browser acceptance"):

- **Deterministic domain tests** — `strategic-learning.test.ts` (19): the admission gate (owned review; statement;
  before/after understanding + change statement all required; category from the fixed 11; **bounded** confidence rejecting
  CERTAIN/ABSOLUTE/ESTABLISHED/PROVEN; scope required; **broad-scope acknowledgement** for broad scopes; **causal-claim
  guard**; observation source validation; evidence references restricted to the review lineage with invented + duplicate
  rejected; idempotency), the SYSTEM_DERIVED lineage, verbatim before/after/counterevidence/boundary/unknowns preservation,
  founder-reported staying founder-reported, and the founder-safe view leaking no status/progress/score/streak field.
- **Live DB tests** — `strategic-learning.live.test.ts` (8, Scenarios A–H): **A** review creates no learning (no execution/
  task/progress/habit/reminder/score table); **B** explicit keep is exactly-once, idempotent, full lineage, and mutates
  nothing (review/BU/FSC byte-identical, no new plan/commitment/decision revision, no `memory.*` write); **C** two distinct
  learnings from one review, retry no-duplicate, no auto-merge; **D** increased uncertainty accepted (no forced positive);
  **E** INSUFFICIENT_INFORMATION preserves unknowns without inventing a conclusion; **F** causal + founder-reported-only
  blocked from SUPPORTED with **no partial row**; **G** immutable CREATE, direct UPDATE rejected by the trigger, lineage
  read-back not recomputed; **H** cross-founder rejected, export faithful (all enriched fields), delete zero orphans, source
  review survives.
- **Genuine rendered-UI acceptance** — Playwright `apps/web/e2e/strategic-learning.spec.ts` (`npm run e2e -w apps/web`,
  headless Chromium): signs in through the **rendered** form, then walks **decision → commitment → plan → review** through
  the actual visible controls, opens **"Record a learning from this review"**, fills every field, selects category /
  confidence / scope, observes **disabled-submit** validation while incomplete, triggers the **server-side causal-claim
  guard** (a visible error), corrects it, clicks **Keep this learning**, and sees the saved panel state
  ("Durable strategic learning" / "It does not modify Business Understanding" / "It does not modify Founder Strategic
  Context"). After **page reload**, the persisted "Your durable strategic learnings" list still shows the learning **with
  its source review**. DB assertions in the same test confirm exactly one learning, the review unchanged (`MIXED_EVIDENCE`),
  **no** BU version, **no** FSC item, and `confidence = PROVISIONAL`. Visual evidence:
  `apps/web/e2e/__evidence__/learning-saved.png`, `learnings-list-after-refresh.png`.
- **Regression:** full **`backend` workspace project** (`vitest run --project backend`, from the repo root — `packages/*` +
  `apps/api` + `apps/workers`): **924 pass / 1 skip / 0 fail** (132 files). Web build (tsc + vite) green; **73** web unit
  tests green; API + web typechecks clean; migrations through **V077** present + applied (V076 table + `slr_no_update`
  trigger + V077 enrichment columns live); frozen-engine hashes byte-identical (`prompt a39ea88…`, `schema 79802e9…`,
  `index f9df116…`); the Decision/Commitment/Plan/Review chain, provenance, and conflict rules remain green. *(The one
  real-network + real-inference `market-review-durable.live` test can time out under parallel load with a co-running API
  bundle; it passes in isolation and on a contention-free run — environmental, unrelated to SLR.)*

**Backend count discrepancy (resolved).** `2aa9a23` reported "656 pass / 1 skip (84 files)". The root `vitest.workspace.ts`
defines a **`backend`** project (`packages/*/src/**` + `apps/api/src/**` + `apps/workers/src/**`) plus a separate `apps/web`
(jsdom) project. 656 / 84 files is the **`apps/api` project alone** — the persistent shell was `cd`'d into `apps/api`, so
`npx vitest run` resolved only that project and silently dropped `packages/*` + `apps/workers` (241 tests). The true full
`backend` project is 924 (= the prior-slice 897 baseline + 27 SLR tests). Same runner/config/env; only the working directory
(hence project resolution) differed.

## Criterion-to-test matrix
All 56 original deterministic criteria are mapped in
[`strategic-learning-record-remediation.md`](../architecture/strategic-learning-record-remediation.md) — each COVERED by a
named assertion, except the lifecycle-mutation criteria (44–47: REFINE/CONTEST/SUPERSEDE/RETIRE) which are
**DEFERRED_BY_GOVERNANCE** (this is the CREATE-only initial slice; Law 10 + SLR-3).

## Scope discipline

No Strategic Execution Record, task management, progress tracking, productivity metrics, habit tracking, reminders,
scheduling, notifications, calendar integrations, autonomous agents, automatic context mutation, or generic Strategic
Memory added; legacy `memory.*` (KA-2) not reconciled; the model cannot create or silently create a learning; creating a
learning performs **no** Review/Plan/Commitment/Decision/Recommendation rewrite and **never** auto-modifies Business
Understanding or Founder Strategic Context; the frozen strategist engine is untouched. Playwright + Chromium were added as a
repo-native browser-automation harness (`apps/web` devDependency). Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **SLR-3** the append-only **lifecycle** (REFINE / CONTEST / SUPERSEDE / RETIRE), effective-state derivation, and a
  historical-revision UI — a governed contradictory-learning relationship (this slice keeps CREATE-only immutable records).
- **SLR-1 / SLR-2** governed **promotion into Business Understanding / Founder Strategic Context** (Law 14) — separate
  future gates. **SLR-4** model-assisted *suggestion* of candidate learnings (MODEL_PROPOSED + founder acceptance + eval).
- Strategic **Execution Record** remains future-only; task/progress tracking stays outside the architecture; generic
  Strategic **Memory** is conceptual; **PI-1** / **KA-2** unchanged.
