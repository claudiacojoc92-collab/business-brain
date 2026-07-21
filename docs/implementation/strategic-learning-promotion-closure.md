# Strategic Learning Promotion Gate — slice closure record

Implements the **only** explicit path by which a Strategic Learning may influence **Business Understanding (BU)** or
**Founder Strategic Context (FSC)**: a founder promotes an **exact learning revision** into a target via an append-only
`PromotionEvent` ledger, with the effective promoted set **derived from events** (never from the latest learning
revision). **Promotion is governance, not evidence — explicit founder judgment only.** Governance gate committed *before*
implementation (`739ce77`, atop `15de732`).

## Architectural answer (ADR-013)
**What gives a learning the right to influence BU?** — *Explicit founder judgment.* Not confidence, age, popularity,
number of revisions, `ACTIVE` lifecycle, `SUPPORTED` epistemic state, model recommendation, frequency, or recency. Nothing
becomes BU merely because it exists, has many revisions, or is ACTIVE. Promotion is rarer than Learning; rare, deliberate,
inspectable, append-only. It writes to **neither** `business.understanding` **nor** `founder_strategic_context_item` and
regenerates nothing.

## Two commits
- **Commit 1 — governance gate `739ce77`** (docs only): [ADR-013](../adr/ADR-013-strategic-learning-promotion-gate.md) +
  [`strategic-learning-promotion-contract.md`](../governance/strategic-learning-promotion-contract.md) (22 laws +
  PromotionEvent model + effective-state rule + boundary) + [`strategic-learning-promotion-slice.md`](../architecture/strategic-learning-promotion-slice.md)
  (repo audit + V079 plan). No code/migration/test.
- **Commit 2 — implementation + closure** (this record).

## What was built

**Migration** — `V079` new `business.learning_promotion_event` (append-only): `target` (BU|FSC), `logical_learning_id`,
`learning_revision_id` + `revision_number` (the **exact** pinned revision — Laws 5, 18), `promotion_action`
(PROMOTE|REPLACE|REMOVE), `rationale`, `scope`, `idempotency_key`, `created_at`; CHECK enums + positive revision;
`UNIQUE(founder, idempotency_key)`; effective/revision indexes; **BEFORE-UPDATE** guard; **BEFORE-DELETE** guard
(individual delete forbidden unless account-deletion sets `bb.allow_promotion_delete`). **No change** to
`business.understanding`, `founder_strategic_context_item`, or the learning table.

**Domain** — [`strategic-learning-promotion.ts`](../../apps/api/src/business-model/strategic-learning-promotion.ts):
`PromotionTarget`/`PromotionAction`/`PromotionScope`/`PromotionEvent`/`PromotionInput`; `assertPromotionAdmissible`
(owned exact revision; rationale + scope + idempotency required; **PROMOTE requires not-already-promoted**,
**REPLACE/REMOVE require currently-promoted**); `buildPromotionFields` (pins the exact revision); **`deriveEffectivePromotion`**
(per thread, the **latest event wins**; PROMOTE/REPLACE → pinned revision, REMOVE → withdrawn — never the latest learning
revision); `isThreadPromoted`; `toPromotionView` (carries `doesNotModifyLearning`/`…Review/Plan/Commitment/Decision`,
`regeneratesRecommendations:false`). No model.

**Repository** — [`pg-learning-promotion.repository.ts`](../../apps/api/src/business-model/pg-learning-promotion.repository.ts):
`record` under a **per-(founder,target,thread) advisory lock** + idempotency, so admissibility (already/not-promoted) is
race-free; `listEvents`, `listEventsForThread`, `getEffective`.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts): `POST /strategy/learnings/revision/:revisionId/
{promote|replace-promotion|remove-promotion}` (body `{target, scope, rationale, idempotencyKey}` → 201 / 409
already/not-promoted / 400 rejection); `GET /strategy/promotions/business-understanding`,
`GET /strategy/promotions/founder-strategic-context` (effective, revision-hydrated), `GET /strategy/promotions` (full
ledger). No PATCH. Responses carry the `doesNotModify*` / `regeneratesRecommendations:false` flags.

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): each learning **revision** in the thread
history offers **Promote to Business Understanding** / **Promote to Founder Strategic Context**; when a thread is already
promoted for a target, its pinned revision shows **✓ Promoted** + **Remove**, and other revisions show **Replace … with
this revision**. Each form states "This affects {target}. This does NOT modify the learning. This does NOT modify review,
plan, commitment or decision." Page-level **"Promoted into Business Understanding / Founder Strategic Context"** lists show
the derived effective revisions (empty until an explicit promotion).

**Export/Delete** — export adds `learningPromotions` (full append-only ledger, ordered). Account deletion removes the
ledger (with the delete-guard bypass) before the learning table; zero orphans.

## Acceptance evidence (four distinct kinds)
- **Deterministic domain** — `strategic-learning-promotion.test.ts` (13): admission gate (explicit, owned exact revision,
  rationale + scope + idempotency required, PROMOTE-vs-REPLACE/REMOVE state rules), lifecycle ≠ promotion, exact-revision
  pinning, effective derivation (later learning revision changes nothing; latest event wins; REMOVE withdraws; BU/FSC
  independent; distinct threads independent), founder-safe view.
- **Live DB (Scenarios A–I)** — `strategic-learning-promotion.live.test.ts` (6): no automatic promotion; explicit PROMOTE
  pins the exact revision (FSC independent, learning + BU-version unchanged); a later refine changes the promoted revision
  **not at all**; REPLACE re-pins; REMOVE withdraws (history preserved); idempotency; concurrency (second PROMOTE →
  ALREADY_PROMOTED); isolation; append-only (UPDATE + individual DELETE rejected); account-delete zero orphans.
- **Genuine rendered-UI acceptance** — Playwright `apps/web/e2e/strategic-learning-promotion.spec.ts`: sign in → nothing
  promoted → **PROMOTE** revision 1 into BU → refresh (BU shows revision 1) → **REFINE** the learning → refresh (**BU
  unchanged**, still revision 1 — Law 6) → **REPLACE** with revision 2 → refresh (BU shows revision 2) → **REMOVE** →
  refresh (BU empty). DB invariants: **no** `business.understanding` version written, learning thread intact (2
  revisions), ledger = `PROMOTE,REPLACE,REMOVE`, FSC untouched. Evidence:
  `apps/web/e2e/__evidence__/promotion-bu-{promoted,replaced,empty}.png`.
- **Regression** — full **`backend` project** (`vitest run --project backend`, repo root — `packages/*` + `apps/api` +
  `apps/workers`): **977 pass / 1 skip / 0 fail** (136 files) = the 958 prior baseline + 19 new promotion tests (13
  deterministic + 6 live). Web build (tsc + vite) green; **73** web unit tests green; API + web typechecks clean;
  migrations through **V079** present + applied; frozen-engine hashes byte-identical (`prompt a39ea88…`, `schema
  79802e9…`, `index f9df116…`).

## Scope discipline
No Strategic Execution, recommendation regeneration, automatic adaptation, agents, autonomous behavior, memory, knowledge
graphs, relationship graphs, or semantic retrieval. No mutation of the learning thread, existing `business.understanding`,
or `founder_strategic_context_item`. The model has **no** promotion authority. Promotion regenerates nothing and edits no
Decision/Commitment/Plan/Review/Learning/Execution. Frozen engine byte-identical. Not deployed, not pushed, no prior
commit amended.

## Remaining debt
- **Consumption of the promoted set** by reasoning (regenerate recommendations / adapt) — a separate future gate.
- Strategic **Execution**; model-assisted promotion *suggestions*; generic Strategic **Memory** — future-only.
  **PI-1 / KA-2** unchanged.

---

## Remediation closure (2026-07-21) — canonical effective composition

**Why the ledger alone was insufficient.** The initial slice (`9e524da`) recorded promotions in an append-only ledger and
exposed *parallel* projection endpoints, but **no canonical BU/FSC read path consumed them** (audit classification **B**):
`assembleStrategicContext` and `GET /understanding` read `understanding.latest()`; `GET /founder-strategic-context/
effective` reads `listActive()` — all native-only, zero promotion references. Promotion therefore recorded a governed
intent that nothing effective honored.

**Two remediation commits.** (1) governance clarification `4ca3740` (docs only — ADR-013 amendment + contract C-1…C-9 +
architecture); (2) implementation remediation (this record). Neither `739ce77` nor `9e524da` amended.

**Canonical composition architecture.** New pure composer
[`effective-context.ts`](../../apps/api/src/business-model/effective-context.ts):
`composeEffectiveBusinessUnderstanding(nativeBU, promotedItems)` → `{ nativeBusinessUnderstanding, promotedLearningItems }`;
`composeEffectiveFounderStrategicContext(nativeItems, promotedItems)` → `{ nativeItems, promotedLearningItems }`;
`toPromotedLearningItem(event, pinnedRevision)` builds an `EffectiveContextItem` with `sourceType: PROMOTED_LEARNING` and
full provenance. Canonical routes `GET /strategy/effective-business-understanding` + `…/effective-founder-strategic-context`
(GET-only; native + promoted; provenance-carrying) are **authoritative**; `/strategy/promotions[/*]` remain for **audit**.
The UI adds a `CanonicalEffectiveContext` "Current effective BU/FSC" view (native vs promoted-learning badges, exact
revision, rationale, scope); the ledger list is relabelled "Promotion history".

**Native vs promoted provenance.** Native BU is returned as the versioned aggregate (`{present, version, conclusions}`);
native FSC as its item list. Promoted items are never flattened — each exposes `promotionEventId`, `logicalLearningId`,
`learningRevisionId`, `learningRevisionNumber`, `promotionSequence`, epistemic status (from the pinned revision), lifecycle
status at read (separately labelled), and original source lineage.

**Exact-revision pinning.** The composed promoted item's `content` = the pinned revision's `revisedUnderstanding`; later
REFINE/CONTEST/SUPERSEDE/RETIRE change it not at all — only explicit REPLACE/REMOVE do (det + live J2 + e2e).

**Event sequence/predecessor (V080).** `promotion_sequence` (1..N) + `predecessor_promotion_event_id` per (founder,
target, thread). Effective state = highest-sequence chain head; promoted iff PROMOTE/REPLACE. Constraints: `>0`,
`UNIQUE(founder,target,thread,sequence)`, partial `UNIQUE(founder,predecessor)` (no-fork), CHECK (seq 1 ⇒ null pred ∧
PROMOTE; seq>1 ⇒ pred not null). Backfill orders existing rows by stable `(created_at,id)` and fails on an impossible
fork. **Chosen PROMOTE-after-REMOVE rule:** re-promote appends the next sequence in the same chain (live L). Derivation is
sequence-based, never `created_at` (det: identical-timestamp head resolves by sequence).

**No historical mutation / no reasoning activation.** Composition writes nothing; the reasoning assembler still reads
native only — the *Strategic Learning Consumption Gate* is deferred (C-7). e2e confirms no `business.understanding` version
is written (count stays 1) and no session/recommendation is created.

**Acceptance.** Deterministic `strategic-learning-promotion.test.ts` **22** (13 + 9 remediation); live
`…live.test.ts` **10** (A–I + J/J2/K/L); genuine Playwright `…spec.ts` drives the canonical view (before → promote →
pinned-after-refine → replace → history → remove → FSC-independent) with 7 evidence PNGs
(`promotion-bu-{before,promoted,pinned,replaced,empty}`, `promotion-history`, `promotion-fsc-promoted`). Full **backend**
project **990 pass / 1 skip** (977 + 13). Web build green; **73** web unit tests; API + web typechecks clean; migrations
through **V080**; frozen hashes byte-identical (`a39ea88…` / `79802e9…` / `f9df116…`). Temp founders purged (zero orphans);
servers stopped; bundle removed; nothing pushed; production untouched.

**Remaining debt.** The **Strategic Learning Consumption Gate** (reasoning consumes the promoted set to regenerate/adapt) —
future, separately governed. Strategic **Execution**; model-assisted promotion *suggestions*; generic Strategic **Memory**
— future-only. **PI-1 / KA-2** unchanged.
