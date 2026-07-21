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
