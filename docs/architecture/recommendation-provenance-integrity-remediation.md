# Recommendation Provenance Integrity — bounded remediation (amends d89110c)

This record **supersedes the acceptance declaration made at `d89110c`**. Two acceptance blockers were found. It opens
with the two required audits (recorded before any code change), then the chosen bounded designs and lifecycle. It amends
`recommendation-provenance-integrity-slice.md` and `../governance/recommendation-provenance-integrity-contract.md`.

Starting HEAD: `d89110c` (feature/axe-wave2-understanding).

---

## Audit 1 — what is actually persisted (Blocker 1)

Read from V066/V069/V070 and the repository (`pg-strategic-session.repository.ts`) + worker (`strategic-session.worker.ts`).

**`business.strategic_session` persists today:**

| Field | Meaning | Provenance value |
|---|---|---|
| `understanding_version` (int) | which BU version reasoned | a **snapshot pointer**, not the reference set |
| `context_health` (jsonb) | missing/stale/contradictory areas | health only |
| `decision_horizon` (text) | horizon | — |
| `recommendation` (jsonb) | the immutable outcome, with embedded references carrying `validated:true` | proves **what was cited & accepted**, not what was **permitted** |
| `insufficient_reason` (jsonb) | INSUFFICIENT outcome | — |
| `context_conflicts` (jsonb) | NON_NEGOTIABLE_OPTION conflict (`itemIds`) | resolves to immutable items |
| `provenance_validation` (jsonb) | **redacted** summary `{manifestVersion, groundingStatus, validatedCount, rejectedCount, rejected:[{kind,reason}]}` | proves counts + rejection kinds, **not** the allowed set |
| `model_id` / `prompt_version` / `schema_version` | model + contract versions | — |

`recordAssembly` persists **only** `understandingVersion`, `contextHealth`, `decisionHorizon`. The full assembled
`StrategicContext` is **not** persisted. The `pm-1` manifest is built **transiently** in the worker
(`buildProvenanceManifest`) and **discarded** after validation.

**What is NOT reconstructable:** the exact allowed-reference set the model was permitted to cite for that historical
session — the conclusion ids, responded-conclusion ids, entity ids, finding ids, source URLs, context-item ids, and the
exact `logicalItemId → {id, version}` map. The persisted recommendation carries only the **selected** validated
references, not the **full permitted** set. Historical revalidation today would have to rebuild the manifest from the
**current** effective context via the assembler — which depends on current resolver behaviour and would substitute
**later** item versions.

**Failed governance requirements:** input-bounded references; exact historical identity; historical stability;
deterministic historical revalidation; exact reconstruction of what the model was permitted to reference.

### Design (smallest durable representation)

Persist an **immutable, serialized manifest** transactionally bound to the generated outcome — the smallest design that
satisfies reconstruction without a new table or repository.

- **Migration V071** adds `business.strategic_session.provenance_manifest JSONB` (additive, nullable; existing sessions
  read as none).
- **Serialized shape** (`SerializedProvenanceManifest`, manifest schema version `pm-1`):
  ```
  { manifestVersion: 'pm-1', understandingVersion: number|null, entries: [
      { space:'CONCLUSION'|'RESPONDED_CONCLUSION'|'ENTITY'|'FINDING'|'SOURCE_URL'|'CONTEXT_ITEM',
        id, logicalItemId?, version?, suppliedToModel:true } ] }
  ```
  Each entry carries the **immutable target id**, reference kind/space (→ target/entity type), `logicalItemId` + exact
  `version` where applicable, and `suppliedToModel`. **No display labels** are persisted as lookup authority; **no source
  bodies/documents** are copied. `createdAt` is the session's `finished_at`/terminal write time (the row's own timestamp).
- **`serializeProvenanceManifest(m)` / `deserializeProvenanceManifest(s)`** in `provenance.ts` round-trip the manifest;
  `deserialize` rebuilds the exact `Set`/`Map` shape so `classifyRef` validates a historical reference **unchanged**
  against the stored manifest.
- **Lifecycle / immutability:** the serialized manifest is written **in the same terminal UPDATE** that publishes the
  outcome (`markReady` / `markInsufficient`, guarded `WHERE status='PROCESSING'`), so it is **transactionally bound to the
  generated outcome** and written exactly once at the terminal transition. `READY` is terminal ⇒ the manifest is immutable
  thereafter. A later assembler-logic change cannot alter a stored manifest (it is data, not recomputed). A retry of a
  FAILED/INSUFFICIENT session is a **new attempt** that re-assembles and re-publishes its own manifest bound to its own
  outcome — it never rewrites a prior terminal manifest. Retirement/expiration of a context item after generation appends
  new item versions elsewhere and **never touches** the stored manifest.
- **Historical revalidation** (`revalidateAgainstStoredManifest`) deserializes the stored manifest and re-runs
  `validateRecommendationProvenance` — **never** the assembler, **never** current effective context.

---

## Audit 2 — claim-to-reference granularity (Blocker 2)

Read from `strategy.ts` (`StrategicRecommendation`).

**Reference attachment in the current schema:**

- `recommendation: { title, action, horizon, priorityRank? }` — **free prose, no references attached.**
- `reasoning.supportingEvidence: EvidenceReference[]` — a **recommendation-global bag**. Each reference has its own
  `statement`, but references are **not** bound to the `title`/`action` claim, to each other, or to a claim id.
- `reasoning.founderDeclarations` / `counterEvidence: EvidenceReference[]` — same global bags.
- `reasoning.conflicts: ConflictReference[]` — carry a `refId`.
- `optionAssessment: [{ label, supportedByEvidence:boolean, excludedByContextRefId }]` — `supportedByEvidence` is a
  **bare boolean not bound to any references**; there is no way to know which references support an option.
- `nextStep`, `alternatives` — free prose, no references.

**Conclusion:** references are attached at the **recommendation-global** level. The load-bearing surfaces — the
`recommendation.title`/`action` prose, the `optionAssessment[].supportedByEvidence` flags, `nextStep`, `alternatives` —
have **no reliable binding to their exact references**. The schema **cannot reliably bind every grounding claim to its
exact references** ⇒ **Option A (claim-level) is not safely representable ⇒ Option B (whole-outcome degradation) is
required.**

**Product defect found.** The current policy keeps a `READY`/`DEGRADED` recommendation as long as **any single** grounded
reference survives **anywhere** in the outcome (`validateRecommendationProvenance`: degrade only when `validatedGrounded
=== 0`). So when the model invents the reference that actually supported the **primary** recommendation (evaluation: the
real model invents ~1 reference id per grounded recommendation) while an **unrelated** reference happens to validate, the
invented reference is removed but the primary recommendation prose and `supportedByEvidence` flags **survive as
grounded** — an unrelated valid reference **launders** the unsupported primary claim. This is precisely the Scenario C
false-positive.

### Governed behaviour (Option B — whole-outcome degradation)

- A `STRATEGIC_RECOMMENDATION` is persisted as **grounded READY only when `rejectedCount === 0` and `groundingStatus ===
  'GROUNDED'`** — every grounding reference resolved; **no** invented grounded reference was present.
- If any grounding reference is invalid (`rejectedCount > 0`, i.e. a `DEGRADED` result), grounding integrity has failed:
  **one bounded inline retry** re-runs the model on the same context. If the retry **still** contains an invalid grounded
  reference, the outcome is **not** persisted as grounded READY — it degrades to `INSUFFICIENT_STRATEGIC_EVIDENCE` with a
  founder-safe explanation. Bounded (exactly one extra reason call); the durable transient-failure retry budget is
  untouched.
- **No ambiguous middle state.** `DEGRADED` is now a **transient** signal only; it is **never** a persisted READY.
- **Prefer false-negative grounding over false-positive.**
- **Deterministic grounding-language guard** (`assertsGroundingClaim`): the persisted terminal degrade outcome carries a
  canned founder-safe explanation with **no** grounding phrases ("your evidence shows", "your data proves", "based on the
  supplied source", "according to your business context", "the founder context establishes", …). Rejected raw ids are
  never exposed (API/UI/logs/export) — the existing redaction rule stands.

**Honest cost (recorded).** Because the current model invents ~1 reference id per grounded recommendation, Option B will
frequently degrade real grounded recommendations to `INSUFFICIENT` after the bounded retry. This is the deliberate
false-negative-over-false-positive trade. The product-preserving end state is **claim-level binding** (each grounding
claim declares its exact references, so only the affected claim is removed) — a future recommendation-schema evolution,
recorded as **remaining debt PI-1**. It is out of scope for this bounded remediation.

---

## Schema / migration / version discipline

- **V071** `provenance_manifest JSONB` — the only migration. No manifest table (a column is smallest for reconstruction).
- **Manifest schema version:** `pm-1` (first *persisted* form; the transient `pm-1` and the serialized `pm-1` are the
  same contract — no bump, no prior persisted shape existed to break).
- **Recommendation schema / prompt versions:** the *persisted recommendation shape is unchanged* (no field added or
  removed) — the change is a **degradation policy**, not a contract shape change — so `strategy-recommendation-4` /
  `strategy-4` are **retained** (no bump without a real contract change). Prior recommendation schemas remain readable;
  no historical session is rewritten.

## API / UI / export

- Historical session views resolve references using the **stored manifest**, never current effective context. Each
  grounded `FOUNDER_STRATEGIC_CONTEXT` reference gets a read-time `historicalStatus`: `EFFECTIVE` (version == current
  effective), `SUPERSEDED` (a newer effective version exists), `RETIRED` (logical item now retired/absent). Immutable
  BU/positioning references are `EFFECTIVE`. **Invalid/unresolved references never appear** (removed at write time) —
  "invalid never grounded" holds by construction.
- Export carries the bounded historical manifest (immutable ids + versions + kinds + `suppliedToModel`) plus the existing
  redacted validation summary — enough to audit what was **permitted**, **validated**, and **rejected (by kind/reason)**,
  and the exact immutable target versions + manifest schema version. No rejected raw ids.
- Account deletion removes the manifest with the session row (no new table ⇒ zero orphans).

## KA-1 status

KA-1 remains **open** until both blockers land. On landing: durable historical reconstruction + validation independent of
current effective context + no falsely-grounded survivors ⇒ **KA-1 RESOLVED**. Remaining debt: **PI-1** (claim-level
grounding, product-preserving) — not required for KA-1.
