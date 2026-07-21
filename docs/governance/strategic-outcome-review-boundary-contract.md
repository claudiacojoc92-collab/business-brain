# Strategic Outcome Review Boundary — governance contract

Governs `business.strategic_outcome_review` (ADR-016). The Review is the **only** place Business Brain compares intended
action, founder-reported execution, available evidence, and observed outcome — producing **only an immutable historical
assessment**. Fail closed: the model never judges, scores, verifies, or decides "what next"; creating a Review mutates
nothing and creates no downstream object.

## Law 1 — Review describes, never changes
A Review produces an immutable historical assessment of what happened. It changes no other record and triggers no
downstream effect. Describing is its entire authority.

## Law 2 — Immutable + append-only
A Review is never updated or deleted (except by founder-account deletion). A correction or a later look is a **new**
Review. `exr`-grade guarantees: BEFORE-UPDATE forbidden; BEFORE-DELETE gated.

## Law 3 — A later Review never edits an earlier Review
Multiple Reviews of the same Plan revision are permitted and each stands forever. A new Review never alters, supersedes-in-
place, or rewrites an earlier one; the earlier Review remains byte-identical.

## Law 4 — Immutable inputs only (no live lookup)
Review creation consumes only exact immutable references: the exact Plan revision (`plan_id`), the exact Context Snapshot
(`snapshot_id` + hash), the frozen Execution Report chain for that revision, the evidence present at review time, and the
founder's explicit outcome statement. No "latest", no live mutable lookup, no regenerated recommendation/understanding.

## Law 5 — Frozen, reproducible snapshot
Every Review freezes: exact Plan revision (+ lineage), the Execution Report chain (effective head per subject), the
Context Snapshot id + content hash, the evidence at review time, the founder outcome statement, the unknowns, the
assessment method (`prompt_template_hash` + `model_configuration`), the timestamp, and the `review_schema_version` — plus a
SHA-256 content hash over a canonical serialization. Recomputing from the frozen inputs is byte-identical forever.

## Law 6 — Deterministic assessment, no judgment model
The assessment is a deterministic composition over the frozen inputs — no live model call, no inference, no scoring.
`assessment_method = 'DETERMINISTIC_COMPOSITION'`, `model_configuration = {}`. The reproducibility fields are recorded as
frozen method provenance.

## Law 7 — Records five things, answers no sixth
A Review records exactly: (1) what was intended, (2) what the founder reported, (3) what evidence existed, (4) what outcome
was observed, (5) what remains unknown. It does **not** answer "what should happen next?" — no disposition, no
recommendation, no next-step.

## Law 8 — Unknown is first-class
A Review may record `UNKNOWN` for the observed outcome (or any dimension) with no pressure to infer. Unknown is never
converted into failure, success, or any score.

## Law 9 — No hindsight
A Review evaluates using only knowledge frozen inside its own snapshot. Later evidence never rewrites an earlier Review; it
can only produce a new Review.

## Law 10 — No verification, no scoring, no coaching
A Review never marks founder testimony or evidence as verified; never emits a success/performance/AI-confidence/founder
score; never coaches or advises. Founder-reported stays founder-reported; missing evidence stays missing; activity is not
outcome; outcome is not causation.

## Law 11 — Hard downstream boundary (fail closed)
A Review must not, by any path: create Strategic Learning; create a Promotion; change Business Understanding; change or
regenerate Recommendations; change Effective Context; change Plans; change Execution Reports; change Decisions; change
Commitments; call external systems; or perform any founder/external action.

## Law 12 — Founder-owned, isolated, exportable, forgettable
A Review belongs to exactly one founder; it is never cross-founder readable. It appears in the founder's export in full and
is removed by account deletion (zero orphans). Nothing is ever created automatically on the founder's behalf.

## Law 13 — Distinct from the Strategic Plan Review
The Strategic Outcome Review (this contract) is not the pre-existing Strategic Plan Review (ADR-011 cat 12, V075). The Plan
Review is a mid-flight coherence assessment that proposes a disposition; the Outcome Review is a frozen retrospective that
answers only "what happened". Neither modifies the other. (Debt SOR-1: reconcile which review Strategic Learning attaches
to — deferred; no wiring changes here.)
