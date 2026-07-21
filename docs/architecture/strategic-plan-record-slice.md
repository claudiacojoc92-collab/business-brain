# Strategic Plan Record — slice architecture

Implements the founder-explicit **Strategic Plan Record (SPR)**, ADR-011 category 12. Smallest durable design that lets a
founder translate ONE effective Strategic Commitment into a bounded, append-only plan (intent + milestones + assumptions
+ dependencies + review/exit conditions), with the commitment/decision/recommendation lineage preserved by reference.
Recorded before implementation; governed by [`strategic-plan-record-contract.md`](../governance/strategic-plan-record-contract.md).

---

## Part 1 — Repository audit (recorded before any code change)

**No existing structure is a Strategic Plan.** Every plan/task/milestone/next-step-like object and its nature:

| Structure | Model-produced? | Founder-authored? | Persists? | Lifecycle? | Confusable with a Plan? |
|---|---|---|---|---|---|
| `recommendation.nextStep` (`{action, successSignal, reviewAfter}`) | **yes** (model output) | no | yes — inside the **immutable recommendation** | no (frozen with the session) | **No** — a single suggested next action, not a sequenced plan; explicitly "the one next step" |
| Commitment `governedBehavior` (string[]) | no | **yes** | yes (on the commitment) | no | No — founder-declared behaviour the commitment governs, not milestones |
| Commitment `reviewAt` / `reviewTrigger` / `exitConditions` | no | yes | yes | commitment lifecycle | No — review/exit conditions, **not milestones** |
| FSC `DECISION_HORIZON` | no | yes | yes | append-only context | No — a decision window, not a plan |
| `app.*_projection` (campaign/current_cycle/founder_status/outcome_history/pattern) | — | no | yes | M2 read-model | No — legacy M2/ADR-010 **read projections** (matched the audit regex only on "project*ion"); not founder plan objects |
| legacy `decision.ts` / `memory.*` | — | — | yes (`memory.*`) | — | No — KA-2, untouched |

**Confirmed:** `recommendation.nextStep` is **not** a plan; commitment `governedBehavior` is **not** a plan; commitment
review conditions are **not** milestones; **no** current UI action implicitly creates a plan (Decision/Commitment panels
create decisions/commitments only); **no** model output has authority to persist planning objects (the model produces
recommendations; `nextStep` is frozen inside the immutable recommendation). There is **no** `strategic_plan`/`task`/
`milestone`/`execution` table.

**Conventions to mirror** (identical to SDR/SCR): ULID `generateId()`; append-only immutable revisions keyed by
`(founder, logical_id, revision)` + a `lifecycle` marker + a **BEFORE-UPDATE trigger forbidding UPDATE**; effective status
derived from `MAX(revision)` + lifecycle (+ read-time `EXPIRED`); idempotent create via unique `(founder,
idempotency_key)`; `db.transaction`; deletion explicit per-table in `delete.service.ts`; export founder-safe sections;
the commitment repo's `getEffective(founderId, logicalCommitmentId, now)` gates plan admission.

---

## Part 2 — Domain model (schema `strategic-plan-1`)

One **append-only** table, `business.strategic_plan_record`, immutable **revisions** of a logical plan (lifecycle events
as revisions; milestones/assumptions/dependencies/conflicts persisted as JSONB — smallest design, no milestone table).

- `id` (ULID) · `founder_id` · `logical_plan_id` · `revision` (1…) · `lifecycle` (`CREATE`|`SUPERSEDE`|`RETIRE`|`CANCEL`) · `supersedes_id`
- **Commitment linkage (SYSTEM_DERIVED, Law 4/9):** `commitment_record_id` (the **exact** effective commitment revision id), `commitment_logical_id`, `commitment_revision`, `commitment_schema_version`, plus inherited `decision_record_id`, `recommendation_session_id`, `provenance_manifest_version`, `business_understanding_version`, `alignment_at_planning`, `grounding_status_at_planning`
- **Founder-authored:** `title`, `strategic_intent`, `scope`, `planning_horizon`, `milestones` (jsonb[]), `assumptions` (jsonb[]), `dependencies` (jsonb[]), `resource_constraints` (string[]), `review_conditions` (string[]), `exit_conditions` (string[]), `no_milestone_rationale` (nullable), `acknowledged_insufficient_evidence` (bool)
- **System-derived:** `uncertainty_at_planning` (jsonb: grounding + unknowns), `conflicts` (jsonb[] — deterministic feasibility), `authorship` (jsonb map)
- `expires_at` (optional) · `activated_at` · `idempotency_key` · `created_at`

Effective status **derived** from the latest revision: `CREATE`/`SUPERSEDE` → `ACTIVE`; `RETIRE` → `RETIRED`; `CANCEL` →
`CANCELLED`; earlier revisions → `SUPERSEDED`. **`EXPIRED` is derived at read** (an otherwise-ACTIVE plan with `expires_at
< now`). No execution states (`IN_PROGRESS`/`COMPLETED`) — Law 3.

### Milestone (bounded; not a task)
`{ id, label, intendedState, sequence:int, confirmationCondition:string|null, targetWindow:date|null, dependencies:string[],
uncertainty:string|null, authorship, statusAtPlanning:'PLANNED' }` — the **only** milestone status is `PLANNED` (planning-
time). No checkbox, no completion.

### Assumption (authorship-separated; never a fact)
`{ statement, status:'GROUNDED'|'FOUNDER_DECLARED'|'MODEL_PROPOSED'|'UNKNOWN'|'CONTRADICTED', source }`. A `MODEL_PROPOSED`
or `UNKNOWN` assumption never becomes a fact.

### Dependency
`{ statement, kind:'COMMITMENT'|'RESOURCE'|'EVIDENCE'|'EXTERNAL'|'SEQUENCING', availability:'AVAILABLE'|'UNAVAILABLE'|'UNKNOWN' }`.
Availability is **never inferred** — founder-declared or UNKNOWN.

### Scope (bounded)
`BUSINESS | MARKETING | STRATEGIC_JOB | CHANNEL | OFFER | POSITIONING | COMMITMENT_SCOPE`. **A plan's scope must not exceed
the commitment's**: admission requires `scope ∈ { commitment.scope, COMMITMENT_SCOPE }` (COMMITMENT_SCOPE = inherit).

---

## Part 3 — Admission gate (deterministic; no model)
All must hold: (1) explicit founder POST; (2) the `:logicalCommitmentId` resolves to a commitment **owned** by the
founder; (3) the commitment's **effective** status is `ACTIVE` (not SUPERSEDED/RELEASED/RETIRED/EXPIRED); (4) `title` +
`strategic_intent` non-empty; (5) `scope` in taxonomy and `∈ { commitment.scope, COMMITMENT_SCOPE }`; (6) ≥1 milestone
**or** a non-empty `no_milestone_rationale`; (7) ≥1 review or exit condition; (8) valid dates (`expires_at` not before
now; a milestone `targetWindow` after `expires_at` is a **BLOCKING** conflict → reject); (9) grounding is **inherited**
from the commitment, never upgraded; (10) if the lineage was insufficient (commitment `acknowledgedInsufficientEvidence`
or grounding ≠ GROUNDED) then `acknowledged_insufficient_evidence = true`; (11) idempotency key present. **Only the current
effective, ACTIVE commitment revision may receive a new plan**; historical plans stay linked to their commitment revision.
Activation = this single explicit POST (the founder's confirm). **No persisted model drafts this slice.**

## Part 4 — Deterministic feasibility conflicts (Part 7)
Computed from the structured fields; each has a severity:
- `MILESTONE_AFTER_EXPIRY` — a milestone `targetWindow` after the plan `expires_at` → **BLOCKING** (activation refused).
- `PLAN_EXPIRY_AFTER_COMMITMENT_EXPIRY` — plan `expires_at` after the commitment's `expiresAt` → **REVIEW_REQUIRED**.
- `UNAVAILABLE_DEPENDENCY` — a dependency `availability = UNAVAILABLE` → **REVIEW_REQUIRED**.
- `CONTRADICTED_ASSUMPTION` — an assumption `status = CONTRADICTED` → **REVIEW_REQUIRED**.
- `UNKNOWN_ASSUMPTION` — an assumption `status = UNKNOWN` → **NON_BLOCKING** (surfaced).
- `UNKNOWN_DEPENDENCY` — a dependency `availability = UNKNOWN` → **NON_BLOCKING**.

**Severity meanings:** `BLOCKING` = structurally incoherent; activation is **refused** (400). `REVIEW_REQUIRED` = surfaced
before and after activation; the founder **may still activate** (sovereignty) with it visible. `UNKNOWN` / `NON_BLOCKING`
= surfaced for awareness only. (A general scheduler/optimizer is **not** attempted; FSC-computed NON_NEGOTIABLE conflict
is deferred — an explicit founder-declared `EXCLUDED_BY_NON_NEGOTIABLE` dependency reads as BLOCKING.)

## Part 5 — Lifecycle & effective-state
`CREATE` (activate) → `SUPERSEDE` (new revision, current effective) / `RETIRE` (founder ends it as no longer relevant) /
`CANCEL` (founder cancels it) — all append-only, neutral. `EXPIRE` derived from `expires_at`. Effective = latest revision;
retired/cancelled/expired are not effective. When the **linked commitment** later changes
(supersede/release/retire/expire), the plan **remains historical and inspectable** — it is *not* auto-retired; the read
path exposes a neutral `linkedCommitmentStatus` (`CURRENT | COMMITMENT_SUPERSEDED | COMMITMENT_RELEASED |
COMMITMENT_RETIRED | COMMITMENT_EXPIRED`).

## Part 6 — API (bounded)
`POST /strategy/commitments/:logicalCommitmentId/plans` (create+activate, gated, idempotent) · `GET /strategy/plans`
(effective, derived status) · `GET /strategy/plans/:logicalPlanId` (effective + append-only history + linked-commitment
status) · `POST …/supersede|retire|cancel`. No draft route (no model drafts), no PATCH/UPDATE, no task/schedule/execution
endpoints. Cross-founder → 404.

## Part 7 — UI
A **separate** "Create a plan" surface on an effective commitment (distinct from the commitment act). Shows the
commitment statement/scope/costs/exclusivity/review-exit + the linked decision + evidence/uncertainty/conflicts; the
founder authors title, intent, scope, milestones, assumptions, dependencies, review/exit conditions, optional expiry; the
deterministic conflicts render (blocking vs review vs surfaced). States: "This activates a plan." + "It does not execute
tasks or create calendar events." A separate explicit **Activate this plan**. Historical view shows plan-time state (a
neutral "the linked commitment has changed" notice when applicable). No personality/coercive/celebratory language, no
progress percentage, no fake completion.

## Part 8 — Persistence & invariants
`V074` append-only table + trigger + unique `(founder, logical_plan_id, revision)` and `(founder, idempotency_key)`.
Invariants: founder-owned effective ACTIVE commitment required; scope ≤ commitment; grounding not upgraded; insufficiency
preserved; ≥1 milestone or a rationale; ≥1 review/exit; milestone sequences deterministic (sorted by `sequence`); expiry
not before activation; milestone-after-expiry BLOCKING; idempotent; no revision mutates a prior; no cross-founder linkage;
**no task/execution/calendar object created**.

## Part 9 — Export / delete
Export adds `strategicPlans` (all revisions + commitment/decision/recommendation/manifest links + milestones + assumptions
+ dependencies + review/exit + conflicts + labelled `authorship` + schema versions + derived status). Account deletion
removes `business.strategic_plan_record`; zero orphans.

## Migration & versions
- **V074** `business.strategic_plan_record` (+ append-only trigger). Latest after V073.
- Plan schema `strategic-plan-1` (independent). Recommendation `strategy-recommendation-4` / prompt `strategy-4` /
  manifest `pm-1` / decision `strategic-decision-1` / commitment `strategic-commitment-1` **unchanged**. Supported
  commitment schema: `strategic-commitment-1`. Prior records untouched and readable.

## Deferred debt
- **SP-1** model-assisted draft generation (with deterministic validation + provenance) + its evaluation.
- **SP-2** FSC-computed NON_NEGOTIABLE / resolver-based feasibility (currently founder-declared only).
- Strategic **Execution Record** remains future-only; Strategic **Memory** is not implemented; **PI-1** / **KA-2** unchanged.
