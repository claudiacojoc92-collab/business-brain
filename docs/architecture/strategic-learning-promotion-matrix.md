# Strategic Learning Promotion Gate — criterion-to-test matrix

Maps every acceptance criterion (contract Part 8 + prompt Parts 8–9) to its covering test. **det** =
`apps/api/src/__tests__/business-model/strategic-learning-promotion.test.ts`; **live** =
`strategic-learning-promotion.live.test.ts` (Scenarios A–I); **e2e** =
`apps/web/e2e/strategic-learning-promotion.spec.ts`. Implementation: **dom** = `strategic-learning-promotion.ts`;
**repo** = `pg-learning-promotion.repository.ts`; **api** = `strategy.routes.ts`; **mig** =
`V079__learning_promotion_event.sql`; **exp/del** = `export.service.ts` / `delete.service.ts`; **ui** = `StrategyPage.tsx`.
All **COVERED** by an executable assertion.

| Criterion | Impl | Test | Status |
|---|---|---|---|
| explicit promotion (founder act) | api/dom | det (admissible) · live B · e2e (rendered PROMOTE) | COVERED |
| no automatic promotion (Law 1, 2) | dom/mig (no auto path) | det (`isThreadPromoted([])=false`) · live A | COVERED |
| promotion references the EXACT revision (Laws 5, 18) | dom `buildPromotionFields` | det (pins revId+number) · live B | COVERED |
| later refine changes nothing (Law 6) | dom `deriveEffectivePromotion` | det · live C · **e2e** (BU unchanged after refine) | COVERED |
| later contest changes nothing | dom | det (later-event-only) · live C-analogue | COVERED |
| later supersede changes nothing | dom | det (pinned until explicit REPLACE) | COVERED |
| later retire changes nothing | dom | det (event-derived, not lifecycle) | COVERED |
| replacement works (Law 11) | dom/repo | det (REPLACE latest wins) · live D · **e2e** | COVERED |
| remove works (Law 10) | dom/repo | det (REMOVE withdraws) · live D/E · **e2e** | COVERED |
| BU empty until explicit promote | api/dom | live A · **e2e** (`promoted-bu-empty`) | COVERED |
| FSC empty until explicit promote; BU⊥FSC (Law 7) | dom | det (independent) · live B · e2e (FSC=0) | COVERED |
| export full promotion history (Law 19) | exp | live D (3 events) · export mapping | COVERED |
| deletion zero orphans (Law 20) | del/mig | live H · e2e cleanup · orphan sweep | COVERED |
| idempotency (Law 24-analogue) | repo | det/live F (same key → same event) | COVERED |
| concurrency (advisory lock; already-promoted rejected) | repo | live F/G (ALREADY_PROMOTED) | COVERED |
| cross-founder isolation | repo | live H | COVERED |
| append-only (UPDATE + individual DELETE rejected, Law 17) | mig triggers | live H | COVERED |
| lifecycle ≠ promotion (ACTIVE/SUPPORTED grant nothing, Law 2) | dom | det (lifecycle/epistemic irrelevant) | COVERED |
| rationale + scope required (Laws 8, 9) | dom | det | COVERED |
| BU never "latest"; explicitly-selected revision (Law 12) | dom | det (later learning rev doesn't change pin) · e2e | COVERED |
| promotion mutates nothing else (Laws 4, 15, 16) | api/dom | live B (learning + BU-version unchanged) · e2e (no BU version, learning intact, FSC=0) | COVERED |
| no model authority (Law 21) | dom (no model path) | design + det (deterministic gate) | COVERED |
| rendered-UI flow: promote→refresh→refine→unchanged→replace→refresh→changed→remove→refresh→empty | ui | **e2e** (full flow + evidence) | COVERED |

**Deferred by governance (ADR-013):** any consumption of the promoted set to regenerate recommendations or adapt
reasoning; Strategic Execution; model-assisted promotion suggestions; memory/knowledge/relationship graphs; semantic
retrieval — none implemented.

---

## Remediation matrix (2026-07-21) — canonical effective composition + lineage

Classification **B**: the ledger existed but no canonical read consumed it. New impl: **comp** =
`effective-context.ts`; **mig** = `V080__learning_promotion_lineage.sql`; **api** = `strategy.routes.ts` (`/strategy/
effective-business-understanding`, `/strategy/effective-founder-strategic-context`); **ui** = `StrategyPage.tsx`
(`CanonicalEffectiveContext`); **det** = `strategic-learning-promotion.test.ts` (+9); **live** =
`strategic-learning-promotion.live.test.ts` (J/J2/K/L); **e2e** = `strategic-learning-promotion.spec.ts` (canonical view).

| # | Criterion | Impl | Test | Status |
|---|---|---|---|---|
| 1 | native BU appears in effective BU | comp/api | det (native present) · live J · e2e (`effective-bu-native`) | COVERED |
| 2 | PROMOTE adds exact learning revision | comp/api | det · live J · e2e (`effective-bu-revision`=1) | COVERED |
| 3 | promoted item includes sourceType + provenance | comp | det (provenance fields) · live J | COVERED |
| 4–7 | later REFINE/CONTEST/SUPERSEDE/RETIRE don't change effective BU | comp | det (pinned content) · live J2 · e2e (still rev 1 after refine) | COVERED |
| 8 | REPLACE changes effective BU to exact replacement | comp/repo | det · live J2 · e2e (rev 2) | COVERED |
| 9 | REMOVE removes promoted content from effective BU | comp/repo | live J2 · e2e (`effective-bu-promoted-empty`) | COVERED |
| 10/50 | native BU unchanged throughout | api | live J2 (present after remove) · e2e (understanding count stays 1) | COVERED |
| 11/60 | ledger history complete / export | exp | e2e (chain PROMOTE,REPLACE,REMOVE) · export lineage | COVERED |
| 12/13 | effective read performs no write / no regeneration | api | GET-only handler · e2e (session count 0) | COVERED |
| 14–17 | native FSC in effective FSC; PROMOTE to FSC; BU⊥FSC | comp/api | det (FSC compose) · live J · e2e (FSC step, BU empty) | COVERED |
| 18–20 | FSC lifecycle-pin/replace/remove; native FSC unchanged | comp | det · live (FSC analogue) | COVERED |
| 24–27 | all canonical readers use one composer; ledger routes separate; no false-canonical | api/ui | route wiring · e2e (`effective-*` vs `promotion-history`) | COVERED |
| 28/29/30/31/32 | deterministic order; no dedup; no conflict-infer; no latest-learning; survives refresh | comp | det (no-dedup, exact-pin) · e2e (persistence) | COVERED |
| 33–36 | PROMOTE seq 1; REPLACE/REMOVE exact predecessor; seq increments once | comp/repo/mig | det (nextLineage) · live K (1,2 + pred) · e2e (`1,2,3`) | COVERED |
| 37–39 | stale predecessor rejected; no fork; concurrent can't both win | mig/repo | live K (uniq_lpe_predecessor) · advisory lock | COVERED |
| 40 | idempotent retry → same event | repo | live F | COVERED |
| 41/42 | effective from sequence, not created_at | comp | det (identical-timestamp head) | COVERED |
| 43–45 | cross-founder/target/thread rejected | dom/repo | det (admission) · live H | COVERED |
| 46/47/48 | rows immutable; individual delete rejected; delete zero orphans | mig/del | live H · orphan sweep | COVERED |
| 49/51–59 | learning/BU/FSC/review/plan/commitment/decision unchanged; no rec/session/task/memory | api | live J2 · e2e (no session; learning intact) | COVERED |
| PROMOTE-after-REMOVE (chosen rule) | re-promote = next sequence | comp/repo | det · live L (seq 3) | COVERED |

**Reasoning-assembler separation (C-7):** `assembleStrategicContext` still reads native only — the *Strategic Learning
Consumption Gate* is deferred. Verified by e2e (no session/recommendation created) + code (assembler has 0 promotion refs).
