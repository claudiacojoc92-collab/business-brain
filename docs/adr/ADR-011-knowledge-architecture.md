# ADR-011 — Knowledge Architecture

**Status:** Accepted — governance gate. Documentation only; no runtime behavior, schema, API, or frozen-engine change.
**Relationship to prior records:** Sits within ADR-010 (Two-Layer Architecture — Truth Engine vs Product Primitives).
Extends the honesty discipline of ADR-007 across every epistemic object. Governs how ADR-008 (Roadmap) capabilities C
(Strategic Counsel) and D (Assistive Execution) may introduce memory, decisions, plans, and execution. Binds the two
governance contracts: [`founder-conversation-consumption-contract.md`](../governance/founder-conversation-consumption-contract.md)
and [`founder-strategic-context-contract.md`](../governance/founder-strategic-context-contract.md). The concrete
implementation inventory is [`knowledge-architecture-current-state-map.md`](../architecture/knowledge-architecture-current-state-map.md).

---

## Context

Business Brain now holds durable knowledge of several distinct kinds: ingested evidence, a versioned Business
Understanding, a known-entity Public Positioning Context, a founder-declared Strategic Context, durable strategy
sessions with immutable recommendations, and deterministic context conflicts. Future arcs (ADR-008 C/D) will want to add
Strategic Memory, decisions, commitments, plans, and execution.

Without an explicit Knowledge Architecture, future slices could **blur categories** — treat a recommendation as a
decision, a preference as evidence, persistence as memory, an accepted inference as objective truth, an unknown as a
zero. Each blur is a small erosion of the truth model. This ADR fixes the canonical taxonomy, the allowed dependency
directions, the lifecycle verbs, the provenance rules, the historical-vs-effective distinction, and a hard **admission
gate** every future Strategic Memory item must pass — so the blur becomes impossible by governance, not by hope.

This ADR **documents existing behavior accurately**; it does not redesign anything already built.

---

## Decision

### §1 — Canonical taxonomy

Fourteen categories. Categories 1–9 are **implemented**; 10–14 are **conceptual only** (defined here so future work cannot
smuggle them in without a superseding gate). Each category names what it is and, critically, **what it is NOT**.

#### 1. Evidence
- **Definition:** A durable, source-attributed fragment of what was observed, declared, or inferred about the founder's
  world. Kinds: `observed` (from a connected source), `declared` (the founder told us), `inferred` (derived, marked).
- **Purpose:** The grounding substrate. Everything downstream must trace to evidence or to an explicit founder declaration.
- **Controller:** System for `observed`/`inferred`; founder for `declared`.
- **Source:** Connectors (website, upload, calendar, Google) and founder input.
- **Scope:** Founder-scoped.
- **Temporal:** Carries `occurredAt` + `capturedAt`; retained.
- **Durability:** Persisted (`evidence.fragments`).
- **Provenance:** `source`, `platform`, `sourceUrl`, `visibility`, `derivedFrom`.
- **Lifecycle:** observe / declare / infer → retained.
- **What it is NOT:** not interpretation, not a conclusion, not market truth, not memory.

#### 2. Observation
- **Definition:** What a source *says* — a self-claim of a website, an extracted statement — held at face value, not as truth.
- **Purpose:** Separate "the site says X" from "X is true".
- **Controller:** System (extraction); the founder can judge accuracy.
- **Source:** Evidence, via model extraction.
- **Scope:** Founder-scoped.
- **Temporal:** Tied to the retrieval/run that produced it.
- **Durability:** Persisted — Business Understanding `OBSERVED` conclusions; Public Positioning `market_finding` rows with
  `observed_text` (and `inference_text` null).
- **Provenance:** Retrieval adapter + extraction version + source URL.
- **Lifecycle:** observe → confirm/partly/correct/reject (founder response).
- **What it is NOT:** not market truth, not inference, not proof of demand.

#### 3. Inference
- **Definition:** A hedged reading across observations — an interpretation, never asserted as fact.
- **Purpose:** Let the system reason without over-claiming.
- **Controller:** Model produces it; founder judges it.
- **Source:** Observations + evidence.
- **Scope:** Founder-scoped.
- **Temporal:** Tied to its run.
- **Durability:** Persisted — BU `SYNTHESIZED_FROM_OBSERVED` / `HYPOTHESIS` / `NEEDS_MORE_EVIDENCE` conclusions; market
  `inference_text` findings (epistemic status never `OBSERVED`).
- **Provenance:** Model + prompt version; grounded on observation ids.
- **Lifecycle:** infer → confirm/correct/reject.
- **What it is NOT:** not an observation, not a fact, not market truth.

#### 4. Business Understanding
- **Definition:** A versioned, founder-legible synthesis of the founder's own business from its own material.
- **Purpose:** "Here is what I understand about your business," in plain terms, epistemically banded.
- **Controller:** Model synthesizes (Layer-2, ADR-010); the **founder confirms / partly-confirms / corrects / rejects**.
- **Source:** The founder's own evidence (website, uploads, declarations).
- **Scope:** Founder-scoped; whole-business.
- **Temporal:** Append-only versions; each version immutable.
- **Durability:** Persisted (`business.understanding`, generation runs `business.understanding_run`, founder responses
  `business.conclusion_response`). The **effective** response per conclusion is *recomputed* (latest non-superseded).
- **Provenance:** `model_version`, `source_fragment_ids`; conclusions cite evidence refs.
- **Lifecycle:** propose (synthesis run) → confirm/partly/correct/reject → supersede (new version).
- **What it is NOT:** not the founder's identity, not market truth, not a decision, not memory.

#### 5. Public Positioning Context
- **Definition:** Known-entity, source-backed evidence of how *named* companies present themselves publicly — observation
  and hedged inference kept separate.
- **Purpose:** Ground positioning reasoning in what competitors/alternatives/references *say*, never in market truth.
- **Controller:** Founder adds entities + judges relevance/accuracy; system reads public sites (robots-respecting).
- **Source:** Founder-named entities + their public sites.
- **Scope:** Founder-scoped; per entity.
- **Temporal:** Reviews are durable; a website change makes prior findings historical until a fresh review.
- **Durability:** Persisted (`market_entity`, `market_finding`, `market_review`, `market_finding_response`). The **effective**
  positioning context (`effectiveMarketContext`) is *recomputed* (confirmed entity + latest READY review +
  website-change validity + accuracy≠no + relevance).
- **Provenance:** Retrieval adapter, extraction/model/prompt versions, review id, source URL.
- **Lifecycle:** add entity → review (durable worker) → observe/infer → confirm relevance/accuracy → supersede on re-review.
- **What it is NOT:** not market intelligence, not market truth, not a claim the market believes anything.

#### 6. Founder Strategic Context
- **Definition:** The explicit, inspectable, temporal, revisable *conditions* under which the founder's strategy must work
  — five kinds: GOAL, CONSTRAINT, RESOURCE, STRATEGIC_PREFERENCE, DECISION_HORIZON.
- **Purpose:** Personalize the strategist to the founder's real goals/resources/constraints without inventing them.
- **Controller:** **Founder only** — declared/confirmed/imported-accepted. The model never writes here.
- **Source:** Explicit founder input.
- **Scope:** Founder-scoped; scoped to a strategy surface (GLOBAL / a subtype).
- **Temporal:** `effectiveFrom` / `effectiveUntil` / `reviewAt`; future/expired handled by the resolver.
- **Durability:** Persisted, **strictly append-only** (`founder_strategic_context_item`, V067+V068): immutable versions +
  a BEFORE-UPDATE trigger; effective/superseded/retired **derived** from `MAX(version)+lifecycle`. Effective context is
  *recomputed* by the resolver.
- **Provenance:** `source`, `logicalItemId`, `version`, `scope`, effective period.
- **Lifecycle:** create → revise (append) → retire (append terminal) → expire (temporal) → review-due.
- **What it is NOT:** not identity, not personality, not psychology, not memory, not a decision.

#### 7. Conflict
- **Definition:** A deterministically-detected tension between explicit structured items (or a strategist's bounded option
  set) — a trade-off to *expose*, never inferred.
- **Purpose:** Make incompatibilities visible without manipulating the founder.
- **Controller:** System (deterministic rules); founder resolves by revising context.
- **Source:** Effective Founder Strategic Context (+ the recommendation's bounded option set for NON_NEGOTIABLE_OPTION).
- **Scope:** Founder-scoped; per session/assembly.
- **Temporal:** Recomputed at assembly (structural rules 1/2/4/5); the NON_NEGOTIABLE_OPTION rule is evaluated
  post-recommendation and **persisted** on the session.
- **Durability:** Structural conflicts are *recomputed* (passed to the model, not stored). The session
  NON_NEGOTIABLE_OPTION conflict is *persisted* (`strategic_session.context_conflicts`).
- **Provenance:** `itemIds` resolving to immutable context items (validated for NON_NEGOTIABLE_OPTION).
- **Lifecycle:** detect → surface → (founder) revise/acknowledge. No resolution workflow this slice.
- **What it is NOT:** not a failure, not a decision, not invented, never LLM-imagined.

#### 8. Unknown
- **Definition:** An explicit, preserved gap — a thing not yet known, never silently filled.
- **Purpose:** Keep "unknown ≠ zero" true throughout.
- **Controller:** System surfaces; founder closes by adding evidence/context.
- **Source:** Missing critical areas, `NEEDS_MORE_EVIDENCE` conclusions, a recommendation's named unknowns, the
  INSUFFICIENT outcome.
- **Scope:** Founder-scoped; per assembly/recommendation.
- **Temporal:** Recomputed.
- **Durability:** Recomputed / surfaced; unknowns inside an immutable recommendation are persisted with it.
- **Provenance:** Tied to the assembled context.
- **Lifecycle:** surface → close (add evidence/context).
- **What it is NOT:** not zero, not a defect, not a guessable value.

#### 9. Strategic Recommendation
- **Definition:** The strategist's advisory answer to one bounded `PRIORITY_DECISION` — grounded, epistemically tagged,
  compositional confidence — or an honest INSUFFICIENT result. Immutable once published.
- **Purpose:** Give the founder a grounded priority call they can accept, qualify, or reject.
- **Controller:** Model produces it (normalized, deterministic safety net); the founder responds append-only.
- **Source:** The assembled StrategicContext (BU + positioning + founder context + conflicts + unknowns + the question).
- **Scope:** Founder-scoped; per session.
- **Temporal:** Immutable; a prior successful session is preserved on later failure.
- **Durability:** Persisted (`business.strategic_session.recommendation`, or `insufficient_reason`); founder responses
  append-only (`business.strategic_response`).
- **Provenance:** `modelId` / `promptVersion` / `schemaVersion`; references echo context ids.
- **Lifecycle:** propose → founder ACCEPT/REJECT/QUALIFY/NEEDS_MORE_EVIDENCE/NOT_RELEVANT_NOW (append-only, supersede).
- **What it is NOT:** not a decision, not a commitment, not execution, not truth, not memory. **ACCEPT does not execute,
  does not write context, does not write memory, does not become objective truth.**

#### 10. Strategic Decision — *being implemented by the Strategic Decision Record slice*
- **Definition:** A founder's *chosen* course of action among understood alternatives, distinct from the recommendation
  that informed it, with decision-time evidence/recommendation/context/uncertainty/trade-offs preserved append-only.
- **Controller:** Founder only, by an explicit, dedicated decision action (never auto-derived from ACCEPT).
- **What it is NOT:** not a recommendation; not produced by the model; not a side effect of accepting a recommendation;
  not a Strategic Commitment (Law 9); not generic memory.
- **Governance + architecture:** [`strategic-decision-record-contract.md`](../governance/strategic-decision-record-contract.md)
  + [`strategic-decision-record-slice.md`](../architecture/strategic-decision-record-slice.md); schema `strategic-decision-1`,
  table `business.strategic_decision_record` (V072), append-only.

#### 11. Strategic Commitment — *being implemented by the Strategic Commitment Record slice*
- **Definition:** A durable, append-only declaration that a specific Strategic Decision will govern the founder's
  strategic conduct for a **bounded** scope and period, subject to visible review, exit, and reconsideration conditions.
- **Controller:** Founder only, by an explicit, dedicated action on a decision (never auto-derived from a decision).
- **What it is NOT:** not a decision by itself; not a task, plan, calendar event, or execution record; not a guarantee, a
  promise to Business Brain, a loyalty mechanism, an identity statement, a permanent restriction, or generic memory.
- **Governance + architecture:** [`strategic-commitment-record-contract.md`](../governance/strategic-commitment-record-contract.md)
  + [`strategic-commitment-record-slice.md`](../architecture/strategic-commitment-record-slice.md); schema
  `strategic-commitment-1`, table `business.strategic_commitment_record` (V073), append-only; references an exact decision revision.

#### 12. Plan — *being implemented by the Strategic Plan Record slice*
- **Definition:** A bounded translation of ONE effective Strategic Commitment into intended strategic moves, milestones,
  review conditions, assumptions, and dependencies — append-only, founder-activated.
- **Controller:** Founder only, by an explicit, dedicated activation on an effective ACTIVE commitment (never auto-derived).
- **What it is NOT:** not a recommendation, decision, or commitment; not execution, tasks, a calendar, an autonomous
  workflow, or proof of progress; not evidence; not generic memory. No `IN_PROGRESS`/`COMPLETED` states (execution is future).
- **Governance + architecture:** [`strategic-plan-record-contract.md`](../governance/strategic-plan-record-contract.md)
  + [`strategic-plan-record-slice.md`](../architecture/strategic-plan-record-slice.md); schema `strategic-plan-1`, table
  `business.strategic_plan_record` (V074), append-only; references an exact commitment revision; the model does not draft
  plans this slice.
- **Plan Review (sub-capability):** a founder-explicit, append-only **Strategic Plan Review Record** — an assessment of an
  exact plan revision (observations + assumption/dependency/milestone assessments + context changes + a conclusion + an
  intended disposition) that **never** mutates the plan/commitment/decision and creates no execution/task/score object.
  Governed by [`strategic-plan-review-record-contract.md`](../governance/strategic-plan-review-record-contract.md) +
  [`strategic-plan-review-record-slice.md`](../architecture/strategic-plan-review-record-slice.md); schema
  `strategic-plan-review-1`, table `business.strategic_plan_review_record` (V075), append-only; no model role this slice.
  It is **not** an Execution Record (category 13, still future).

#### 13. Execution Record — *conceptual only (not implemented)*
- **Definition (future):** A durable record of what the founder actually *did*, which becomes new `observed` Evidence and
  re-enters the loop (ADR-008 D: "execution is the sensor").
- **What it is NOT:** not causality; not proof a plan worked; not a decision.

#### 14. Strategic Memory — *conceptual only (not implemented)*
- **Definition (future):** Durable strategic *continuity* across sessions — what the founder is trying to do and under
  what conditions, carried forward deliberately. Must pass the §8 admission gate.
- **What it is NOT:** not persistence (persistence ≠ memory); not context; not an inferred model of the founder's
  identity; not a silent write. Note: the legacy `memory.*` schema (thread/recommendation primitives, M2/ADR-010 era) is
  **not** this — see the current-state map.
- **Strategic Learning (implemented precursor — *not* generic Strategic Memory):** a founder-explicit, append-only
  **Strategic Learning Record** — a durable strategic understanding the founder *explicitly decides to keep* after a
  review, with the full Review→Plan→Commitment→Decision→Recommendation→Evidence lineage. It records "what durably changed
  in my strategic model", separates prior/revised understanding, carries applicability scope (with broad-scope
  acknowledgement) + boundary conditions + counterevidence + unresolved unknowns, preserves uncertainty with a bounded,
  never-truth-inflating vocabulary (`PROVISIONAL`/`SUPPORTED`/`CONTESTED`/`INSUFFICIENT_INFORMATION`) that may increase,
  bounds causal claims, and **never** auto-mutates Business Understanding or Founder Strategic Context (Laws 12–14 —
  promotion into BU/FSC is a separate future gate). This is the **initial CREATE-only** slice (no REFINE/CONTEST/SUPERSEDE/
  RETIRE). Governed by [`strategic-learning-record-contract.md`](../governance/strategic-learning-record-contract.md) +
  [`strategic-learning-record-slice.md`](../architecture/strategic-learning-record-slice.md); schema `strategic-learning-1`,
  table `business.strategic_learning_record` (V076 + V077), append-only; no model role this slice. A founder-directed
  **single-thread lifecycle** (`CREATE → REFINE/CONTEST/SUPERSEDE/RETIRE`, V078) is governed by
  [ADR-012](ADR-012-strategic-learning-lifecycle.md) (dual-layer; inter-thread relationships deferred); CONTEST is a
  single-thread usability downgrade, not an inter-thread relationship. The **only** explicit path a learning influences
  Business Understanding or Founder Strategic Context is the **Promotion Gate** ([ADR-013](ADR-013-strategic-learning-promotion-gate.md),
  V079/V080): a founder promotes an EXACT learning revision via an append-only `PromotionEvent` ledger (effective set
  derived from an explicit sequence/predecessor chain, never the latest revision); promotion is governance, not evidence,
  writes to neither BU nor FSC content, and regenerates nothing. The **only** way the Recommendation Engine *consumes*
  Effective BU/FSC is the **Consumption Gate** ([ADR-014](ADR-014-strategic-learning-consumption-gate.md), V081): a founder
  explicitly creates an immutable `ContextSnapshot` (freezing native + promoted Effective BU/FSC) and generates a
  recommendation from it — reasoning reads the frozen snapshot, never live context; **availability ≠ consumption**;
  nothing is consumed automatically. It is **not** generic Strategic Memory (that still requires the §8 admission + §10 gate).

### §2 — Canonical matrix

| # | Category | Epistemic role | Source | Controller | Durable? | Recomputable? | Append-only? | Founder confirmation? | Affects recommendations? | Exported? | Deleted w/ account? | Implemented? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Evidence | grounding | connectors + founder | system/founder | yes | no | additive | n/a | yes (via 4/5) | yes | yes | ✅ |
| 2 | Observation | source-says | evidence (extraction) | system | yes | partly | via responses | yes | yes | yes | yes | ✅ |
| 3 | Inference | hedged reading | observations | model | yes | partly | via responses | yes | yes | yes | yes | ✅ |
| 4 | Business Understanding | synthesis | founder evidence | model + founder | yes (versions) | effective recomputed | yes | yes | yes | yes | yes | ✅ |
| 5 | Public Positioning Context | public self-claims | founder entities + sites | founder + system | yes | effective recomputed | reviews durable | yes | yes | yes | yes | ✅ |
| 6 | Founder Strategic Context | operating conditions | founder | **founder only** | yes | effective recomputed | **yes (strict)** | inherent (declared) | yes | yes | yes | ✅ |
| 7 | Conflict | deterministic tension | items / option set | system | session rule persisted; structural recomputed | structural yes | n/a | no | yes | via session | yes | ✅ |
| 8 | Unknown | explicit gap | assembly/recommendation | system→founder | with recommendation | yes | n/a | no | yes | via session/BU | yes | ✅ |
| 9 | Strategic Recommendation | advisory | assembled context | model + founder response | yes (immutable) | no | recommendation immutable; responses append-only | response, not the rec | is the output | yes | yes | ✅ |
| 10 | Strategic Decision | chosen course | founder | founder only | (future) | — | (future) | required | — | (future) | (future) | ❌ future |
| 11 | Strategic Commitment | bound decision | founder | founder only | (future) | — | (future) | required | — | (future) | (future) | ❌ future |
| 12 | Plan | intended steps | founder/commitment | founder | (future) | — | (future) | required | — | (future) | (future) | ❌ future |
| 13 | Execution Record | what was done | founder action | founder | (future) | — | (future) | required | via new evidence | (future) | (future) | ❌ future |
| 14 | Strategic Memory | strategic continuity | admitted records | founder-aware | (future) | — | (future) | required | (future) | (future) | (future) | ❌ future |

### §3 — Dependency graph

**Allowed directions (knowledge flows one way):**

```
Evidence → Observation → Inference → Business Understanding
Evidence → Public Positioning Context (observation + inference, kept separate)
Founder declaration → Founder Strategic Context
Business Understanding + Public Positioning Context + Founder Strategic Context + effective Conflicts + Unknowns
    → StrategicContextAssembler → Strategic Recommendation
Strategic Recommendation + explicit founder decision → Strategic Decision            (future)
Strategic Decision + explicit founder commitment → Strategic Commitment              (future)
Strategic Commitment → Plan                                                          (future)
Execution → Execution Record → Evidence (re-enters the loop)                          (future)
```

**Forbidden reverse dependencies (each is a truth-eroding collapse — never allowed):**

- A Recommendation must **not** rewrite Evidence, Observations, Inferences, or Understanding.
- A Recommendation must **not** silently write Founder Strategic Context (or any context).
- A Recommendation must **not** create a Decision (ACCEPT ≠ decide/execute).
- A Decision/Commitment/Plan must **not** strengthen Evidence or promote an Inference to Observation/fact.
- A Preference must **not** become Evidence (it informs, it does not ground).
- A Plan must **not** become proof; Execution must **not** become causality.
- A Conflict must **not** invent missing context; it is detected, never imagined.
- ACCEPT must **not** transform an Inference into objective truth.
- Model output must **not** be treated as grounded Knowledge without resolvable provenance.

### §4 — Lifecycle semantics

| Verb | Applicable categories | Append-only? | Founder action? | Affects effective state? | Affects historical truth? | Implemented? |
|---|---|---|---|---|---|---|
| observe | Evidence, Observation | additive | no | yes | no (records new) | ✅ |
| infer | Inference | additive | no | yes | no | ✅ |
| propose | Understanding (synthesis), Recommendation | new record | no | yes (new version/session) | no | ✅ |
| confirm | Understanding conclusions, Positioning findings | append (response) | **yes** | yes (effective response) | no | ✅ |
| accept | see clarification below | append (response) | **yes** | records a response; **no** context/memory write | **no** | ✅ (BU, FSC*, Rec response) |
| revise | Understanding, Founder Strategic Context | **append new version** | **yes** | yes (new effective) | no (prior immutable) | ✅ |
| supersede | Understanding versions, responses, FSC versions | derived from ordering | via revise | yes | no | ✅ |
| retire | Founder Strategic Context | **append terminal version** | **yes** | yes (no effective) | no | ✅ |
| expire | Founder Strategic Context (temporal), Positioning (website change) | n/a (temporal) | no (founder set the date) | yes (excluded) | no | ✅ |
| reject | Understanding conclusions, Recommendation | append (response) | **yes** | yes (effective response) | no | ✅ |
| challenge | Recommendation (exposes trade-offs/conflicts) | n/a | system-surfaced | informs, does not overwrite | no | ✅ |
| decide | Strategic Decision | (future) | **yes** | (future) | no | ❌ future |
| commit | Strategic Commitment | (future) | **yes** | (future) | no | ❌ future |
| plan | Plan | (future) | **yes** | (future) | no | ❌ future |
| execute | Execution Record | (future) | **yes** | via new evidence | no | ❌ future |
| review | Founder Strategic Context (review-due), future memory | n/a | **yes** | yes | no | ✅ (FSC review-due) |

**ACCEPT — clarified per surface (the meaning differs; none writes memory):**
- **Business Understanding:** a founder `confirmed` response to a conclusion — records that the founder agrees; it does not
  change the conclusion's epistemic status (an accepted inference is still an inference).
- **Founder Strategic Context:** the founder authored the item — its `source` is FOUNDER_DECLARED/CONFIRMED; there is no
  separate "accept" beyond creation/revision. (\*FSC "acceptance" = the founder's explicit write.)
- **Strategic Recommendation (implemented):** an append-only founder response `ACCEPT` — records a decision *candidate*; it
  does **not** execute the recommendation, write context, or write memory, and does not make the recommendation true.
- **Strategic Decision (future):** would be the *only* place ACCEPT could create a durable decision — and only via an
  explicit, dedicated founder decision action, never auto-derived from a recommendation ACCEPT.

### §5 — Historical vs effective state

- **Historical state:** the complete immutable record of every version/response/finding/session — never rewritten.
  Examples: all Understanding versions, all conclusion responses, all Founder-Strategic-Context versions (CREATE/REVISE/
  RETIRE), all market reviews/findings, all strategy sessions + responses.
- **Effective state:** the *current, eligible* view derived deterministically from history at read time — never a stored
  flag. Examples: the latest Understanding + effective (non-superseded) responses; `effectiveMarketContext` (confirmed
  entity + latest READY review + website-change validity + accuracy≠no + relevance); the effective Founder Strategic
  Context (ACTIVE latest version, not future, not expired, in-scope).
- **Recomputed state:** the assembled StrategicContext, `missingCriticalAreas`, `staleItems`, and the structural conflicts
  — computed on demand, **not persisted**.
- **Session state:** the durable strategy session (status, immutable recommendation, snapshot of understanding version +
  context health, persisted NON_NEGOTIABLE_OPTION conflict, append-only responses).
- **Current state:** effective state *as of now*.

Rules: expired / retired / superseded context is **excluded** from effective state but **retained** historically;
a **historical recommendation** keeps references to the versions/ids that were effective when it was produced (its
provenance is a snapshot, not a live pointer); **future** context (effectiveFrom > now) is excluded until it begins.

### §6 — Provenance architecture

Typed references, per category: Evidence (`source`/`platform`/`sourceUrl`/`derivedFrom`); Observation/Inference
(retrieval adapter + extraction/model/prompt version + source URL, on the finding); Business Understanding
(`model_version`, `source_fragment_ids`, conclusion evidence refs); Public Positioning Context (review id + adapter +
model/prompt version + source URL); Founder Strategic Context (`logicalItemId` + `version` + `scope` + `source` +
effective period); Context Conflict (`itemIds` resolving to immutable context items); Recommendation
(`modelId`/`promptVersion`/`schemaVersion` + evidence references that echo context ids, incl.
`FOUNDER_STRATEGIC_CONTEXT` refs with `logicalItemId`/`version`); future Decision/Commitment/Execution
(would reference the recommendation/decision/commitment ids they derive from).

**Hard rules:** the model may reference **only IDs supplied to it in the prompt**. An invented ID must never appear as
grounded provenance. Deterministic validation is enforced today for the **NON_NEGOTIABLE_OPTION** rule (a model-echoed
reference is discarded unless it resolves to an effective non-negotiable). **KA-1 — RESOLVED** (write-time validation at
`d89110c` + a bounded remediation closing two blockers — a durable immutable manifest and whole-outcome degradation — see
`docs/architecture/recommendation-provenance-integrity-remediation.md`) (see
`docs/architecture/recommendation-provenance-integrity-slice.md` and
`docs/governance/recommendation-provenance-integrity-contract.md`): every model-produced reference is now validated at
write time in `provenance.ts` (`buildProvenanceManifest` → `validateRecommendationProvenance`) against a per-session,
founder-scoped **input manifest** built from the exact assembled context. Invalid references are **removed, never
substituted**; when grounding collapses the outcome is downgraded to INSUFFICIENT; the redacted validation summary is
persisted (V070 `provenance_validation`) for export/historical fidelity. The end state is reached: any reference
presented as grounded provenance is validated against supplied ids at write time.

### §7 — Recomputed vs persisted

**Persist only what is historically necessary; recompute the rest.**

| Object | Classification |
|---|---|
| Business Understanding (versions, runs, conclusion responses) | **persisted** (history) |
| Founder Strategic Context (all versions) | **persisted** (append-only history) |
| Public Positioning Context (entities, reviews, findings, responses) | **persisted** (history) |
| Strategy session + immutable recommendation / insufficient reason + responses | **persisted** (history) |
| Session NON_NEGOTIABLE_OPTION conflict (`context_conflicts`) | **persisted** (post-recommendation, part of the contract) |
| Understanding-version snapshot + context-health snapshot on a session | **persisted** (a snapshot for auditability) |
| optionAssessment | **persisted** (inside the immutable recommendation/insufficient JSON) |
| Effective Business Understanding responses | **recomputed** |
| Effective Public Positioning Context (`effectiveMarketContext`) | **recomputed** |
| Effective Founder Strategic Context (resolver) | **recomputed** |
| Assembled StrategicContext | **recomputed** (never persisted) |
| `missingCriticalAreas`, `staleItems` | **recomputed** |
| Structural conflicts (GOAL_GOAL / GOAL_RESOURCE / HORIZON_FEASIBILITY / quantitative GOAL_CONSTRAINT) | **recomputed** (passed to the model, not stored) |
| Recommendation provenance references | **persisted** as a snapshot inside the immutable recommendation |

### §8 — Memory admission gate

**No future Strategic Memory record may exist unless it satisfies ALL of the following.** This gate is a governance
precondition; introducing a memory system requires a superseding capability record that demonstrates each point.

1. **Strategic continuity** — it carries genuine cross-session strategic continuity (not a convenience cache).
2. **Not representable by another category** — it cannot be expressed as Evidence, Understanding, Positioning Context,
   Founder Strategic Context, a Recommendation, or a (future) Decision/Commitment.
3. **Founder aware** — the founder knows it exists.
4. **Inspectable** — the founder can see it, its category, and its wording.
5. **Revisable** — append-only revision; history preserved.
6. **Provenance known** — every element resolves to a stored record; no invented ids.
7. **Explicit scope** — it declares what it applies to.
8. **Explicit validity** — it declares its temporal validity (effective/expiry/review).
9. **No inferred identity** — it never encodes a psychological or identity model of the founder.
10. **Passes the Constitution** — including the final test:

> **"Does this serve the founder's clarity and sovereignty, or the product's hold?"**

If any answer is no, it must not become Strategic Memory.

### §9 — Anti-collapse rules (canonical, non-negotiable)

- **Context ≠ Memory.** Founder Strategic Context is current operating conditions, not durable strategic continuity.
- **Persistence ≠ Memory.** Storing a row is not remembering a strategy.
- **Recommendation ≠ Decision.** Advice is not a chosen course.
- **Decision ≠ Commitment.** Choosing is not binding.
- **Commitment ≠ Plan.** Binding is not a sequence of steps.
- **Plan ≠ Execution.** Intending steps is not doing them.
- **Execution ≠ Evidence** *(directly)* — execution produces new `observed` evidence; it is not itself proof of outcome.
- **Preference ≠ Evidence.** A preference influences; it does not ground.
- **Constraint ≠ Identity.** A condition is not a trait.
- **Conflict ≠ Failure.** A visible trade-off is healthy, not an error.
- **Unknown ≠ Zero.** Missing is not none.
- **Accepted ≠ True.** An accepted inference remains an inference.
- **Current State ≠ Historical State.** Effective is derived; history is immutable.
- **Model Output ≠ Grounded Knowledge.** Ungrounded model text is a hypothesis, not knowledge.

### §10 — Future gates (prerequisites; not implemented here)

Before any of the following ships, a superseding capability record (under the ADR-008 §4 process) must satisfy this ADR:

- **Strategic Decision Memory:** requires §8 admission + an explicit founder decision action + a decision provenance model
  linking to the informing recommendation; ACCEPT must remain non-writing until then.
- **Strategic Commitments:** requires a Decision first + explicit binding + scope/validity.
- **Plans:** require a Commitment first + append-only plan versions + no plan-as-proof.
- **Execution:** requires the ADR-008 D gate (approval-first, never autonomous) + execution → new `observed` evidence.

### §11 — Constitutional review

Evaluated against ADR-007 (Honesty), ADR-010 (Two-Layer), and the two governance contracts. Findings:

- **Consistent:** the separation of observation/inference/understanding/positioning/context/recommendation; append-only
  history; unknown≠zero; ACCEPT-writes-nothing; conflicts-not-invented; founder sovereignty; provenance echoing supplied
  ids only.
- **Residual tensions (named honestly, not papered over):**
  - **KA-1 — write-time provenance validation. RESOLVED** (write-time validation `d89110c` + bounded remediation). Two
    blockers were closed: (1) the exact allowed-reference manifest is now **persisted immutably** (V071
    `provenance_manifest`, schema `pm-1`) and revalidated historically **without** the assembler or current effective
    context; (2) **whole-outcome degradation** (Option B) — any invalid grounding reference, after one bounded retry,
    degrades the whole outcome to INSUFFICIENT, so an unrelated valid reference can never launder an unsupported claim.
    Eval evidence: the real model invents ~1–2 reference ids per grounded recommendation; the bounded retry either
    recovers a clean grounded answer or degrades honestly to INSUFFICIENT — never a falsely-grounded READY. Remaining
    debt **PI-1** (claim-level grounding, product-preserving) is not required for KA-1. See
    `recommendation-provenance-integrity-remediation.md` + `../implementation/recommendation-provenance-integrity-closure.md`.
  - **KA-2 — legacy `memory.*` schema.** A pre-existing M2/ADR-010-era memory schema (threads, recommendations, patterns,
    voice_signatures, intelligence_events) coexists with the new strategy stack and is not yet reconciled under this
    taxonomy. It is **not** Strategic Memory; its relationship to the new stack is unresolved debt (see the map).
  - **KA-3 — structural conflicts are not persisted.** Rules 1/2/4/5 are recomputed and passed to the model but not
    stored on the session, so a historical session does not retain the exact structural conflicts it reasoned under
    (only the NON_NEGOTIABLE_OPTION conflict is stored). Acceptable for now (they are deterministically recomputable from
    the effective context as of the session), but noted.

This ADR does **not** claim perfect compliance; the three tensions above are real and are recorded as debt, not hidden.

---

## Consequences

- Future slices must place every new epistemic object into one of these 14 categories and obey §3/§9. A new object that
  fits none is a signal to stop and write a superseding record.
- Strategic Memory cannot be introduced without passing §8 and clearing the §10 gate — the blur is now prevented by
  governance.
- No runtime behavior, schema, API, UI, or frozen-engine artifact changes as a result of this ADR.
