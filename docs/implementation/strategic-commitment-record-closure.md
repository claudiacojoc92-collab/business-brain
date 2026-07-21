# Strategic Commitment Record — slice closure record

Opens ADR-011 **category 11 (Strategic Commitment)**: a founder-explicit, append-only declaration that a specific
Strategic Decision will govern the founder's strategic conduct for a **bounded** scope and period, subject to visible
review, exit, and reconsideration conditions. Governance + architecture gate committed *before* implementation
(`18a7460`, atop the SDR line `e766c28`).

## Gate (committed first — `18a7460`)

- **Audit (Part 1):** no existing action creates a commitment. The Strategic Decision Record is the *input* to a
  commitment and is explicitly "not a commitment"; no SDR/recommendation/feedback/model path creates one (the strategy
  routes had no commitment endpoint); FSC `DECISION_HORIZON` is a temporal context item (not reclassified); the legacy
  `decision.ts` "commitment" is the Business Memory v1 (KA-2) `/dev` primitive writing `memory.*` — untouched
  (naming-collision noted → new capability is `StrategicCommitmentRecord`).
- **Governance contract** — [`strategic-commitment-record-contract.md`](../governance/strategic-commitment-record-contract.md):
  15 laws (decision-is-not-commitment; explicit declaration with no silent/inferred/feedback creation; bounded — no
  "forever"/"until successful"; not obedience; not identity; requires a decision; exact-revision historical linkage;
  visible cost; explicit obligations that are not tasks; no hidden exclusivity; no manufactured permanence; append-only;
  outcome-doesn't-rewrite; not-a-plan/no "completed"; export/delete + sovereignty).
- **Architecture record** — [`strategic-commitment-record-slice.md`](../architecture/strategic-commitment-record-slice.md):
  one append-only table, deterministic admission gate + effective-state resolution, schema `strategic-commitment-1`.

## What was built (implementation — `18a7460`+1)

**Domain** — [`strategic-commitment.ts`](../../apps/api/src/business-model/strategic-commitment.ts): the
`StrategicCommitmentRecord` type; the **deterministic admission gate** `assertCommitmentAdmissible` (owned + **ACTIVE**
decision; supported decision schema; statement non-empty; scope explicit and **≤ decision scope** (`DECISION_SCOPE`
inherits); ≥1 review/expiry/exit mechanism; exclusivity explicit; an accepted cost must be `FOUNDER_CONFIRMED`; valid date
ordering; insufficiency acknowledged; idempotency); `effectiveStatus` (lifecycle-derived + **read-time `EXPIRED`** from
`expires_at`); `linkedDecisionStatus` (neutral notice when the linked decision later changes — never auto-terminates);
`buildCommitmentFields` (decision links + founder text; an **authorship map** keeps founder / recommendation-derived /
system-derived separate; grounding **inherited, never upgraded**). The model is never in this path.

**Persistence** — `V073 business.strategic_commitment_record` (append-only immutable revisions keyed by `(founder,
logical_commitment_id, revision)`; **BEFORE-UPDATE trigger forbids UPDATE**; unique `(founder, idempotency_key)`).
[`pg-strategic-commitment.repository.ts`](../../apps/api/src/business-model/pg-strategic-commitment.repository.ts):
idempotent `create` (from an effective decision); append-only `supersede`/`release`/`retire`; `listByFounder`,
`getHistory`, `getEffective` with derived status incl. expiry.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts):
`POST /strategy/decisions/:logicalDecisionId/commitments` (create, gated, idempotent), `GET /strategy/commitments`,
`GET /strategy/commitments/:logicalCommitmentId` (effective + history + `linkedDecisionStatus`), `POST …/supersede|release|retire`.
No PATCH/UPDATE, no plan/task endpoints. Cross-founder → 404.

**Export/Delete** — [`export.service.ts`](../../apps/api/src/account/export.service.ts) adds a `strategicCommitments`
section (all revisions + decision/session/recommendation/manifest links + scope + exclusivity + governed behaviour +
resource envelope + accepted/unknown costs + review/expiry + exit conditions + labelled `authorship`);
[`delete.service.ts`](../../apps/api/src/account/delete.service.ts) removes `business.strategic_commitment_record` before
the decision delete (zero orphans).

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): a **separate** "Create a commitment from this
decision" surface, offered only after a decision is on record (a decision does not auto-become a commitment). The founder
defines statement, scope, exclusivity, governed behaviour, an accepted cost, review/expiry, and exit conditions; sees
"This creates a strategic commitment. It does not create a plan or tasks. You can review, supersede, release, or retire
it."; and an INSUFFICIENT decision requires a fresh acknowledgement. Neutral lifecycle language; no "lock it in" / streak /
celebratory / coercive / retention copy. Commitment schema `strategic-commitment-1` (recommendation/decision
schemas/prompt unchanged).

## Acceptance evidence

- **Deterministic (Part 16):** `strategic-commitment.test.ts` — 20 tests (admission gate: terminal-decision, statement,
  scope, scope-≤-decision, exclusivity, review-mechanism, date-order, cost-confirmed, insufficiency-ack, idempotency;
  build/linkage; divergent + insufficient inheritance without upgrade; authorship; lifecycle + `EXPIRED` derivation;
  linked-decision status; no plan/task fields).
- **Live DB (Part 16 + Scenarios):** `strategic-commitment.live.test.ts` — 8 tests covering cases 1–4, 6, 22, 24–30,
  36–39: a recorded decision + `ACCEPT` create **no** commitment (and no plan/task table); explicit create exactly-once +
  idempotent; exact decision-revision + manifest linkage; a later decision revision + BU/FSC change do not rewrite the
  commitment (it stays ACTIVE with a `DECISION_SUPERSEDED` notice — not auto-terminated); append-only UPDATE rejected;
  supersede + release preserve the prior revision and a terminal commitment cannot be re-terminated; `EXPIRED` derived at
  read; cross-founder decision-link + commitment-read rejected without leakage; export faithful (authorship preserved),
  deletion zero orphans, no `memory.*` write.
- **Browser (Part 18):** decision and commitment are **separate** acts — recording a decision reveals a distinct "Create
  a commitment from this decision" affordance ("a separate step — and not a plan"). Creating an aligned commitment through
  the real UI→API persisted revision 1 / CREATE / **ALIGNED** (inherited) / `DECISION_SCOPE` / `PREFERRED_DIRECTION` /
  founder statement / linked to the exact decision revision + manifest `pm-1` / with a review date; the recorded state
  and the list-back show `ACTIVE`, `notAPlan: true`, and "It does not create a plan or tasks".
- **Regression:** backend **842 pass / 1 skip**; web build (tsc + vite) + 73 web tests green; API + web typechecks clean;
  migrations V066–V073 present, V073 table + append-only trigger live; frozen-engine hashes byte-identical; Strategic
  Decision + provenance (KA-1) + conflict rules + NON_NEGOTIABLE_OPTION remain green; recommendation `ACCEPT` and BU
  `accept` semantics unchanged. (Also hardened the cross-file live-test session-claim to a deterministic per-session claim,
  removing a pre-existing parallel `claimQueued` race.)

## Scope discipline

No plans, tasks, execution tracking, agents, reminders, market discovery, or general Founder Conversation added; the
legacy `memory.*` schema (KA-2) not reconciled; no generic Strategic Memory; the model cannot create/infer/save a
commitment; a decision never auto-becomes a commitment; the frozen engine untouched. Not deployed, not pushed, no prior
commit amended.

## Remaining debt
- **SCR-1** governed `PAUSE` lifecycle + auto-derived review scheduling.
- **SCR-2** a shorter mandatory review horizon for insufficient-evidence commitments (needs governance justification).
- Strategic **Plan** remains future-only; Strategic **Memory** is not implemented; **PI-1** / **KA-2** unchanged.
