# Plan: Understanding regression — recover the strategist, measured

- **Status:** approved 2026-10-17 (D1–D4 as recommended, plus three additions below); C1 in build. Operator brief 2026-10-17: restore / keep / narrow / delete; measure on seven real
  businesses before and after; audit the thesis + founder-projection layer and report before changing it.
- **Evidence:** `history.md`, `prompt-diff-*.diff` in this folder. The regression starts at `c59d630` (10-15).

## Most serious finding: prefabricated text wearing the model's voice

The sentence the founder called meaningless, "Afacerea ta are mai mult de un traseu comercial sub același brand", is a
HARDCODED TEMPLATE (`MORE_THAN_ONE_PATH` in `packages/application/src/arc/theses.ts`), not model output. Two more fixed
strings sit beside it:
- the consequence line (`CONSEQUENCE`): "Dacă legătura există în practică, asta ar schimba cum gândești …";
- the "I don't know yet" lead (`UNKNOWN_LEAD`): "Nu știu încă: …".

All three appear for every business. This is not a model producing weak analysis. It is prefabricated text wearing the
model's voice, and it is the most serious finding of this audit.

## Why the fix has to move all four layers together

The position is suppressed in FOUR layers between the model and the screen, and the card projection degrades even the
good 10-13 snapshot. A prompt-only fix would therefore have changed nothing on screen, and we would have concluded that
the restoration failed. The fix moves all four layers together, and the eval is measured on the founder-visible card
text, not on the model's raw output.

**Standing lesson:** when output looks wrong, check every layer between the model and the screen before blaming the
model.

The four layers:

1. **The understanding prompt.** `c59d630` removed DECIDE, the root-cause order, the capability check, the so-what test and the 3–4 ranked tensions.
2. **Understanding governance (code).** It overrides the model on every first read:
   - `earnDiagnosis` never allows a constraint without the founder's goal, and the stored constraint follows it (`decided: false`).
   - The stage is forced to `undetermined` without performance evidence (`performanceEvidence`).
   - The capability check is dropped when there is no declared goal.
   - Absence tensions are moved to `websiteNotes` when there is no declared goal; their so-what is blanked.
   - `BEHAVIOUR` bans "nu poate judeca / evalua / compara" (the "cannot judge" form that is allowed).
   - `positioning.summary` is blanked when it says "pariezi" without a declared goal.
3. **The arc projection** (`arc.service.ts` `projectUnderstanding`):
   - An old snapshot's decided constraint is shown only as a hypothesis.
   - The footprint stage is downgraded to undetermined.
   - So even the 10-13 Body Move read would render degraded today.
4. **The thesis + founder-projection layer (10-16/17)** writes MY READ and MATTERS, which now lead the card. Audit below.

## Audit of the thesis + founder-projection layer (reported before any change)

**Fixed template sentences.** These are the cross-business and within-business repeats:
- `MORE_THAN_ONE_PATH` is the MY READ opener: "Afacerea ta are mai mult de un traseu comercial sub același brand." It is one of the three truisms, and the same line for every business with more than one motion.
- `CONSEQUENCE`: "Dacă legătura există în practică, asta ar schimba cum gândești {areas}." It sits in every MATTERS item, so it appears twice within one business.
- `UNKNOWN_LEAD`: "Nu știu încă: …" starts every unknown line.

**RESTORE (the E3 strengths, carried into this layer):**
- A MATTERS item may state a consequence as BB's committed reading, in the so-what shape ("This means <what customers cannot see, judge or do>, so <what that leaves you with>").

**KEEP:**
- Numbers only from the governed input.
- Claim terms licensed by the input.
- No recommendations (`SOLUTION`): the reading step does not prescribe; E3 had the same rule.
- No economics nobody stated.
- No invented benchmarks ("most", "almost everyone").
- Actor ownership (a customer's action is never written as the founder's).
- No refs or labels.
- The word cap.
- Thesis eligibility (≥ 2 facts), the simple ranking, de-duplication, observation-only never top.
- The Business Snapshot.

**NARROW:**
- `behaviourFinding` in founder copy: same narrowing as in understanding.
  - Allowed: what a customer cannot see, judge or check.
  - Banned: feel, convert, will do.
- `EFFECT` words (filter, barrier, separates, qualifies, blocks), banned today unless the source says them.
  - Keep the ban in FACT sentences.
  - Allow them in a sentence that is BB's reading of a mechanism. That is an interpretation, not a fact.

**DELETE:**
- `INFERS`: the ban on conclusion connectors ("ceea ce înseamnă", "which means"). A so-what IS a conclusion.
- The required conditional on every consequence (`CONDITIONAL` gate) and the fixed `CONSEQUENCE` line.
- The required "unknown" sentence in every MATTERS item (`UNKNOWN_MARK`) and the fixed `UNKNOWN_LEAD`. The unknown belongs in the questions.
- The fixed `MORE_THAN_ONE_PATH` opener.
- Projection-prompt rules:
  - "Describe STRUCTURE from the business's side … never as what customers do";
  - "No conclusion connectors";
  - "'If it is real' is a condition";
  - "NEVER CLAIM WHAT A RELATIONSHIP CAUSES … no 'because', no 'which makes'";
  - "A relationship nobody has confirmed stays a POSSIBILITY".
- Thesis-prompt rule: "For an open thesis NEVER describe what each branch would cause".

## The seven fixtures

The inputs are the current linked evidence per business, exported read-only from prod. They are turned into the exact model input with the same code `bridgePourIn` uses.

| Business | Language | Sources | "Old" output to compare |
|---|---|---|---|
| Body Move (Another Body Move Test fragments, latest reader) | ro | website | 10-13 Body Move Studio (E3) |
| QuFi Network | en | website | 10-13 06:07 (E3) |
| Business Brain | en | website + Instagram | 10-13 06:05 (E3) |
| LFG (Lfg Final) | de | website | 10-14 01:10 (E3) |
| Imm Expert | ro | website + founder-supplied | 10-03 (E1) |
| East Fork Pottery | en | website | 09-11 (E1) |
| Basecamp | en | website | 09-11 (E1) |

AI Startup (ro, website) is available as an eighth.

**Comparing against the old outputs:**
- Four businesses have an E3 "old" output; East Fork, Basecamp and Imm Expert only have E1, which was audit-like too.
- The reader changed in between (BUS-73 block boundaries), so the old outputs were produced from slightly different page text.

## Commit sequence

1. **C1: eval set, harness and baseline. No product change.**
   - **Export:** a read-only prod script captures each business's linked fragments → observations, plus the old snapshots.
   - **Harness:** env-gated. It runs the full chain: synthesis → governance → arc view (thesis + projection) → the founder-visible card text, rendered the way the web renders it.
   - **Rubric scorer:** pure and unit-tested. Deterministic checks:
     - decided constraint present;
     - constraint not a restated tension;
     - 3–4 tensions, each naming a fixture entity or number;
     - stage named;
     - no website-hygiene in the tensions;
     - no banned behaviour phrases;
     - no sentence repeated within or across businesses;
     - BB-written text in the content language;
     - the business named as the sources name it.
   - **Human column:** cause vs symptom, and strategist vs audit, filled in by the operator.
   - **Baseline:** current `main` × 3 runs per business.
2. **C2: understanding prompt.** Restore 1–8, keep 1–7, narrow 2, delete 8 (operator lists). Prompt tests updated; the no-real-business test stays.
3. **C3: understanding governance and projection code.**
   - Remove the goal gate on the constraint; restore `refineConstraint`.
   - Stage from business evidence.
   - The capability check without a goal.
   - The absence split: business-proof absence stays a tension; site-structure absence (menu, button, counter) goes to `websiteNotes`.
   - Narrow `BEHAVIOUR`; allow "betting on".
   - Stop the arc projection downgrading decided constraints and footprint stages.
   - **Measure after C2+C3:** this shows whether the prompt alone would have been enough.
4. **C4: thesis + founder-projection layer** per the audit above, plus the card order (decision D1).
5. **C5: re-run all seven × 3.** Old / regressed / fixed side by side per business, with the rubric table. Then operator review, the ship flow, deploy, and the prod walk (separate approvals).

**Size:**
- C1 ≈ 1 day; C2+C3 ≈ 1–1.5 days; C4 ≈ 1 day; C5 ≈ 0.5 day plus review.
- One full eval round ≈ 60 model calls (7 businesses × 3 runs × 3 calls); about three rounds.

## Decisions for the operator (before C1/C4)

### D1. What leads the first-read card

**The question.** Restoring the constraint, stage and ranked tensions gives the card a second "strategist" section next to today's MY READ / WHAT I THINK MATTERS (from the thesis layer). Both cannot lead.

**Recommendation.** Business Snapshot → the constraint (the cause) → stage → 3–4 ranked tensions, each with its so-what → questions. MY READ / MATTERS leave the first-read card. The theses keep running internally: they feed the conversation agenda, the mirror and Strategy, and they get the narrowed copy rules from the audit.

**Reasoning.**
- The 10-13 read you judged "dramatically better" was exactly that order: constraint, stage, tensions, questions.
- MY READ / MATTERS is the layer that carried the three fixed templates. Even after the templates are deleted, it was built to describe relationships as possibilities, not to commit.
- Two leads on one card would split the founder's attention between a committed view and a hedged one, and the hedged one would undercut the committed one.
- Keeping the theses internal keeps what they do well (structured hypotheses for the conversation and Strategy) without putting their voice on the first screen.

**Alternative.** Keep MY READ / MATTERS below the tensions as "what I'm watching". This costs screen length and keeps a second voice on the card; I would only choose it if the eval shows the narrowed theses add something the tensions do not.

### D2. Private material in the fixtures

**The question.** The fixtures are the real ingested content of seven businesses. Most of it is public website text, but Imm Expert (and an older Body Move record) include founder-supplied documents, which are private material handed to BB.

**Recommendation.** Keep the fixtures in a git-ignored local folder. Commit only a manifest: business, fragment ids, content hashes, export date. The harness, the rubric scorer and the scorer's unit tests are committed; the eval runs locally where the fixtures exist.

**Reasoning.**
- The repo is not the place for a client's private documents, even in a private repository.
- The medical-guard fixtures were curated, publishable cases; these are raw client material.
- A manifest with hashes still makes every run reproducible and shows when an input changed.
- The cost: someone without the local folder cannot re-run the eval. Today that is only you and me, and the export script can rebuild the folder from prod.

### D3. "Headings in the business language"

**The question.** Your rubric item "in the business's own language throughout, headings included" conflicts with the language rule ratified on 2026-10-07: UI chrome (headings, buttons, provenance chips) is always English; BB-written text, and the strings that read as part of BB's sentence about the business (the 2026-10-13 amendment), follow the business's content language.

**Recommendation.** The rubric checks every BB-written sentence and every content-language string, not the English UI headings.

**Reasoning.**
- Scoring headings would fail every business on a rule we chose deliberately, and hide the real language defects among those failures.
- If you now want the headings in the business language too, that is a change to the language rule itself (UI, i18n catalogs, CLAUDE.md), not to the understanding. It should be decided on its own.

### D4. The business name

**The question.** The card says "Another Body Move Test" because that is the record name typed when the business was created. The Business Snapshot uses the record name, and you asked for the Snapshot to stay exactly as built.

**Recommendation.** When the record name does not appear anywhere in the business's sources, use the name the sources use (the brand on the site), and keep the record name everywhere else (lists, navigation). This is a small, deterministic change to the Snapshot and to every place BB writes the name in its sentences.

**Reasoning.**
- The founder reads a sentence about their business with a test label in it; that undermines the read more than any wording issue.
- A real founder usually types their real name, so this mostly matters for test records; but nothing stops a founder typing a placeholder.
- It touches the Snapshot you froze, which is why it needs your explicit OK. Without it, the rubric's name check will keep failing on test records, and I will mark those failures as a known record-name issue rather than a regression.

## Operator approval (2026-10-17)

- **D1 approved.** Constraint, stage, ranked tensions, questions; MY READ and MATTERS leave the first-read card; the theses keep running internally. In the operator's words: the constraint IS the read. "Nu ai ales pentru cine ești în primul rând" is what MY READ was supposed to be. One slot, filled with something that commits.
- **D2 approved.** Git-ignored fixtures, committed manifest with hashes, committed harness and scorer. Same confidentiality line as 10-06 (Body Move's material not shown to a third party). The export script rebuilding from prod is the escape hatch.
- **D3 approved as scoped.** The rubric checks BB-written sentences and content-language strings, not the English UI chrome.
  - **Open product decision (logged, not part of this work):** the founder has reacted badly to the mixed-language screen twice, in writing and unprompted. English headings over Romanian body text read as broken to the person they are for. The language rule (UI always English) is therefore a live question, not a settled one. It gets decided, not inherited.
- **D4 approved, with a constraint.** Use the name the sources use when the record name appears nowhere in them; keep the record name in lists and navigation. If the sources do not agree on a single name, or the match is ambiguous, fall back to the record name. A deterministic rule with an honest fallback, never a guessed brand.

**Additions:**
1. **A test that stops the templates coming back.** A test over the thesis and projection modules fails on any fixed sentence literal intended for founder-facing copy. The bar is defined and documented in the test. The rubric's cross-business repeat check catches templates empirically; this catches them at authoring time.
2. **The baseline gets the operator's human score** (cause vs symptom, strategist vs audit) before anything changes, so the final comparison is against a bar committed to in advance.
3. **The C2+C3 measurement is the real checkpoint**, reported on its own. It answers whether restoring the prompt and the code gates alone recovers the strategist. If it does, C4 gets smaller; if not, we learn that before spending a day on C4.

## Status log
- 2026-10-17: done — evidence (history, diffs), audit, plan written; nothing built / next — operator decides D1–D4, approves C1 / blockers — operator review
- 2026-10-17: done — D1–D4 approved with additions (template test, human-scored baseline, C2+C3 checkpoint); language rule logged as an open product decision / next — C1: fixtures, harness, scorer, baseline / blockers — none
- 2026-10-17: done — C1 built (uncommitted): fixtures exported read-only (7, git-ignored), stage A runner (resumable), stage B renderer, rubric + 8 unit tests, report; baseline = 1 run per business (+ extra bodymove/qufi runs), 3 runs timed out; orphaned worker from the killed first run found and stopped / next — operator scores the human columns / blockers — operator scoring; new finding: Business Snapshot (live) states wrong buying modes for non-service businesses
