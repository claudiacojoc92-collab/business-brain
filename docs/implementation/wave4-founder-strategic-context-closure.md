# Wave 4 · Founder Strategic Context — slice 1 closure record

Makes the existing bounded `PRIORITY_DECISION` strategist more realistic and personalized by introducing explicit,
founder-controlled **Founder Strategic Context**: the conditions under which the founder's strategy must work.
Governance + architecture gate committed *before* implementation (`299890d`, atop the strategy slice `5008573`).

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

## What is NOT claimed (out of scope this slice)

Founder Strategic Context is **not** complete in all future forms. This slice does **not** implement: a separate
`STRATEGIC_EXCLUSION` object, `STRATEGIC_COMMITMENT`, accepted strategic-decision memory, strategy plans, task
execution, automatic extraction from conversations, silent memory writes, scheduled review reminders, conflict-
resolution workflows, general Founder Conversation, autonomous agents, market discovery, or a founder personality
profile. Production is untouched; nothing deployed or pushed; the frozen engine is byte-identical.
