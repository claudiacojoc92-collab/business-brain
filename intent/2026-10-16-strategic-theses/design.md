# Strategic theses: Understanding as a strategic model (design, Phase 1)

**Status:** proposed, awaiting Claudia's product review. No code, no model runs, no deploy.
**Date:** 2026-10-16
**Scope:** generic for any founder-led business. Body Move was only the discovery case; nothing here (code or prompt) may encode studios, assessments, subscriptions, locations, classes or any other industry concept.

## 0. Canonical definition (frozen)

Understanding is not a summary. It is a strategic model of how the business works: where value enters and flows, where customer decisions happen, how relationships evolve, which parts run on different commercial mechanisms, and which unknowns could change what the founder should do next.

Two layers, never collapsed:

- **Internal understanding:** rich, structured, mostly invisible.
- **Founder-facing understanding:** short, selective, strategically useful (readable in 1–2 minutes).

## 1. What exists and can be reused

| Capability | Where | Reuse |
|---|---|---|
| Governed evidence: verbatim anchoring, observed vs declared provenance, untrusted sources, website-hygiene separation | `bi/evidence-anchor`, `understanding-governance` | As is. It is the fact base every thesis must cite. |
| Business model per dimension (offer, customer, acquisition, conversion, retention, capacity, economics, performance, intent), with known (+ basis) and unknown | `read.model` | As is. It covers concepts 1–6, 10–12 partially; the missing concepts are in §2. |
| Conclusions BB deliberately did not draw | `read.notConcluding` | As is. It feeds the "absence = unknown" rule. |
| Structural synthesis + hypotheses (relationship, between, dimensions, `changes` = decision areas, alternative, reversal, discriminator unknown/question, evidence with surface/context) | `read.structure` | **The closest existing shape to a thesis.** A hypothesis is already "facts + relationship + reversal + question". It becomes the seed of the thesis contract. |
| Salvage-first governance, bounded repair, quarantine of raw candidates | `governStructure`, `governUnderstandingWithRepair`, `structureCandidates` | As is, for the synthesis and hypotheses. The eligibility gates in §7 reuse its checks. |
| Fact-level checks: numbers grounded, claim terms licensed, escalations licensed, page-condition and threshold rules | `groundNumbers`, `claimTermsIn`, `escalationsIn`, `checkReversal` | As is. They become the eligibility and output checks. |
| Question machinery: A/B/C tiers, presupposition check, "settles its fork" check, question repair, ≤ 3, acquisition kept | `governUnderstanding` question selection, `questionTiers` | Reused, but the **inputs change**: B comes from the top theses (§3). |
| Agenda fidelity: the 3 shown questions are asked verbatim, in order; skip = unresolved | `conversation.service` (shipped) | As is. If the theses pick the questions, the conversation follows them automatically. |
| Updated read after answers: movements (strengthened, weakened, reversed, sharpened, unresolved), skip ⇒ unresolved, conservative language | `mirror.service` (shipped) | Reused; it moves **theses** instead of hypotheses (§8). |
| Strategy context: synthesis, readings, paired answers, updated read | `StrategyModelInput.understandingRead` (shipped) | Extended with the theses and their status (§8). |
| Founder-facing synthesis call, re-governed sentence by sentence, persisted per snapshot in `founder_event` | `arc/first-read.ts`, `anthropic-first-read.model.ts` (built, **uncommitted**) | Evolves into the founder-facing composer (call 2, §6). |

## 2. Missing capabilities

1. **Candidate thesis generation.**
   - Hypotheses are produced inside the big understanding synthesis call, as 1–3 "structural relationships". There is no step that deliberately generates *many* candidates (6–10) across the business model and asks, for each, "which decision changes if this is true?".
   - `changes` exists but is a weak tag, not a reasoned decision lever.
2. **The business-model concepts the theses need** are missing as structure:
   - offer roles (entry, core, recurring, expansion, complementary, one-off);
   - commercial motions (a meaningful difference in entry, buying, continuation, economics or customer job);
   - decision and friction points;
   - expansion / cross-use relationships;
   - the structurally supported journey.

   Today they live implicitly in free text or in the **studio-flavoured `mechanisms` vocabulary** (`group_timetable`, `one_to_one`, `paid_first_step`, `packages`), which does not generalize.
3. **Strategic ranking.** None exists. Hypotheses appear in model order, and the card took the first that survived governance. That is exactly how a well-grounded location observation outranked a higher-leverage entry → conversion → continuation relationship.
4. **Question selection from thesis uncertainty.**
   - The A questions come from the generic readiness gaps (performance, acquisition, intent): MBA-style, chosen because the field is empty.
   - The B question comes from whichever hypothesis survived, not from the most valuable thesis.
5. **Carry-forward.**
   - Hypotheses reach the mirror, but movements are not persisted (only the founder-facing read is).
   - Strategy receives prose readings, not theses with status.
   - Nothing reaches Today or outcomes.
   - So Strategy effectively starts from the flattened 12-line summary.

## 3. Smallest architecture change

Two model calls around the existing governed state, plus deterministic eligibility and ranking. No new subsystem, no migration.

```
EXISTING  crawl → evidence → understanding synthesis → governance (+repair) → governed understanding
NEW  ①   THESIS PASS (learn time, one model call)
           input:  governed facts (F-refs), read.model, synthesis, kept hypotheses, notConcluding, untrusted-excluded
           output: compact business model (motions, offer roles, decision points) + 6–10 candidate theses
NEW  ②   ELIGIBILITY (deterministic) → RANKING (deterministic score + bounded model priority)
NEW  ③   QUESTION SELECTION from the top theses (existing question governance)
           → rewrites read.questions / unknowns / questionTiers  (the conversation agenda follows: agendaUnknowns)
         store: read.businessModel, read.theses (snapshot JSON, additive; old snapshots simply lack them)
NEW  ④   FOUNDER COMPOSER (view time, the existing first-read call evolved; cached per snapshot in founder_event)
           input:  business model + top 1–2 theses + the 3 selected questions
           output: My read / What I think matters (1–2) / question rationales → re-governed
LATER    mirror moves theses (by id) → persisted with the mirror; strategy receives theses + status
```

- **Why ① runs at learn time:** the questions must be chosen *from* the theses before the card and the conversation agenda exist (`agendaUnknowns` reads the stored snapshot). It costs one extra model call during the existing "reading" progress state.
- **Why ④ runs at view time:** it is already built that way (cached per snapshot), it can be regenerated without a new read, and it falls back cleanly.

## 4. Internal `StrategicThesis` contract

```ts
type DecisionArea = 'acquisition' | 'conversion' | 'retention' | 'expansion' | 'positioning' | 'offer_design'
  | 'channel' | 'operating_model' | 'resource_allocation' | 'customer_journey' | 'pricing';

interface FactRef { ref: string }                 // F<n>: a governed fact (model line, quote, motion, offer role)

interface StrategicThesis {
  id: string;                                     // stable within the snapshot: T1..Tn
  headline: string;                               // internal label, ≤ 12 words
  facts: FactRef[];                               // ≥ 2 distinct governed refs (eligibility)
  relationship: string;                           // what connects them (interpretation, cites the refs)
  implication: string;                            // why it may matter (conditional while open)
  decisions: DecisionArea[];                      // which founder decisions change if true (≥ 1)
  ifTrue: string;                                 // the decision that changes, concretely
  weakenedBy: string;                             // the answer or outcome that weakens or reverses it
  unknown: string;                                // what BB must learn before relying on it
  question: string;                               // discriminating, founder-answerable, non-leading
  dimensions: ModelDimension[];                   // business dimensions connected (≥ 2 for cross-dimension credit)
  modelPriority: number;                          // the model's own ordinal (1 = most valuable): one ranking input only
  eligibility: { pass: boolean; reasons: string[] };
  score?: { total: number; leverage: number; consequence: number; nonObvious: number; crossDim: number; specificity: number; reversibility: number; grounding: number };
  rank?: number;                                  // among eligible theses
  status: 'open' | 'strengthened' | 'weakened' | 'reversed' | 'sharpened' | 'unresolved';
}

// Compact governed business model (concepts 1–9 that read.model lacks). Generic vocabulary, every item cites refs.
interface BusinessModelSketch {
  motions: { name: string; entry: EntryType[]; buying: BuyingType[]; continuation: ContinuationType[]; refs: string[] }[];
  offerRoles: { offer: string; role: 'entry' | 'core' | 'recurring' | 'expansion' | 'complementary' | 'one_off' | 'lifecycle'; refs: string[] }[];
  decisionPoints: { from: string; to: string; refs: string[] }[];   // e.g. trial → paid, quote → acceptance
}
type EntryType = 'referral' | 'organic_inbound' | 'paid' | 'outbound' | 'partner' | 'marketplace' | 'walk_in' | 'founder_led' | 'self_serve' | 'sales_assisted';
type BuyingType = 'direct_purchase' | 'booking' | 'consultation' | 'assessment' | 'demo' | 'quote' | 'trial' | 'sales_call' | 'application' | 'checkout' | 'contract';
type ContinuationType = 'repeat_purchase' | 'subscription' | 'package' | 'ongoing_service' | 'usage' | 'maintenance' | 'follow_up' | 'referral' | 'none_observed';
```

These vocabularies are generic categories, not assumptions: a value is allowed only with a governed ref, and `none_observed` is a legitimate answer.

## 5. Ranking: criteria and who decides what

**Eligibility is a gate, never a score.** A thesis enters the ranking only if every deterministic check passes:

- ≥ 2 distinct valid fact refs;
- no new number;
- claim terms and escalations licensed by the facts (existing checks);
- **an economics/inference guard:** margin, profit, scalability, demand, utilisation, growth, stagnation, preference, channel effectiveness, retention or conversion rate, dominance, "strongest / most important" are allowed only when a governed fact contains the concept;
- reversible: `weakenedBy` and `unknown` present;
- the question passes the existing presupposition and "settles its fork" checks;
- **not an observation:** the relationship must not restate a single fact (overlap with any one fact below a threshold) and must name at least one decision area;
- **not taxonomy:** a relationship that only classifies offers, with no decision attached, fails.

**Score among eligible theses (deterministic, explainable):**

| Criterion | Weight | Deterministic proxy |
|---|---|---|
| Decision leverage | 0.25 | `decisions` weighted (acquisition, conversion, retention, expansion, resource allocation highest) + `ifTrue` present |
| Business consequence | 0.15 | number of distinct decision areas affected |
| Non-obviousness | 0.15 | 1 − max overlap with any single fact, the site's own positioning copy, or another candidate |
| Cross-dimension | 0.15 | distinct `dimensions` connected (≥ 2) |
| Specificity | 0.10 | named business entities (`businessEntities`) referenced |
| Reversibility | 0.05 | clarity of `weakenedBy` / `unknown` (gate already passed) |
| Model priority | 0.10 | the model's own ordinal, bounded so it cannot override the rest |
| Grounding strength | 0.05 | refs count and kind (observed lines > quotes): **tie-breaker weight only** |

Grounding is deliberately the smallest weight, so an easy-to-prove observation cannot outrank a high-leverage thesis.

**Responsibilities:**
- **Model (call ①):** generates the candidates and fills every field honestly; gives an ordinal priority with one sentence why.
- **Code:** eligibility, scoring, ordering, de-duplication (similar theses merged; the best one kept), question selection, storage.

## 6. Founder-facing output contract (call ④, re-governed)

```ts
interface FounderUnderstanding {
  snapshotId: string;
  myRead: string;                               // 2–3 short sentences: HOW the business works (motions, entry,
                                                //   continuation, relationships). No catalogue, no audiences list, no praise.
  matters: { thesisId: string; headline: string; body: string }[];   // top 1–2 theses; body = relationship ·
                                                //   why BB cares · what is uncertain (≤ 3 sentences)
  whys: (string | null)[];                      // one rationale per selected question: "what decision gets clearer"
}
```

- **Rendered:** My read → What I think matters → What I need from you (the 3 thesis-driven questions).
- **Not rendered:** alternatives, evidence lists, reversal rules, labels, scores.

## 7. Grounding without killing interpretation

- **Two kinds of clause, marked by the model:** every founder-facing sentence comes with `kind: fact | interpretation` and `refs`.
  - A **fact** clause must map to the refs at the stated strength. New numbers, qualifiers, economics or behaviour fail.
  - An **interpretation** clause must connect ≥ 2 refs and stay conditional while its thesis is open.
- **Salvage, not kill:** the existing sentence-level salvage applies (drop the failing sentence, keep the rest). A thesis is removed only when nothing grounded remains.
- **Two cheap checks the last run showed are needed:**
  - catalogue shape: a sentence listing ≥ 4 offer or audience items is dropped;
  - length: ≤ 30 words per sentence.
- **The economics guard (§5) also runs on the founder copy.**
- **Interpretation is allowed by design:** "these motions may need different acquisition logic" passes, because it connects ≥ 2 refs and asserts no new fact. "This line is your strongest engine" fails the economics guard unless a fact says so.

## 8. Carry-forward

- **Conversation:**
  - the 3 questions are the thesis questions; agenda fidelity (shipped) asks them verbatim;
  - `questionTiers[i].resolves` points at a thesis id, so a skip leaves *that thesis* unresolved.
- **Updated mirror:**
  - `MirrorReadInput.hypotheses` becomes the top theses (id, relationship, implication, unknown, question, weakenedBy);
  - the model returns movements per thesis id (same statuses);
  - "skip ⇒ unresolved" maps through `resolves`;
  - **movements are persisted** with the mirror (`arc_mirror_built` metadata, next to the read). No migration.
- **Strategy:**
  - `understandingRead` gains `theses: { id, headline, relationship, implication, decisions, status, because }[]`;
  - the strategy prompt must build on the top non-reversed theses, name the thesis each core choice relies on, and never contradict a reversed one;
  - a light check flags a bet that cites no thesis (logged; not blocking at launch).
- **Today:** inherits through the strategy (no change).
- **Outcomes:** later. The thesis id gives outcomes something to move. Not in the launch slices.

## 9. What stops controlling founder-facing copy

- **Become fallback only, for old snapshots or a failed call:**
  - the deterministic first-read templates (`arc.u5.*`, `arc.u3.*`, `composeFounderView`);
  - `founderSignals` / `teamGap` copy;
  - the `arc.u2` structure card (synthesis, noticed, could change).
- **Generalized:** the studio-flavoured `mechanisms` kinds. They keep governing the synthesis for now, but no founder copy or thesis depends on them; the generic `BusinessModelSketch` replaces them as the source of motion language.
- **Narrowed:** readiness-gap A questions (performance, acquisition, intent as "the field is empty"). A stays only for the current-driver question when it is needed; the rest come from theses.
- **Kept for its role, not for founder copy:** the hypothesis list. It remains the governed seed of the theses.
- **Also to review later** (they encode domain words): the attribute-propagation vocabulary and some Romanian patterns in the governance.

## 10. Implementation plan (fast launch)

Each slice: targeted tests → type-check → lint changed files → build → **one** real run on **three stored snapshots of different business types** (Body Move = local services, QuFi = B2B fintech, plus one more already in the database). Generality is checked by reading all three, not by tuning to one. No migration in any slice.

| Slice | What | Files (approx.) | Ships |
|---|---|---|---|
| **S1. Thesis pass** | Contracts (§4); call ① with a generic prompt; eligibility + ranking (§5); store `read.theses` + `read.businessModel` in the snapshot; tests on invented SaaS, agency and ecommerce fixtures | `bi/contracts.ts`, new `bi/theses.ts`, `learn-business.use-case.ts`, new `anthropic-theses.model.ts`, `model-shapes.ts` | with S3 |
| **S2. Questions from theses** | Top thesis questions through the existing question governance (A = current driver if needed, B = thesis #1, C = thesis #2 or the next high-value unknown); rewrite questions, unknowns and tiers (`resolves` → thesis id) | `understanding-governance.ts` (selection only) | with S3 |
| **S3. Founder composer** | Evolve the uncommitted first-read call into §6 (My read / matters / whys) with the §7 checks; card renders it; deterministic copy becomes fallback | `arc/first-read.ts`, `anthropic-first-read.model.ts`, `ArcSurface.tsx`, `understanding-founder.ts` | **deploy 1** (api + web) |
| **S4. Carry-forward** | Mirror moves theses by id + persists movements; strategy context + prompt rule + soft check | `mirror.service.ts`, `anthropic-mirror.model.ts`, `strategy/contracts.ts`, `anthropic-strategy.model.ts`, `arc.service.ts`, `founder-events.ts` | **deploy 2** (api + web) |

**Not in scope:** crawler, evidence extraction, governance rules beyond the eligibility gates, conversation flow, migrations, Today, outcomes.

**Risks:**
- One more model call at learn time (latency inside the existing progress state, plus cost).
- Old snapshots have no theses, so they show the fallback.
- Ranking proxies are heuristics: the three-snapshot read is the check, and the weights are a tuning knob, not a promise.

**Open decision for Claudia:** should S1–S3 apply only to new reads (old snapshots keep the fallback), or also run the thesis pass lazily on an existing snapshot when its card is opened? The lazy option avoids forcing a re-read, but adds latency to the first open.
