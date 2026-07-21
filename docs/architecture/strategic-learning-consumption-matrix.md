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

---

## Remediation matrix (2026-07-21) — mandatory gate + full-input reproducibility

New/changed impl: **dom** = `context-snapshot.ts` (SHA-256 + full payload); **cap** = `context-snapshot.capture.ts` (freezes
public-positioning); **asm** = `strategic-context.assembler.ts` (`frozen` covers all three dimensions); **wrk** =
`strategic-session.worker.ts` (mandatory + integrity + provenance); **repo** = `pg-strategic-session.repository.ts`
(`generation_contract_version` + `recordGeneration`); **api** = `strategy.routes.ts` (require snapshot / gate legacy
retry); **mig** = `V082__consumption_gate_mandatory.sql`; **ui** = `StrategyPage.tsx` (ask-gate + legacy label); **model** =
`anthropic-strategy.model.ts` (`promptTemplateHash` + `modelConfiguration`). **det** = `context-snapshot.test.ts`; **live**
= `context-snapshot.live.test.ts` (A–E); **e2e** = `strategic-learning-consumption-gate.spec.ts`.

| # | Criterion | Impl | Test | Status |
|---|---|---|---|---|
| 1–5 | new generation without/with-null/foreign/missing snapshot rejected (API + domain + repo CHECK + worker) | api/repo/mig/wrk | live D (worker CONTEXT_SNAPSHOT_REQUIRED) · e2e (400 + disabled button) | COVERED |
| 6/7 | foreign / nonexistent snapshot rejected | api/wrk | e2e (missing→400) · live E (isolation) | COVERED |
| 8/9 | valid snapshot accepted; every new session non-null snapshot (contract v1) | repo/mig | live C · e2e (context_snapshot_id + contract=1) | COVERED |
| 10/11 | no alternate endpoint / UI action bypasses the gate | api/ui | e2e (Generate disabled w/o snapshot) · route audit | COVERED |
| 12–14 | legacy null-snapshot sessions readable; can't regenerate live; not mutated | api/ui | e2e (legacy badge + no-retry) · retry-route 400 | COVERED |
| 15–20 | snapshot-bound generation performs no live BU/FSC/promotion/market/positioning read | asm/wrk | live C (frozen consumed) · det (frozen projections) | COVERED |
| 21–26 | later BU/FSC/PROMOTE/REPLACE/REMOVE/refine does not change generation | dom/wrk | live A/B (snapshot frozen) · e2e (hash unchanged after REMOVE) | COVERED |
| 27–35 | every consumed field frozen/pinned; provenance preserved; schema version recorded | cap/dom | det (public-positioning survives) · live C | COVERED |
| 36–44 | SHA-256 64-hex, key-order-stable, array-sensitive, content-sensitive, client can't supply, recompute-verify, export-preserved | dom/api/exp | det (SHA-256 vectors + integrity) · e2e (64-hex) | COVERED |
| 45–55 | session records snapshot id/hash/schema/strategist/prompt-hash/model/config/objective/generatedAt; client can't override | wrk/repo/model | live C · e2e (prompt_template_hash + provenance columns) | COVERED |
| 56–61 | snapshot immutable; learning/promotion/BU/FSC/recommendation history unchanged (append-only) | mig | live E (UPDATE/DELETE rejected) · e2e (BU=1, learning=1) | COVERED |
| 62–66 | no auto regeneration/invalidation; no Decision/…/task/memory writes | api/wrk | e2e (no session change on context change) · scope | COVERED |
| 67 | account deletion zero orphans | del/mig | live E · orphan sweep (0) | COVERED |

**Deferred (unchanged):** automatic regeneration/invalidation/recomputation, Strategic Execution, agents, memory, graphs,
embeddings, semantic retrieval.
