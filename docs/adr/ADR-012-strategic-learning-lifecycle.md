# ADR-012 — Strategic Learning Lifecycle (REFINE / CONTEST / SUPERSEDE / RETIRE)

**Status:** Proposed — architecture design review, **revised after a falsification challenge** (see "Challenge" below).
The first-round recommendation (Model C) was **falsified and revised** to a **dual-layer model with the relationship layer
deferred**. **Documentation only**; no runtime behavior, schema, API, migration, test, or frozen-engine change.
Implementation is explicitly **out of scope** (deferred debt **SLR-3**).
**Relationship to prior records:** Governed by [ADR-011](ADR-011-knowledge-architecture.md) (Knowledge Architecture) and
the Business Brain Constitution. Extends the Strategic Learning Record — the **initial CREATE-only** slice
([governance contract](../governance/strategic-learning-record-contract.md),
[architecture](../architecture/strategic-learning-record-slice.md),
[remediation](../architecture/strategic-learning-record-remediation.md)) — from `6c7616a`. Sits alongside the
append-only revision discipline already used by Strategic Decision / Commitment / Plan / Plan-Review records.

---

## Context

The Strategic Learning Record today is **CREATE-only**. A learning is an immutable row keyed by
`(founder_id, logical_learning_id, revision)` — with `logical_learning_id = id` and `revision = 1` for every record —
protected by a BEFORE-UPDATE trigger (`slr_no_update`). A "correction" is currently just *another independent learning*
(Law 10). There is no governed way to say **this new understanding continues, sharpens, disputes, replaces, or closes an
earlier one.** That is the gap SLR-3 will eventually fill.

Before writing any of that code, one architectural question must be settled: **are REFINE, CONTEST, SUPERSEDE, and RETIRE
all revisions of a single logical learning, or do some of them describe relationships between *distinct* learning
objects?** The answer determines the table shape, the export format, the promotion semantics (Law 14), and the browser
mental model. Choosing wrong is expensive to unwind because learnings are append-only and founder-visible.

This ADR is a design review only. It compares three candidate architectures and recommends exactly one.

### The four operations, read epistemically

The operations are not symmetric. Each encodes a different move in how a founder's understanding changes:

| Operation | What the founder is doing | Same belief or a new one? | Does the earlier learning stay "live"? |
|---|---|---|---|
| **REFINE** | Sharpen / qualify the *same* understanding (tighten a boundary condition, adjust confidence, add a caveat) | **Same** belief, evolved | No — the refined version is the current reading of one belief |
| **SUPERSEDE** | Replace the understanding with an updated one on the *same* topic | **Same** topic, new reading takes its place | No — the prior reading is history; the new one is current |
| **RETIRE** | Close the learning — no longer load-bearing (not necessarily *wrong*, just no longer in play) | **Same** belief, terminal status change | No — the belief is closed but preserved as history |
| **CONTEST** | Record that a belief is now *in tension* with evidence or with another belief — **without** resolving it | Often a **distinct** position that coexists with the original | **Yes** — both the contested belief and the contesting position remain live, unresolved |

**The crux (first-round framing — refined by the Challenge below).** REFINE, SUPERSEDE and RETIRE are *linear evolution of
one belief* — the natural shape is an append-only revision chain, exactly like Decision/Commitment/Plan. The first round
read **CONTEST as "different in kind" — a relationship between coexisting objects.** The Challenge below shows this is only
*half* right: "contest" actually names **two** concepts — a *single-thread usability downgrade* (a revision) and a
*between-thread contradiction* (a relationship). Collapsing a genuine between-thread contradiction into one belief's chain
would falsely assert `latest wins` (an affront to Law 9); but so would forcing a founder's *own* self-downgrade to
manufacture a second object. The revised decision separates the two.

### Forces (the governing constraints)

- **Constitution / ADR-011 laws** — append-only (Law 10), historically linked (Law 11), preserve uncertainty and never
  inflate to truth (Law 9), never auto-mutate BU/FSC (Laws 12–13, promotion is a future gate — Law 14), founder
  sovereignty and clarity over product hold (Law 16).
- **Consistency with the existing chain** — Decision/Commitment/Plan already model same-topic evolution as
  `(logical_id, revision)` with an effective-state = latest live revision. New capabilities should not invent a novel
  discipline without cause.
- **Founder comprehensibility** — the founder must be able to answer "what do I currently understand about X, and what's
  in tension?" by *looking*, not by traversing a graph in their head.
- **The record is append-only and already shipped** — any model must be reachable by a *forward* migration that preserves
  existing rows and never edits V076/V077.

---

## Candidate architectures

### Model A — Immutable revision model (one logical learning; all four ops are revisions)

Every operation appends a new immutable revision of the **same** `logical_learning_id`. A `lifecycle` marker
(`CREATE | REFINE | CONTEST | SUPERSEDE | RETIRE`) and a `supersedes_revision` pointer record intent. Effective state =
the latest revision (or latest non-`RETIRE` revision). This is the exact shape of Strategic Decision/Commitment/Plan.

- **Shape:** one table (the existing one), create-only relaxed to "append revisions"; effective-state derived by
  ordering. CONTEST becomes "revision N of learning A, lifecycle = CONTEST".

### Model B — Linked-learning model (every learning is a distinct object; all four ops are typed edges)

Every learning stays its own logical object (`revision` always 1). Operations are **relationships** recorded in an
append-only edge table: `REFINES(A→B)`, `SUPERSEDES(A→B)`, `RETIRES(A)`, `CONTESTS(A↔B)`. "Current understanding" is
derived by traversing the graph (drop superseded/retired nodes; surface unresolved contests). No revision chains at all.

- **Shape:** node table (learnings) + edge table (typed, append-only). A pure knowledge graph.

### Model C — Hybrid model (evolution = revisions; contest = relationship)

Same-topic **evolution** — REFINE, SUPERSEDE, RETIRE — are append-only **revisions** of one `logical_learning_id`
(revision chain + `lifecycle` marker; effective-state = latest live revision), identical to the existing chain. **CONTEST**
is an append-only **typed relationship** in a separate `strategic_learning_relationship` table between two *distinct*
logical learnings — because a contest is a coexisting tension, not a replacement. (A founder lowering their own confidence
without a second position is still expressible as a REFINE/SUPERSEDE revision that sets `confidence = CONTESTED`; the
relationship table is reserved for genuine *between-learning* tension.)

- **Shape:** the existing revision table (evolution) **plus** one small append-only relationship table (contest / future
  cross-links), each with its own no-update trigger.

---

## Evaluation

Scored **Strong / Adequate / Weak** per dimension; narrative follows the table.

| Dimension | A — Immutable revision | B — Linked-learning | C — Hybrid |
|---|---|---|---|
| Constitutional compatibility | Adequate | Weak | **Strong** |
| Append-only guarantees | **Strong** | Adequate | **Strong** |
| Epistemic correctness | Weak | Adequate | **Strong** |
| Export complexity | **Strong** (lowest) | Weak (highest) | Adequate |
| Future BU/FSC promotion | **Strong** | Weak | **Strong** |
| Browser UX | Adequate | Weak | **Strong** |
| Migration complexity | **Strong** (lowest) | Weak | Adequate |
| Long-term scalability | **Strong** | Weak | **Strong** |

### 1. Constitutional compatibility
- **A — Adequate.** Honors append-only (Law 10) and lineage (Law 11) and matches the existing chain discipline. **But**
  forcing CONTEST into a single "latest wins" chain manufactures a resolution the founder didn't make — friction with
  Law 9 (*preserve uncertainty*) and the anti-certainty ethos. It also merges two beliefs with *different review
  provenance* into one chain, straining Law 11.
- **B — Weak.** A pure graph can *represent* anything, but modeling ordinary evolution as edges dissolves "one belief that
  I sharpened," pushing comprehension cost onto the founder — tension with Law 16 (*clarity, not the product's hold*).
- **C — Strong.** Matches the constitution's grain: linear evolution as revisions (Laws 10/11, consistent with the chain);
  genuine tension as an explicit relationship that keeps **both** positions live and unresolved (Law 9). No false
  resolution, no over-atomization.

### 2. Append-only guarantees
- **A — Strong.** Identical trigger pattern; every revision is an immutable insert; RETIRE is a new revision, not an edit.
- **B — Adequate.** Edges are append-only, but "current state" derivation must be careful never to require mutating a
  node (e.g., no `is_current` flag that gets flipped — that was the M2 `belief_chains` mistake, KA-2).
- **C — Strong.** Two append-only surfaces, each with a BEFORE-UPDATE trigger; revisions append, relationships append,
  RETIRE is a revision. Nothing is ever updated in place.

### 3. Epistemic correctness
- **A — Weak.** Correct for REFINE/SUPERSEDE/RETIRE (linear). **Wrong for CONTEST:** a revision chain implies the later
  revision *is the belief now*, erasing the coexistence of two contesting positions and mis-attributing the contesting
  insight's own lineage. This is the single most important axis of the design question, and A fails it.
- **B — Adequate.** Native and correct for CONTEST. **But over-atomizes** REFINE: "the same learning, sharpened" fragments
  into distinct nodes joined by edges, losing the intuitive continuity of one evolving understanding.
- **C — Strong.** Evolution is a chain (continuity preserved); contest is a relationship (coexistence preserved). Each
  operation is modeled as the thing it actually is.

### 4. Export complexity
- **A — Strong (lowest).** One table; group by `logical_learning_id`, order by `revision`. A single flat, founder-
  inspectable list.
- **B — Weak (highest).** Must export nodes **and** a typed edge set; a faithful, self-describing export needs traversal
  semantics. A graph dump is harder for a founder to read and for account-export to guarantee complete.
- **C — Adequate.** One revision table (grouped chains) **plus** one relationship table (flat typed edges). More than A,
  far less than B; both halves are flat lists a founder can read directly.

### 5. Future BU/FSC promotion (Law 14)
- **A — Strong.** The promotion candidate is unambiguous: the effective (latest live) revision per logical learning.
- **B — Weak.** "Which learning is current?" is a graph question; unresolved contests leave several live nodes with no
  single promotable answer, and superseded/retired resolution is traversal-dependent.
- **C — Strong.** Effective revision per learning is the candidate, **and** an unresolved contest relationship becomes an
  explicit *"do not silently promote — this is contested"* flag. That is exactly the honesty Laws 9/14 demand: the model
  surfaces the tension to the founder rather than auto-resolving it.

### 6. Browser UX
- **A — Adequate.** Revision history is familiar (like plans). But a contest rendered as "revision 3" misleads the founder
  into reading an update where a *challenge* occurred.
- **B — Weak.** Founders must reason about a typed graph; refine/supersede-as-edges is unintuitive for the common case.
- **C — Strong.** Two clear, separate mental models, each matched to its operation: a **revision timeline** for how one
  understanding evolved, and a distinct **"in tension with / contested by"** surface for coexisting positions.

### 7. Migration complexity (from V076 + V077, forward-only)
- **A — Strong (lowest).** The columns already exist (`logical_learning_id`, `revision`). Add a `lifecycle` marker + a
  `supersedes_revision` pointer; relax the create-only assumption to allow appended revisions. One forward migration.
- **B — Weak.** Requires a new relationship table **and** re-conceptualizing the record away from the revision semantics
  already provisioned — the most disruptive path for the least-used capability shape.
- **C — Adequate.** Reuse the existing `logical_learning_id` + `revision` columns for evolution (add `lifecycle` +
  `supersedes_revision`), **plus** add one new append-only `strategic_learning_relationship` table for contest. Comparable
  to A plus a single small table; V076/V077 untouched.

### 8. Long-term scalability
- **A — Strong.** Bounded per-topic chains; trivial indexes.
- **B — Weak.** Graphs grow and "current understanding" queries get expensive; comprehensibility degrades as edges
  accumulate.
- **C — Strong.** Revision chains stay bounded per topic; contests are *rare* and *sparse*, so the relationship table stays
  small and queries stay simple (chain scan + occasional edge lookup).

---

## First-round decision (CHALLENGED — superseded by the revised decision below)

The first-round review adopted **Model C — the Hybrid model**: REFINE/SUPERSEDE/RETIRE as revisions of one
`logical_learning_id`; **CONTEST as an append-only typed relationship between two distinct logical learnings**. A founder
lowering confidence on their own belief without a second position was a REFINE/SUPERSEDE revision; the relationship table
was reserved for between-learning tension; an unresolved contest relationship guarded promotion.

This is preserved for the record but is **no longer the recommendation** — the falsification pass below shows Model C's
central claim ("CONTEST is *always* a relationship between distinct objects") is false.

### Why the first-round rejected models fail (still valid)

- **Model A (immutable revision) fails on epistemic correctness — the decisive axis.** It forces CONTEST into a linear
  "latest wins" revision chain, collapsing two coexisting, mutually-contesting positions into one current belief. That
  asserts a resolution the founder never made (violating Law 9's *preserve uncertainty*) and erases the contesting
  insight's own review provenance (straining Law 11). Its wins — simplest export, simplest migration — are real but
  secondary; they buy simplicity by misrepresenting the one operation that is genuinely relational.
- **Model B (linked-learning) fails on export complexity, promotion clarity, and founder comprehensibility.** Modeling
  REFINE/SUPERSEDE/RETIRE as graph edges over-atomizes one evolving understanding, turns "what do I currently understand
  about X?" into a graph traversal, yields ambiguous BU/FSC promotion candidates, and produces a graph-dump export that
  erodes founder sovereignty and clarity (Law 16). It is correct about CONTEST but wrong to impose graph semantics on the
  common, linear case.

Model C keeps A's strengths for the linear operations and B's strength for the relational one, at the cost of a single
extra append-only table — a cost justified precisely by the epistemic correctness the other two sacrifice.

---

## Challenge (falsification pass)

Model C's decisive claim is: **"CONTEST is *always* a relationship between distinct learning objects."** Attempting to
falsify it exposes that the first-round analysis **conflated three distinct situations** under the single word "contest":

1. **The founder becomes less able to stand behind the *same* learning** (they downgrade their own thread).
2. **The founder records counterevidence or uncertainty about the *same* learning** (evidence weakens one thread).
3. **A genuinely distinct learning contradicts another** (two independent threads disagree).

Situations 1 and 2 are **single-thread lifecycle** events — they need **no second object and no relationship**. Only
situation 3 involves two threads, and even then coexistence does not *require* a relationship object. Model C forces 1 and
2 to manufacture a second object (or mislabels a self-downgrade as "a relationship"), which is wrong. **The claim is
falsified.** "CONTEST" names two different concepts that must not be one mechanism:

- **A — lifecycle contestation of one thread:** *"This is still the same learning, but I no longer treat its claim as
  straightforwardly usable."* A **revision** (`lifecycle = CONTEST`). Crucially **not** latest-wins-as-truth: the newer
  revision does not declare the older one false; it lowers the thread's current **usability / epistemic status** while
  preserving all history.
- **B — contradiction/tension between independent threads:** *"This other standing claim disagrees with that one."* A
  **relationship** between distinct learnings — a *separate* concept from the lifecycle.

### Required case analysis

**Case 1 — Same claim becomes unsafe to use.** Rev 1: "Price-led messaging increased conversion for this offer." New
evidence: the increase may be seasonality; the founder can no longer treat the causal interpretation as sufficiently
supported. → **CONTEST revision** of the *same* thread. "Seasonality" here is *counterevidence / an alternative-explanation
caveat*, not yet a standalone strategic claim the founder commits to — so it is **not** a new learning and **not** a
relationship. It is stronger than REFINE (the founder no longer stands behind the causal claim, rather than merely
sharpening it). **Historical state:** rev 1 (SUPPORTED causal claim) preserved immutably. **Effective state:** latest
revision = CONTEST, `confidence` drops to CONTESTED (or INSUFFICIENT_INFORMATION), counterevidence attached; the thread
stays *live but downgraded*. One object, no relationship.

**Case 2 — Distinct competing explanation.** A: "Price-led messaging increased conversion." B: "Distribution expansion,
not price-led messaging, best explains the increase." → B is a **CREATE of a new independent learning**: it is a positive,
standalone causal claim the founder could act on (invest in distribution), not merely doubt about A. B is **not** a
revision of A (different claim, different provenance) and **not** counterevidence-within-A (it stands on its own). B
contradicts A, but the two **coexist as independent threads** without any relationship object in this slice. The founder
*may separately* also CONTEST-revise A (downgrade it) if B now persuades them — an independent action on thread A. A
future relation could record "B CONTRADICTS A", but it is **not required** for both to exist honestly.

**Case 3 — Partial counterevidence.** "Founder-led video appears effective for high-trust offers." Later: "Two launches
did not reproduce the result, but the evidence is insufficient to reject the learning." → **Only added counterevidence +
reduced epistemic status on the *same* thread** — a **REFINE** revision (still standing behind it, now weaker: e.g.
SUPPORTED → PROVISIONAL/CONTESTED) with the two failed launches recorded as `counterEvidence`. The founder does not
withdraw the claim, so not SUPERSEDE/RETIRE; the failed launches are not a rival theory, so **not** a new learning and
**not** a relationship. (Had the founder decided they can no longer use it, this becomes a CONTEST revision — same thread
either way.)

**Case 4 — Scope contradiction.** A: "Discount messaging harms premium positioning." B: "Time-bounded discount messaging
improved conversion for an entry product without measurable positioning damage." → These **do not actually contradict**:
A's scope is premium positioning; B's scope is an *entry product*, *time-bounded*. **Scope + boundary conditions reconcile
them.** B is a **CREATE of a new independent learning** with its own `learningScope` (entry product) and
`boundaryConditions` (time-bounded). **No contest, no relationship.** This is precisely what the SLR's existing scope +
boundary fields are for; treating scope-differentiated learnings as "contests" would be a modeling error.

**Case 5 — Founder explicitly withholds resolution.** The founder wants **both** explanations preserved and deliberately
does **not** choose. → Two standing independent claims (as in Case 2), **both CREATE'd**, neither superseded nor retired —
so coexistence and the withheld verdict are *already* representable without a relationship (the absence of supersede/retire
*is* the withheld verdict). To record the withheld tension as an **explicit, first-class, promotion-guarding fact**, an
**inter-learning relationship** (e.g. `CONTRADICTS` / `IN_TENSION_WITH`) is the correct mechanism — but it is an
**enhancement, not a correctness requirement**, and therefore **deferrable**. This is the *only* case with any genuine pull
toward a relationship object, and even here the lifecycle-only model remains correct (just less explicit).

**What the cases prove:** counterevidence and self-downgrade (Cases 1, 3) are **single-thread lifecycle revisions**;
distinct or scope-differentiated claims (Cases 2, 4) are **independent CREATEs that coexist**; only deliberately-withheld
inter-thread tension (Case 5) has any need for a relationship, and that need is **useful-but-deferrable**, never required
for correctness. **No case requires building a relationship table now.**

---

## Refined options

- **Option 1 — Pure revision lifecycle.** REFINE / CONTEST / SUPERSEDE / RETIRE are all revisions within one logical
  learning thread. Independent contradictory learnings coexist as separate CREATEs with **no** explicit relationship — and
  the relationship concept is not named or designed for.
- **Option 2 — First-round hybrid (Model C).** REFINE/SUPERSEDE/RETIRE are revisions; **CONTEST exists *only* as a
  relationship** between independent learnings.
- **Option 3 — Dual-layer model.** REFINE / CONTEST / SUPERSEDE / RETIRE are all **lifecycle actions within a thread**
  (CONTEST = usability downgrade, not latest-wins). **Separately**, an *optional future* relation layer
  (`CONTRADICTS` / `QUALIFIES` / `SUPPORTS` / `DEPENDS_ON`) may connect distinct threads — **explicitly outside** the
  lifecycle implementation, **deferred** unless proven essential.

| Dimension | O1 · Pure revision | O2 · Hybrid (C) | O3 · Dual-layer (deferred relations) |
|---|---|---|---|
| Epistemic correctness | Strong | **Weak** | **Strong** |
| Founder comprehensibility | Strong | Weak | Strong |
| Withheld verdict (Case 5) | Adequate (implicit) | Adequate (over-applied) | **Strong** (named, deferred) |
| Append-only history | Strong | Strong | Strong |
| Effective-state derivation | Strong | Weak | Strong |
| Scope handling (Case 4) | Strong | Weak | Strong |
| Counterevidence handling (Cases 1,3) | Strong | Weak | Strong |
| Export legibility | **Strong** (one table) | Adequate | Strong now / Adequate later |
| UI complexity | Low | Higher | Low now |
| Future BU/FSC promotion | Strong | Adequate | **Strong** (best trajectory) |
| Migration complexity | **Low** | Higher | Low now |
| Risk of accidental knowledge-graph | Low | **High** | Low (explicitly guarded) |
| Distinguish "I no longer stand behind this" vs "another claim disagrees" | Adequate (actions only) | **Weak (conflates)** | **Strong (separates)** |

**Narrative.** O2 (Model C) is falsified on the two decisive rows — *epistemic correctness* and *the ability to
distinguish self-downgrade from inter-thread disagreement* — because it collapses situation 1/2 into "a relationship" and
introduces an inter-learning edge table for a case that doesn't need one, seeding exactly the generic-knowledge-graph risk
ADR-011 forbids. O1 and O3 ship the **same code now** (revisions only; no relationship table), and both are correct. O3 is
the better **architecture record**: it (a) explicitly separates "I no longer stand behind this" (lifecycle CONTEST) from
"another claim disagrees" (a future relation) — the exact distinction the challenge demands; (b) gives Case 5's withheld
verdict a named future home instead of O1's silence, which could let a later implementer either ignore the need or bolt
relationships onto the revision chain; and (c) states the knowledge-graph guard out loud. O1's only edge — marginally
simpler doc — is not worth losing that clarity.

---

## Deterministic decision rule (founder-driven; no similarity / embeddings / model inference)

The founder always chooses the operation; the UI explains each option in plain language. The rule is two founder-answered
questions plus one boundary test. **Nothing is auto-classified.**

**Step 0 — target.** The founder either (a) starts a **new** learning, or (b) explicitly **selects an existing learning
thread** to act on. (Selection is manual — the founder picks the thread; the system never matches by similarity.)

**Step 1 — the standalone-claim test** (decides CREATE vs a revision of the selected thread):
> *"Does your input state a strategic claim that could stand on its own and that you could act on independently — or is it
> a caveat, doubt, counterevidence, or refinement **about** the claim you already recorded?"*
- **Stands on its own → CREATE** a new independent learning (even if it contradicts an existing one — Cases 2, 4). It may
  *optionally* be linked to another thread **later**, once/if the relation layer exists.
- **About the existing claim → a revision** of the selected thread → Step 2.

**Step 2 — the lifecycle verb** (founder picks one, each with UI copy):
- *"I'm sharpening or qualifying it — I still stand behind it, just more precisely."* → **REFINE**
  (Cases 3-if-still-used; adds boundary/counterevidence, may lower confidence).
- *"I no longer treat its claim as straightforwardly usable — doubt or counterevidence has weakened it — but I'm keeping
  the thread."* → **CONTEST** (lifecycle) (Case 1; downgrades usability; **not** "the old one is false").
- *"I'm replacing it with an updated understanding on the same topic."* → **SUPERSEDE**.
- *"It's no longer load-bearing — I'm closing it (not necessarily wrong)."* → **RETIRE**.

**Step 3 — optional relation (future layer only).** After a CREATE, the founder **may** explicitly declare a typed relation
to another thread (`CONTRADICTS` / `QUALIFIES` / `SUPPORTS` / `DEPENDS_ON`) — only if that layer is built (deferred),
always founder-declared, never inferred.

This rule is deterministic because every branch is a founder answer, not a computed judgment. It also encodes the two
constraints the challenge requires: counterevidence is a revision **unless** it carries a standalone claim (then CREATE);
and CONTEST never means latest-wins-truth.

---

## Architecture boundary — is a learning-relationship table needed now?

**Verdict: useful-but-deferrable, and premature (mildly harmful) to build now.**

- **Necessary now?** **No.** All five cases are satisfied by lifecycle revisions + independent CREATEs. Even Case 5's
  withheld verdict is representable by two coexisting learnings that neither supersede nor retire each other.
- **Useful but deferrable?** **Yes** — for making Case 5's tension an explicit, first-class, promotion-guarding fact, and
  for richer future BU/FSC promotion. This belongs in its **own** governance + architecture gate, only once a proven
  founder need exists.
- **Harmful now?** Building a typed inter-learning edge table **prematurely** risks it drifting into a **generic knowledge
  graph / ontology / inference substrate** — precisely what ADR-011 forbids (no generic Strategic Memory; KA-2). The
  discipline: if the relation layer is ever built, it must remain a **small, founder-declared, append-only** set of
  explicit typed links — never an inference layer, never model-populated, never a similarity index.

---

## Revised decision

**Adopt Option 3 — the dual-layer model, with the relationship layer deferred.**

- The **Strategic Learning Lifecycle slice** implements **REFINE / CONTEST / SUPERSEDE / RETIRE as append-only revisions of
  one `logical_learning_id`** (add a `lifecycle` marker + `supersedes_revision`; effective-state = latest **live**
  revision; RETIRE closes the thread; **CONTEST lowers the thread's usability/epistemic status without asserting the older
  revision is false**). Consistent with Decision/Commitment/Plan.
- **Distinct competing or scope-differentiated claims are independent CREATEs** (the existing mechanism) that **coexist**;
  scope + boundary conditions reconcile apparent contradictions (Case 4). **No relationship table ships in this slice.**
- The founder chooses every operation via the deterministic rule above; **no similarity, embeddings, or model
  classification.**
- A **future, separately-gated relation layer** (`CONTRADICTS` / `QUALIFIES` / `SUPPORTS` / `DEPENDS_ON`) may later connect
  distinct threads and make Case 5's withheld tension explicit — **deferred**, bounded, founder-declared, and guarded
  against becoming a generic knowledge graph.

**Does CONTEST exist as a lifecycle action, a relation type, or both?** **Both — but they are different concepts and only
the lifecycle action ships now.** *Lifecycle* CONTEST = "I no longer treat my own learning as straightforwardly usable"
(revision, this slice). *Relation* CONTRADICTS/tension = "this independent claim disagrees with that one" (future layer,
deferred). Model C's error was fusing them into one relationship-only mechanism.

> **CONTEST as a lifecycle action is not the same concept as a future CONTESTS relationship between two independent
> learning threads.** The former is a single-thread usability downgrade the founder applies to their *own* learning; the
> latter is a founder-declared link *between two distinct threads*, deferred to a separate future gate. This slice
> implements only the lifecycle action.

**Next implementation slice (SLR-3, still gated — not built here):** the four lifecycle verbs as append-only revisions;
CONTEST as usability-downgrade; effective-state = latest live revision; independent CREATE for standalone claims; the
founder-driven decision rule surfaced in the UI. **No** relationship table, **no** cross-thread resolution, **no** model
classification.

**Explicitly deferred (own future gate, only if proven essential):** the relation layer
(`CONTRADICTS`/`QUALIFIES`/`SUPPORTS`/`DEPENDS_ON`); explicit withheld-tension records (Case 5); relationship-based
promotion guards. Also still deferred: BU/FSC promotion itself (Law 14), model-suggested learnings, execution/task/memory.

---

## Consequences

- **Positive:** each of the three conflated situations is modeled as what it is; single-thread evolution stays a familiar
  append-only revision timeline (one table, one trigger, legible export); distinct claims simply coexist; CONTEST is honest
  (usability downgrade, not truth-replacement); the knowledge-graph risk is quarantined behind a future gate; forward-
  migratable with V076/V077 untouched; scales.
- **Negative / accepted cost:** the lifecycle slice keeps **one** persistence surface (the revision chain), so the accepted
  cost is only the effective-state logic accounting for `lifecycle = CONTEST` (usability-downgraded) and `RETIRE` (closed).
  The trade is that deliberately-withheld **inter-thread** tension (Case 5) is representable only *implicitly* (two
  coexisting learnings, neither superseded/retired) until the deferred relation layer is built — an accepted, documented
  limitation, not a correctness gap.
- **Follow-on design questions deferred to the SLR-3 implementation gate (not decided here):** the exact `lifecycle` enum
  and whether RETIRE is reversible; the precise wording of the founder-facing verb copy; the promotion-eligibility
  predicate (which lifecycle statuses block promotion); and — in its **own** later gate — whether/how the relation layer
  (`CONTRADICTS`/`QUALIFIES`/`SUPPORTS`/`DEPENDS_ON`) is introduced. This ADR fixes only the **shape**: the four lifecycle
  verbs are **thread revisions**; distinct claims **coexist as independent CREATEs**; the relation layer is a **separate,
  deferred concern**.

## Non-goals / scope guard

This ADR changes **no** code, schema, migration, API, test, or frozen-engine artifact. It does not implement REFINE /
CONTEST / SUPERSEDE / RETIRE, does not create a learning-relationship table, does not add task management, execution,
progress/productivity tracking, generic Strategic Memory, or automatic BU/FSC mutation, and does not reconcile the legacy
`memory.*` / dead `founder.belief_chains` (KA-2). Implementation remains gated behind a future governance + architecture
slice (SLR-3), which must be committed **before** any code, per the ADR-011 admission-gate discipline. If the deferred
relation layer is ever built, it must stay a small, founder-declared, append-only set of explicit typed links — **never**
an inference layer, model-populated store, similarity index, or generic knowledge graph.

---

## Final verdict

**ADR-012 revised to dual-layer model, with relationships deferred.**

CONTEST exists as **both** a *lifecycle action* (ships in SLR-3: "I no longer treat my own learning as straightforwardly
usable" — a revision that downgrades usability, not latest-wins-truth) and a future *relation type* (deferred:
`CONTRADICTS`/tension between distinct threads). Only the lifecycle action is in the next slice. Model C is rejected because
it fused these two distinct concepts into a relationship-only mechanism, mislabelling single-thread self-downgrade
(Cases 1, 3) as an inter-object relationship and seeding a premature knowledge-graph substrate.
