# Wave 4 · Founder Strategic Context — slice 1 architecture

Smallest architecture to let a founder explicitly record, inspect, and revise strategic context, and have the existing
`PRIORITY_DECISION` job consume the *effective* context. Recorded before implementation. Governed by
[`founder-strategic-context-contract.md`](../governance/founder-strategic-context-contract.md).

> **Remediation update (V068).** The first acceptance declaration was **superseded by a remediation review** that
> found three contract-level blockers in the V067 implementation: (1) revise/retire *mutated* the prior row's status
> (not append-only); (2) only 3 of the 5 required conflict rules were correctly implemented; (3) the recommendation
> schema was changed without a version bump. All three are resolved below — this document reflects the remediated
> (V068) design; the paragraphs describing the superseded V067 behavior are marked.

## Domain model

One governed aggregate: **`FounderStrategicContextItem`** (in `apps/api/src/business-model/founder-strategic-context.ts`).

```
FounderStrategicContextItem {
  id; founderId; logicalItemId; version;
  kind: GOAL | CONSTRAINT | RESOURCE | STRATEGIC_PREFERENCE | DECISION_HORIZON;
  statement; category; scope;
  source: FOUNDER_DECLARED | FOUNDER_CONFIRMED | IMPORTED_ACCEPTED | VERIFIED_SYSTEM_RECORD;
  status: ACTIVE | RETIRED | SUPERSEDED;
  effectiveFrom; effectiveUntil?; reviewAt?;
  metadata: <discriminated per kind>;
  supersedesItemId?; createdAt;
}
```

`logicalItemId` is the stable identity of a "thing" across revisions; `id` identifies one version. Discriminated,
schema-validated metadata per kind: `GoalMetadata` (optional target, optional horizon, priority
PRIMARY|SECONDARY|UNRANKED); `ConstraintMetadata` (category, founderClassification NON_NEGOTIABLE|NEGOTIABLE|
NOT_YET_CLASSIFIED, temporaryOrStructural, severity?); `ResourceMetadata` (category, quantity?/unit?, availability,
evidenceStatus); `StrategicPreferenceMetadata` (category, strength PREFERENCE|STRONG_PREFERENCE|NON_NEGOTIABLE,
rationale?); `DecisionHorizonMetadata` (label, startsAt?/endsAt?/triggeringEvent?, appliesTo). A normalizer validates +
coerces on write; NON_NEGOTIABLE (constraint classification / preference strength) is accepted only from an explicit
founder write path, never defaulted.

## Persistence — APPEND-ONLY (migrations V067 + V068)

**Superseded V067 behavior (do not reinstate):** revise flipped the prior row `ACTIVE → SUPERSEDED` and retire flipped
`ACTIVE → RETIRED` *in place* — mutating historical rows. That is not append-only.

**Remediated (V068) design — the immutable source of truth.** `business.founder_strategic_context_item` is now strictly
append-only:
- Each row is one **immutable version**. `lifecycle ∈ {CREATE, REVISE, RETIRE}` records what that version IS; it is
  written once and **never updated**. `version` increments per logical item.
- **A BEFORE UPDATE trigger (`fsc_no_update`) forbids ANY row update** at the database — historical rows are physically
  immutable. Account deletion (`DELETE`) is the only destructive path.
- **Effective / superseded / retired state is DERIVED** from the ordered history, never from a mutable flag: for a
  logical item, the `MAX(version)` row is the effective content version *unless* its `lifecycle` is `RETIRE` (then the
  item is retired and has no effective version); all lower versions are `SUPERSEDED`. Revision appends a `REVISE`
  version; **retirement appends a terminal `RETIRE` version** (copying the content at retirement time) — the prior
  record is never rewritten.
- The `status` column is kept only as a **write-once, non-authoritative insertion hint** (`ACTIVE` for CREATE/REVISE,
  `RETIRED` for RETIRE). It is NOT the source of truth and is rebuildable from `(version, lifecycle)`; the domain
  `status` returned to callers is the *derived* value. Export uses the derived status (via `listAllForExport`).
- **Concurrency is arbitrated by the immutable unique `(founder_id, logical_item_id, version)` index** (not a mutable
  flag): two writers racing for the next version both target `N+1`, so exactly one insert wins and the loser gets a
  `ContextConcurrencyError` — never two effective versions, never a mutated prior row. The V067 partial-unique index on
  the mutable `status='ACTIVE'` was **dropped** in V068.
- Founder-scoped on every query; `effectiveUntil < effectiveFrom` and unjustified `reviewAt < effectiveFrom` rejected at
  the domain layer; no cascade loses history outside account deletion.

Repository `PgFounderStrategicContextRepository`: `create` (v1/CREATE), `revise` (append REVISE — no UPDATE), `retire`
(append terminal RETIRE — no UPDATE), `listActive` (derived), `history` (derived status per version), `listAllForExport`.
Immutability is proven by a test capturing a prior version's full DB row before/after revision, later revision,
retirement, and a losing concurrent write (byte-identical each time) and asserting the DB rejects a direct `UPDATE`.

## Effective-context resolution

`EffectiveFounderStrategicContextResolver.resolve(founderId, asOf, scope)` → `EffectiveFounderStrategicContext`
(goals/constraints/resources/strategicPreferences/decisionHorizons + conflicts + staleItems + missingCriticalAreas).
Eligibility: `status = ACTIVE`; `effectiveFrom <= asOf`; `effectiveUntil` null or `>= asOf`; scope applies to the
requested job; latest version only; proposed/unconfirmed/future/expired/retired/superseded excluded (expired surfaces
under `staleItems`, not active). Deterministic ordering (kind group → priority/severity → stable id); bounded payload;
no raw dumps.

## Conflict detection (deterministic only) — the five required rules + their structured prerequisites

All rules are computed purely from **explicit, founder-declared structured input**; nothing is inferred from absence or
`UNKNOWN`, and no quantity/requirement is invented. `resolutionStatus` is recorded, not orchestrated (no resolution
workflow this slice). The four assembly-time rules run in `detectStructuralContextConflicts(groups)`; rule 3 needs a
bounded option set (the recommendation's alternatives) and runs in `detectNonNegotiableExcludesOnlyOption(groups, options)`.

1. **GOAL_GOAL** — ≥2 goals marked `PRIMARY` in overlapping scope.
2. **GOAL_RESOURCE** — a goal's explicit `requiresResourceCategories` names a category for which an effective
   `RESOURCE` is declared `availability: UNAVAILABLE`. `UNAVAILABLE` is a **founder-explicit** value (added in this
   remediation); `UNKNOWN` / absent / a non-declared zero **never** triggers this (proved by tests).
3. **NON_NEGOTIABLE_OPTION_CONFLICT** — over an explicitly **bounded option set** `{label, supportedByEvidence,
   excludedByItemId}`: if ≥1 option is evidence-supported and **every** supported option is excluded by a founder
   non-negotiable, no acceptable supported option remains. It neither violates the non-negotiable nor invents another
   option. Proven by a deterministic fixture (the spec's stated requirement for rule 3); in production the option set is
   the recommendation's alternatives+primary.
4. **HORIZON_FEASIBILITY** — a goal's explicit `prerequisite` (a `durationDays` or `completionDate`) cannot fit inside
   the active `DECISION_HORIZON` window (`startsAt..endsAt`, or an `endsAt` bound). A goal end-date merely being after
   the horizon end **does not** qualify (the superseded V067 rule did that — removed); a real prerequisite timeline is
   required.
5. **GOAL_CONSTRAINT (quantitative)** — a goal's explicit `requires: [{category: BUDGET|TIME, value, unit}]` exceeds a
   `CONSTRAINT`'s explicit `limit` of the same category **and unit**. Fires only when **both** quantities are explicitly
   structured (never a manufactured number); required ≤ limit, mismatched unit, or an unknown quantity → no conflict.

**Minimal typed additions (all optional, founder-explicit only):** `ResourceMetadata.availability += UNAVAILABLE`;
`GoalMetadata.requiresResourceCategories`, `.requires[]` (known budget/time quantity), `.prerequisite`
(duration/completion); `ConstraintMetadata.limit` (explicit max).

## Recommendation schema version

Bumped `SCHEMA_VERSION.strategy` `strategy-recommendation-1 → strategy-recommendation-2` (Option A). The change is
purely **additive**: a new `FOUNDER_STRATEGIC_CONTEXT` epistemic kind and optional reference fields
(`logicalItemId`/`version`/`scope`/`source`/effective period). The normalizer reads both shapes, so a persisted v1
payload (no context fields) and a v2 payload parse identically for the shared fields (compat test). New durable sessions
record `schema_version = strategy-recommendation-2`; old v1 sessions remain readable.

## API surface

Session-guarded `/api/founder-strategic-context/*`, existing route/domain-error conventions, discriminated schemas
validated server-side, founder id never in a writable body:
- `POST /items` — create (explicit founder action)
- `GET /effective` — effective context (optional `scope`, `asOf`)
- `GET /items/:logicalItemId/history`
- `POST /items/:logicalItemId/revisions` — append-only revise
- `POST /items/:logicalItemId/retire`

## UI boundary

`apps/web/src/strategic-context/StrategicContextPage.tsx` (`/strategic-context`): five sections (Goals, Constraints,
Resources, Preferences, Decision Horizon); add one item; see active items + expiry/needs-review; revise; retire; open
history. Explains: *"This context helps Business Brain recommend strategies that fit your actual goals, resources, and
constraints. Nothing is inferred or saved without your confirmation."* No personality language; UNKNOWN shown, never
treated as zero; progressive capture (no 40-field form); not required before using Strategy.

## StrategicContextAssembler integration

Extend the assembler's `founderContext` (currently empty arrays) to consume the effective resolver:
`{goals, constraints, resources, strategicPreferences, decisionHorizons, conflicts, staleItems, missingCriticalAreas}`
— preserving item id + logicalItemId + version + kind + source + scope + temporal metadata, deterministic order,
bounded, excluding superseded/retired/future/expired/unconfirmed. The strategy model references items by resolvable id.

## Recommendation schema + prompt

Extend `StrategicRecommendation` minimally: evidence/context references gain optional `logicalItemId`, `version`,
`scope`, `effectiveFrom`/`effectiveUntil` plus a new epistemic kind `FOUNDER_STRATEGIC_CONTEXT`. The recommendation
shows where a context item materially changed it (fits-goal / constraints-change-strategy / resources-support /
preference-considered-but / designed-for-horizon). Bump `PROMPT_VERSION.strategy` (`strategy-1 → strategy-2`): use
context where materially relevant; don't overfit preferences; unknown ≠ unavailable; no identity/psychology; expose
trade-offs; state when the recommendation would differ without a constraint.

## Migration / export / delete

V067 (append-only table). Export: active + historical versions, kind, source, scope, effective dates, status,
supersession linkage, metadata — no internal-only fields. Delete: remove all founder-owned context records (+ derived
conflicts if persisted — not persisted this slice). Verify zero orphans.

## Browser acceptance plan

Context CRUD (empty state, 5 kinds, revise, history, retire, expiry/needs-review, refresh, isolation, safe errors, no
personality language) + paired strategy scenarios: A (materially different context → materially different
recommendation), B (preference does not override evidence), C (expired item excluded / as-of), D (conflict visible).
For every strategic session: references resolve to stored context, no retired/superseded/future/expired cited as
active, no manufactured provenance, isolation holds, ACCEPT writes nothing. Controlled non-production seeds, removed
afterward.

## Known exclusions (this slice)

No `STRATEGIC_EXCLUSION` object, no `STRATEGIC_COMMITMENT`, no accepted-decision memory, no plans/execution, no
automatic conversation extraction, no scheduled review reminders, no conflict-resolution workflow, no additional
strategic job, no market discovery, no founder personality profile. Frozen engine untouched; production untouched.

## Build order

governance + architecture (this gate, committed first) → domain model → V067 + repository → resolver + conflicts →
routes + export/delete → assembler + schema + prompt → UI → deterministic tests → eval fixtures → browser acceptance →
regression + closure → one implementation commit.
