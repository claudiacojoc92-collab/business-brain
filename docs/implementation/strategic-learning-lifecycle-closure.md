# Strategic Learning Lifecycle — slice closure record

Implements the founder-directed **single-thread lifecycle** for Strategic Learning Records: `CREATE → REFINE / CONTEST /
SUPERSEDE / RETIRE`, each an explicit founder act that **appends a new immutable revision** of one logical thread and
preserves complete history. Per **ADR-012** (dual-layer): **single-thread lifecycle ships; inter-thread learning
relationships are deferred.** **CONTEST is a single-thread usability downgrade — not** a future `CONTESTS` relationship
between two independent threads; a genuinely distinct claim is a **separate CREATE**. **No** relationship table,
contradiction graph, semantic matching, similarity, clustering, or knowledge graph. Governance gate committed *before*
implementation (`cbb1ca9`, atop `6c7616a`).

## Two commits
- **Commit 1 — governance gate `cbb1ca9`** (docs only): finalized [ADR-012](../adr/ADR-012-strategic-learning-lifecycle.md)
  + [`strategic-learning-lifecycle-contract.md`](../governance/strategic-learning-lifecycle-contract.md) (28 laws +
  transition table + decision rule + boundary) + [`strategic-learning-lifecycle-slice.md`](../architecture/strategic-learning-lifecycle-slice.md)
  (repo audit + V078 plan). No code/migration/test.
- **Commit 2 — implementation + closure** (this record): migration, domain, repo, API, UI, export/delete, tests,
  Playwright acceptance + evidence, closure docs.

## What was built

**Migration** — `V078` forward-ALTER of `business.strategic_learning_record` (V076/V077 unedited): lifecycle metadata
(`lifecycle_action` enum, `root_learning_id`, `predecessor_learning_id`, `lifecycle_reason`, `replacement_summary`,
`retained_validity`, `counterevidence_resolution`, `unknowns_resolution`); existing CREATE rows backfilled
(`CREATE`/root=id/predecessor=null); constraints (`revision>0`; action enum; CREATE-shape); `UNIQUE(founder, logical,
revision)`; **no-fork** `UNIQUE(founder, predecessor)`; append-only **UPDATE** trigger retained; new BEFORE-**DELETE**
guard `slr_no_delete` (individual delete forbidden unless the account-deletion transaction sets `bb.allow_learning_delete`).

**Domain** — [`strategic-learning-lifecycle.ts`](../../apps/api/src/business-model/strategic-learning-lifecycle.ts):
`LearningLifecycleAction`/`LearningLifecycleStatus` (distinct from epistemic `confidence`), `deriveLifecycleStatus`,
`getEffectiveRevision`, `assertContiguousChain`, `validateLifecycleTransition` (exact-current-revision + expected-revision;
RETIRE terminal; per-verb required fields; no-op REFINE rejection; scope-broaden acknowledgement; causal guard;
observation/evidence validity; counterevidence/unknowns-drop explanations), `buildRevisionFields` (lineage **copied** from
predecessor — Law 5). No model, no similarity.

**Repository** — [`pg-strategic-learning.repository.ts`](../../apps/api/src/business-model/pg-strategic-learning.repository.ts):
`appendRevision` under a `FOR UPDATE` thread lock — validates against the locked effective revision, inserts `revision =
current+1`, `predecessor = current.id`, `root` copied; idempotent on `(founder, idempotency_key)`; the `UNIQUE(founder,
predecessor)` index converts a concurrent double-append into a caught **409 conflict** (no fork). `getThread`,
`listThreads`, `getRevisionById`.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts): `POST /strategy/learnings/:learningId/
{refine|contest|supersede|retire}` (each: `sourceRevisionId`, `expectedRevision`, `idempotencyKey`, founder confirmation,
payload → 201 revision / 409 conflict / 400 rejection with deterministic reason). `GET /strategy/learning-threads`,
`GET /strategy/learning-threads/:logicalLearningId`, `GET /strategy/learnings/revision/:revisionId`. Responses carry
`doesNotModify{BusinessUnderstanding,FounderStrategicContext,Review,Plan,Commitment,Decision}` +
`creates{Recommendation,Execution,Relationship}: false`. No PATCH.

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): each thread shows the effective revision,
**lifecycle status**, epistemic status, revision count, source review, scope, boundary/counterevidence/unknowns; a
**revision history** (every revision, never hidden/collapsed, never labelled "wrong"); Refine/Contest/Supersede/Retire
forms with the governed copy for ACTIVE/CONTESTED threads; **no** action buttons for RETIRED (terminal note instead).
Every form states it does not modify BU/FSC/review/plan/commitment/decision. No "wrong/failed/stale/invalid/progress/
promote/contradiction detected" vocabulary. Contest pre-fills existing counterevidence/unknowns so they aren't dropped.

**Export/Delete** — [`export.service.ts`](../../apps/api/src/account/export.service.ts) emits each thread's full ordered
revision history (lifecycle action + derived status + predecessor/root + all content + lineage + reasons + replacement/
retained/resolutions), ordered by `(logical_learning_id, revision)`. [`delete.service.ts`](../../apps/api/src/account/delete.service.ts)
sets `SET LOCAL bb.allow_learning_delete='on'` so the account-deletion bulk delete passes the guard; zero orphans.

## Acceptance evidence (four distinct kinds)

- **Deterministic domain** — `strategic-learning-lifecycle.test.ts` (24) + the existing SLR CREATE tests (19): status
  derivation, contiguous-chain, effective-state; stale/terminal/rationale/idempotency; REFINE (valid, no-op rejected,
  same-learning confirm, scope narrow/broaden, causal guard, counterevidence/unknowns-drop, evidence lineage/dup);
  CONTEST (no second learning/relationship, position + basis required, uncertainty may increase, CONTESTED); SUPERSEDE
  (replacement/explanation/retained-validity/confirm required, stays ACTIVE); RETIRE (RETIRED); lineage copied; lifecycle
  vs epistemic separate; founder-reported preserved.
- **Live DB (Scenarios A–J)** — `strategic-learning-lifecycle.live.test.ts` (10): REFINE two-revisions + no-op surfaced
  cleanly + BU/FSC unchanged; CONTEST without a second learning/relationship (introspection: no relationship table),
  CONTESTED, history preserved; separate contradictory CREATE (distinct logical ids, neither mutates the other); SUPERSEDE
  (replacement/retained persisted, old visible, new effective); RETIRE terminal (later action → 409) + separate CREATE
  allowed; **no-fork** concurrency (one succeeds, one 409, no fork); idempotency; isolation; export/delete (UPDATE +
  individual DELETE rejected; account-delete zero orphans); migration fidelity.
- **Genuine rendered-UI acceptance** — Playwright `apps/web/e2e/strategic-learning-lifecycle.spec.ts` (`npm run e2e -w
  apps/web`, headless Chromium): signs in, opens threads + revision history, drives REFINE (same-learning validation →
  confirm → rev 2; refresh shows rev 1 + rev 2), a **no-op refine** (visible validation), CONTEST (→ CONTESTED, no
  relationship UI), independent-thread coexistence (distinct logical ids, no auto contradiction), SUPERSEDE (replacement +
  retained visible in history), RETIRE (→ RETIRED, action buttons gone), the **causal guard** and **broad-scope guard**
  via the authenticated session (400 with the exact reason), then DB invariants (BU/FSC unchanged; no relationship table).
  Evidence: `apps/web/e2e/__evidence__/lifecycle-{refined-history,contested,superseded,retired}.png`.
- **Regression** — full **`backend` project** (`vitest run --project backend`, repo root — `packages/*` + `apps/api` +
  `apps/workers`): **958 pass / 1 skip / 0 fail** (134 files) = the 924 prior baseline + 34 new lifecycle tests (24
  deterministic + 10 live). Web build (tsc + vite) green; **73** web unit tests green; API + web typechecks clean;
  migrations through **V078** present + applied; frozen-engine hashes byte-identical (`prompt a39ea88…`, `schema
  79802e9…`, `index f9df116…`).

*(Test-harness note: the shared-IP rate limiter counts a browser flow's many same-IP requests against one bucket; a
prod-safe, opt-in `RATE_LIMIT_MAX_OVERRIDE` env — unset in production — lets the local acceptance run complete. No
lifecycle behavior depends on it.)*

## Scope discipline
No inter-thread relationship table/API, contradiction graph, semantic similarity, learning clustering, knowledge graph,
REACTIVATE, Strategic Learning **Promotion** into BU/FSC (Law 14), Strategic Execution, task/progress/productivity/habit/
reminder/scheduling/notification/calendar/agent, generic Strategic Memory, embeddings/vectors/graphs, or `memory.*`
reconciliation. The model has **no** lifecycle authority. Lifecycle actions perform **no** downstream mutation or
consequence (BU/FSC/recommendation/decision/commitment/plan/review/execution untouched; no memory write). Frozen engine
byte-identical. Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **Inter-thread relationship layer** (`CONTRADICTS`/`QUALIFIES`/`SUPPORTS`/`DEPENDS_ON`) — deferred to its own future
  gate; founder-declared, optional, non-required for lifecycle correctness; never an inference/knowledge-graph substrate.
- Strategic Learning **Promotion** into BU/FSC (Law 14); model-assisted lifecycle *suggestions*; Strategic **Execution**;
  generic Strategic **Memory** — all future-only. **PI-1 / KA-2** unchanged.
