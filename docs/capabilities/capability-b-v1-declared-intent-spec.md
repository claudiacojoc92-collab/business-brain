# Capability B v1 — Be Understood (Declared Intent Capture)

**Type:** Capability build spec (BUILD document — momentum, not polish)
**Status:** DRAFT FOR APPROVAL
**Date:** 4 July 2026
**Governed by:** ADR-007 (honesty) · ADR-008 (roadmap — this is Capability B, the moat) · ADR-009 (auth boundaries — N/A, B is unauthenticated). Inherited by reference; not reopened.

> **Design principle (the key):** Do not design the questions from "what's nice to ask." Design backward from **what Capability C (counsel) will need and cannot infer from observation.** Every captured field exists because C would otherwise have to fabricate it. B v1 gives C ground truth on the things perception structurally cannot see.

> **Build rule:** one architectural risk (how `declared` evidence types + fuses). Everything else defaulted and noted. Reuse the existing pipeline — no second pipeline.

---

## 1. What this is (one paragraph)

B v1 is a **single structured conversation** that captures the founder's **declared intent** — the things documents and websites never contain — as first-class `declared` evidence flowing into the existing evidence store and Business Model, exactly like observed evidence. The reflection already ends by asking "what are you actually trying to build?" — B v1 answers that, captures it as evidence, and the *next* reflection is sharper because it now knows intent, not just observation. This is Capability B (the moat, ADR-008): a competitor can sync the same public/private docs, but not months of the founder's declared direction.

NOT a chatbot. NOT open-ended conversation. NOT memory. NOT correction-flows. One structured conversation → declared evidence → better reflection. Nothing more.

---

## 2. Designed backward from Capability C

Each captured field exists because **C cannot infer it from observation** and would otherwise fabricate it:

| Captured field | Why C needs it | Why observation can't provide it |
|---|---|---|
| **Direction** — what you're trying to build | C prioritizes toward the goal | Docs show what exists, not where it's going |
| **Target** — who you're trying to serve | C's advice is audience-specific | Docs show what was made, not who it's for when they differ |
| **What's changing** | C weights recent motion | A snapshot has no trajectory |
| **Biggest challenge now** | The #1 input to "what matters now" | Never written in a business document |
| **Load-bearing assumptions** | C flags risk honestly | Assumptions are unstated by definition |
| **Success definition** | C advises toward the founder's win, not a generic one | Not in any doc |

These six are the spine of B v1's conversation. (Exact wording/order of questions = reversible, defaulted, tune later. The *fields* are the architecture; the *phrasing* is polish.)

---

## 3. Founder experience (the block)

1. After a reflection (or from the connect surface), an invitation: *"Now tell me the part your documents can't."* One structured conversation, ~6 questions mapping to the six fields.
2. Founder answers in their own words (short free-text per question).
3. Each answer becomes a `declared` evidence fragment.
4. The next reflection fuses declared intent with observed (website/upload/google) — e.g. "you *say* you're building X (declared), your docs *show* Y (observed) — here's the gap." Declared + observed fusion is the new signal.

**Reversible defaults (assumed, not debated):** exact question copy, order, how many questions (default 6, one per field), UI (reuse the existing preview/reflection surface pattern), whether it's one-shot or resumable (default: one-shot for v1, resumable is later depth). All tune-later.

---

## 4. What's IN (build this)

- A **conversation surface** (reuse existing UI patterns) presenting ~6 structured questions (the six fields, §2).
- Capturing each answer as a **`declared` evidence fragment** through the **existing three-layer honesty gate**, with:
  - `confidence_kind: 'declared'` (the existing third kind — NOT observed, NOT inferred),
  - `source: 'founder'` (or `conversation`),
  - provenance: the question/field it answers (a `declared://` style anchor, mirroring how upload/google use opaque location URIs),
  - `visibility: private`,
  - `occurred_at`: capture time.
- **Fusion into recompute:** declared fragments flow into the SAME `recomputeFromSources` path as observed, so the reflection reasons across declared + observed. Engine byte-identical.
- **Reflection uses declared evidence** — declared-vs-observed gaps become a new reflection signal (the moat payoff).

---

## 5. What's OUT (do not build — flag if tempted)

- Chatbot / open-ended dialogue / turn-taking conversation. (Structured Q&A only.)
- Memory / persistence across sessions beyond the evidence itself. (Deferred — you said so.)
- Correction-flows (founder editing the model). (B's later depth, not v1.)
- Business Memory, freshness, confidence scoring, dedup. (Deferred capability, do not reopen.)
- A second evidence pipeline. (Reuse the one that exists — hard rule.)
- Any new `confidence_kind`. (`declared` already exists in the model — USE it, don't invent.)
- Engine edits. Honesty-gate changes. ADR reopening.
- Follow-up / adaptive questions based on answers. (v1 is fixed questions; adaptive is later.)

---

## 6. THE one architectural risk (the only thing to get right)

**How `declared` evidence types and fuses without corrupting the observed/inferred honesty model.**

This is the single load-bearing question. `declared` is a *different epistemic kind* from `observed`:
- **observed** = Business Brain perceived it (a real doc/page said it).
- **declared** = the founder asserted it (they told us directly).
- **inferred** = the engine derived it from evidence.

The risk: declared intent must NOT be treated as observed truth about the world, and must NOT let the engine launder "the founder said they're winning" into "the business is winning." Declared is evidence of *what the founder intends/believes*, not of external reality — exactly parallel to the M2.2/Google epistemic ceiling (an upload is evidence of the document, not the market).

**What to verify (this is the gate):**
- `declared` fragments are typed `declared`, distinct from observed, through the UNCHANGED gate. (The kind already exists — confirm the store + engine already handle it, since ADR-007's model has always had three kinds.)
- The reflection **attributes declared evidence correctly**: "you *told me* X" (declared), never rendered as "your business *is* X" (observed). Declared provenance chips read as declared ("you said"), not as observed ("your website says").
- Declared cannot be the sole basis for an inferred claim about *external reality* (same epistemic ceiling as observed-source rules). A founder saying "we're the market leader" is declared intent, not market fact.
- Fusion works: declared + observed produce the gap-signal ("you say X, docs show Y") WITHOUT the engine collapsing declared into observed.

**If `declared` already flows cleanly through the existing gate + engine (it should — it's the model's third kind), there is NO new pipeline and this risk is a verification, not a construction.** If declared has never actually been exercised end-to-end, THIS is where we stop and confirm before building the surface on top.

One gate, here. Everything else builds.

---

## 7. Reuse (do not rebuild)

- Evidence store + three-layer gate + `makeFragment` (add `declared` kind — already in the model).
- `recomputeFromSources` (declared is just another kind in the store it already reads).
- Two-beat reflection (declared deepens Beat 2's fusion).
- The existing UI/preview surface pattern.
- Fail-closed resolution, honest states.

---

## 8. Acceptance criteria

1. Founder completes the ~6-question structured conversation; each answer becomes a `declared` fragment through the unchanged gate.
2. Declared fragments carry `declared` kind, `source:founder`, field provenance, `visibility:private`.
3. The next reflection fuses declared + observed — declared-vs-observed gaps surface as a signal.
4. Declared evidence is **attributed as declared** ("you told me"), never rendered as observed truth. Epistemic ceiling holds (declared ≠ external-reality fact).
5. Engine byte-identical; three-layer gate unchanged; no second pipeline; no new confidence_kind invented.
6. Website/Upload/Google not regressed; full suite green.
7. Live: a real founder answers the conversation, declared evidence is created, the reflection visibly improves using it (manual observation gate, like every capability).

---

## 9. Build order

**Phase 1 — Declared-evidence path + the risk gate → STOP if declared isn't already clean.**
Capture → `declared` fragment through the unchanged gate. Verify `declared` types + fuses correctly (§6): distinct kind, correct attribution, epistemic ceiling, no engine change. If `declared` already flows end-to-end, this is quick and we continue; if it's never been exercised, STOP and report before the surface.

**Phase 2 — Conversation surface:** ~6 structured questions (the six fields), reuse UI pattern, capture answers.

**Phase 3 — Reflection fusion:** declared + observed in recompute; declared-vs-observed gap signal; correct declared attribution in the rendered reflection.

**Phase 4 — Measure + close:** live conversation → declared evidence → improved reflection, watched. Declared attributed correctly, ceiling holds, dangling=0, engine byte-identical, suite green. Report + commit plan (feature branch, gated merge — separate task).

---

## 10. Deferred as polish / later depth (noted, not now)

Question wording/order/count; adaptive follow-ups; resumable conversations; correction-flows; memory; conversational UI feel. All reversible, all later.

---

*Governed by ADR-007/008/009. Capability B, the moat. Declared intent as first-class evidence, reusing the existing pipeline. One gate: declared types + fuses without corrupting the honesty model. Designed backward from what Counsel will need. Build, don't polish.*
