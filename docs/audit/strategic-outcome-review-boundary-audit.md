# Strategic Outcome Review Boundary — pre-implementation audit (2026-07-21)

Answers the ADR-016 core question against the current repository, and records the design decision to build a **new**
object rather than extend the existing Strategic Plan Review.

## Core question
> Can Business Brain faithfully describe what happened without rewriting history, updating Business Understanding,
> generating Strategic Learning, changing Recommendations, changing Effective Context, or changing future Plans?

**Today: not in one constitutional object.** The pieces exist but no single record lays intention + reported execution +
evidence + outcome side by side under an immutability + reproducibility guarantee, and the closest existing object (Plan
Review) answers "what next" (a disposition), which the boundary forbids for this layer.

## What already exists (audited)
- **Execution Report** (`business.execution_report`, ADR-015, V083–V085) — append-only revision-scoped founder testimony;
  effective state per `(founder, plan_id, subject)`; bounded unverified evidence; product performs/verifies nothing. This
  is the reported-execution input.
- **Context Snapshot** (`business.context_snapshot`, ADR-014, V081/V082) — immutable frozen reasoning input with a SHA-256
  content hash. This is the exact-context input and the freeze/hash reproducibility pattern to mirror.
- **Strategic Plan Record** (`business.strategic_plan_record`, V074) — append-only immutable Plan revisions; `getByRevisionId`
  resolves the exact revision. This is the intended-action input.
- **Strategic Plan Review** (`business.strategic_plan_review_record`, ADR-011 cat 12, V075) — a founder-explicit, append-
  only *plan-coherence* assessment that records a `review_conclusion` and a **`selected_disposition`** (`CONTINUE_CURRENT_
  PLAN` / `CREATE_REVISED_PLAN` / …). It does **not** consume the Execution Report chain or a Context Snapshot, is **not**
  frozen/hashed for reproducibility, and it **does** answer "what next".
- **Strategic Learning** (`business.strategic_learning_record`, V076) — founder-explicit learning, currently created FROM a
  Plan Review (`POST /strategy/plan-reviews/:reviewId/learnings`). Append-only; promotion is a separate gate.
- **Append-only ledger discipline** — BEFORE-UPDATE forbid + BEFORE-DELETE gated on a `bb.allow_*_delete` GUC; per-founder
  idempotency; account-deletion is the only destructive path (delete.service). Mirror exactly.

## Design decision — a new object (Strategic Outcome Review)
The prompt's Review must: sit between Execution Report and Strategic Learning; consume the exact execution chain + context
snapshot; freeze a reproducible snapshot (prompt hash, model config, schema version, timestamp); treat UNKNOWN as first-
class; answer only "what happened", never "what next". The existing Plan Review matches **none** of these five properties
and violates the last (it proposes a disposition). Extending it would blur two constitutional roles. Therefore build a
**new** append-only object, `business.strategic_outcome_review`, and leave the Plan Review untouched. Strategic Learning
wiring is not changed in this slice (debt SOR-1).

## Constitutional risks and how the design fails closed
| Risk | Mitigation |
|---|---|
| Review becomes a judgment/scoring engine | Deterministic composition, no model call, `model_configuration={}`; UNKNOWN first-class; no score/rating fields exist in schema or view |
| Review answers "what next" | No disposition/next-step field in domain, schema, API, or UI (Law 7) |
| Hindsight rewrites an earlier Review | Immutable + append-only; later evidence → new Review; content hash proves earlier Review byte-identical (Laws 2/3/9) |
| Live/latest lookup leaks mutability | Create takes exact `plan_id` + exact `snapshot_id`; execution frozen at review time; no "latest" path (Law 4) |
| Silent downstream mutation | No Learning/Promotion/BU/FSC/Plan/Execution/Decision/Commitment writes; tests assert counts unchanged (Law 11) |
| Verification creep | `notVerified`/`productPerformedNothing` constants; evidence stays unverified (Law 10) |

## Verdict
Building the Strategic Outcome Review as a new immutable, deterministic, reproducible, append-only object makes the core-
question answer **yes**. Implementation follows in Commit 2.
