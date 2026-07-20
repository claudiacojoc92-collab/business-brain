# Strategic Decision Record — slice closure record

Opens ADR-011 **category 10 (Strategic Decision)**: a founder-explicit, append-only record of a strategic choice among
understood alternatives, with the decision-time evidence, recommendation, context, uncertainty, and trade-offs preserved.
Governance + architecture gate committed *before* implementation (`4ee30d4`, atop the SDR-provenance line `25e5d02`).

## Gate (committed first — `4ee30d4`)

- **Audit (Part 1):** no existing action creates a decision. Recommendation feedback (`ACCEPT`/`QUALIFY`/`REJECT`/…)
  writes only append-only `strategic_response` (case 20: no context/understanding/memory); BU respond writes
  `conclusion_response` + a new understanding version; FSC create/revise/retire writes context items; the legacy
  `decision.ts`/`captureDecision` is the **Business Memory v1 (KA-2)** `/dev` primitive writing `memory.*` — untouched
  (naming-collision noted → new capability is `StrategicDecisionRecord`). The model never writes a decision.
- **Governance contract** — [`strategic-decision-record-contract.md`](../governance/strategic-decision-record-contract.md):
  15 laws (recommendation-is-not-decision; explicit-founder-act with no hidden/inference/feedback write; named
  alternatives; recommendation + provenance-manifest linkage; decision-time context never rewritten; founder owns the
  leap; decision is not truth / not commitment; append-only; bounded lifecycle; no coercive lock-in; no post-hoc
  rewriting; export/delete; constitutional supremacy) + the authorship boundary.
- **Architecture record** — [`strategic-decision-record-slice.md`](../architecture/strategic-decision-record-slice.md):
  one append-only table, deterministic admission gate + alignment, schema `strategic-decision-1`.

## What was built (implementation — `25e5d02`+1)

**Domain** — [`strategic-decision.ts`](../../apps/api/src/business-model/strategic-decision.ts): the `StrategicDecisionRecord`
type; the **deterministic admission gate** `assertDecisionAdmissible` (explicit action; session owned + terminal;
manifest required where the schema needs it; chosen option + ≥2 alternatives; exactly-one-CHOSEN matching the choice;
chosen-cannot-be-rejected; INSUFFICIENT requires acknowledgement; idempotency key); `deriveAlignment`
(ALIGNED/PARTIALLY_ALIGNED/DIVERGENT/NO_RECOMMENDATION, judgment-free); `groundingAtDecision` (an INSUFFICIENT session
can never read GROUNDED); `buildDecisionFields` (references from the immutable session; founder text verbatim; an
**authorship map** keeps FOUNDER_AUTHORED / RECOMMENDATION_DERIVED / SYSTEM_DERIVED separate). The model is never in this
path.

**Persistence** — `V072 business.strategic_decision_record` (append-only; immutable revisions keyed by
`(founder, logical_decision_id, revision)`; **BEFORE-UPDATE trigger forbids UPDATE**; unique `(founder, idempotency_key)`).
[`pg-strategic-decision.repository.ts`](../../apps/api/src/business-model/pg-strategic-decision.repository.ts): idempotent
`create`; append-only `supersede`/`reverse`/`retire`; `listByFounder` (effective), `getHistory`, `getEffective`;
effective status **derived** from the latest revision's lifecycle.

**API** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts): `POST /strategy/sessions/:sessionId/decisions`
(create, idempotent, gated), `GET /strategy/decisions`, `GET /strategy/decisions/:logicalDecisionId` (effective + full
history + linked immutable session), `POST …/supersede|reverse|retire`. Cross-founder → 404 (indistinguishable). No
PATCH/UPDATE.

**Export/Delete** — [`export.service.ts`](../../apps/api/src/account/export.service.ts) adds a `strategicDecisions` section
(all revisions + session/schema/manifest links + chosen option + alternatives + uncertainty + trade-offs + scope +
alignment + rationale + labelled `authorship`); [`delete.service.ts`](../../apps/api/src/account/delete.service.ts) removes
`business.strategic_decision_record` in the deletion transaction (zero orphans).

**UI** — [`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx): a **separate** "Record a decision" surface
(the feedback control is re-labelled "Your read on this recommendation" and no longer calls itself a decision). Two beats:
choose (recommended / an alternative / author your own), then confirm; shows what Business Brain recommends vs what you're
choosing, unknowns, reversibility, an INSUFFICIENT acknowledgement, and "This records your decision. It does not create a
commitment or plan." The recorded state states the alignment neutrally. No personality/celebratory/coercive language.

## Acceptance evidence

- **Deterministic (Part 14):** `strategic-decision.test.ts` — 19 tests (admission gate incl. required chosen option /
  statement / ≥2 alternatives / chosen-marked / chosen-not-rejected / non-terminal / manifest-required / insufficient-ack;
  alignment 7/8/9 incl. divergence-does-not-rewrite-evidence; grounding-11; authorship 25/26; scope/status derivations).
- **Live DB (Part 14 + Scenarios):** `strategic-decision.live.test.ts` — 7 tests covering cases 1–4, 12–30: a
  recommendation + `ACCEPT` create **no** decision (and no commitment/plan table); explicit create is exactly-once +
  idempotent; exact session/schema/manifest linkage; later FSC/BU revision + a fresh session do **not** rewrite the
  decision's references; append-only UPDATE rejected by the trigger; supersede + reverse preserve the prior revision and a
  terminal decision cannot be re-terminated; cross-founder session-link + decision-read rejected without leakage; export
  faithful (authorship preserved); deletion zero orphans; no legacy `memory.*` write.
- **Browser (Part 16, Scenario A):** the decision surface renders **separately** from feedback; opening it shows the
  recommended option vs the founder's choice, "does not create a commitment or plan", and an explicit confirm; recording an
  **aligned** decision through the real UI→API persisted revision 1 / CREATE / **ALIGNED** / source RECOMMENDED /
  founder-authored statement / linked to the exact session + manifest `pm-1` / GROUNDED; it lists back as ACTIVE with
  `notACommitment: true` and `authorship.decisionStatement = FOUNDER_AUTHORED`.
- **Regression:** backend 814 pass / 1 skip; web build (tsc + vite) + 73 web tests green; API + web typechecks clean;
  migrations V066–V072 present, V072 table + append-only trigger live; frozen-engine hashes byte-identical. KA-1 remains
  resolved; provenance manifests remain immutable; the five context-conflict rules + NON_NEGOTIABLE_OPTION remain green;
  recommendation `ACCEPT` and BU `accept` semantics unchanged.

## Scope discipline

No Strategic Commitments, plans, tasks, execution, agents, market discovery, or general Founder Conversation added; the
legacy `memory.*` schema (KA-2) not reconciled; no generic Strategic Memory; the model cannot create/infer/save a
decision; the frozen engine untouched. Not deployed, not pushed, no prior commit amended.

## Remaining debt
- **SDR-1** lifecycle `EXPIRED`/`CHALLENGED`/`REVIEW_DUE` + auto-derived review (needs semantics + a scheduler).
- **SDR-2** `CUSTOM` decision scope.
- Strategic **Commitment** (Law 9) remains a future, separate capability.
- **PI-1** (claim-level grounding) and **KA-2** (legacy `memory.*`) remain as previously recorded; untouched here.
