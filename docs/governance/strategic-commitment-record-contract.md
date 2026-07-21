# Strategic Commitment Record — Governance Contract

**Status: FROZEN.** Governs the founder-explicit **Strategic Commitment Record (SCR)**: a durable, append-only
declaration that a specific **Strategic Decision** will govern the founder's strategic conduct for a **bounded** scope and
period, subject to visible review, exit, and reconsideration conditions. Written and committed *before* implementation.
Companion architecture record: [`strategic-commitment-record-slice.md`](../architecture/strategic-commitment-record-slice.md).

Governed by [ADR-011](../adr/ADR-011-knowledge-architecture.md) (category 11 — Strategic Commitment) and the Business
Brain Constitution. Builds on the Strategic Decision Record
([contract](strategic-decision-record-contract.md)) — a commitment always references a decision.

## Why

A **decision** records *"what have I chosen?"*. A **commitment** records *"what choice am I intentionally allowing to
govern my attention, resources, and strategic behavior — for what scope, under what conditions, and until when?"*. A
Strategic Decision is **not** automatically a Strategic Commitment. A commitment is **not** a task, a plan, a calendar
event, an execution record, a guarantee of success, a promise to Business Brain, a loyalty mechanism, a psychological
identity statement, a permanent restriction, or generic memory. Only an explicit founder action creates one.

## The fifteen laws

### Law 1 — Decision is not commitment
A Strategic Decision records a founder choice. It becomes a Strategic Commitment only through a **separate, deliberate**
founder action — never automatically, never for "every decision".

### Law 2 — Explicit founder declaration
A commitment may be created only when the founder explicitly confirms the linked decision, the governed scope, the period
or review condition, what the commitment requires, what it does **not** require, and the exit/reconsideration conditions.
**No silent creation, no inference, no creation from clicks, dwell time, positive feedback, repeated behavior, or model
interpretation.**

### Law 3 — Commitment is bounded
Every commitment must have an explicit boundary: scope; a start condition/date; a review date, review trigger, or bounded
duration; and exit/reconsideration conditions. **"Until successful" is not a valid bounded period. "Forever" is not
supported.** A commitment with no review/expiry/exit mechanism is inadmissible.

### Law 4 — Commitment is not obedience
A commitment governs founder-chosen strategic consistency; it does not make Business Brain an authority over the founder.
Reconsideration, revision, pause, or exit is **never** framed as failure, weakness, lack of discipline, betrayal, or
inconsistency of character.

### Law 5 — Commitment is not identity
A commitment is a bounded strategic declaration. It must not become evidence about personality, values beyond what was
explicitly declared, ambition, discipline, seriousness, psychological type, or founder identity.

### Law 6 — Commitment requires a decision
Every commitment references an existing, founder-owned Strategic Decision Record. **No free-floating commitment.** To
commit to something not represented by a decision, a decision must first be recorded explicitly.

### Law 7 — Historical linkage
The commitment references the **exact immutable decision revision** used at creation. Later decision supersession,
reversal, or retirement must not rewrite the historical commitment.

### Law 8 — Visible cost
Before confirmation the founder must see the meaningful strategic cost (attention, time, money, team capacity, opportunity
cost, excluded alternatives, reduced flexibility, review burden). **Unknown cost stays explicitly unknown; the model must
not invent founder resource commitments.**

### Law 9 — Explicit obligations
A commitment describes what strategic **behavior** it governs (e.g. maintain a positioning direction; avoid reopening a
decision before the review condition; allocate a bounded resource envelope; preserve a channel choice for a test period;
evaluate against named evidence thresholds). These are **not** translated into tasks or plans.

### Law 10 — No hidden exclusivity
A commitment explicitly states whether it excludes alternatives, deprioritizes them, is merely a preferred direction, or
leaves parallel experimentation open. **Exclusivity is never inferred from the word "commitment".**

### Law 11 — No manufactured permanence
Commitments support review, challenge, pause (if governed), supersession, release, retirement, and expiration. Business
Brain must **not** optimize for keeping a commitment active.

### Law 12 — Append-only history
Commitment history is immutable; change is represented by append-only revisions / lifecycle versions. **No UPDATE of
historical commitment content** (enforced in the database).

### Law 13 — Outcome does not rewrite commitment-time truth
Later execution or business outcomes must not rewrite why the commitment was made, what was known, what remained
uncertain, what costs were accepted, or what exit conditions existed.

### Law 14 — Commitment is not plan
A commitment may state governed behavior and resource boundaries. It must **not** contain task lists, operational
sequencing, project milestones, assignments, execution status, or completion percentages — those belong to a future Plan
capability. There is no "completed" state (commitment is not execution).

### Law 15 — Export, deletion, and sovereignty
Commitments and lifecycle history are founder-inspectable, exportable, account-deletable, historically resolvable,
founder-isolated, and **easy to leave or retire without product pressure**. Apply the Constitutional test: **"Does this
serve the founder's clarity and sovereignty, or the product's hold?"**

## Authorship boundary

Every field is exactly one of **FOUNDER_AUTHORED** (statement, governed behavior, accepted costs, exit conditions,
acknowledgements), **RECOMMENDATION_DERIVED** (a possible cost surfaced from the recommendation, labelled as such, never
presented as the founder's words), or **SYSTEM_DERIVED** (decision/session/schema/manifest links, alignment,
grounding-at-commitment, derived status). Never merged. The model never creates a commitment, an obligation, a cost the
founder accepted, or an exclusivity judgment.

## Scope boundary

This slice records founder commitments over existing Strategic Decisions. It does **not** add plans, tasks, execution
tracking, agents, reminders, market discovery, or general Founder Conversation; reconcile the legacy `memory.*` schema
(KA-2, incl. its `decision.ts` "commitment" text primitive — untouched); create generic Strategic Memory; let the model
create/infer/save a commitment; auto-convert decisions into commitments; or modify the frozen engine. `strategic-commitment-1`
is a new, independent schema version — recommendation and decision schema/prompt versions are unchanged.
