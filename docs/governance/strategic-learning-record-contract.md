# Strategic Learning Record — Governance Contract

**Status: FROZEN.** Governs the founder-explicit **Strategic Learning Record (SLR)**: a durable strategic understanding
the founder **explicitly decides to keep** after a review. Written and committed *before* implementation. Companion
architecture record: [`strategic-learning-record-slice.md`](../architecture/strategic-learning-record-slice.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) and the Business Brain Constitution. Builds on the
Strategic Plan Review Record ([contract](strategic-plan-review-record-contract.md)) — a learning is promoted from a review.

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

### Law 9 — Learning preserves uncertainty
A learning's confidence is one of `ESTABLISHED`, `TENTATIVE`, or `CONDITIONAL` — **never absolute truth**.

### Law 10 — Learning is append-only
Learning records are immutable. A correction is another append-only learning. No UPDATE (enforced in the database).

### Law 11 — Learning is historically linked
Every learning references the exact **Review → Plan → Commitment → Decision → Recommendation → Evidence lineage** it was
promoted from.

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

This slice records founder learnings promoted from existing reviews. It does **not** add Strategic Execution Records, task
management, progress/productivity/habit/time tracking, reminders/scheduling/notifications/calendar integrations, agents/
autonomous actions, **automatic context mutation** (BU/FSC), or generic Strategic Memory; reconcile the legacy `memory.*`
schema or the dead `founder.belief_chains` table (KA-2); let the model silently create learning; or modify the frozen
engine. `strategic-learning-1` is a new, independent schema version — all prior schemas/prompt versions unchanged.
