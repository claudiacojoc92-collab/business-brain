# Strategic Decision Record — slice architecture

Implements the founder-explicit **Strategic Decision Record (SDR)**, ADR-011 category 8. Smallest durable design that lets
a founder record a strategic choice among understood alternatives, append-only, with decision-time evidence/recommendation/
context/uncertainty/trade-offs preserved by reference. Recorded before implementation; governed by
[`strategic-decision-record-contract.md`](../governance/strategic-decision-record-contract.md).

---

## Part 1 — Repository audit (recorded before any code change)

**No existing action creates a Strategic Decision Record.** Every action resembling accept/approve/choose/decide/confirm/
save/reject/defer/revisit, and exactly what it writes:

| Action (route) | Writes | Is it a decision? |
|---|---|---|
| Recommendation feedback `ACCEPT`/`QUALIFY`/`REJECT`/`NEEDS_MORE_EVIDENCE`/`NOT_RELEVANT_NOW` (`POST /strategy/sessions/:id/responses`) | append-only supersession into `business.strategic_response` (one effective response/session) | **No.** Explicitly "does NOT write accepted business context"; verified (case 20) to touch only `strategic_response` — no context/understanding/memory. This is recommendation *feedback*. |
| Business Understanding respond (`POST /understanding/respond`) | `business.conclusion_response` + a new `business.understanding` version | **No.** Accepting/correcting BU, not a strategic choice. |
| FSC `create`/`revise`/`retire` (`/founder-strategic-context/items…`) | append-only `business.founder_strategic_context_item` versions | **No.** Founder strategic *context*, not a decision. |
| Market finding response (`/market/...`) | `business.market_finding_response` (relevance/accuracy) | **No.** |
| `captureDecision` / `decision.ts` (`POST /dev/memory/respond`, **/dev only**) | `memory.*` `declared` evidence fragments re-entering recompute | **No — and out of scope.** This is the **legacy Business Memory v1 (KA-2)** primitive, a dev route, not the production founder flow. Do-not-touch. **Naming-collision noted:** the new capability is `StrategicDecisionRecord` / `business.strategic_decision_record` to avoid confusion with this legacy `Decision`. |
| Strategy worker / model | `strategic_session` outcome | **No.** The model never writes a decision; there is no path that infers one. |

**Confirmed:** no current action could accidentally be interpreted as creating a Strategic Decision. Recommendation
`ACCEPT` is a separate feedback record and stays that way.

**Conventions to mirror:**
- **IDs:** ULID via `generateId()` (`@bb/shared`).
- **Append-only:** immutable versioned rows + a `lifecycle` marker (CREATE/REVISE/RETIRE) + a **BEFORE UPDATE trigger that
  forbids any UPDATE** (V068 `founder_strategic_context_item` pattern); effective state derived from `MAX(version)` +
  lifecycle; concurrency arbitrated by a `(founder, logical_id, version)` unique index; `db.transaction().execute`.
- **Persistence:** JSONB for structured payloads; terminal writes guarded (`WHERE status=…`); no FK cascade — deletion is
  explicit per-table in `apps/api/src/account/delete.service.ts` (one transaction, `deleteFrom … where founder_id`).
- **Export:** `export.service.ts` lists `business.*` per founder → founder-safe shapes (strategicSessions already carry
  recommendation + provenanceValidation + provenanceManifest).
- **Views:** `toSessionView` (founder-safe) + `annotateReferenceHistory` (read-time historical status); terminal detection
  `isTerminalSession` (READY/INSUFFICIENT_EVIDENCE/FAILED).
- **UI:** `StrategyPage` `RecommendationView` has the feedback controls ("This is right"/"Partly"/"I disagree" → "Record my
  response"). The decision surface must be **separate** ("Record a decision").
- **Versions:** recommendation schema `strategy-recommendation-4`, manifest `pm-1`; the SDR introduces an independent
  `strategic-decision-1`. No recommendation schema/prompt bump.
- **Docs:** governance contracts in `docs/governance` ("N laws" + a Constitutional-supremacy law); slice records in
  `docs/architecture`; closure in `docs/implementation`; ADR-011 + current-state map updated.

---

## Part 2 — Domain model

### StrategicDecisionRecord (schema `strategic-decision-1`)
One **append-only** table, `business.strategic_decision_record`, holding immutable **revisions** of a logical decision —
lifecycle events are modelled as revisions (smallest design; no separate `lifecycle_event` table). Fields kept (only those
with clear product + governance meaning):

- `id` (ULID, PK) · `founder_id` · `logical_decision_id` (stable identity across revisions) · `revision` (1…)
- `lifecycle`: `CREATE` | `SUPERSEDE` | `REVERSE` | `RETIRE` (immutable per row)
- `supersedes_id` (the prior revision this row follows; null for `CREATE`)
- **Founder-authored:** `chosen_option` (jsonb `{label, source, statement}`), `decision_statement` (text), `rationale`
  (text, optional), `alternatives_considered` (jsonb[]), `trade_offs_accepted` (jsonb[]/text — founder-confirmed),
  `acknowledged_insufficient_evidence` (bool)
- **System-derived / references:** `recommendation_session_id` (null if none), `recommendation_schema_version`,
  `provenance_manifest_version`, `business_understanding_version`, `decision_horizon`, `alignment` (derived),
  `grounding_status_at_decision` (from the session; never upgraded), `scope`, `reversibility`, `uncertainty` (jsonb: the
  recommendation confidence dims + unknowns snapshot), `authorship` (jsonb map field→origin), `idempotency_key`
- `decided_at` · `review_at` (nullable) · `created_at`

Effective status is **derived** from `MAX(revision)`: latest `CREATE`/`SUPERSEDE` → `ACTIVE`; latest `REVERSE` →
`REVERSED`; latest `RETIRE` → `RETIRED`; every superseded earlier revision → `SUPERSEDED`.

### DecisionAlternative
`{ label, source: RECOMMENDATION_DERIVED | FOUNDER_AUTHORED, disposition: CONSIDERED | CHOSEN | REJECTED | DEFERRED |
UNSUPPORTED | EXCLUDED_BY_NON_NEGOTIABLE, reason: string | null }`. `reason` is populated **only** when founder-authored
or explicitly preserved from the recommendation — never model-invented. Exactly one alternative may be `CHOSEN` and it must
equal the `chosen_option`.

### Authorship
`authorship` records per-field origin (`FOUNDER_AUTHORED` | `RECOMMENDATION_DERIVED` | `SYSTEM_DERIVED`). Founder text and
recommendation text are never merged.

### Scope
`BUSINESS | MARKETING | STRATEGIC_JOB | CHANNEL | OFFER | POSITIONING` (bounded; `CUSTOM` deferred — avoids a premature
universal taxonomy). Defaulted deterministically from the session subtype where possible, founder-confirmable.

### Reversibility
`REVERSIBLE | COSTLY_TO_REVERSE | IRREVERSIBLE | UNKNOWN` — **founder-selected**, default `UNKNOWN`. Never model-inferred
as founder fact.

### Alignment (deterministic)
`ALIGNED | PARTIALLY_ALIGNED | DIVERGENT | NO_RECOMMENDATION`, derived from the chosen option's `source` + the session
outcome: session not READY → `NO_RECOMMENDATION`; chosen `source=RECOMMENDED` → `ALIGNED`; `RECOMMENDED` with a founder
caveat/rationale marking partial → `PARTIALLY_ALIGNED`; `ALTERNATIVE`/`FOUNDER_AUTHORED` → `DIVERGENT`. Divergence is
recorded neutrally; evidence is never rewritten and the founder choice is never marked evidence-supported unless it is.

### Review conditions (optional, not commitments)
`review_at` (date) + a free `review_trigger` note stored on the founder-authored side. Not tasks, not commitments; no
auto-derived `REVIEW_DUE` status this slice.

---

## Part 3 — Admission gate (deterministic; no model)
Creation is allowed only when **all** hold: (1) explicit founder POST to the decision surface; (2) `sessionId` resolves to
a session **owned** by the founder; (3) session is **terminal** (READY or INSUFFICIENT_EVIDENCE — not QUEUED/PROCESSING/
FAILED); (4) the recommendation/insufficient outcome is readable; (5) for a READY session on a manifest-bearing schema
(`strategy-recommendation-4`) the persisted `provenance_manifest` exists; (6) `chosen_option` is explicit and non-empty;
(7) `alternatives_considered` explicit; (8) uncertainty visible (carried from the session); (9) trade-offs visible or
explicitly `unknown`; (10) not an unintended duplicate (idempotency key); (11) for an INSUFFICIENT session,
`acknowledged_insufficient_evidence === true`. A founder may decide **for** the recommended option, **against** it, or for a
**founder-authored** option absent from the recommendation. Divergence is never labelled irrational/noncompliant.

## Part 4 — Persistence & invariants
Single table + append-only trigger (V072). DB/domain invariants: chosen option non-empty; a chosen option cannot also be
`REJECTED`; recommendation-backed decision must reference an existing founder-owned **terminal** session; manifest must
exist where the schema requires it; `grounding_status_at_decision` cannot be `GROUNDED` when the source session was
INSUFFICIENT; founder-authored text distinct from model text; `revision 1` must be `CREATE`; `SUPERSEDE`/`REVERSE`/`RETIRE`
require a prior revision and reference it (`supersedes_id`); no cross-founder linkage; **idempotent create** (unique
`(founder_id, idempotency_key)`).

## Part 5 — API (bounded)
`POST /strategy/sessions/:sessionId/decisions` (create, idempotent) · `GET /strategy/decisions` (list, effective) ·
`GET /strategy/decisions/:logicalDecisionId` (get, with revision history + decision-time references + read-time historical
annotation) · `POST /strategy/decisions/:logicalDecisionId/supersede` · `/reverse` · `/retire` (append-only lifecycle).
No PATCH/UPDATE. Cross-founder → 404 (indistinguishable from absent).

## Part 6 — UI
A **separate** "Record a decision" surface on a terminal session (distinct from feedback): shows what Business Brain
recommends, the alternatives, evidence state, unknowns, conflicts, non-negotiables, and what it does not know; the founder
picks the recommended option / an alternative / authors their own, confirms alternatives, optionally writes a rationale,
sees "This records your decision. It does not create a commitment or plan.", and performs a final explicit confirmation;
INSUFFICIENT sessions require an explicit "I'm deciding without sufficient evidence" acknowledgement. A historical decision
renders its **decision-time** state (a quiet notice if current context has since changed — never a rewrite), the recommended
vs chosen options distinctly, alignment neutrally, and the "not a commitment or plan" line. No personality/celebratory/
coercive language, no raw ids dominating.

## Part 7 — Export / delete
Export adds a `strategicDecisions` section (record + revision history + session/schema/manifest links + chosen option +
alternatives + uncertainty + trade-offs + scope + alignment + founder rationale + labelled model-derived content). Account
deletion adds `business.strategic_decision_record` to `delete.service.ts` (before session delete); zero orphans.

## Migration & versions
- **V072** `business.strategic_decision_record` (+ append-only trigger). Latest after V071.
- Decision schema `strategic-decision-1` (independent). Recommendation schema `strategy-recommendation-4` / prompt
  `strategy-4` **unchanged**. Provenance manifest `pm-1` referenced, not modified. Prior sessions untouched and readable.

## Deferred debt
- **SDR-1** lifecycle `EXPIRED`/`CHALLENGED`/`REVIEW_DUE` + auto-derived review (needs clear semantics + a scheduler).
- **SDR-2** `CUSTOM` scope taxonomy.
- **PI-1** (claim-level grounding) and **KA-2** (legacy `memory.*`) remain as previously recorded; untouched here.
- Strategic **Commitment** (Law 9) is explicitly a future capability.
