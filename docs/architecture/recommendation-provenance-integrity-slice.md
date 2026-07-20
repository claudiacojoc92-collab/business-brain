# Recommendation Provenance Integrity — slice architecture

> **Amended by [`recommendation-provenance-integrity-remediation.md`](recommendation-provenance-integrity-remediation.md)**
> (supersedes the d89110c acceptance). Two blockers were closed: the allowed-reference manifest is now **persisted
> immutably** (V071) so historical revalidation never uses the assembler/current effective context, and degradation is
> now **whole-outcome** (Option B) rather than "collapse only when zero grounded". Read this record together with the
> remediation record; where they differ, the remediation governs.

Resolves **KA-1** (ADR-011). Smallest design that makes every grounded recommendation reference typed, resolvable,
founder-isolated, version-exact, historically stable, input-bounded, and safe for export/reconstruction. Recorded before
implementation; governed by [`recommendation-provenance-integrity-contract.md`](../governance/recommendation-provenance-integrity-contract.md).

## §1 — Audit (recorded before any code change)

**Reference producers & shapes:**
- `EvidenceReference` (in `reasoning.supportingEvidence` / `founderDeclarations` / `counterEvidence`): epistemic `kind` +
  locators `refId`, `entityId?`, `sourceUrl?`, `logicalItemId?`, `version?`, `scope?`, `source?`. Produced by the model;
  normalizer `strategy.ts:ref()` **carries all locators verbatim, no validation**.
- `ConflictReference` (`reasoning.conflicts`): `refId?` — carried, unvalidated.
- `optionAssessment[].excludedByContextRefId` — **validated** by the worker (`computeSessionContextConflicts`) against
  effective non-negotiables (bad ref discarded).
- `SessionContextConflict.itemIds` (NON_NEGOTIABLE_OPTION) — **validated** (derived from the validated option assessment).

**Target inventory (ids the assembler supplies to the model), by reference kind:**

| Target category | manifest id source (assembler) | id format | immutable | versioned |
|---|---|---|---|---|
| BUSINESS_UNDERSTANDING (conclusion) | `businessUnderstanding.conclusions[].id` | ULID (`generateId`) | yes | belongs to `businessUnderstanding.version` (session snapshot) |
| BUSINESS_UNDERSTANDING (founder response) | `founderResponses[].conclusionId` | ULID | via conclusion | via version |
| PUBLIC_POSITIONING_CONTEXT (finding) | `observations[].findingId`, `inferences[].findingId` | ULID | yes | n/a (superseded, not deleted) |
| PUBLIC_POSITIONING_CONTEXT (entity) | `entities[].id` | ULID | yes | n/a |
| PUBLIC_POSITIONING_CONTEXT (source url) | `observations[].sourceUrl` | URL string | stable | n/a |
| FOUNDER_STRATEGIC_CONTEXT (item) | `founderContext.*[].id` + `logicalItemId` + `version` | ULID + int | yes (append-only) | yes |

**Reference-kind → target-category map (deterministic):**
- `OBSERVED_BUSINESS_EVIDENCE`, `BUSINESS_UNDERSTANDING_INFERENCE` → BUSINESS_UNDERSTANDING (locator: `refId` = conclusion id).
- `PUBLIC_POSITIONING_OBSERVATION`, `MARKET_INFERENCE` → PUBLIC_POSITIONING_CONTEXT (locator: `refId` = finding id, or `entityId`, or `sourceUrl`).
- `FOUNDER_STRATEGIC_CONTEXT` → FOUNDER_STRATEGIC_CONTEXT (locator: `refId`/`logicalItemId` + `version`).
- `FOUNDER_DECLARATION`, `FOUNDER_CORRECTION`, `FOUNDER_RELEVANCE_DECISION` → BUSINESS_UNDERSTANDING (a conclusion the
  founder responded to) **or** FOUNDER_STRATEGIC_CONTEXT (a declared item): validated against either allowed set.
- `UNKNOWN`, `CONVERSATION_HYPOTHESIS`, `STRATEGIC_RECOMMENDATION` → **non-grounding** (the strategist's own reasoning):
  no target; a locator, if present, is stripped so it can never render as a citation.

**Gaps found (KA-1):** model-invented ids, valid-syntax-nonexistent ids, cross-founder ids, and current-but-not-supplied
ids are all **carried, persisted, and rendered as grounded** today; export carries the recommendation JSON verbatim.
Only `excludedByContextRefId` is validated. **Historical reconstruction is already sound** — every target id is an
immutable ULID and the session snapshots `understandingVersion` — so no migration is needed for reconstruction; a small
column is added only to persist the *validation result* for export fidelity and audit.

## §2 — Canonical reference contract

The application-level reference stays `EvidenceReference` (its epistemic `kind` deterministically maps to a target
category via the table above; its existing locators are the lookup keys). One additive field:
`validated?: boolean` — set true by the validator when the reference resolved to the manifest. **Display labels are never
lookup keys.** Supported grounded target kinds this slice: BUSINESS_UNDERSTANDING, PUBLIC_POSITIONING_CONTEXT,
FOUNDER_STRATEGIC_CONTEXT (and, via kind, source-url/entity within positioning). No reference kinds are created for
unimplemented Decision/Commitment/Plan/Execution. `SESSION_CONTEXT_CONFLICT` is not a *recommendation-content* reference
(the conflict is a session object with already-validated item ids), so it is not added as an EvidenceReference kind.

**Observations vs inferences:** in Public Positioning Context they are **separate finding rows with independent immutable
ULIDs**, so both are citable directly. In Business Understanding they are conclusion rows with independent ULIDs. No
pretense of citing a sub-object that lacks an id.

## §3 — Provenance manifest (`pm-1`)

A deterministic `ProvenanceManifest` built from the exact assembled `StrategicContext` (founder-scoped by construction):
- `understandingVersion` (the version snapshot);
- `conclusionIds: Set` (from the assembled BU conclusions);
- `respondedConclusionIds: Set` (conclusions with a founder response);
- `entityIds: Set`, `findingIds: Set`, `sourceUrls: Set`;
- `contextItemIds: Set` (exact FSC version ids) + `contextItemVersionByLogical: Map<logicalId, {id, version}>`.

**Not persisted as a separate table.** Historical reconstruction is guaranteed by the immutable target ids already stored
in the (validated) references + the session's `understandingVersion`. The manifest is rebuildable, but per ADR-011 a later
*re-assembly of current effective context is not proof of what the model saw* — so the **validated references themselves**
(immutable ids) are the durable historical record, and the **validation result** is persisted (below).

## §4 — Validation pipeline (deterministic; between normalize and persist)

Worker flow: assemble → build manifest → model.reason → normalize → **validate** → apply policy → persist.

`validateRecommendationProvenance(outcome, manifest)`:
1. For each `EvidenceReference` (supportingEvidence/founderDeclarations/counterEvidence): derive target category from
   `kind`. Non-grounding kinds → strip any locator, keep as reasoning (never grounded). Grounding kinds with a locator →
   validate the locator against the manifest set for that category (FSC: exact id ∈ contextItemIds, and if
   `logicalItemId`+`version` present they must match the manifest's exact version). Grounding kinds with **no** locator →
   not a grounded reference (treated as unsupported reasoning; not counted as grounding).
2. A validated grounded reference gets `validated: true`. An invalid grounded reference is **removed** (Law 6 — never
   substituted) and recorded in a redacted rejection list `{kind, reason}` (never the raw invalid id).
3. `reasoning.conflicts[].refId` validated against `conclusionIds`; an invalid one is nulled.
4. Detections (each a distinct `reason`): `MALFORMED`, `UNSUPPORTED_KIND`, `MISSING_TARGET`, `CROSS_FOUNDER`
   (a missing target for a founder-scoped manifest *is* the cross-founder/foreign-id case — the manifest never contains
   another founder's ids), `VERSION_MISMATCH`, `NOT_IN_MANIFEST`, `DUPLICATE`.
5. Result: `{ outcome (cleaned), groundingStatus, validatedCount, rejectedCount, rejected: [{kind, reason}] }`.

Cleaned outcome + policy (Law 8):
- If the recommendation retains **≥1 validated grounded reference** in supportingEvidence∪founderDeclarations →
  `groundingStatus = GROUNDED` (or `DEGRADED` if any reference was rejected) → persist READY with the cleaned outcome.
- If it retains **0** validated grounded references → downgrade to `INSUFFICIENT_STRATEGIC_EVIDENCE` (grounding failure),
  `groundingStatus = UNGROUNDED`.
- INSUFFICIENT outcomes: validate their `optionAssessment.excludedByContextRefId` (already validated in the rule-3 path);
  `groundingStatus = N/A`.

No extra model round-trip: the durable worker's existing attempt-level retry covers `MODEL_FAILED`; provenance failures
degrade deterministically (Law 9), which is simpler and strictly safe. (A future corrective-retry is noted as optional.)

## §5 — Persistence

Migration **V070**: `business.strategic_session.provenance_validation JSONB` (nullable, additive) storing
`{ manifestVersion:'pm-1', groundingStatus, validatedCount, rejectedCount, rejected:[{kind,reason}] }`. Founder-isolated
(on the session row), written transactionally in the same `markReady`/`markInsufficient` update as the outcome,
immutable after session completion, **deleted with the session** (existing delete removes the row — no new table),
exported. No graph/vector/knowledge-graph storage; no source-document copying; no new memory.

## §6 — Schema / prompt / manifest versions (distinct)

- **Prompt version:** `strategy-3 → strategy-4` (reinforce: cite only ids present in the supplied context; do not invent
  or reconstruct ids from prose).
- **Recommendation schema version:** `strategy-recommendation-3 → strategy-recommendation-4` (adds the optional
  `validated` marker on references). Additive; the normalizer reads v1–v4; persisted v1/v2/v3 recommendations remain
  readable and are not rewritten.
- **Provenance-manifest version:** `pm-1` (new, recorded in `provenance_validation`).

## §7 — API / UI / export / delete

- API `toSessionView` surfaces `groundingStatus` + (for READY) the recommendation with `validated` markers.
- UI (`StrategyPage`) renders a validated grounded reference as a citation; a non-grounding reasoning item is shown as
  the strategist's reasoning, **not** as a resolvable citation (no `source` link unless the reference validated). A
  historical reference to a now-superseded/retired/expired target still renders (it validated at generation) — it is
  historical, not invalid. Unresolved references never reach the UI (removed at write time).
- Export: adds `schemaVersion` (already present) + `provenanceValidation` summary per strategy session; the recommendation
  it exports contains only validated references.
- Delete: `provenance_validation` is on the session row → removed by the existing founder delete; verify zero orphans.

## §8 — Historical reconstruction & isolation

Reopening a session resolves each persisted (validated) reference by its immutable id: BU conclusion id within
`session.understandingVersion`; FSC exact item-version id (append-only, never mutated); finding/entity ULID (persisted).
A later revise/retire/expire/supersede of effective state does not touch these immutable rows, so the historical view is
stable (Law 7). Cross-founder resolution is impossible: the manifest is built only from the session founder's assembled
input, and resolution is manifest-bounded.

## §9 — Out of scope / known limits

- Statement-level partial grounding is not represented (references are the citation unit); grounding collapse degrades
  the whole outcome (Law 8) — acceptable and documented.
- KA-2 (legacy `memory.*`) and KA-3 (structural conflicts not persisted) are **not** addressed here.
- Corrective model-retry for provenance failures is deferred (deterministic degradation is used).

## Build order

governance + architecture (gate, committed first) → provenance domain (manifest + validator) → worker wiring + V070 +
session repo + schema/prompt bump → UI + export/delete → deterministic tests → live A–E → browser → eval → regression +
closure → one implementation commit.
