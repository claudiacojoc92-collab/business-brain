# Knowledge Architecture — current-state implementation map

Companion to [ADR-011 — Knowledge Architecture](../adr/ADR-011-knowledge-architecture.md). Maps every **currently
implemented** epistemic structure to its ADR-011 category, source of truth, lifecycle, and known architectural debt.
Documentation only — nothing here changes runtime behavior. Verified against the code at commit `4d6483b`.

## Component map

| Component | Repository path | ADR-011 category | Persistence / source of truth | Lifecycle | Recomputed vs persisted |
|---|---|---|---|---|---|
| Evidence fragments | `@bb/infrastructure` `PgEvidenceRepository`; table `evidence.fragments` | 1 Evidence | persisted (append) | observe/declare/infer | persisted |
| Business Understanding synthesis | `business-model/understanding.ts`, `understanding-worker.ts`, `business-understanding.service.ts`, `pg-understanding.repository.ts`; table `business.understanding` (V058) | 4 Understanding (+ 2 Observation / 3 Inference via conclusion epistemic status) | persisted, append-only versions | propose→confirm/partly/correct/reject→supersede | versions persisted; effective responses recomputed |
| Understanding generation runs | `understanding-run.ts`, `pg-understanding-run.repository.ts`; table `business.understanding_run` (V059) | provenance of 4 | persisted | run lifecycle | persisted |
| Conclusion responses | `pg-conclusion-response.repository.ts`; table `business.conclusion_response` (V060) | founder confirm/correct on 2/3/4 | persisted, append-only (`superseded_by`) | confirm/partly/correct/reject | persisted; effective = non-superseded |
| Public Positioning Context | `market-context.ts`, `market-context.service.ts`, `market-review.ts`, `market-review.worker.ts`, `pg-market.repository.ts`, `pg-market-review.repository.ts`, `pg-market-finding-response.repository.ts`, `anthropic-market-inference.ts`; tables `business.market_entity` (V061), `market_review` (V062), `market_finding`, `market_finding_response` (V063) + provenance (V064) + website-change (V065) | 5 Positioning (2 Observation + 3 Inference kept separate) | persisted | add entity→review→observe/infer→confirm relevance/accuracy→supersede on re-review | findings/reviews persisted; `effectiveMarketContext` recomputed |
| Founder Strategic Context | `founder-strategic-context.ts`, `pg-founder-strategic-context.repository.ts`; table `business.founder_strategic_context_item` (V067 + V068 append-only) | 6 Founder Strategic Context | persisted, **strictly append-only** (immutable versions + BEFORE-UPDATE trigger) | create→revise(append)→retire(append terminal)→expire/review | versions persisted; effective **derived** from `MAX(version)+lifecycle` |
| Effective resolver | `effective-strategic-context.resolver.ts` | 6→effective + 7 Conflict + 8 Unknown | pure (no persistence) | resolve as-of/scope; detect structural conflicts | **recomputed** |
| Deterministic conflicts (structural: GOAL_GOAL, GOAL_RESOURCE, HORIZON_FEASIBILITY, quantitative GOAL_CONSTRAINT) | `effective-strategic-context.resolver.ts` `detectStructuralContextConflicts` | 7 Conflict | not persisted (passed to model) | detect→surface | **recomputed** |
| `missingCriticalAreas` / `staleItems` | `effective-strategic-context.resolver.ts` | 8 Unknown / context health | not persisted | surface | **recomputed** |
| StrategicContextAssembler | `strategic-context.assembler.ts` | assembler (4+5+6+7+8 → 9) | not persisted; `recordAssembly` stores only a snapshot (understanding version + context health + horizon) | assemble per session | **recomputed** |
| Strategy model adapter + prompt | `anthropic-strategy.model.ts` (prompt `strategy-3`), `strategy.ts` normalizer, `strategy-classifier.ts`, `model-config.ts` (schema `strategy-recommendation-3`) | produces 9 | model output normalized | reason→normalize | ephemeral → persisted as the recommendation |
| Strategy session + recommendation | `strategic-session.worker.ts`, `pg-strategic-session.repository.ts`, `pg-strategic-response.repository.ts`; tables `business.strategic_session`, `strategic_response` (V066) + `context_conflicts` (V069) | 9 Recommendation (+ 7 NON_NEGOTIABLE_OPTION persisted) | persisted; recommendation immutable; responses append-only | propose→ACCEPT/REJECT/QUALIFY/… (append) | recommendation + session conflict persisted |
| optionAssessment | inside 9 (recommendation / insufficient JSON) | drives 7 NON_NEGOTIABLE_OPTION | persisted inside the immutable outcome | model-emitted | persisted with the outcome |
| ACCEPT semantics | `pg-strategic-response.repository.ts`, `pg-conclusion-response.repository.ts` | response on 4 / 9 | append-only response | accept/reject/qualify | persisted response; **writes no context/memory** (and **no decision**) |
| Strategic Decision Record | `strategic-decision.ts`, `pg-strategic-decision.repository.ts`; table `business.strategic_decision_record` (V072, append-only) | 10 Strategic Decision | persisted, **strictly append-only** (immutable revisions + BEFORE-UPDATE trigger) | founder-explicit create→supersede/reverse/retire (append) | revisions persisted; effective status **derived** from `MAX(revision)+lifecycle` |
| Provenance | reference fields across 4/5/6/7/9 | 6 Provenance | ids echoed + (for NON_NEGOTIABLE_OPTION) validated | — | persisted as snapshots |
| Export | `account/export.service.ts` | ownership | reads all founder-owned history (incl. strategic context all versions, strategic sessions/responses) | export | reads persisted |
| Delete | `account/delete.service.ts` | ownership | hard-deletes all founder-owned rows | delete | destroys persisted |
| **Legacy** recommendation/thread primitive | `recommendation-service.ts`, `recommendation.ts`, `pg-recommendation.repository.ts`, `thread-service.ts`, `thread.ts`, `pg-thread.repository.ts`; schema `memory.*` (`threads`, `recommendations`, `patterns`, `voice_signatures`, `intelligence_events`, `thread_events`) | M2/ADR-010 Layer-2 primitive — **not** 14 Strategic Memory | persisted | thread open/recur/resolve; recommendation emit | persisted |

## Known architectural debt

- **KA-1 — write-time provenance validation. RESOLVED** (Recommendation Provenance Integrity slice + bounded remediation;
  see `recommendation-provenance-integrity-slice.md`, `recommendation-provenance-integrity-remediation.md` +
  `../governance/recommendation-provenance-integrity-contract.md`). Write-time validation landed at `d89110c`; the
  bounded remediation closed two blockers — a **durable immutable manifest** (V071 `provenance_manifest`, schema `pm-1`;
  historical revalidation independent of the assembler / current effective context) and **whole-outcome degradation**
  (Option B; any invalid grounding reference → one bounded retry → else terminal INSUFFICIENT, so an unrelated valid
  reference cannot launder an unsupported claim). *New debt:* **PI-1 — claim-level grounding** (each grounding claim
  declares its exact references so only the affected claim is removed) is the product-preserving end state; not required
  for KA-1, deferred.
  The worker now builds a per-session, founder-scoped **input manifest** from the exact assembled context
  (`provenance.ts` `buildProvenanceManifest`, version `pm-1`) and validates **every** model-produced reference against it
  at write time (`validateRecommendationProvenance`), before persistence. Reference-kind → target-category is enforced;
  a `FOUNDER_STRATEGIC_CONTEXT` ref must match the exact immutable `id`/`logicalItemId`/`version` supplied. Invalid refs
  are **removed, never substituted**; a grounding kind with no locator degrades to reasoning; when all grounding
  collapses the outcome is downgraded to INSUFFICIENT (`groundingStatus` GROUNDED/DEGRADED/UNGROUNDED). The redacted
  validation summary (kind + reason only, never raw invalid ids) is persisted for export/historical fidelity (V070
  `provenance_validation`); schema `strategy-recommendation-4`, prompt `strategy-4`. Founder isolation is by
  construction (a cross-founder id is simply NOT_IN_MANIFEST). *Cross-slice note:* the NON_NEGOTIABLE_OPTION rule that
  previously carried the only write-time validation is now one case within the unified provenance pass.
- **KA-2 — legacy `memory.*` schema (later).** The M2/ADR-010-era recommendation/thread primitive (schema `memory.*`)
  coexists with the new Wave-4 strategy stack and is **not yet reconciled** under the ADR-011 taxonomy. It is **not**
  Strategic Memory (category 14). Its relationship to the new stack (whether it is retired, folded into Evidence, or kept
  as a separate Layer-2 primitive) is unresolved. *Remediation: later, when Capability C is formally opened; not
  blocking; do not extend it as if it were Strategic Memory.*
- **KA-3 — structural conflicts not persisted (accepted).** Structural conflicts (rules 1/2/4/5) are recomputed at
  assembly and passed to the model but not stored on the session, so a historical session does not retain the exact
  structural conflicts it reasoned under (only the NON_NEGOTIABLE_OPTION conflict is persisted). They are deterministically
  recomputable from the effective context as of the session. *Remediation: not required now; revisit if historical audit
  of the full conflict set becomes necessary.*

## Remediation timing summary

| Debt | Category | Required now? |
|---|---|---|
| KA-1 write-time provenance validation | 6 Provenance | **RESOLVED** (durable manifest + whole-outcome degradation) |
| PI-1 claim-level grounding (product-preserving) | 6 Provenance | No — deferred; not required for KA-1 |
| KA-2 legacy `memory.*` reconciliation | 14 (boundary) | No — later, at Capability C |
| KA-3 structural conflicts not persisted | 7 Conflict | No — accepted |

None of the debt is a governance blocker for this gate; all are recorded so future slices cannot treat them as resolved.
