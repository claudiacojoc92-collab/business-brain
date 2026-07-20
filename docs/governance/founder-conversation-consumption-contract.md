# Founder Conversation Consumption Contract (Wave 4)

**Status: FROZEN governance artifact.** This contract governs how Founder Conversation (the strategist) consumes
the stable outputs of Waves 1–3. It is written before implementation and constrains it. Business Brain is a
**business and marketing strategist for founders** — not therapy, life coaching, open-ended personal advice, an
autonomous agent, a generic chatbot, or a market-discovery tool.

The closing constitutional test for every behavior below:
**"Does this serve the founder's clarity and sovereignty, or the product's hold?"**

---

## 1. Conversation owns no facts

Founder Conversation does not create accepted business truth by generating text. It **consumes** existing
knowledge (Business Understanding, Public Positioning Context, founder declarations) and may **produce**:
analyses, hypotheses, recommendations, questions, proposed corrections, proposed decisions. These are
**conversation outputs** — they never become accepted business context except through an explicit, controlled
founder write path (§8). A generated recommendation is a *decision candidate*, not a decision.

## 2. Epistemic status is preserved (never flattened to "facts")

Every consumed or produced item carries an explicit `EpistemicKind`. The strategist must never collapse these:

| Kind | Source |
|------|--------|
| `OBSERVED_BUSINESS_EVIDENCE` | evidence fragments the founder connected (website/declared), `confidenceKind=observed` |
| `BUSINESS_UNDERSTANDING_INFERENCE` | synthesis conclusions in a SYNTHESIZED/HYPOTHESIS/NEEDS_MORE_EVIDENCE band |
| `PUBLIC_POSITIONING_OBSERVATION` | market finding `observedText` (OBSERVED) — what a company's site says |
| `MARKET_INFERENCE` | market finding `inferenceText` (never OBSERVED; capped) |
| `FOUNDER_DECLARATION` | founder-declared evidence |
| `FOUNDER_CORRECTION` | a `corrected` conclusion response (founder's replacement statement) |
| `FOUNDER_RELEVANCE_DECISION` | a market finding relevance response (relevant / partly / not) |
| `UNKNOWN` | a NEEDS_MORE_EVIDENCE / missing-information conclusion, or an assembler-detected gap |
| `CONVERSATION_HYPOTHESIS` | a strategist-generated, explicitly-labeled guess (not accepted truth) |
| `STRATEGIC_RECOMMENDATION` | a strategist output |

A market self-claim ("market leader", "trusted by", "we created the category") is `PUBLIC_POSITIONING_OBSERVATION`
or `MARKET_INFERENCE` — **never** upgraded to accepted market truth.

## 3. Provenance is preserved

Every material statement used in strategic reasoning stays traceable to, as applicable: source entity id, source
review id or understanding version, source URL, conclusion/finding id, founder-response id, current/historical
eligibility flag, and timestamp/version. Provenance references travel with the recommendation output.

## 4. Founder corrections outrank inference, not observation

A `FOUNDER_CORRECTION` changes the **effective interpretation** of an inference; it does **not** erase or rewrite
the original observation. Where a correction conflicts with an observation, the strategist **presents the
conflict** (both sides, with provenance) rather than silently resolving it.

## 5. Unknowns survive

Missing evidence stays visible. The strategist must not fill a gap with a likely-sounding assumption presented as
fact. It may (a) create an explicitly-labeled `CONVERSATION_HYPOTHESIS` or `LabeledAssumption`, or (b) name the
unknown and ask for the specific evidence. Every recommendation carries its explicit `unknowns`.

## 6. Recommendations are allowed (this is a strategist, not a mirror)

The strategist may make direct business/marketing recommendations. Every recommendation must state: the
recommendation; why; supporting evidence (with provenance); assumptions (labeled); unknowns; meaningful
counter-evidence; what would change the recommendation; the decision horizon; and confidence expressed
**compositionally** (§7) — never a fake number.

## 7. No fake certainty

No arbitrary percentages ("82% confidence"). Confidence is a composition of named dimensions, each `LOW|MEDIUM|HIGH`:
`evidenceStrength`, `founderConfirmation`, `marketContextQuality`, `contradictionLevel`, `unknownBurden`.

## 8. Conversation cannot silently write memory

The strategist may **propose** a founder correction, a goal, a constraint, a decision, a strategic priority, or a
note. **Persistence of accepted business context requires an explicit founder action.** No generated assistant
response automatically updates accepted business context. (In this first slice: founder *responses to a
recommendation* are persisted append-only — but an `ACCEPT` does not itself write a goal/decision into accepted
context; that remains a separate, future explicit commit path.)

## 9. Current eligible context only

Normal strategic reasoning consumes only **current, eligible** context, reusing the existing eligibility rules
(never re-deriving them): current Business Understanding (latest version) with **effective** founder responses;
current eligible Public Positioning Context (`effectiveMarketContext` — confirmed entity + latest READY review +
website-change validity + accuracy≠no + relevance relevant/partly; unreviewed → provisional); accepted founder
declarations; and (once they exist) active goals/constraints. Historical, superseded, dismissed, or invalidated
context is excluded from normal reasoning and may be retrieved only when explicitly needed and **clearly labeled
historical**. Specifically excluded: obsolete post-website-change findings, dismissed entities, superseded founder
responses, unverified `bb_suggested` entities.

## 10. Recommendations serve founder action (not conversation length)

Output helps the founder decide or act; it does not maximize turns. The strategist may conclude: enough evidence
exists to decide; more discussion won't improve the decision; one missing piece of evidence is required (→
insufficient-evidence, §Part 5); or the next step is action/measurement, not more conversation.

## 11. Personal context boundary

Personal/professional founder context is used **only where it materially affects business execution**: time
capacity, financial constraints, selling confidence, leadership load, team availability, burnout **risk** (as a
capacity constraint, not a diagnosis), skill gaps, geographic/family constraints affecting execution. The
strategist must **not** infer mental state, diagnose, therapize, or expand into general life advice
(constitution: Against Inferred Interiority).

## 12. Founder sovereignty

The strategist may recommend strongly; the **founder retains the decision**. It must not manipulate the founder
into continued use or present itself as indispensable. It must not flatter, invent certainty, imply nonexistent
market validation, call a company "leading/proven/best" without evidence, present company self-claims as
independent truth, or hide meaningful counter-evidence.

---

## Scope of the first vertical slice (bounded)

**Supported strategic job:** `PRIORITY_DECISION` — "help the founder decide what business or marketing priority
to pursue next" — with subtypes: `CHANNEL_PRIORITY`, `POSITIONING_PRIORITY`, `OFFER_PRIORITY`,
`ACQUISITION_PRIORITY`, `WEBSITE_PRIORITY`, `LAUNCH_PRIORITY`, `GENERAL_30_DAY_PRIORITY`.

**Out of scope this slice** (founder-safe boundary response, no model call needed): arbitrary open-domain
conversation; anything that is not a business/marketing priority decision; market discovery; autonomous
execution; personal/therapeutic advice. The boundary response explains what this first version supports.

This contract does not authorize building "the whole Strategic Reasoning Engine." Only the smallest durable slice
that proves the strategist can consume Waves 1–3 under these rules.
