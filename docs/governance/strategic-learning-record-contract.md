# Strategic Learning Record — Governance Contract

**Status: FROZEN** (amended by the remediation of 2026-07-21 — see "Remediation amendments" below). Governs the
founder-explicit **Strategic Learning Record (SLR)**: a durable strategic understanding the founder **explicitly decides
to keep** after a review. This is the **initial immutable creation slice** (CREATE-only). Companion architecture record:
[`strategic-learning-record-slice.md`](../architecture/strategic-learning-record-slice.md); remediation evidence:
[`strategic-learning-record-remediation.md`](../architecture/strategic-learning-record-remediation.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) and the Business Brain Constitution. Builds on the
Strategic Plan Review Record ([contract](strategic-plan-review-record-contract.md)) — a learning is **created/kept from**
a review. **"Creating a learning" is not "promotion"**: promotion is the future, separately-gated flow that carries a
learning *into* Business Understanding / Founder Strategic Context (Law 14).

## Why

Everything from Evidence through Review records **what happened**. Nothing yet records **what durably changed in the
founder's strategic model**. That missing object is Strategic Learning: *"What durable strategic understanding did the
founder explicitly decide to keep?"* **History records events; learning records durable changes in understanding — they
are different objects.** Learning is a founder-governed promotion of insight. Not every review creates learning; **most
reviews should not.** A learning is not journaling, note-taking, a diary, a wisdom collection, memory, execution tracking,
productivity tracking, automatic insight generation, or model summarization.

## The sixteen laws

### Law 1 — Learning is optional
Most reviews produce no learning. There is no expectation, prompt-pressure, or nudge to create one.

### Law 2 — Learning is explicitly accepted by the founder
A learning is created only by a deliberate founder action. **No automatic promotion** — not from a review, a
disposition, a conclusion, time, or inference.

### Law 3 — Learning is not model authority
The model may propose (not in this slice); the **founder decides**. Model-proposed text stays `MODEL_PROPOSED` until the
founder explicitly accepts it.

### Law 4 — Learning never rewrites Review.
### Law 5 — Learning never rewrites Plan.
### Law 6 — Learning never rewrites Commitment.
### Law 7 — Learning never rewrites Decision.
### Law 8 — Learning never rewrites Recommendation.
A learning references these immutable records; it mutates none of them.

### Law 9 — Learning preserves uncertainty (and may increase it)
A learning's confidence is one of `PROVISIONAL`, `SUPPORTED`, `CONTESTED`, or `INSUFFICIENT_INFORMATION` — a **bounded,
never truth-inflating** vocabulary. None of these imply objective, independently-verified, or permanent truth; a learning
is the founder's interpretation. A learning may record that understanding became *less* certain. (`ESTABLISHED` was
removed in remediation — it could be misread as objectively proven; a conditional learning is expressed via explicit
**boundary conditions**.) A **causal** learning supported only by founder-reported material may not claim `SUPPORTED`.

### Law 10 — Learning is append-only
Learning records are immutable. A correction is another append-only learning. No UPDATE (enforced in the database).

### Law 11 — Learning is historically linked
Every learning references the exact **Review → Plan → Commitment → Decision → Recommendation → Evidence lineage** it was
kept from. Stored lineage is read back as stored — never rebuilt from current state. Any founder-cited evidence reference
must resolve to the source review's own lineage (no arbitrary/invented ids; no duplicates).

### Law 12 — Learning does not automatically modify Business Understanding.
### Law 13 — Learning does not automatically modify Founder Strategic Context.
Creating a learning writes **only** the learning record; BU and FSC are untouched.

### Law 14 — Promotion into BU/FSC is a future governed action
Any future flow that promotes a learning into Business Understanding or Founder Strategic Context is a **separate,
explicitly gated** capability. It does not exist in this slice.

### Law 15 — Learning is exportable
Learning records are founder-inspectable, historically linked, exportable, founder-isolated, and account-deletable.

### Law 16 — Constitutional supremacy
Apply the test: **"Does this serve the founder's clarity and sovereignty, or the product's hold?"**

## Authorship boundary

Every field is exactly one of **FOUNDER_AUTHORED** (`learningStatement`, category, confidence — `founderAuthored=true`,
`acceptedByFounder=true`), **MODEL_PROPOSED** (a suggestion — not used this slice; `modelSuggested`), or **SYSTEM_DERIVED**
(the review/plan/commitment/decision/session/manifest links). Never merged.

## Model role (this slice)

**None.** The founder authors every learning; it is validated deterministically. No LLM path exists, so no LLM evaluation
applies. Any future model suggestion stays `MODEL_PROPOSED` until explicitly accepted.

## Scope boundary

This slice records founder learnings **created/kept from** existing reviews. It does **not** add Strategic Execution
Records, task management, progress/productivity/habit/time tracking, reminders/scheduling/notifications/calendar
integrations, agents/autonomous actions, **automatic context mutation** (BU/FSC), or generic Strategic Memory; reconcile
the legacy `memory.*` schema or the dead `founder.belief_chains` table (KA-2); let the model silently create learning; or
modify the frozen engine. `strategic-learning-1` is a new, independent schema version — all prior schemas/prompt versions
unchanged.

## Remediation amendments (2026-07-21)

- **Lifecycle is CREATE-only.** This is the *initial immutable creation slice*. There is **no** REFINE / CONTEST /
  SUPERSEDE / RETIRE, no effective-state derivation, and no historical-revision UI. A correction is another independent
  append-only learning; a *governed* contradictory-learning relationship is future work (**SLR-3**). Contradictory later
  learning is therefore supported only as independent immutable records.
- **The object is enriched** so it is an honest durable-understanding record, not "category + text + confidence": it
  separates **priorUnderstanding** / **revisedUnderstanding** / **changeStatement** (before/after kept distinct);
  carries an applicability **scope**; requires explicit **broad-scope acknowledgement** when a learning generalizes
  beyond the source review (`MULTIPLE_OFFERS`/`MULTIPLE_MARKETS`/`BUSINESS`/`FOUNDER_STRATEGY`/`OPERATING_MODEL`); flags a
  **causal hypothesis** and bounds it (founder-reported-only causal claims cannot be `SUPPORTED`); and preserves
  **boundaryConditions**, **counterEvidence**, **unresolvedUnknowns**, and source-classified **observations**
  (founder-reported stays founder-reported). All are FOUNDER_AUTHORED and deterministically validated (no model).
- **Vocabulary** is bounded (Law 9): `PROVISIONAL | SUPPORTED | CONTESTED | INSUFFICIENT_INFORMATION`. Migrated via a
  forward migration (**V077**); V076 was not edited.
- **"Promotion" reserved.** Creation from a review is *create/keep/record* — never "promotion". "Promotion" denotes only
  the future BU/FSC capability (Law 14).
