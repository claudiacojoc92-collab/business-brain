# Strategic Commitment Record — slice architecture

Implements the founder-explicit **Strategic Commitment Record (SCR)**, ADR-011 category 11. Smallest durable design that
lets a founder declare that a specific Strategic Decision will govern their strategic conduct for a **bounded** scope and
period, append-only, with the decision-time evidence/recommendation/context preserved by reference. Recorded before
implementation; governed by [`strategic-commitment-record-contract.md`](../governance/strategic-commitment-record-contract.md).

---

## Part 1 — Repository audit (recorded before any code change)

**No existing action creates a Strategic Commitment.** Every commitment-like object/term and its behaviour:

| Object / term | Canonical name | Behaviour | Storage | Founder action | Allocates resources? | Duration? | Exit conditions? | Operational? | Confusable with a commitment? |
|---|---|---|---|---|---|---|---|---|---|
| Strategic Decision Record (V072) | `StrategicDecisionRecord` | records a founder *choice* among alternatives; append-only | `business.strategic_decision_record` | explicit (POST decisions) | no | no (carries an optional `reviewAt`/horizon, not governing) | no | no | **No** — a decision is explicitly "not a commitment" (SDR Law 9); it is the *input* to a commitment |
| Decision `reviewAt`/`reviewTrigger`/`reversibility` | fields on the decision | decision-time metadata | jsonb/columns on the decision | — | no | no | no | no | No |
| FSC `DECISION_HORIZON` | context item kind | a founder-declared decision **window** (effectiveUntil/reviewAt); append-only strategic context | `business.founder_strategic_context_item` | explicit (FSC create) | no | yes (a time window) | no | no | No — it is *context*, not a governing commitment; **must not be reclassified** |
| Recommendation `nextStep`/`horizon`/`reviewAfter` | fields inside the model recommendation | model-produced suggestion text | inside the immutable session recommendation | — | no | no | no | no | No — model output, never a founder commitment |
| `captureDecision` / `decision.ts` | Business Memory v1 "Decision" | the founder's decision **text** written as `declared` evidence into `memory.*` (KA-2), `/dev` only | `memory.*` | dev route | no | no | no | no | **No** — legacy, untouched; naming-collision noted → new capability is `StrategicCommitmentRecord` |

**Confirmed:** no Strategic Decision route auto-creates a commitment; no recommendation action; no feedback action; no
model output; no FSC item is silently reclassified. The strategy routes have **no** commitment endpoint today.

**Conventions to mirror** (identical to the SDR slice): ULID `generateId()`; append-only immutable revisions keyed by
`(founder, logical_id, revision)` + a `lifecycle` marker + a **BEFORE-UPDATE trigger forbidding UPDATE**; effective status
derived from `MAX(revision)` + lifecycle; idempotent create via unique `(founder, idempotency_key)`; `db.transaction`;
deletion explicit per-table in `delete.service.ts`; export founder-safe sections in `export.service.ts`; the SDR
domain/repo/routes/UI as the template.

---

## Part 2 — Domain model (schema `strategic-commitment-1`)

One **append-only** table, `business.strategic_commitment_record`, immutable **revisions** of a logical commitment
(lifecycle events modelled as revisions; smallest design — no separate event table). Fields kept (each with governed
meaning):

- `id` (ULID) · `founder_id` · `logical_commitment_id` · `revision` (1…) · `lifecycle` (`CREATE`|`SUPERSEDE`|`RELEASE`|`RETIRE`) · `supersedes_id`
- **Decision linkage (SYSTEM_DERIVED, Law 7):** `decision_record_id` (the **exact** effective decision revision id), `decision_logical_id`, `decision_revision`, `decision_schema_version`, plus inherited `recommendation_session_id`, `recommendation_schema_version`, `provenance_manifest_version`, `alignment_at_commitment`, `grounding_status_at_commitment`
- **Founder-authored:** `statement`, `scope`, `exclusivity`, `governed_behavior` (string[]), `resource_envelope` (jsonb[]), `accepted_costs` (jsonb[]), `unknown_costs` (string[]), `exit_conditions` (string[]), `reconsideration_conditions` (string[]), `acknowledged_insufficient_evidence` (bool)
- **Boundary (Law 3):** `starts_at`, `review_at`, `review_trigger`, `expires_at`
- `authorship` (jsonb map) · `idempotency_key` · `created_at`

Effective status **derived** from the latest revision: `CREATE`/`SUPERSEDE` → `ACTIVE`; `RELEASE` → `RELEASED`; `RETIRE`
→ `RETIRED`; earlier revisions → `SUPERSEDED`. **`EXPIRED` is derived at read time** (an otherwise-ACTIVE commitment with
`expires_at < now` → `EXPIRED`) — no scheduler this slice.

### Scope (bounded)
`BUSINESS | MARKETING | STRATEGIC_JOB | CHANNEL | OFFER | POSITIONING | DECISION_SCOPE`. **A commitment's scope must not
exceed the linked decision's scope**: admission requires `scope ∈ { decision.scope, DECISION_SCOPE }` (no silent
expansion; `DECISION_SCOPE` means "inherit the decision's scope"). No generic `CUSTOM`.

### Exclusivity (deterministic; never inferred)
`EXCLUSIVE | DEPRIORITIZES_ALTERNATIVES | PREFERRED_DIRECTION | PARALLEL_EXPERIMENT_ALLOWED | UNKNOWN` — founder-selected,
required (may be `UNKNOWN`).

### Resource envelope (bounded; no tasks)
`[{ kind: TIME|BUDGET|TEAM_CAPACITY|FOUNDER_ATTENTION|TEST_DURATION, availability: FOUNDER_DECLARED|UNKNOWN|UNAVAILABLE,
boundaryType: MAXIMUM|INTENDED_ALLOCATION, amount: string|null }]`. Founder-declared bounded availability only — never an
operational allocation or a task.

### Accepted costs (authorship-separated)
`accepted_costs: [{ statement, source: FOUNDER_CONFIRMED|RECOMMENDATION_DERIVED, confirmed: bool }]` + `unknown_costs:
string[]`. **Invariant:** a cost may be `confirmed:true` only when `source = FOUNDER_CONFIRMED` (an unsupported /
recommendation-derived cost cannot be marked founder-accepted). Model-authored cost language is never stored as the
founder's.

### Review condition (mandatory — Law 3)
At least one of: `review_at` (date), `expires_at` (bounded expiry), an evidence-threshold / assumption-failure /
context-change `review_trigger`, a founder-invoked review, or a non-empty `exit_conditions`. A commitment without any is
inadmissible.

---

## Part 3 — Admission gate (deterministic; no model)
All must hold: (1) explicit founder POST to the commitment surface; (2) the `:logicalDecisionId` resolves to a decision
**owned** by the founder; (3) the decision's **effective** revision is **non-terminal** (`ACTIVE` — not `REVERSED`/
`RETIRED`); (4) the decision is historically readable; (5) `statement` non-empty; (6) `scope` explicit + in taxonomy;
(7) `scope ∈ { decision.scope, DECISION_SCOPE }`; (8) ≥1 review/expiry/exit mechanism; (9) `exclusivity` explicit (may be
`UNKNOWN`); (10) any `accepted_costs.confirmed` cost has `source = FOUNDER_CONFIRMED`; (11) date ordering valid
(`starts_at ≤ review_at`, `≤ expires_at`; `review_at`/`expires_at` not before `starts_at`); (12) if the decision was made
under insufficient evidence (`acknowledgedInsufficientEvidence` or grounding ≠ GROUNDED) then `acknowledgedInsufficientEvidence
= true` on the commitment; (13) idempotency key present. **Only the current effective, non-terminal decision revision may
receive a new commitment**; historical commitments stay linked to their historical decision revision.

## Part 4 — Lifecycle & effective-state resolution
`CREATE` → `SUPERSEDE` (new revision, current effective) / `RELEASE` (founder ends the obligation early — neutral, not
failure/abandonment) / `RETIRE` (founder closes it as no longer relevant to the domain). `EXPIRE` is **derived** from
`expires_at`. Effective = latest revision; released/retired/expired are not effective; superseded revisions remain
historical. When the **linked decision** is later superseded/reversed/retired, the commitment **remains historical and
inspectable** — it is *not* auto-terminated; the read path exposes a neutral `linkedDecisionStatus`
(`CURRENT|DECISION_SUPERSEDED|DECISION_REVERSED|DECISION_RETIRED`) for a review-needed notice.

## Part 5 — API (bounded)
`POST /strategy/decisions/:logicalDecisionId/commitments` (create, gated, idempotent) · `GET /strategy/commitments`
(effective, derived status) · `GET /strategy/commitments/:logicalCommitmentId` (effective + append-only history + linked
decision status) · `POST …/supersede|release|retire`. No PATCH/UPDATE, no plan/task endpoints. Cross-founder → 404.

## Part 6 — UI
A **separate** "Create a commitment from this decision" surface, distinct from the decision act. Shows the exact decision,
its recommendation alignment, decision-time uncertainty/trade-offs/alternatives/scope, and the historical provenance link;
the founder defines statement, scope, exclusivity, governed behaviour, resource boundary, accepted/unknown costs, review/
expiry, and exit conditions. States: "This creates a strategic commitment.", "It does not create a plan or tasks.", "You
can review, supersede, release, or retire it." A separate final confirmation. Historical view shows commitment-time state
(a neutral "the linked decision has changed" / "reached its review point" notice when applicable — never a rewrite). No
"lock it in" / streak / "great commitment" / celebratory / coercive / retention language.

## Part 7 — Divergent & insufficient-evidence decisions
A commitment on a **divergent** decision preserves `alignment_at_commitment = DIVERGENT`, the source recommendation,
the actual (unchanged) evidence status, the founder choice, and the decision-time unknowns — recorded no less
legitimately, evidence never upgraded. A commitment on an **INSUFFICIENT** decision requires a fresh explicit
acknowledgement; grounding is never upgraded to GROUNDED; insufficiency/unknowns are preserved. (No invented evidence
thresholds; no imposed shorter horizon this slice — recorded as optional future governance.)

## Part 8 — Persistence & invariants
`V073` append-only table + trigger + unique `(founder, logical_commitment_id, revision)` and `(founder, idempotency_key)`.
Domain/DB invariants: statement non-empty; founder-owned decision required; decision revision must exist; terminal
decision cannot receive a new commitment; scope cannot exceed decision scope; ≥1 review/expiry/exit; valid date ordering;
exclusivity required or UNKNOWN; unsupported cost cannot be founder-accepted; insufficiency cannot be upgraded; no
plan/task fields; lifecycle event cannot precede creation; a terminal commitment cannot be terminated twice; no
cross-founder linkage; idempotent create.

## Part 9 — Export / delete
Export adds `strategicCommitments` (record + full lifecycle history + decision/session/recommendation/manifest links +
scope + exclusivity + governed behaviour + resource boundaries + accepted/unknown costs + review/expiry + exit conditions
+ labelled `authorship` + derived status + insufficiency inheritance + alignment). Account deletion removes
`business.strategic_commitment_record`; zero orphans.

## Migration & versions
- **V073** `business.strategic_commitment_record` (+ append-only trigger). Latest after V072.
- Commitment schema `strategic-commitment-1` (independent). Recommendation schema `strategy-recommendation-4` / prompt
  `strategy-4` / manifest `pm-1` / decision `strategic-decision-1` **unchanged**. Supported decision schema:
  `strategic-decision-1`. Prior sessions/decisions untouched and readable.

## Deferred debt
- **SCR-1** governed `PAUSE` lifecycle + auto-derived review scheduling (needs semantics + a scheduler).
- **SCR-2** a shorter mandatory review horizon for insufficient-evidence commitments (needs governance justification).
- Strategic **Plan** remains future-only; Strategic **Memory** is not implemented; **PI-1** / **KA-2** unchanged.
