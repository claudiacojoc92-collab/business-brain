# ADR-008 — Product Capability Roadmap

**Type:** Product Governance / Roadmap Decision Record
**Status:** 🔒 LOCKED
**Date:** 3 July 2026
**Owner:** Claudia Cojoc (Founder / Head of Product)
**Applies to:** Business Brain — all product development from this point forward
**Relationship to prior records:** Governed by and consistent with ADR-007 (Connect Your World Nucleus, LOCKED). Does not modify ADR-007; organizes all future work above it.
**Location:** Business Brain — Product Governance / Architecture Decisions

---

## 0. Context

The Foundation Phase is complete and validated. M2.1 (Website Connector) and M2.2 (Upload Connector) shipped as capabilities under a proven discipline: spec-first, honesty enforced structurally, the Business Model engine frozen, measurement before conclusions, and one internal risk gate at the genuine architectural-risk point.

The following are proven and stable, and are not reopened by this record:
- ADR-007 is locked. Evidence-first architecture is stable.
- The three-layer honesty gate (DB CHECK · domain smart-constructor · store append) is stable.
- The Business Model engine is frozen.
- The connector contract and plug-in architecture are proven.
- Multi-source fusion exists and is validated live.
- Capability-sized development succeeded (M2.2).

This record ends the micro-slice phase and freezes how Business Brain is planned from here: **as a small number of large product capabilities, not dozens of engineering milestones.** It defines those capabilities, their boundaries, and the process every future capability follows.

---

## 1. The governing model: a loop, not a pipeline

Business Brain is **one loop that turns from day one**, not a sequence of stages where value arrives at the end.

```
        ┌─────────────────────────────────────────────────────────┐
        │                                                         │
        ▼                                                         │
   A · PERCEIVE ──▶ B · BE-TOLD-INTENT ──▶ C · ADVISE ──▶ D · ASSIST
   (Connect Your      (Be Understood)      (Tell Me What   (Help Me Act)
    World)                                  Matters)              │
        ▲                                                         │
        │              actions taken become new observed evidence │
        └─────────────────────────────────────────────────────────┘
```

The loop: Business Brain **perceives** the founder's world (A), is **told the intent** that perception can't capture (B), turns both into **counsel** (C), and **assists** the founder in acting — whereupon those actions become new evidence the loop perceives (D → A).

**Consequences of the loop model (binding):**
- Each capability **deepens an arc of the loop; it does not gate the next stage.** No capability must be "finished" before another begins — understanding never finishes, so nothing may depend on its completion.
- **C (counsel) may begin as soon as A has any evidence.** The payoff is not deferred to the end of a pipeline. This is the M2.1 lesson made structural: value is felt early and deepens, never scheduled for "later."
- **Capabilities may deepen in parallel.** A gaining a new source while C advances is the loop working, not scope confusion.
- The **decomposition and boundaries are frozen; the interleaving is not.** Timing and sequence of deepening stay responsive to what founders actually pull on.

---

## 2. The four frozen capability arcs

A capability is something a **founder can feel**, not an internal engineering feature. Evidence sources (Instagram, LinkedIn, Google Drive, etc.) are not capabilities — they are sources inside a capability.

---

### A — Connect Your World  *(perception)*

**Status:** In progress. Website (M2.1) ✅ · Upload (M2.2) ✅.

**Why it exists.** Business Brain can only be as good as what it can perceive. This is the perception organ — the capability that lets Business Brain obtain reality itself rather than ask the founder to reconstruct it.

**Founder problem it solves.** "I don't want to explain my business. I want it understood from where it already lives."

**Emotional milestone.** *"It already knows my business — I didn't have to tell it."*

**What belongs inside.**
- Website and upload evidence sources (shipped).
- The shared **OAuth infrastructure** — built once, provider-agnostic, supporting read now and write later.
- A **demand-pulled** set of high-value platform evidence sources (e.g. Google, Instagram, YouTube, LinkedIn-via-export, and others) added onto the proven infrastructure as real founder demand justifies each.
- **Cross-source fusion** — the mechanism that makes multiple connected sources worth more than their sum (already validated).

**What explicitly does NOT belong.**
- Deep strategic reasoning (that is C).
- The conversation that captures declared intent (that is B).
- Autonomous action on any connected source (that is D, gated).
- Connect is *perception* — not *understanding*, not *dialogue*, not *action*.

**Why a capability, not a milestone.** It has a felt completion state ("my world is connected and it just works") and an unbounded-but-optional tail (more sources) that never blocks the capabilities above it. Individual connectors and OAuth are evidence sources and infrastructure inside this one capability — not sequels to it.

---

### B — Be Understood  *(declared intent — the moat)*

**Why it exists.** Perception captures what a founder *did and published*. It cannot capture what they *want, fear, or are deciding*. This is the organ for that — and per ADR-007, the accumulated declared intent is the product's defensible moat: a competitor's fresh sync reproduces observed reality, but not months of privately-declared, corrected, longitudinally-fused intent.

**Founder problem it solves.** "The tools see my outputs but not my intent. Nothing knows what I'm actually trying to do."

**Emotional milestone.** *"It gets what I'm trying to build — not just what I've already done."*

**What belongs inside.**
- The strategic **conversation** that captures declared intent — goals, constraints, priorities, fears, decisions, pivots — as first-class `declared` evidence.
- **Correction**: the founder fixing the model, which is itself high-value declared evidence.
- The **fusion** of declared intent with observed reality into the single Business Model.

**What explicitly does NOT belong.**
- Business *modeling* as a separate capability. There is **one Business Model**, and it is where A (perception) and B (dialogue) fuse — not a third layer to be built and re-fused.
- Giving advice (that is C).
- "Understanding the founder" and "understanding the business" are **not** separate capabilities; in a founder-led company they are one graph, per ADR-007.

**Why a capability, not a milestone.** It is the difference between a describer of the past and a partner who understands objectives, and it is the single most defensible asset in the system. It absorbs what an earlier draft called "Understand You" and dissolves the "Understand Your Business" split — one model, fed by perception and dialogue.

---

### C — Tell Me What Matters  *(counsel)*

**Why it exists.** Understanding is inert until it produces a useful thing the founder couldn't see themselves. This is where the graph becomes advice — the product's reason to exist and the thing a founder pays for.

**Founder problem it solves.** "I have data and dashboards. I don't have someone who tells me what actually matters this week."

**Emotional milestone.** *"It told me something true and non-obvious that I couldn't see myself."*

**What belongs inside.**
- Surfacing of **contradictions, blind spots, and hidden strengths** (already glimpsed live — the public-vs-private contradiction, the unmarketed-loyalty blind spot).
- **Prioritization** — "what matters now."
- **Weekly briefs** and the recurring cycle that turns accumulated understanding into ongoing counsel.
- Everything traceable to evidence — the honesty gate extends here; no counsel renders that doesn't trace to what Business Brain actually perceived or was told.

**What explicitly does NOT belong.**
- Acting on the advice (that is D).
- Generic content generation without strategic grounding.

**Why a capability, not a milestone — and why it can start early.** Advice is the product's payoff. Critically, **C may begin the moment A has any evidence** — it does not wait for A and B to "finish." This is the loop-not-pipeline correction made concrete: the advisor deepens as perception and dialogue deepen, rather than gating on their completion.

---

### D — Help Me Act  *(assistance — a gated frontier)*

**Status.** **Gated frontier.** Part of the long-term Business Brain vision, but **not permitted to ship in autonomous form until trust is deeply earned.** Its early and only near-term form is assistive.

**Why it exists.** Advice a founder can't act on is friction. This closes the loop — and it is the highest-risk frontier in the product, because it is the one place the honesty architecture faces an adversary it hasn't yet: the real world reacting to the AI's actions.

**Founder problem it solves.** "Good advice still leaves me with all the work."

**Emotional milestone.** *"It didn't just tell me — it helped me do it, and I stayed in control."*

**What belongs inside.**
- **Assistive execution (the near-term, permitted form):** drafts, prepared actions, recommendations, and scheduling — always presented for the founder's **approval**, never performed autonomously.
- **Publishing / write-back — later, and gated:** permitted only per-action with explicit founder approval, and only after read-side trust is deeply earned (ADR-007).
- **Sensing consequences back into the loop:** actions the founder takes become new `observed` evidence (they published; engagement moved), feeding back into A→C. Execution is not the end of a pipeline — it is the sensor that makes the loop a loop.

**What explicitly does NOT belong (hard lines).**
- **Autonomous execution** in any form until trust is deeply earned. Explicitly gated. Not shippable by default.
- Any write-back **without per-action founder approval**.
- Any action that smuggles execution risk into an earlier capability. D's risk stays contained in D.

**Why a capability, not a milestone — and why it is a gated frontier, not optional.** It deserves to be its own capability precisely so its risk is never smuggled into an earlier one. It is a real part of the vision (not optional), but it is the last arc to deepen and the only one whose autonomous form is forbidden until the others have proven trustworthy. Its early form — prepare, draft, recommend, ask — is permitted; its autonomous form is gated.

---

## 3. What changed from the initial proposal (recorded for provenance)

The initial draft roadmap was a five-stage pipeline (Connect → Understand You → Understand Your Business → Strategic Advisor → Execute). It was reframed on these grounds:
- **Pipeline → loop.** A pipeline defers the founder's payoff to a late stage and stalls when an early stage "never finishes." The loop delivers value from day one and deepens.
- **"Understand You" + "Understand Your Business" → one model.** They are not separable in a founder-led company and splitting them fights ADR-007's single-graph architecture. "Understand You" becomes **B (Be Understood)** — the conversation/moat, not a modeling layer. "Understand Your Business" dissolves into the single Business Model where A and B fuse.
- **"Connected Platforms" and "Cross-Source Intelligence" → inside A.** Platforms are evidence sources and OAuth is infrastructure; fusion already exists. They are not sequel capabilities.
- **"Execute" → D, a gated frontier.** Reframed from an inevitable capstone to a gated frontier: assistive now, autonomous only with deeply-earned trust; part of the vision, not optional, but risk-contained and last to deepen.

---

## 4. The frozen process (every future capability)

Every capability from here follows the process that succeeded with M2.2:

```
Capability Spec
  → Challenge (CTO/Head-of-Product pressure-test; better decompositions argued before agreement)
  → Approval
  → Implementation Brief
  → Claude Code
  → Internal risk gate(s)
  → Capability complete (measured against acceptance criteria)
  → Merge (its own gated reconciliation task)
```

**On internal gates (binding clarification):** the default is **one internal risk gate** at the genuine architectural-risk point. But the number of gates follows the number of **real risks**, not a fixed rule. A capability with one clear risk (like M2.2's reconstruction reframe) gets one gate; a capability with several genuine risks (C's advice-quality and trust; D's entire write-back safety surface) may warrant two or three, placed at each real risk point — the same judgment that inserted an extra checkpoint in M2.1. Capability-sized delivery is the default; gate count is set by risk, not by rule.

**Inherited invariants (apply to every capability, non-negotiable):**
- ADR-007 stays locked; the Business Model engine stays frozen; the three-layer honesty gate is never loosened.
- Honesty by construction: no claim renders that doesn't trace to real evidence; fail closed; no fuzzy matching without explicit measured approval.
- Measure, don't estimate: conclusions come from measured distributions, not single runs.
- Evidence-first: connectors and capabilities emit evidence; the engine consumes only evidence.
- Merge/reconciliation is always its own separately-gated task, never bundled into a capability's build.

---

## 5. What this record freezes, and what it does not

**Frozen:**
- The four capability arcs (A, B, C, D), their purpose, boundaries, and what does/does not belong in each.
- The loop model (deepen arcs, do not gate stages; C may start early; parallel deepening allowed).
- D as a gated frontier (assistive permitted; autonomous forbidden until trust deeply earned).
- The per-capability process and the risk-driven gate count.

**Not frozen (deliberately kept flexible):**
- The interleaving and timing of how the arcs deepen — responsive to real founder demand.
- Which evidence sources enter A, in what order (demand-pulled).
- The number and placement of internal gates within any given capability (set by that capability's real risks at spec time).

---

## 6. Lock

This roadmap is the frozen product organization for Business Brain. Future capability work is planned within these four arcs and follows the §4 process. Reopening the capability decomposition requires a superseding record (ADR-009+); deepening the arcs, adding evidence sources to A, and setting per-capability gates do **not** require reopening this record — they are the normal operation of the frozen roadmap.

The immediate next step, when initiated, is the continuation of **Capability A** (the next evidence sources / OAuth infrastructure) and/or the opening of **Capability C** (counsel can begin now that A has evidence) — each via its own Capability Spec under the §4 process. No implementation is planned by this record.

---

*Governed by ADR-007 (LOCKED). One loop, four arcs. Perceive · Be-told · Advise · Assist. Value from day one; risk contained; the engine frozen; honesty by construction.*
