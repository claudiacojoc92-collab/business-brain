# Wave 4 · Founder Strategic Context — slice 1 architecture

Smallest architecture to let a founder explicitly record, inspect, and revise strategic context, and have the existing
`PRIORITY_DECISION` job consume the *effective* context. Recorded before implementation. Governed by
[`founder-strategic-context-contract.md`](../governance/founder-strategic-context-contract.md).

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

## Persistence (migration V067)

`business.founder_strategic_context_item` — append-only version rows. Invariants:
- unique `(founder_id, logical_item_id, version)`;
- **partial unique** `(founder_id, logical_item_id) WHERE status = 'ACTIVE'` → at most one active version per logical
  item;
- a revision references the effective version it supersedes (`supersedes_item_id`) and flips the prior row to
  `SUPERSEDED` in the **same transaction** (atomic supersession);
- a `SUPERSEDED` row can never return to `ACTIVE`; retirement flips `ACTIVE → RETIRED` (append-only, history preserved);
- founder-scoped on every query; `effectiveUntil < effectiveFrom` and unjustified `reviewAt < effectiveFrom` are
  rejected at the domain layer;
- indexes on `(founder_id, status)` and `(founder_id, logical_item_id)`; no cascade that loses history outside account
  deletion.

Repository `PgFounderStrategicContextRepository`: `create`, `revise` (tx: supersede prior effective + insert next
version), `retire` (tx), `getEffective(asOf)`, `history(logicalItemId)`, `listActive`, `listAllForExport`.

## Effective-context resolution

`EffectiveFounderStrategicContextResolver.resolve(founderId, asOf, scope)` → `EffectiveFounderStrategicContext`
(goals/constraints/resources/strategicPreferences/decisionHorizons + conflicts + staleItems + missingCriticalAreas).
Eligibility: `status = ACTIVE`; `effectiveFrom <= asOf`; `effectiveUntil` null or `>= asOf`; scope applies to the
requested job; latest version only; proposed/unconfirmed/future/expired/retired/superseded excluded (expired surfaces
under `staleItems`, not active). Deterministic ordering (kind group → priority/severity → stable id); bounded payload;
no raw dumps.

## Conflict detection (deterministic only)

`detectStrategicContextConflicts(effective, recommendationMarkers?)` — structured rules only: (1) multiple PRIMARY
goals in overlapping scope+horizon; (2) a goal requiring a resource category explicitly `UNKNOWN`/unavailable; (3) a
non-negotiable preference excluding the only recommended option (from resolvable recommendation markers); (4) a horizon
shorter than an explicitly declared prerequisite timeline; (5) an explicit budget/time constraint conflicting with a
requested action where the required quantity is known. Undeterminable → preserved as unknown, never invented. No LLM
inference of contradictions. No resolution workflow this slice (`resolutionStatus` is recorded, not orchestrated).

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
