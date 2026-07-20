# Founder Strategic Context — Governance Contract (Wave 4)

**Status: FROZEN.** This contract governs the Founder Strategic Context capability. It is written and committed
*before* implementation. Companion to [`founder-conversation-consumption-contract.md`](./founder-conversation-consumption-contract.md).

## What Founder Strategic Context is

> The explicit, inspectable, temporal, and revisable set of conditions under which the founder's business strategy
> must work.

It answers only: what the founder is trying to achieve; what resources are currently available; what constraints
currently apply; what strategic approaches the founder prefers; over what horizon the current recommendation must work.

It is **not**: a biography; a personality profile; psychological inference; therapy or life coaching; generic personal
memory; behavioral surveillance; an inferred model of the founder's identity.

**Supported kinds this slice (only):** `GOAL`, `CONSTRAINT`, `RESOURCE`, `STRATEGIC_PREFERENCE`, `DECISION_HORIZON`.
Explicitly **not** implemented: `STRATEGIC_EXCLUSION` as a separate object, `STRATEGIC_COMMITMENT`, accepted strategic
decisions, strategy plans, task execution, automatic extraction from conversations, silent memory writes.

---

## The twelve rules

### 1. Founder-declared, not system-invented
Effective context may contain only information that was explicitly **declared** by the founder, explicitly
**confirmed** by the founder, **imported and explicitly accepted** by the founder, or independently **verified through
a governed source** where the category permits it. The system may *propose* context, but proposed or inferred context
never becomes effective without explicit founder confirmation.

### 2. Conditions, not identity
Context describes strategic operating conditions, never stable traits.
- Correct: "Available marketing time: 4 hours per week until September." / "The founder does not want to use cold
  outreach during this launch."
- Incorrect: "The founder has low execution capacity." / "The founder avoids selling."

Do not infer stable traits from temporary conditions.

### 3. Temporal and scoped
Every item carries at minimum: `effectiveFrom`; `effectiveUntil` (nullable); `reviewAt` (nullable); `scope`; `status`.
No temporary condition silently becomes permanent.

### 4. Inspectable and founder-controlled
The founder can see every active item (category, wording, when it became effective, whether it expires), edit it
through **append-only revision**, retire it, see prior versions, and — where practical — see where it was consumed by a
strategic session. No hidden strategic profile.

### 5. No silent writes from conversation
The strategic model and Founder Conversation may *suggest* a goal, constraint, resource, preference, or decision
horizon. No generated recommendation or conversation output may **automatically persist** one. Persistence requires a
dedicated explicit founder action.

### 6. Append-only revision
A revision never overwrites history: the prior version stays durable. Exactly **one effective version** exists per
logical item; a later version supersedes the previous effective version. Retirement is append-only too.

### 7. Preferences do not override evidence
A preference influences the recommendation but does not convert a weak strategy into a strong one. The strategist may
say: "LinkedIn is better supported by current evidence, although you prefer Instagram." It does not obey preferences
blindly.

### 8. Founder sovereignty does not require obedience
Business Brain may challenge incompatibilities between goals, resources, constraints, preferences, time horizon,
business evidence, and market evidence. It must expose strategic cost and trade-offs **without manipulating** the
founder.

### 9. Unknown is not zero
Missing budget ≠ zero budget. Missing team data ≠ no team. Missing time capacity ≠ unlimited capacity. Unknowns remain
explicit.

### 10. Personal context boundary
Personal information is allowed only when it materially affects business execution.
- **Allowed:** hours available; financial runway; travel limitations; caregiving obligations affecting availability;
  willingness to be publicly visible; founder-declared energy capacity; need for income predictability; geographic
  constraints.
- **Forbidden:** diagnosis; inferred trauma; romantic/family analysis unrelated to execution; personality scoring;
  inferred subconscious motives; emotional profiling; predictions based on perceived psychology.

### 11. Context must be strategically relevant
An item belongs only if it can materially change priority, channel, pace, resource allocation, feasibility,
sequencing, risk, or recommendation horizon. Do not collect data merely because it may be useful someday.

### 12. Constitutional test
For every retained item: Can this materially change a strategic recommendation? Did the founder explicitly declare or
confirm it? Is its scope and validity clear enough? Can the founder inspect, revise, retire, or let it expire? If any
answer is no, it must not enter effective context.

The final constitutional test remains: **"Does this serve the founder's clarity and sovereignty, or the product's
hold?"**

---

## Kind-specific rules

- **NON_NEGOTIABLE** (on a `CONSTRAINT.founderClassification` or a `STRATEGIC_PREFERENCE.strength`) may be set **only by
  the founder** — never by the model or an import default.
- A founder-declared non-negotiable **preference** may function as a temporary exclusion, but the model and UI must
  label it accurately as a preference/non-negotiable — it does **not** create a separate `STRATEGIC_EXCLUSION` domain
  kind in this slice.
- `RESOURCE.evidenceStatus`: a qualitative founder claim is `FOUNDER_DECLARED`, never silently `VERIFIED`. Qualitative
  claims are not treated as verified quantities.
- A `GOAL` is not required to carry a numeric target. `DECISION_HORIZON` is distinct from a goal's horizon.

## Consumption boundary

The `StrategicContextAssembler` consumes **only** the effective resolver output (active, current, latest-version,
in-scope, non-expired, founder-confirmed items). Superseded, retired, future, expired, and proposed/unconfirmed items
are never consumed as active context. Every consumed item preserves its id, logical item id, version, kind, source, and
temporal metadata so the recommendation's provenance resolves to a stored record. Conflict detection is deterministic
over structured context (plus resolvable explicit conflict markers from the recommendation) — never an LLM inventing
psychological or strategic contradictions; an undeterminable conflict is preserved as unknown, not fabricated.
`ACCEPT` on a recommendation writes no context and no business memory.
