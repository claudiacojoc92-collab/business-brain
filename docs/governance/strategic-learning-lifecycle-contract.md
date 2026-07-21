# Strategic Learning Lifecycle — Governance Contract

**Status: FROZEN** (governance gate, committed *before* implementation). Governs founder-directed change **within one
logical learning thread**: `CREATE → REFINE / CONTEST / SUPERSEDE / RETIRE`. Every transition is an explicit founder act
that appends a new immutable revision preserving complete history. Governed by
[ADR-011](../adr/ADR-011-knowledge-architecture.md) + [ADR-012](../adr/ADR-012-strategic-learning-lifecycle.md) and the
Business Brain Constitution. Extends the Strategic Learning Record
([contract](strategic-learning-record-contract.md)); companion architecture record:
[`strategic-learning-lifecycle-slice.md`](../architecture/strategic-learning-lifecycle-slice.md).

**Architectural decision (ADR-012, dual-layer, relationships deferred):** single-thread lifecycle ships now; inter-thread
learning relationships are deferred. **CONTEST is a valid single-thread lifecycle action** (a usability downgrade of the
founder's *own* learning) — **not** the same concept as a future `CONTESTS` relationship between two independent threads.
A genuinely distinct claim is a **separate CREATE thread**, never a revision of another. No contradiction graph,
relationship table, semantic matching, similarity, clustering, or knowledge graph is included.

## The twenty-eight laws

### Law 1 — Explicit founder action
No lifecycle transition occurs automatically. No review, new evidence, elapsed time, recommendation, model output,
contradictory learning, context change, or external event may trigger REFINE / CONTEST / SUPERSEDE / RETIRE.

### Law 2 — Immutable history
Every lifecycle act creates a new append-only revision. No existing revision is updated in place; no individual revision
is deleted outside governed founder-account deletion.

### Law 3 — Stable logical identity
All revisions of the same learning share a stable `logical_learning_id`, **copied from the source revision** — never
inferred from text/semantic similarity, embeddings, categories, shared evidence, shared review, or timestamps.

### Law 4 — Separate claims remain separate
Two independent claims (even from the same review) remain separate threads. The system never automatically merges,
semantically deduplicates, classifies one as a revision of the other, or relates them as contradictory.

### Law 5 — Exact revision lineage
Every revision preserves: logical learning id, root learning id, immediate predecessor id, revision number, source review
(+ its revision), exact plan revision, exact commitment revision, exact decision, exact recommendation session, exact
provenance manifest where applicable. **Lineage is never rebuilt from current state.**

### Law 6 — REFINE preserves the same underlying learning
REFINE = "I still stand behind this learning, but I want to clarify or bound it." It may clarify wording; narrow scope;
broaden scope *with explicit acknowledgement*; add evidence / counterevidence / boundary conditions / unknowns; reduce
epistemic certainty; sharpen prior-vs-revised understanding. It **rejects a no-op** and must not smuggle in a materially
independent claim.

### Law 7 — CONTEST is a single-thread usability downgrade
CONTEST = "I no longer treat this learning as straightforwardly usable, but I am not replacing or retiring it." It does
**not** require a second learning, a competing claim, a contradiction relationship, proof of falsity, or a replacement. It
preserves the original claim, founder rationale, counterevidence where available, unresolved unknowns, and the founder's
current bounded position. CONTEST is **not** deletion, falsification, or inter-thread contradiction.

### Law 8 — SUPERSEDE replaces prospective use
SUPERSEDE = "A newer formulation should replace this learning for future strategic interpretation." It creates a new
revision **in the same logical thread** and records: replacement statement, what changed, why replacement is appropriate,
what remains valid, any unresolved limitations. Previous revisions remain visible.

### Law 9 — RETIRE ends prospective use
RETIRE = "I no longer want this learning used prospectively, and I am not replacing it." Requires a retirement reason;
remains historically visible; is **terminal** in this slice. **No REACTIVATE.** A future related claim must use a new
CREATE thread.

### Law 10 — Lifecycle state is descriptive
Actions: `CREATE | REFINE | CONTEST | SUPERSEDE | RETIRE`. Effective statuses: `ACTIVE | CONTESTED | SUPERSEDED |
RETIRED`. **No evaluative states** (WRONG, FAILED, INVALID, STALE, BAD, LOW_QUALITY, UNTRUSTWORTHY).

### Law 11 — Lifecycle status and epistemic status are separate
Epistemic states remain `PROVISIONAL | SUPPORTED | CONTESTED | INSUFFICIENT_INFORMATION`. Lifecycle status and epistemic
status use **distinct fields and distinct type names**. Neither is derived solely from the other (an ACTIVE learning may
be PROVISIONAL; a lifecycle-CONTESTED learning may be epistemically CONTESTED; a RETIRED learning preserves its epistemic
history).

### Law 12 — Uncertainty may increase
A later revision may be less certain than its predecessor. No transition requires confidence growth, stronger wording,
resolution, or a positive conclusion.

### Law 13 — Evidence classification remains stable
Founder-reported evidence stays founder-reported; SYSTEM_DERIVED stays limited to deterministic repository facts. A later
revision must not upgrade evidence credibility merely because it is newer.

### Law 14 — Counterevidence cannot silently disappear
A later revision may preserve, add, or explain why prior counterevidence is no longer decisive. If earlier counterevidence
is omitted from the effective representation, an explicit founder explanation is required and preserved
(`counterevidence_resolution`). Omission is never treated as resolution.

### Law 15 — Unknowns cannot silently disappear
If unresolved unknowns from the prior revision are removed, an explicit founder explanation of how/why they were resolved
or are no longer relevant is required and preserved (`unknowns_resolution`).

### Law 16 — Scope broadening is explicit
Any revision broadening scope to BUSINESS, FOUNDER_STRATEGY, multiple markets/offers, or another broad category requires
explicit founder acknowledgement. No lifecycle action may silently generalize beyond its source context.

### Law 17 — Causal guard persists
The deterministic causal guard applies to every revision: founder-reported-only causal claims must not gain unjustifiably
strong epistemic status through REFINE or SUPERSEDE. CONTEST is **not** blocked merely because it reduces confidence in a
causal claim.

### Law 18 — No downstream mutation
Lifecycle actions do not update Business Understanding, Founder Strategic Context, recommendations, decisions,
commitments, plans, reviews, or execution records. Strategic Learning Promotion remains a separate future slice.

### Law 19 — No downstream consequences
A CONTESTED / SUPERSEDED / RETIRED learning must not automatically regenerate recommendations, invalidate decisions,
cancel commitments, revise plans, create reviews, or create alerts / tasks / execution records.

### Law 20 — Contradictory threads may coexist
Distinct threads may contradict each other; the system preserves both. No automatic reconciliation, no automatic
relation, no "latest wins" across separate threads.

### Law 21 — Inter-thread relationships are deferred
No relationship table or relationship API in this slice. The lifecycle is complete without one. A future founder-declared
relationship layer is useful but deferrable and separately governed.

### Law 22 — Effective state is deterministic
The effective revision of one logical learning is derived from stable logical identity, contiguous revision numbers, the
exact predecessor chain, and explicit lifecycle action — **no LLM judgment, no text matching, no timestamp-only
inference.**

### Law 23 — No forks
Every revision after CREATE points to the exact current effective revision. Two concurrent actions on the same predecessor
must not both succeed — one succeeds, the other receives a conflict.

### Law 24 — Idempotency
Retrying the same lifecycle request with the same idempotency key returns the same revision; no duplicates.

### Law 25 — Export preserves complete history
Export includes logical learning id; all revisions; lifecycle actions; effective status; predecessor/root links; source
lineage; rationale; prior & revised understanding; scope; evidence; counterevidence; unknowns; historical timestamps.

### Law 26 — Founder deletion removes all revisions
Founder deletion removes all threads and revisions with zero orphans.

### Law 27 — Model has no lifecycle authority
The model must not choose CREATE-vs-revision, choose a lifecycle action, decide a learning is wrong, contest / supersede /
retire it, alter epistemic state, broaden scope, or create relationships. No model-generated lifecycle action.

### Law 28 — Constitutional supremacy
The Constitution is supreme. Lifecycle convenience yields to founder sovereignty, withheld verdict, disclosed bias, named
unknowns, bounded claims, no inferred interiority, visible work, and ungamed departure.

## Deterministic founder-facing decision rule (no model inference)

1. **Is the new statement independently useful and actionable without referring to the existing learning?**
   - **Yes → CREATE** a separate learning thread.
   - **No →** continue to the lifecycle choice.
2. **Does the founder still stand behind the same underlying learning?**
   - Yes, but wants changed wording / scope / evidence / boundaries / uncertainty → **REFINE**.
   - No longer straightforwardly usable, not yet replaced or retired → **CONTEST**.
   - A newer formulation should replace it prospectively → **SUPERSEDE**.
   - It should no longer be used prospectively and there is no replacement → **RETIRE**.

The founder always makes this choice, supported by clear UI copy. **No model inference, similarity, or classification.**

## Transition table

| From effective status | REFINE | CONTEST | SUPERSEDE | RETIRE | Notes |
|---|---|---|---|---|---|
| ACTIVE | → ACTIVE (rev+1) | → CONTESTED (rev+1) | → ACTIVE (rev+1; prior derives SUPERSEDED) | → RETIRED (rev+1, terminal) | all require exact current revision + expected revision + rationale + idempotency |
| CONTESTED | → ACTIVE (rev+1) | → CONTESTED (rev+1) | → ACTIVE (rev+1) | → RETIRED (rev+1, terminal) | a contested thread may be refined, re-contested, superseded, or retired |
| SUPERSEDED (historical) | — | — | — | — | historical status of non-effective revisions; not directly actionable |
| RETIRED | ✗ conflict | ✗ conflict | ✗ conflict | ✗ conflict | terminal; a new related claim is a separate CREATE |

Effective lifecycle status = the `lifecycle_action` of the latest (effective) revision, mapped: CREATE/REFINE/SUPERSEDE →
ACTIVE, CONTEST → CONTESTED, RETIRE → RETIRED. Non-effective revisions that a later SUPERSEDE replaced derive the
historical status SUPERSEDED.

## Architecture boundary

Included now: single-thread lifecycle (four verbs) as append-only revisions; deterministic effective-state; no-fork
concurrency; idempotency; complete history; export/delete. **Explicitly excluded / deferred:** any relationship table,
`CONTRADICTS`/`SUPPORTS`/`QUALIFIES`/`DEPENDS_ON` edge, contradiction detection, semantic similarity, learning clustering,
knowledge graph, REACTIVATE, Strategic Learning Promotion into BU/FSC, execution/tasks, generic Strategic Memory, and
legacy `memory.*` reconciliation.

## Model role (this slice)

**None.** Every lifecycle transition is founder-authored and deterministically validated. No LLM path exists.

## Acceptance criteria (summary)

Explicit founder action for every transition; each creates one immutable revision; existing CREATE records migrate without
content/lineage change; stable logical identity; separate claims stay separate; CONTEST works without a second learning or
relationship object; contiguous revisions; stale writes fail; forks impossible; complete visible history; the four verbs
work; RETIRE terminal; lifecycle/epistemic states separate; uncertainty may increase; evidence classes stable; scope +
causal guards active; counterevidence/unknowns cannot silently vanish; BU/FSC/review/plan/commitment/decision unchanged;
no recommendation/execution/task/memory write; no relationship table/row; export full history; deletion zero orphans;
genuine Playwright acceptance passes; full backend suite green from repo root; frozen engine byte-identical.
