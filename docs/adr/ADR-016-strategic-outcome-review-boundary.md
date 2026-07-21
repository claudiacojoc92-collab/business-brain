# ADR-016 — Strategic Outcome Review Boundary

Status: Accepted (governance) — 2026-07-21. Branch `feature/axe-wave2-understanding`. Builds on ADR-015 (Execution
Boundary) and ADR-014 (Consumption Gate / Context Snapshot). Governs the constitutional boundary between an **Execution
Report** and **Strategic Learning**.

## Core constitutional question
> Can Business Brain faithfully **describe what happened** without rewriting history, updating Business Understanding,
> generating Strategic Learning, changing Recommendations, changing Effective Context, or changing future Plans?

If it cannot, the architecture is not constitutionally complete. This ADR makes the answer **yes** by introducing a single
immutable object — the **Strategic Outcome Review** — that is the *only* place Business Brain may lay the intended action,
the founder-reported execution, the available evidence, and the observed outcome side by side, and that produces **only an
immutable historical assessment**. Nothing downstream changes automatically.

## The canonical lifecycle
Evidence → Business Understanding → Recommendation → Decision → Commitment → Plan → **Execution Report → Review → Strategic
Learning** → Promotion → Effective Context. The Review sits **strictly between** Execution Report and Strategic Learning.
Nothing bypasses Review to reach Learning; Review itself creates no Learning.

## Naming — why a NEW object, not the existing Strategic Plan Review
A **Strategic Plan Review** already exists (ADR-011 cat 12, V075, `strategic_plan_review_record`). It is a *mid-flight
plan-coherence* assessment: it evaluates whether a Plan still holds and proposes an intended **disposition**
(`CONTINUE_CURRENT_PLAN` / `CREATE_REVISED_PLAN` / …) — i.e. it answers *"what should happen next?"*. It does **not**
consume the Execution Report chain, does **not** consume a Context Snapshot, and is **not** a frozen, reproducible object.

The Review this ADR governs is constitutionally different: a **retrospective outcome assessment** that freezes its
immutable inputs, records only *what happened* and *what remains unknown*, and **never** answers *"what next"*. To avoid
conflation it is named the **Strategic Outcome Review** (`strategic_outcome_review`). The pre-existing Strategic Plan
Review is left entirely untouched. (Reconciling whether Strategic Learning should henceforth attach to the Outcome Review
rather than the Plan Review is recorded as debt SOR-1; this slice changes no existing wiring.)

## What the Strategic Outcome Review IS
An append-only, immutable, founder-initiated record that compares four immutable facts about one exact Plan revision:
1. **What was intended** — read from the exact Plan revision (`plan_id`).
2. **What the founder reported** — the effective founder-reported execution for that exact revision (ADR-015 revision-
   scoped chain), frozen at review time.
3. **What evidence existed** — the bounded, unverified evidence references present on the execution chain at review time,
   plus the exact Context Snapshot consumed.
4. **What outcome was observed** — the founder's explicit outcome statement.
…and, first-class, **what remains unknown**.

It records those five things and nothing else. It does **not** answer "what should happen next?".

## What the Strategic Outcome Review is NOT
Not execution, not recommendation, not learning, not promotion, not judgment, not coaching, not verification, not scoring.
It performs no founder action and no external action. It never marks founder testimony or evidence as verified.

## Immutability, no hindsight, reproducibility
- **Immutable + append-only.** A Review is never edited. A later Review is a **new** Review; it never alters an earlier
  one. History is never rewritten.
- **No hindsight.** A Review evaluates using only the knowledge frozen inside its own snapshot. Later evidence can only
  produce a *new* Review; it can never change an earlier Review.
- **Reproducible forever.** A Review freezes: the exact Plan revision, the exact Execution Report chain (head per subject),
  the exact Context Snapshot id + hash, the evidence present at review time, the founder outcome statement, the assessment
  method (prompt-template hash + model configuration), a timestamp, and the schema version — plus a SHA-256 content hash
  over a canonical serialization. Recomputing the assessment from the frozen inputs yields a byte-identical payload.

### Assessment method — deterministic, no judgment model
To keep Review from becoming a judgment/scoring/coaching surface, the assessment is a **deterministic composition** over
the frozen inputs (no live model call, no inference). The reproducibility fields required by the boundary
(`prompt_template_hash`, `model_configuration`, `review_schema_version`, timestamp) are still recorded as the frozen
*method provenance*: `assessment_method = 'DETERMINISTIC_COMPOSITION'`, `prompt_template_hash` = SHA-256 of the composition
template version, `model_configuration = {}` (no model). Determinism makes "reproducible forever" trivially true and
future-proofs the schema should a purely-descriptive model ever be added.

## Unknown is first-class
A Review may conclude **UNKNOWN** for the observed outcome (or for any dimension) with no pressure to infer. Unknown is
never silently converted into failure, success, or any score.

## Inputs are immutable — no live lookup
Review creation consumes only exact immutable references: the exact Plan revision id, the exact Context Snapshot id, the
frozen Execution Report chain for that revision, the evidence present at review time, and the founder outcome statement.
**No "latest", no live mutable lookup, no regenerated recommendation, no regenerated understanding.**

## Hard boundaries (fail closed)
A Review must not, by any path: create Strategic Learning; create a Promotion; change Business Understanding; change or
regenerate Recommendations; change Effective Context; change Plans; change Execution Reports; change Decisions; change
Commitments; call external systems; or perform any action.

## Database
`business.strategic_outcome_review` — append-only, immutable (BEFORE-UPDATE forbidden; BEFORE-DELETE gated on
`bb.allow_strategic_review_delete`, the founder-account-deletion path only), matching the ADR-015 execution-report
guarantees. Every row references the founder, the exact Plan revision (+ lineage), the frozen execution chain, the Context
Snapshot id + hash, the frozen evidence, the founder outcome statement, the unknowns, the prompt-template hash, the model
configuration, the review schema version, the content hash, and the timestamp.

## Acceptance
Accept only if the Strategic Outcome Review is an immutable constitutional object that **describes but never changes**
Business Brain history: it cannot mutate any prior record, cannot create Learning, cannot promote context, cannot
regenerate a recommendation, remains reproducible, keeps Unknown unchanged, and — given later evidence — produces a new
Review while the earlier Review stays byte-identical.
