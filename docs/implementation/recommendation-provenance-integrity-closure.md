# Recommendation Provenance Integrity — slice closure record

Resolves **KA-1** from ADR-011: recommendation provenance references were previously carried from model output without
comprehensive write-time validation (only the NON_NEGOTIABLE_OPTION path validated referenced items). Every displayed or
persisted grounded reference is now typed, resolvable, founder-isolated, version-aware, historically stable, restricted
to IDs supplied to the model, and safe for export and historical reconstruction.

Governance + architecture gate committed *before* implementation (`675c741`, atop the ADR-011 gate `0d5e41b`).

## Gate (committed first — `675c741`)

- **Governance contract** — [`recommendation-provenance-integrity-contract.md`](../governance/recommendation-provenance-integrity-contract.md):
  12 laws. The load-bearing ones: Law 1 *model output is not provenance*; Law 2 *input-bounded references* (a per-session
  manifest); Law 3 *exact historical identity*; Law 4 *founder isolation*; Law 6 *no silent substitution*; Law 8 *visible
  bounded degradation* (remove invalid refs; downgrade to INSUFFICIENT when grounding collapses); Law 9 *deterministic
  validation*; Law 10 *export fidelity*; Law 11 *no new memory*.
- **Architecture record** — [`recommendation-provenance-integrity-slice.md`](../architecture/recommendation-provenance-integrity-slice.md):
  the write-time audit (all provenance targets are immutable ULIDs; session snapshots carry `understanding_version`; no
  reconstruction migration is required — V070 persists only the validation *result* for export fidelity), the
  reference-kind → target-category map, the `pm-1` manifest, the validation pipeline, and the distinct
  prompt/schema/manifest versions.

## What was built (implementation — this commit)

**Deterministic validator** — [`provenance.ts`](../../apps/api/src/business-model/provenance.ts):
- `buildProvenanceManifest(context)` → a `pm-1` manifest built from the **exact assembled `StrategicContext`**:
  `understandingVersion`, conclusion ids, responded-conclusion ids, entity ids, finding ids, source URLs, context-item
  ids, and the effective `logicalItemId → {id, version}` map. It is **founder-scoped by construction** — the manifest can
  only contain this founder's supplied ids, so a cross-founder id is simply `NOT_IN_MANIFEST` (Law 4 with no impure DB
  lookup).
- `validateRecommendationProvenance(outcome, manifest)` classifies every reference: a non-grounding kind (or a grounding
  kind with **no locator**) is stripped to reasoning (`CONVERSATION_HYPOTHESIS`, never a false grounding label); a
  grounding kind is validated against its target category, with `FOUNDER_STRATEGIC_CONTEXT` requiring the **exact**
  immutable `id`/`logicalItemId`/`version`. Duplicates are de-duplicated. Invalid refs are **removed, never substituted**.
  When no validated grounded reference survives (supporting ∪ declarations), the outcome is rebuilt as
  `INSUFFICIENT_STRATEGIC_EVIDENCE`. Rejection reasons: `MALFORMED | UNSUPPORTED_KIND | NOT_IN_MANIFEST | VERSION_MISMATCH
  | DUPLICATE`. Grounding status: `GROUNDED | DEGRADED | UNGROUNDED | NOT_APPLICABLE`.

**Worker wiring** — [`strategic-session.worker.ts`](../../apps/api/src/business-model/strategic-session.worker.ts):
after normalize, `buildProvenanceManifest(context)` → `validateRecommendationProvenance` runs **before** persistence; the
validated outcome then feeds `computeSessionContextConflicts`; the branch persists READY (with the cleaned recommendation
+ redacted validation summary) or INSUFFICIENT. Terminal degradation is deterministic — no extra model round-trip (the
durable worker's existing attempt-retry already covers `MODEL_FAILED`).

**Persistence** — `V070__strategic_session_provenance_validation.sql` adds `business.strategic_session.provenance_validation
JSONB`. The stored summary is **redacted**: kind + reason only, never a raw invalid id. Repo
([`pg-strategic-session.repository.ts`](../../apps/api/src/business-model/pg-strategic-session.repository.ts)) writes it on
`markReady`/`markInsufficient` and reads it back in `toDomain`.

**Versions** — prompt `strategy-3 → strategy-4` (reinforced "a refId/entityId/logicalItemId/sourceUrl is grounded ONLY if
it appears verbatim in the supplied context; NEVER invent"); schema `strategy-recommendation-3 → strategy-recommendation-4`
(additive `validated?` marker; normalizer reads both, old sessions stay readable); manifest `pm-1`.

**Surfaces** — [`export.service.ts`](../../apps/api/src/account/export.service.ts) includes the redacted
`provenanceValidation` in the founder export; account deletion removes it with the session (zero orphans). The UI
([`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx)) renders a `source` link **only** on a `validated`
reference and shows a founder-safe note when grounding degraded — no raw internal ids, no personality language.

## Acceptance evidence

- **Deterministic (Part 12, 20 cases).** `provenance.test.ts` (14 `it` blocks) covers cases 1–16 + 19 + the manifest and
  DEGRADED cases; the DB-backed cases 17 (export claims no unresolved ref as validated) and 18 (deletion removes all new
  provenance records) are in `provenance.live.test.ts`; case 20 (ACCEPT writes no context/understanding/decision/
  commitment/memory) verified live (below). **19 automated tests pass.**
- **Live API (Part 13, A–E).** `provenance.live.test.ts` (5 tests) exercises the real durable worker: B (invalid refs
  removed, session stays READY/DEGRADED), grounding-collapse (INSUFFICIENT/UNGROUNDED), C (historical session retains the
  **exact** supplied item version after the item is revised), E (another founder's id is not in the manifest and is
  rejected, never leaked), and export-includes-summary / delete-removes-it. Scenario A (all references valid) was run as a
  real durable session for a controlled non-production founder → READY, `strategy-recommendation-4`, `provenance_validation
  = {rejected:[], validatedCount:4, groundingStatus:"GROUNDED", manifestVersion:"pm-1"}`, all 4 grounded refs `validated:
  true` and resolving to stored records.
- **Case 20 verified live.** For the Scenario-A founder, a real `ACCEPT` (`POST /strategy/sessions/:id/responses`) moved
  only `business.strategic_response` 0 → 1 (append-only). Context, understanding, conclusion responses, and every
  `memory.*` table were unchanged. ACCEPT writes no context, understanding, decision, commitment, or memory.
- **Browser (Part 14).** The READY recommendation renders with grounded "FROM YOUR BUSINESS" / goal citations, founder-safe
  language, no raw internal ULIDs dominating the surface, no personality language; a fresh navigation to `/strategy`
  re-hydrates the historical view intact.
- **Evaluation (Part 15).** [`wave4-provenance-eval.ts`](../../tools/eval/wave4-provenance-eval.ts) runs the exact
  production SYSTEM prompt + normalizer + deterministic validator over synthetic fixtures with known ids. **3/3 twice.**
  Direct KA-1 evidence: the **real model invented ~1 reference id per grounded recommendation** (validated 3–4, rejected
  1), caught and removed deterministically with grounding intact (DEGRADED). The fabricated-grounding probe always
  degraded to INSUFFICIENT/UNGROUNDED; the ungrounded-context fixture returned INSUFFICIENT. See
  [`wave4-provenance-eval-results.json`](../../tools/eval/wave4-provenance-eval-results.json).
- **Regression.** Backend 776 pass / 1 skip; web build (tsc clean + vite) green; web 73 tests pass; migrations V066–V070
  present, V070 column live; frozen engine hashes byte-identical (prompt `a39ea88…`, schema `79802e9…`, index `f9df116…`).

## Scope discipline

No Strategic Decision Memory, Strategic Commitments, plans, execution, tasks, agents, market discovery, or general Founder
Conversation added. The legacy `memory.*` schema (KA-2) was not reconciled. The frozen engine was not modified. No generic
citation infrastructure beyond what current Business Brain recommendations require. Not deployed, not pushed, no prior
commit amended.

**KA-1 status: RESOLVED.** Identified by ADR-011; resolved by this slice.
