# Strategic Learning Consumption Gate — criterion-to-test matrix

Maps every acceptance criterion (ADR-014 / contract L1–L12 / prompt Parts 9–10) to its covering test. **det** =
`apps/api/src/__tests__/business-model/context-snapshot.test.ts`; **live** = `context-snapshot.live.test.ts` (A–E); **e2e**
= `apps/web/e2e/strategic-learning-consumption.spec.ts`. Impl: **dom** = `context-snapshot.ts`; **cap** =
`context-snapshot.capture.ts`; **repo** = `pg-context-snapshot.repository.ts`; **asm** = `strategic-context.assembler.ts`
(`frozen` param); **wrk** = `strategic-session.worker.ts`; **api** = `strategy.routes.ts`; **mig** =
`V081__context_snapshot.sql`; **ui** = `StrategyPage.tsx` (`ContextSnapshots`); **exp/del** = `export.service.ts` /
`delete.service.ts`.

| Criterion (law) | Impl | Test | Status |
|---|---|---|---|
| L1 consumption is explicit (only via a founder-created snapshot + explicit generate) | api/wrk | live C · e2e (create + generate) | COVERED |
| L2 promotion never implies consumption (PROMOTE makes no snapshot) | api | live A (snapshot unchanged after PROMOTE) · e2e | COVERED |
| L3 consumption never mutates context | cap/api | live A/C (BU/FSC/understanding untouched) · e2e (understanding=1) | COVERED |
| L4 consumption never mutates learning | cap/api | live C (learning intact after generate) · e2e (learning=1) | COVERED |
| L5 recommendation history immutable | wrk/mig | live C (stored recommendation unchanged) | COVERED |
| L6 recommendations reproducible (reason over frozen snapshot) | dom/wrk/asm | live C (BU_CONCLUSIONS=2 stays after later change) | COVERED |
| L7 every recommendation records the exact snapshot consumed | wrk/api | live C (`contextSnapshotId`=snap) · e2e (session.context_snapshot_id) | COVERED |
| L8 later context changes never rewrite old snapshots/recommendations | repo/mig | live A/B (snapshot hash+payload frozen after promote/refine) · e2e (hash unchanged) | COVERED |
| L9 regeneration is explicit (new snapshot + new generate) | api/ui | e2e (2nd snapshot differs; generate is a separate click) | COVERED |
| L10 no automatic invalidation | mig/api | live A (old snapshot still readable, unchanged) | COVERED |
| L11 no background recomputation | (no scheduler/worker path) | design + live (no recompute observed) | COVERED |
| L12 no model authority (deterministic founder-driven) | dom/cap | det (pure build) · design | COVERED |
| snapshot freezes context (deterministic content hash) | dom | det (hash deterministic + content-sensitive) · live A | COVERED |
| snapshot = native BU + promoted learnings, provenance preserved | cap | det (promoted FSC survives) · live C (2 BU conclusions) · e2e (1 promoted) | COVERED |
| RecommendationInput carries snapshotId + frozen payload + timestamp | dom | det (`toRecommendationInput`) | COVERED |
| the legacy live path is unchanged (no auto-consumption) | asm/wrk | live D (BU_CONCLUSIONS=1) · full backend regression | COVERED |
| append-only (UPDATE + individual DELETE rejected) | mig | live E | COVERED |
| cross-founder isolation | repo | live E | COVERED |
| export full snapshots; account-delete zero orphans | exp/del | live E · e2e cleanup · orphan sweep | COVERED |
| rendered-UI: create → inspect → context changes → snapshot frozen → new snapshot differs → generate binds | ui | **e2e** (+ 3 evidence PNGs) | COVERED |

**Deferred by governance (ADR-014):** automatic recommendation regeneration/invalidation; background recomputation;
freezing public-positioning/market context into the snapshot; Strategic Execution; agents; event-driven orchestration;
memory; knowledge/relationship graphs; embeddings; semantic retrieval — none implemented.
