# Wave 4 · Founder Strategic Context — slice 1 closure record

Makes the existing bounded `PRIORITY_DECISION` strategist more realistic and personalized by introducing explicit,
founder-controlled **Founder Strategic Context**: the conditions under which the founder's strategy must work.
Governance + architecture gate committed *before* implementation (`299890d`, atop the strategy slice `5008573`).

## Remediation review (supersedes the first acceptance)

The first acceptance declaration (implementation `eaebcc1`) **was superseded by a remediation review** that identified
three contract-level blockers, all now resolved in a follow-up remediation commit (migration `V068`):

1. **Append-only was not real.** V067 `revise` flipped the prior row `ACTIVE → SUPERSEDED` and `retire` flipped
   `ACTIVE → RETIRED` *in place* — mutating historical records. **Fixed:** the table is now strictly append-only —
   `lifecycle ∈ {CREATE, REVISE, RETIRE}` per immutable version, effective/superseded/retired derived from
   `MAX(version) + lifecycle`, retirement appends a terminal `RETIRE` version, and a **BEFORE UPDATE trigger forbids any
   row update at the database**. Concurrency is arbitrated by the immutable `(founder, logical_item, version)` unique
   index. Proven by a test that snapshots a prior version's full DB row before/after revision, later revision,
   retirement, and a losing concurrent write (byte-identical each time) and asserts the DB rejects a direct `UPDATE`.
2. **Conflict detection was incomplete.** Only GOAL_GOAL, a mis-specified HORIZON_FEASIBILITY (goal-end-after-horizon),
   GOAL_CONSTRAINT-overlap, and a free-text marker existed. **Fixed:** all five required rules are now deterministic —
   GOAL_GOAL; GOAL_RESOURCE (explicit `requiresResourceCategories` + a founder-explicit `UNAVAILABLE` resource — never
   from `UNKNOWN`/absence); NON_NEGOTIABLE_OPTION over a bounded option set; HORIZON_FEASIBILITY over an explicit
   `prerequisite` duration/date vs the decision-horizon window; and a quantitative GOAL_CONSTRAINT (explicit goal
   `requires` budget/time exceeding an explicit constraint `limit`, same unit). Minimal founder-explicit typed fields
   were added (`UNAVAILABLE`, `requiresResourceCategories`, `requires`, `prerequisite`, `limit`); no number is invented.
3. **Schema change without a version bump.** **Fixed:** `SCHEMA_VERSION.strategy` bumped
   `strategy-recommendation-1 → strategy-recommendation-2` (additive; the normalizer reads both; compat test proves v1 +
   v2 payloads parse; new sessions persist `schema_version=strategy-recommendation-2`, old v1 sessions stay readable).

The sections below describe the current (remediated) state.

## What was built

**Domain** — [`founder-strategic-context.ts`](../../apps/api/src/business-model/founder-strategic-context.ts): one
governed aggregate `FounderStrategicContextItem` over five kinds — `GOAL`, `CONSTRAINT`, `RESOURCE`,
`STRATEGIC_PREFERENCE`, `DECISION_HORIZON` — each with discriminated, validated metadata. Founder-declarable sources
only (`VERIFIED_SYSTEM_RECORD` rejected this slice); `NON_NEGOTIABLE` accepted only from an explicit founder write; a
resource claim is `FOUNDER_DECLARED`, never silently `VERIFIED`; a goal needs no numeric target; invalid date ranges
rejected with a founder-safe `ContextValidationError`.

**Persistence** — migration `V067` (`business.founder_strategic_context_item`): append-only versions, a **partial
unique index** guaranteeing exactly one `ACTIVE` version per logical item, plus the version-tuple unique index.
[`PgFounderStrategicContextRepository`](../../apps/api/src/business-model/pg-founder-strategic-context.repository.ts):
`create`, `revise` (supersede prior effective + insert next version in one tx; kind immutable), `retire`
(`ACTIVE→RETIRED`), `listActive`, `history`, `listAllForExport`. A concurrent revision that loses the single-ACTIVE
race raises `ContextConcurrencyError` (→ 409).

**Effective resolver** —
[`effective-strategic-context.resolver.ts`](../../apps/api/src/business-model/effective-strategic-context.resolver.ts):
pure, deterministic. Returns only `ACTIVE` + not-future + not-expired + in-scope + latest-version items (expired
surface under `staleItems`, review-due flagged but still active), plus `missingCriticalAreas` (unknown ≠ zero) and
**deterministic structured conflicts** — `GOAL_GOAL` (dual PRIMARY), `HORIZON_FEASIBILITY` (goal ends after the
decision horizon), `GOAL_CONSTRAINT` (non-negotiable overlapping a primary goal), plus a marker-based
`NON_NEGOTIABLE_OPTION_CONFLICT` helper. Undeterminable tensions are never invented.

**API** — [`strategic-context.routes.ts`](../../apps/api/src/routes/strategic-context.routes.ts), session-guarded
`/api/founder-strategic-context/*` (create / list / effective / history / revisions / retire). Founder id from the
session, never a body. Discriminated schemas validated server-side; founder-safe errors.

**Integration** — the [`StrategicContextAssembler`](../../apps/api/src/business-model/strategic-context.assembler.ts)
`founderContext` now consumes the effective resolver (ids/versions/source/temporal preserved, expired/future/retired
excluded). `StrategicRecommendation` gains a `FOUNDER_STRATEGIC_CONTEXT` epistemic kind + optional
`logicalItemId`/`version`/`scope`/`source`/effective-period on references. Strategy prompt bumped `strategy-1 →
strategy-2`: use context where material, don't overfit preferences, unknown ≠ unavailable, no identity/psychology,
expose trade-offs, cite context by resolvable id.

**UI** — [`StrategicContextPage.tsx`](../../apps/web/src/strategic-context/StrategicContextPage.tsx) (`/strategic-context`):
five sections, add/revise/retire/history, expiry + needs-review badges, a tensions panel, UNKNOWN shown (never zero),
progressive capture, no personality language, not required before using Strategy.

**Export / delete** — export includes all context versions (kind/source/scope/effective dates/status/supersession/
metadata; no internal fields); delete removes all founder-owned context rows.

## Evidence

- **Deterministic tests**: [`founder-strategic-context.test.ts`](../../apps/api/src/__tests__/business-model/founder-strategic-context.test.ts)
  (15 pure — validation, resolver as-of/scope/expiry/unknown≠zero/ordering, structured conflicts) +
  [`founder-strategic-context.live.test.ts`](../../apps/api/src/__tests__/business-model/founder-strategic-context.live.test.ts)
  (3 live — append-only revision/supersession/history/retire/cannot-reactivate/concurrent-conflict/isolation;
  assembler consumption with provenance + expired-excluded + revision-replaces; routes + export/delete zero orphans).
- **Full regression (green)**: API `489 passed / 1 skipped`; web `73 passed`; both type-checks clean; web prod build
  OK; `V067` latest with all indexes; frozen engine byte-identical (`a39ea88…` / `79802e9…` / `f9df116…`).
- **Evaluation**: [`wave4-founder-strategic-context-eval.md`](./wave4-founder-strategic-context-eval.md) — 11/12 then
  12/12; every parsed run met all contract criteria.

## Browser acceptance

Synthetic non-production seeds (Business Understanding seeded directly as
`model_version='ACCEPTANCE_SEED_synthetic_nonproduction'`; strategic context created through the **real API**),
removed afterward.

- **Context CRUD (real UI + API)**: empty state (missing critical areas), all five kinds added, revise → `v2 (revised)`,
  history, retire, an **expired constraint excluded from active + flagged "expired — needs review"**, the tensions
  panel showing two `GOAL_CONSTRAINT` conflicts, founder-safe validation error, refresh persistence, and **no
  personality language**.
- **Scenario A (context changes the recommendation)**: two founders, identical Business Understanding, contrasting
  context. Founder A (£150/mo firm, 4h/week, organic preference, newsletter) → *"Double down on organic LinkedIn
  output and convert your newsletter list, rather than opening new channels"*, citing 5 context items. Founder B (£4k/mo,
  2-person team, growth-speed) → *"Systematize the LinkedIn content-to-inbound pipeline… use the two-person team to
  increase cadence"*, citing 4 context items. **Different titles, materially different actions** — not superficial
  wording.
- **Scenario B (preference does not override evidence)**: founder with a strong Instagram preference but LinkedIn
  evidence → *"Prioritise LinkedIn"*, naming the Instagram preference tension.
- **Scenario C (expired excluded)**: the expired "Holiday content freeze" is absent from the consumed context and not
  cited; it appears in `staleItems` as `EXPIRED`.
- **Scenario D (conflict visible)**: founder A's recommendation exposes the £150/4h non-negotiable trade-off and its
  `whatWouldChangeThisRecommendation` references the binding conditions.
- **Provenance resolution**: every cited `FOUNDER_STRATEGIC_CONTEXT` reference resolved to a stored context item
  (A 5/5, B 4/4) — **zero unresolved or manufactured references**.
- **ACCEPT semantics**: after ACCEPT, context item count unchanged (8/8) and understanding unchanged (v1) — **ACCEPT
  writes no context and no business memory**.
- **Ownership**: both acceptance founders deleted via the real endpoint — **zero orphans** across context, sessions,
  responses, understanding; no acceptance-seed remains anywhere. Founder isolation holds (cross-founder revise → null,
  history → 404).

## Remediation re-acceptance evidence

- **Append-only (DB + API):** create → revise → retire over the real API; the v1 DB row is byte-identical after both
  operations; history is `v1:CREATE:SUPERSEDED, v2:REVISE:SUPERSEDED, v3:RETIRE:RETIRED` (retirement is a new durable
  terminal version); a direct SQL `UPDATE` is rejected by the trigger (`append-only`). Plus the immutability unit test.
- **Five conflict rules (live API + UI):** GOAL_GOAL, GOAL_RESOURCE (goal requires TEAM + `UNAVAILABLE`),
  HORIZON_FEASIBILITY (60-day prerequisite vs 30-day window), and quantitative GOAL_CONSTRAINT (£1000 required vs £150
  limit) all appear in `/effective` conflicts and render in the Strategic Context tensions panel (DOM-verified). Rule 3
  (NON_NEGOTIABLE_OPTION over a bounded option set) is proven by deterministic fixtures. **UNKNOWN ≠ UNAVAILABLE**
  verified live: a `UNKNOWN` team resource produces **0** GOAL_RESOURCE conflicts.
- **Schema v2:** a real durable session records `schema_version = strategy-recommendation-2`; its 4
  `FOUNDER_STRATEGIC_CONTEXT` references all resolve to immutable stored records; v1/v2 payload compatibility unit test
  passes.
- **ACCEPT / isolation / ownership:** ACCEPT left context rows (11→11) and understanding (v1→v1) unchanged;
  cross-founder history read → 404; both remediation founders deleted → zero orphans, no acceptance-seed remains.
- **Regression (green):** API `496 passed / 1 skipped`; web `73 passed`; both type-checks clean; web prod build OK;
  `V068` latest migration (append-only trigger + `lifecycle` + dropped mutable-`ACTIVE` index); frozen engine
  byte-identical. Eval reran post-remediation: every parsed fixture met all criteria (only stochastic single-shot JSON
  truncations varied, which the durable worker retries).

## Final re-acceptance check — NON_NEGOTIABLE_OPTION end-to-end (migration V069)

A final review found the one remaining gap: rule 3 (NON_NEGOTIABLE_OPTION) had only deterministic-fixture evidence and
**was not wired into the real pipeline**; running the actual scenario also exposed a **model-behaviour defect** — given
the only evidence-supported option excluded by a non-negotiable, the strategist *invented a supported alternative*
(prioritised the un-evidenced option). Both were fixed (one remediation commit; the prior acceptance is refined, not
re-declared):

- **Pipeline wiring:** the model now emits an `optionAssessment` (bounded options with `supportedByEvidence` +
  `excludedByContextRefId`); the durable worker runs the deterministic `detectNonNegotiableExcludesOnlyOption` over it,
  **validating each echoed reference against the effective non-negotiables** (a non-resolving ref is discarded — no
  manufactured provenance), and persists any `NON_NEGOTIABLE_OPTION_CONFLICT` on the session (`context_conflicts`,
  migration `V069`), surfaced in `toSessionView` and rendered on the strategy result page.
- **Behaviour fix (prompt `strategy-2 → strategy-3`; schema `strategy-recommendation-2 → strategy-recommendation-3`,
  additive):** for a bounded-option question where the only evidence-supported option is excluded by a non-negotiable
  and no other option is supported, the strategist returns **INSUFFICIENT** — it does not promote an unsupported option,
  does not weaken the non-negotiable, and states plainly that no currently supported acceptable option remains. `UNKNOWN`
  is never treated as support.
- **Real end-to-end proof** (founder with LinkedIn-only evidence + a `NON_NEGOTIABLE` "no LinkedIn this period", question
  "LinkedIn or Instagram?"): session `INSUFFICIENT_EVIDENCE`, `schema_version=strategy-recommendation-3`;
  `optionAssessment = [LinkedIn supported+excluded(→real item id), Instagram unsupported]`; the persisted
  `NON_NEGOTIABLE_OPTION_CONFLICT` reads *"Every evidence-supported option (LinkedIn) is excluded by a non-negotiable you
  set … No currently acceptable supported option remains"* with `itemIds` **resolving to the immutable stored
  non-negotiable**; the insufficient reason states recommending Instagram *"would mean substituting the unevidenced
  option … not a grounded strategic decision"*; **no personality/psychology language**; it **renders in the founder UI**
  ("YOUR NON-NEGOTIABLE RULES OUT THE ONLY SUPPORTED OPTION"); **ACCEPT wrote no context/memory** (1→1, understanding
  v1→v1); founder deleted → **zero orphans**. Regression: API `501 pass / 1 skip`, web green, prod build OK, `V069`
  latest, frozen engine byte-identical.

## What is NOT claimed (out of scope this slice)

Founder Strategic Context is **not** complete in all future forms. This slice does **not** implement: a separate
`STRATEGIC_EXCLUSION` object, `STRATEGIC_COMMITMENT`, accepted strategic-decision memory, strategy plans, task
execution, automatic extraction from conversations, silent memory writes, scheduled review reminders, conflict-
resolution workflows, general Founder Conversation, autonomous agents, market discovery, or a founder personality
profile. Production is untouched; nothing deployed or pushed; the frozen engine is byte-identical.
