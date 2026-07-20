# Strategic Decision Record — Governance Contract

**Status: FROZEN.** Governs the founder-explicit **Strategic Decision Record (SDR)**: a durable, append-only record of a
strategic choice the founder **explicitly** makes among understood alternatives, with the evidence, recommendation,
context, uncertainty, trade-offs, and temporal conditions visible at the moment of decision. Written and committed
*before* implementation. Companion architecture record:
[`strategic-decision-record-slice.md`](../architecture/strategic-decision-record-slice.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) (category 8 — Strategic Decision) and the Business Brain
Constitution. Builds on: provenance-validated recommendations + immutable provenance manifests
([recommendation-provenance-integrity-contract](recommendation-provenance-integrity-contract.md)), Founder Strategic
Context ([founder-strategic-context-contract](founder-strategic-context-contract.md)).

## Why

A recommendation is model-produced strategic output. **Viewing** a recommendation is not a decision; **accepting**
Business Understanding is not a decision; **positive feedback** on a recommendation is not a decision; the **model saying**
an option is best is not a decision. The next capability Business Brain needs is not generic memory — it is a place where
the founder's own strategic **choice** is recorded, once, deliberately, with everything they knew at that moment, and kept
faithfully thereafter. Only an explicit founder action may create one.

## The fifteen laws

### Law 1 — Recommendation is not decision
A recommendation remains model-produced strategic output. It never becomes a founder decision automatically. Generating,
viewing, refreshing, or regenerating a recommendation writes no decision.

### Law 2 — Explicit founder act
An SDR may be created only by a deliberate founder action on a visible decision surface. **No hidden write, no background
inference, no conversation mining, no creation from sentiment, dwell time, clicks, or recommendation feedback.** The
existing recommendation-feedback response (`ACCEPT`/`QUALIFY`/`REJECT`/…) is **not** a decision and must remain separate.

### Law 3 — Named alternatives
A decision must state what was **chosen** and what relevant **alternatives** were considered. A bare "accept the
recommendation" is insufficient unless the exact chosen option and the alternatives are explicit and visible.

### Law 4 — Recommendation linkage
Where a decision follows a Business Brain recommendation, it references the **exact immutable strategic session** and the
**recommendation schema version**. The decision remains valid historically even if later recommendations differ.

### Law 5 — Provenance linkage
A recommendation-backed decision links to the recommendation's persisted **provenance manifest** (version) and validated
references. It does **not** duplicate full source content.

### Law 6 — Decision-time context
The decision preserves or resolves the exact decision-time state: Business Understanding version; Public Positioning
Context references; Founder Strategic Context versions; effective conflicts; unknowns; recommendation outcome; provenance
manifest; alternatives; uncertainty; trade-offs. **Current effective context must never rewrite historical decision
context.**

### Law 7 — Founder ownership of the leap
Business Brain may explain evidence, uncertainty, trade-offs, consequences, reversibility, and missing information. It must
**not disguise a value judgment as evidence**. The founder owns the final leap.

### Law 8 — Decision is not truth
A founder decision does not make an inference objectively true, weak evidence strong, a preferred option proven, an
uncertainty disappear, or a rejected alternative invalid forever.

### Law 9 — Decision is not commitment
A decision records a **choice**. It does not automatically mean the founder commits resources, duration, execution, or
persistence. **Strategic Commitment is a future, separate capability** and must not be created here.

### Law 10 — Append-only history
SDRs are immutable historical records. Change is represented through **append-only** revisions / lifecycle versions — never
an `UPDATE` of historical decision content. Enforced in the database.

### Law 11 — Explicit lifecycle
Only lifecycle states with clear semantics are implemented this slice: **ACTIVE** (the effective decision), **SUPERSEDED**
(a later revision replaced it), **REVERSED** (the founder undid it), **RETIRED** (the founder ended it). `EXPIRED`,
`CHALLENGED`, and `REVIEW_DUE` are **not** implemented (no auto-expiry/derived-review this slice) and are recorded as
deferred debt — they are not invented without semantics.

### Law 12 — No coercive lock-in
Business Brain must not shame or pressure the founder for changing, reversing, or deferring a decision, choosing against
the recommendation, or leaving without recording a decision. No celebration, streaks, or retention mechanics.

### Law 13 — No post-hoc rewriting
Later outcomes must not rewrite what was known, unknown, or believed at decision time. Execution results may later become
evidence — never retroactive certainty.

### Law 14 — Export and deletion
All SDRs and their lifecycle history are founder-inspectable, exportable, account-deletable, provenance-resolvable, and
founder-isolated. Deletion leaves zero orphans.

### Law 15 — Constitutional supremacy
Apply the Business Brain Constitution and the test: **"Does this serve the founder's clarity and sovereignty, or the
product's hold?"** A surface that nudges the founder toward recording (or not reversing) a decision serves the product's
hold; a neutral surface that records exactly what the founder chose serves the founder.

## Authorship boundary (Laws 7 + 2 operationalized)

Every SDR field is exactly one of:
- **FOUNDER_AUTHORED** — the founder's own words / explicit structured selections (decision statement, chosen option,
  optional rationale, confirmed alternatives, acknowledgements).
- **RECOMMENDATION_DERIVED** — copied verbatim from the linked immutable recommendation, **labelled as such** (e.g. an
  alternative's label). Never presented as the founder's words.
- **SYSTEM_DERIVED** — deterministic references and derivations (session id, schema/manifest versions, alignment,
  grounding-status-at-decision, decided-at).

These must never be merged into one ambiguous narrative. The model never authors a decision, a rejection reason, or a
psychological explanation of the founder's choice.

## Scope boundary

This slice records founder decisions over the existing bounded `PRIORITY_DECISION` strategy surface. It does **not**: add
Strategic Commitments, plans, tasks, execution, agents, market discovery, or general Founder Conversation; reconcile the
legacy `memory.*` schema (KA-2) — the pre-existing `decision.ts`/`captureDecision` memory primitive is untouched; create
generic Strategic Memory; let the model create/infer/save a decision; modify the frozen engine; change recommendation
`ACCEPT` or Business-Understanding `accept` semantics. `strategic-decision-1` is a new, independent schema version — the
recommendation schema/prompt versions are unchanged.
