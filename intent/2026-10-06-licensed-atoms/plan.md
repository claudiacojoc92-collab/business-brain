# Plan: the language-neutral atom extractor + proof-extraction repairs

Governing intent: [intent.md](./intent.md). Decision is made (operator, 2026-10-06); this plan reflects
it rather than re-opening it. Build nothing until the plan is approved.

## Design

### The extractor (sibling to proof extraction, mirrors its proven shape)

Proof extraction already has the exact safety spine we want, so we copy its structure and strip the
English coupling:

- **Input:** the same ingested fragments proof extraction reads — `links.listFragmentIds(businessId)` →
  `evidence.findByIds(ids)` → projected to readable `SourceUnit`s (website pages via
  `bridgeFragmentsToObservations`, plus declared/poured-in docs). Reuse `toUnits` (lift the shared
  projection into a small helper both services call; no behaviour change to proof).
- **Model proposes, code licenses.** `IAtomExtractionModel.extract({ units })` returns candidates
  `{ atomClass, value, sourceRef }`. `value` MUST be a verbatim span of the cited unit. The model is a
  *proposer only* — it never decides what is licensed.
- **Deterministic licensing = verbatim anchoring** (the single safety mechanism). For each candidate:
  `normalize(unit.text).includes(normalize(value))` or drop it. `normalize` = whitespace-collapse +
  **diacritic-fold for matching only**; the stored/licensed `value` keeps original diacritics. No
  language gate, no about-business regex, no wrap template. This is why it works for RO/IT/EN
  identically.
- **Provenance pointer, stored:** each licensed atom persists `{ atomClass, value, sourceRef,
  sourceUrl, charStart, charEnd, sourceFingerprint, modelId, extractedAt }`. The span offsets are
  computed deterministically from the verbatim match, so "where did this fact come from" is answerable
  from the DB alone (same guarantee proof facts give, V080).
- **Cache by fingerprint** over the bound fragment id set (reuse proof's `fingerprint`), so re-extract
  only when sources change.
- **Closed scope — SHIP four `AtomClass` values, frozen in code:** `service | location |
  contact_booking | people`. The model prompt names exactly these and is told to emit nothing else;
  unknown classes are dropped deterministically. **Deferred** (operator, 2026-10-06; additive later — new
  enum value + prompt line + test, no schema change): `schedule` (hours tables are weak copy, live on a
  subpage) and `price` (a published price is a business decision, not a copy decision, and goes stale —
  BB must not publish a price the owner changed last month). Rationale for shipping these four and not
  two: a landing page needs offer + location + CTA + proof; `service`+`location` give two, `contact_booking`
  is the CTA (no CTA = not a landing page), `people` is the proof section.

### How atoms reach the substrate

One additive block in `carouselContext` (`packages/composition/src/composition-root.ts`, in the
asset-authority region, ~line 544 where `licensedPropositions` is assembled):

```
const atoms = await atomExtractionService.facts(bid);        // provenance-carrying, cached
const atomProps = atoms.map((a, i) => ({ ref: `A${i+1}`, text: a.value, source: 'business_evidence' }));
const licensedPropositions = [ ...businessEvidence, ...atomProps, ...founderCorrections, ...founderProps ];
```

`source: 'business_evidence'` means `specFromSnapshot` / `specFromLandingSnapshot` already treat them
as licensed external facts — no change to the frozen spec projection. Carousel, reel, reel-shoot and
(later) move-draft inherit them with zero per-generator change.

### What we deliberately do NOT do

- No `GovernedUnderstanding` change, no understanding-prompt change (the one working path stays frozen).
- No touching the dead V052/V053 facet pipeline.
- Atoms never license as proof (`behavior_result`); only as `business_evidence`.

## Commit sequence (each reversible on its own)

1. **docs:** the known-issues shipped-feature defect + dead-schema note + this intent/plan. *(done this
   session, uncommitted — lands first.)*
2. **feat(atoms): contracts + closed AtomClass + ports.** `packages/application/src/atoms/contracts.ts`
   (`AtomClass`, `AtomCandidate`, `BusinessAtom`, `IAtomExtractionModel`, `IAtomRepository`,
   `IAtomFragmentSource`). Pure types; reversible by deletion.
3. **refactor(proof): extract the shared fragment→unit projection** (`ProofExtractionService.toUnits` →
   `bi/source-units.ts`, a pure `toSourceUnits(frags)`) used by both proof and atoms. **Correction:** proof
   extraction has **no tests today**, so the refactor can't lean on existing coverage — it ships with a new
   characterization test for `toSourceUnits` (website bridging, supplied material, block/sitemap skip, dedup)
   that protects both callers. The move is mechanical (identical logic); structural typing keeps
   `ProofSourceUnit` unchanged. Reversible.
4. **feat(atoms): the extraction service** — verbatim-anchor licensing, diacritic-fold matching, span
   offsets, fingerprint cache, dedup. Unit tests with inline fragment fixtures (RO + EN) asserting:
   licensed only on verbatim match; diacritics folded for matching but preserved in the value; unknown
   class dropped; span points back to the source. Reversible.
5. **feat(atoms): `AnthropicAtomModel` adapter** (`packages/infrastructure/src/business-intelligence/`)
   — proposer prompt over the six classes, JSON out, temp 0, fail-safe to `[]` (empty, never
   fabricated). Reversible.
6. **feat(atoms): V083 `workspace.business_atom` + `PgAtomRepository`** — mirrors V080 proof_facts
   (provenance columns + fingerprint). New forward migration; reversible by a later drop (never edit).
   **Needs `approve migration`.**
7. **feat(atoms): wire into `carouselContext` + composition root** — the additive block above.
   Reversible (removing the block restores today's substrate).
8. **test(atoms): the Body Move acceptance test** (fixture-based — see below).
9. **fix(proof): de-anglicize `BIZ_REF_RE` + `wrap()` for RO/IT** — *propose the approach first* (see
   open question). Separate, reversible.
10. **fix(proof): numeric sanity bound on checkable proof** — reject non-positive / absurd tenure,
    team_size, service_count, independent of language. **Test case = the live Body Move counter: the exact
    text `Ani de experiență` followed by `0 +` must NOT license a tenure fact.** Separate, reversible, small.
11. **fix(guard): the negated-treatment false-positive** — see "Guard bug" below. Needs an operator
    decision (widening a safety guard), NOT silent. Belongs to the landing-move medical guard
    (`packages/application/src/move-draft/medical-guard.ts`), recorded here because the real site proves it.
12. **verify:** re-run carousel + reel on a real business (output changes once atoms flow) and confirm
    no gate regression; record the before/after.

Commits 9 and 10 are independent of 2–8 and could land first (they repair production now); sequencing
them after keeps one reviewable arc, but either order is fine — operator's call.

## Acceptance test (explicit, runnable)

**The fixture (operator-supplied).** The operator is handing over `bodymovestudio.ro` as a **text file —
the page's VISIBLE TEXT in reading order, not raw HTML.** That is faithful: ingestion stores *text*
fragments (the website connector projects pages to text via `bridgeFragmentsToObservations`, and the
atom extractor reads that text), and verbatim anchoring makes it a valid test either way — an atom is
licensed iff its exact text is a span of the fragment. Committed under
`intent/2026-10-06-licensed-atoms/fixtures/bodymove-home.txt` (+ `bodymove-despre.txt` if supplied). The
build network cannot reach the host, so the committed test runs on the fixture; a live ingest on the
operator's network is the final manual confirmation. **Blocked until the operator confirms the file path.**

**Assert ONLY what the fixture actually contains** (operator-confirmed contents of the homepage):

- **service** (positive, verbatim pointer each): `Clase & Personal Training`, `Kinetoterapie`,
  `Gimnastică Prenatală & Recuperare Postpartum`, `Masaj`.
- **location** (positive, verbatim pointer each): `Strada Decebal nr.110, Cluj-Napoca`; and the second
  address, which is **split across two lines** on the page — `Strada Nicolae Tonitza, nr.2A` +
  `Cartier Bună Ziua, Cluj-Napoca`.
- **contact_booking** (positive): `+40 728 126 481`; `contact@bodymovestudio.ro`; and the booking
  sentence `Programările se realizează online prin aplicația Evo Beauty sau prin contactarea recepției.`
- **people** (NEGATIVE assertion): the homepage holds only the generic `Specialiști cu experiență în
  recuperare, mișcare și wellbeing.` — there is **no atomic staff credential**. Assert the extractor
  **does NOT fabricate a `people` atom** from that generic phrase (a class that invents is worse than a
  class that finds nothing). If the `Despre noi` page fixture is supplied and ingestion reaches it, test
  a real positive there; otherwise **`people` ships untested-positive and this plan says so** — its only
  committed test is the no-fabrication one.
- **Absent, must NOT appear:** session duration (that came from the operator, not the site), prices.

**Multi-line address — anchoring decision (stated, because `fixture.slice(start,end)` must equal the
stored value exactly):** matching is **whitespace-insensitive** (collapse internal runs including
newlines to a single space) **+ diacritic-folded**, used only to LOCATE the span. The **stored `value`
is the exact fixture substring** `fixture.slice(charStart,charEnd)` — so for the split address the value
is the contiguous two-line span *including its newline*, and slice-equality holds by construction. The
model may propose the address comma-joined; the whitespace-insensitive locate still finds it, and we
store the original (newline-preserving) span. The generator reflows for display. So a multi-line fact is
**one atom whose value contains the line break**, not two atoms — unless the two lines are genuinely
separate facts, which for this address they are not.

```
service  ⊇ ['Clase & Personal Training','Kinetoterapie','Gimnastică Prenatală & Recuperare Postpartum','Masaj']
location ⊇ ['Strada Decebal nr.110, Cluj-Napoca', <the two-line Tonitza span, verbatim incl. newline>]
contact_booking ⊇ ['+40 728 126 481','contact@bodymovestudio.ro', <the Evo Beauty booking sentence>]
people: no atom minted from 'Specialiști cu experiență în recuperare, mișcare și wellbeing.'
every positive atom: fixture.slice(charStart,charEnd) === value  (newline preserved where present)
```

## Guard bug found on the real site (reported, NOT silently widened)

Running Body Move's own published RO copy through `detectRegulatedClaims(text,'ro')`:

- ❌ **`Nu tratăm simptome. Ne concentrăm pe cauze, prevenție și rezultate pe termen lung.`** → BLOCKED,
  `class2: therapeutic-effect verb`. The `therapeuticFP` rule matches `tratăm` (trat+ăm) and **ignores
  the negation `Nu`**. This false-positives the client's *legitimate* "we do **not** treat symptoms"
  marketing — a bug that would surface mid-demo on copy the client already publishes.
- ✅ `Specialiști cu experiență în recuperare, mișcare și wellbeing.` — PASS (the `recuperare` noun
  doesn't match `recuper`+verb-ending; the known reversal holds).
- ✅ `să previi apariția unor probleme` — PASS (`previi` is not a matched inflection of `preven-`).
- ✅ service names (`Kinetoterapie`, `Gimnastică Prenatală & Recuperare Postpartum`) and the booking
  sentence — PASS (won't trip the guard when quoted in generated copy).

**Proposed fix (needs operator go — widening a safety guard is a conscious decision):** a tight negation
guard on the therapeutic/outcome verb match — a `nu`/`nu mai`/`fără a` adjacency window immediately
before the verb (mirroring the existing `(?<!se\s)` reflexive lookbehind). It must be **narrow**: only a
directly-negated verb passes; `Nu doar tratăm — vindecăm` still trips on `vindecăm`. I will bring the
exact regex + an expanded must-pass/must-still-block test set (the three phrases above as MUST-PASS, plus
adversarial negations as MUST-BLOCK) **before** implementing, so the widening is reviewed, not silent.
The three phrases become committed MUST-PASS cases in `landing-medical-cases.ro.ts` only once the fix
lands (adding them red now would break the green suite).

## Open question to settle before commit 9 (de-anglicize proof)

I expect the English **reference guard** (`BIZ_REF_RE`, the "is this about THIS business" test) needs
**replacing, not translating** — a bigger RO/IT pronoun/determiner list is brittle and still English in
spirit. Proposed replacement: drop the language-keyed reference regex and lean on the *same* mechanism
the atom extractor uses — the claim is about this business if its anchor is a verbatim span of *this
business's* ingested fragments (which it already must be). The business-name token check stays as a
secondary positive signal. Net: proof's about-business guard becomes provenance-based (language-neutral)
rather than English-lexical. The `wrap()` templates get RO/IT variants keyed off the business/content
language (the same language the generator runs in). **I'll bring this as a concrete proposal with the
diff shape before implementing commit 9**, per your instruction.

## Frozen-slice impact (flagged before starting)

- **No frozen code is edited.** The atom service, adapter, migration, repo, and the `carouselContext`
  block are all in the asset-authority region (above `WALL-END:asset-authority`) or net-new packages.
  Proof extraction is not a frozen slice.
- **But the frozen carousel/reel generators change behaviour** — they will suddenly receive real
  licensed facts and produce different (richer) copy. That is the point, and it is safety-neutral (more
  *licensed* facts can only make more copy licensable; they never bypass a gate). Still, it is a change
  to shipped, frozen features via their inputs, so commit 11 **re-verifies carousel + reel on a real
  business** and records before/after. No `approve frozen` is needed (no frozen file is touched), but
  the re-verification is non-optional.

## Sizing (honest, in work-sessions)

- Commit 1 (docs): done.
- Commits 2–4 (contracts + shared projection + service + unit tests): **~1.5 sessions.**
- Commit 5 (model adapter + prompt iteration): **~1 session** (prompt tuning for clean six-class output).
- Commit 6 (V083 + repo): **~0.5 session.**
- Commit 7 (wiring): **~0.5 session.**
- Commit 8 (acceptance fixture test): **~0.5 session** once the fixture exists.
- Commits 9–10 (proof repairs): **~1.5 sessions** (9 needs the proposal round; 10 is small).
- Commit 11 (carousel/reel re-verification, live): **~0.5–1 session.**

**Total ≈ 6–7 work-sessions.** This is a real build, not a patch.

**Does it fit before Canggu?** If the window is tight, cut scope deliberately rather than late:
- **Minimum viable substrate fix (~3 sessions):** atom classes `service` + `location` only (the two the
  acceptance test names, and the highest-value facts), commits 2–8 restricted to those, plus the two
  proof repairs (9–10). Defer `schedule / contact_booking / people / price` to a follow-up — the
  extractor is closed-scope but adding a class later is additive (new enum value + prompt line + test),
  no schema change.
- The proof repairs (9–10) should ship regardless of the atom scope — they fix live content now and are
  cheap.

## Where move-draft wiring lands

**After** this intent. The move-draft wiring's acceptance test is "produces a publishable draft on Body
Move's real facts," and that cannot pass until atoms exist (Run B proved it: a starved substrate →
positioning overreach → kernel block). Sequence: this intent (atoms + proof repairs) → re-verify
carousel/reel → **then** resume `intent/2026-10-05-landing-move` wiring (compose-root, routes, the
draft-on-surface job, the Today UI), now with a substrate that can pass its acceptance test. The
parroting known-issue is addressed as part of that wiring, not here.

## Open questions raised by the live landing run (2026-10-06) — recorded, not solved

1. **The licensing asymmetry (Decision 1, proposal in flight).** The atom lane is verbatim-anchored; the
   understanding lane is LLM synthesis treated as equally licensing. The real Body Move run proved the cost: the
   33 synthesized "facts" include exact prices (PT 150 lei/ședință; abonament 8=800/12=1000), class caps
   (max. 4), a cancellation policy (min. 8h), an online shop + vouchers, and `karate` (a service the atoms never
   saw) — all currently able to license public copy. The draft asserted "Prețurile sunt afișate transparent…
   magazinul nostru online" on that basis. **Fix the asymmetry, not the sentence.** Proposed design: tier the
   substrate by provenance (`anchored` | `synthesized` | `founder_owned`) and gate by CLAIM TYPE — a synthesized
   proposition may back a GENERAL statement (positioning/audience/approach) but NOT a SPECIFIC CHECKABLE one
   (prices/pricing practice, counts, facilities, channels, availability, credentials). Preferred enforcement:
   assembly-time (carouselContext) — withhold specific-checkable synthesized facts from the licensed set so the
   generator never sees them and the frozen kernel's concept-grounding blocks any it invents (NON-frozen; the
   in-kernel alternative would need approve frozen). See the chat proposal for the enforcement point + the
   concrete Body Move loss (price + shop sentences + unanchored extras drop; the 4 service atoms, 2 locations, 13
   people, booking survive — NOT a section collapse).
2. **Generator↔licensed divergence (Decision 2, queued).** The generator wrote `Borșan` where the atom holds the
   site's `Borsan` — and the generator is right (the site dropped the diacritics). Neither constrain nor allow:
   SURFACE the divergence to the founder ("we wrote Borșan; your site says Borsan — which is right?"); the answer
   becomes a `founder_owned` fact that supersedes the site permanently. Turns the bug into the accumulation
   mechanism. Propose the divergence-detection rule (what's worth asking vs ordinary rewording) before building.
3. **Move-draft production wiring (Decision 3, queued).** Context provider + strategy conditioning + adopted-
   strategy gate.
4. **STRATEGY FINDING — recorded, not for engineering today.** Body Move has **17 strategy versions, every one
   `proposal`/`insufficient`, none adopted**; the one live direction is **B2B medical referral**, not a consumer
   landing. So the draft we produced answers a question nobody asked. Two open questions follow:
   (a) a demo must show BB producing the move its OWN (adopted) strategy calls for, not a generic one;
   (b) **17 strategies produced and none adopted is a PRODUCT problem, not an engineering one — and may be the
   most important thing in this report.** Flagged for the product owner, not the build queue.

## Reach correction, the full-page result, and the price reason (2026-10-06)

- **ATOM-LANE REACH — record corrected.** The atom lane reads EVERY ingested page in production
  (`carouselContext` → `atomExtractionService.facts(bid)` → `PgEvidenceRepository.findByIds(all bound ids)` →
  `toSourceUnits`). The earlier live runs used a TWO-page fixture (home + despre) and under-counted the lane's
  reach — that was a fixture artifact, not the lane's behaviour.
- **FULL-PAGE RUN (all 4 ingested content pages): 27 atoms, 0 dropped, spans exact.** service **11**
  (+7 re-anchored from the `/servicii/*` pages: Pilates, Functional Training, Aerial Yoga, Balet Adulți,
  Balet & Dans Copii, Group Training, Personal Training — the exact set the understanding lane had emitted as
  synthesized prose), location 2, contact_booking 1, people 13. **Re-anchoring recovers the laundered services
  with provenance** — they were about to be discarded as synthesized.
- **SHRUNK CLASSIFIER SCOPE (Decision 1).** After full-page re-anchoring, the synthesized-only residue the
  claim-type classifier must withhold is small: general positioning/audience prose (kept), deferred-class
  **prices** (withheld), **policy** facts until that class ships, and `karate`. The classifier is a backstop over
  a mostly-re-anchored lane, not a salvage mechanism.
- **`karate` SUB-FINDING: the understanding model treats URL STRUCTURE as evidence.** `karate` appears NOWHERE in
  page body text — only as a sitemap URL (`/lista-preturi-karate-copii/`). The understanding lane derived a
  service claim from the sitemap. Not wrong (the page exists), but **not anchorable** (no body text), and it
  explains a whole category of synthesized-only facts that re-anchoring can never recover. Recorded, not solved.
- **`price` STAYS DEFERRED — corrected reason.** NOT staleness (their prices are published by them, as anchorable
  as a service name). The real reason: **the generator must not volunteer prices into a landing page on its own
  initiative — that is the owner's decision, not the copy's.** Long-term shape is "licensed but not volunteered"
  (BB knows the price, uses it only when asked); that machinery doesn't exist yet, so `price` stays deferred and
  fail-closed withholding handles it meanwhile. Do not re-litigate from the weak staleness argument.
- **PRODUCTION-PATH CHECK (the snake/camel silent-zero).** Traced: `findByIds` → `toDomain` maps `source_url →
  sourceUrl` + parses `payload`, so production feeds camelCase fragments end-to-end — NOT vulnerable. The
  mismatch was harness-only (raw export JSON bypassing `toDomain`). But the symptom (0 units / 0 atoms / 0 error)
  is a silent total failure of the same shape as the English-regex drop, so `toSourceUnits` now FAILS LOUDLY:
  non-empty fragments → empty projection logs at error with the keys it actually saw. Shipped with the policy class.

## Generator-utilization findings (2026-10-06) — routing, variance, fidelity

- **VARIANCE IS A FINDING IN ITS OWN RIGHT.** The discriminator run proved it: identical 63-proposition
  substrate, one run NAMED all 13 people, the next wrote a vague paragraph. For a product handing drafts to
  paying customers that is a **quality-floor** problem — two clients with the same data get different quality,
  and a demo becomes a coin flip. Section routing is partly a fix for it (a section handed 13 people and told to
  name them drifts far less than one handed 63 facts and told to write "proof"); the LLM's run-to-run
  non-determinism under a flat bag is the mechanism.
- **Section routing + how_it_works WORKED on completeness** (3× acceptance, identical substrate): all three runs
  listed all 10 services, populated how_it_works with all 4 policy rules, and listed 13 people. The coin-flip on
  completeness is gone.
- **But the 3× run exposed NAME CORRUPTION** (now guarded): the generator wrote `Florin Lazăr` (for `Florin
  Laza`) in all three and `Carmen Mureșan` (for `Carmen Constantinescu`, borrowing the adjacent surname) in two.
  Deterministic people-fidelity guard added (diacritic-folding boundary, `people` only, blocks after repair).
- **THE PRICE/SHOP SENTENCE DISAPPEARING IN ALL THREE RUNS IS LUCK, NOT A GATE.** Routing happened to send the
  synthesized price fact to the `general` bucket, which feeds hero/subhead/who — sections that didn't reach for
  it. The fact is STILL in the licensed set and could resurface. **Three clean runs are NOT evidence the
  licensing asymmetry is fixed.** The Decision-1 claim-type classifier is still owed; until it lands, the price
  sentence is suppressed by luck, not prevented.
- **Divergence is MEASURED, not blocked, for the non-people classes** (`measureDivergence`): data for a later
  decision about constraining a class — RO inflection means services/policy diverge from verbatim by design, so
  we do not constrain on it today.

## The Decision-1 classifier is DEFERRED, DELIBERATELY, AND OWED (2026-10-06)

The claim-type classifier (tier synthesized facts by provenance; a synthesized specific may not back a
checkable assertion) is **deferred, deliberately, and recorded as owed.** Reason: with 20 days to Canggu the
piece with no substitute is the WIRING (route, job, screen), not the classifier — everything built today lives
in harness scripts, so if it had to be shown tomorrow there would be nothing to show. The price sentence is
absent today because section routing keeps synthesized facts in the bucket feeding hero/subhead/who, and those
sections don't enumerate specifics — which is more structural than "luck", but still **not a guarantee.** The
live hole the classifier closes: a different business whose synthesized specific lands INSIDE a positioning
sentence. Real hole — but not the one that leaves us with nothing to demonstrate. Build order: wiring first,
classifier owed next.

## Finding: BB produced an adoptable strategy and the founder never adopted it (2026-10-06)

Body Move: 16 of 17 strategy versions were correctly refused (`inputs_sufficient: false — "No founder goal
captured yet"`), and **v17 is a COMPLETE, adoptable Proposal — all 22 gates pass** — sitting at status
`proposal`, never adopted. `getCurrent` returns null only because the adoption pointer was never set. So the
system worked; **the adoption click never came.** If the adoption step were visible and convincing on the
surface, she would have clicked it — so the surface either doesn't show it or doesn't sell it. This belongs
next to the onboarding / working-boundary question already open: **same class of problem — a produced thing
the founder can't see or act on.** Decision for the demo: adopt v17 through the product (founder action, not an
operator edit); the resulting landing serves the B2B-medical strategy, which is the stronger "system with
judgment" story. `adopt(businessId, versionId, founderId)` (status must be `proposal`) sets the pointer; one
founder action unblocks the whole move. NOT a re-strategizing effort.

## PRE-DEPLOY NOTE (for when the deploy comes — state plainly, do not imply it's been exercised)

- **V082 (`workspace.move_draft`) AND V083 (`workspace.business_atom`) both need the migrate step** before the
  move-draft / atom paths work in a live environment.
- **The end-to-end path has NEVER run against a live database.** Only the provider LOGIC (unit tests) and the
  COMPILED wiring are proven; the live DB → carouselContext → atoms → generator → gate → persisted MoveDraft
  chain has not executed. The 3× acceptance + landing runs used harness scripts over the export data, not the
  deployed stack. Say so in the pre-deploy report rather than implying it has been exercised.

## Status log

- 2026-10-06: Plan written from the operator's decision (separate language-neutral atom extractor;
  verbatim anchoring as the sole safety mechanism; closed classes; do-not-extend-GovernedUnderstanding;
  two proof repairs alongside). Shipped-feature defect + dead-schema recorded in known-issues.md.
- 2026-10-06: **Plan APPROVED; scope locked to FOUR classes** (`service | location | contact_booking |
  people`; `schedule`/`price` deferred additively — operator's reasons recorded in Design). Acceptance test
  rewritten to the operator's confirmed fixture contents (4 services, 2 addresses incl. a two-line one,
  contact + booking sentence; `people` = no-fabrication from a generic phrase; session-duration/prices
  absent). Multi-line-address anchoring decided (whitespace-insensitive locate → store the exact
  newline-preserving span). Fixture = page visible text in reading order (faithful; text fragments +
  verbatim anchor), operator supplying `fixtures/bodymove-home.txt` — **acceptance test (commit 8) blocked
  on that path.**
- 2026-10-06: **Guard bug CONFIRMED on real client copy** (measurement): `Nu tratăm simptome…` false-positives
  (negation ignored). Reported, not widened — fix is commit 11, operator decision pending. Two other must-pass
  phrases + service names + booking line all PASS. Numeric-bound (commit 10) has its real case: `Ani de
  experiență 0 +`.
- 2026-10-06: Building from commit 2 (contracts + ports). de-anglicize approach (commit 9) comes as its own
  proposal before implementation.
- 2026-10-06: **Commits 4–7 landed + the acceptance reorder paid off.** service (`01be462`), AnthropicAtomModel
  (`5baa5de`), V083 + PgAtomRepository (`4c38355`), fixtures + acceptance test (`31193b8`). Fixture derived from
  the BB production export — PUBLIC page text only (website fragments; strategy/conversation/understanding tables
  cleanly excluded). First LIVE run (before wiring, per operator): proposed=20 but licensed=0 — a sourceRef
  round-trip bug (the prompt header rendered "Homepage (home)" and the model copied it; unit ref was "Homepage").
  Recall was already strong (20/20 anchor). FIXED in two commits: `8ea4d93` (unambiguous sourceRef header) +
  `9ad6132` (LENIENT ref resolution — resolve only to exactly one normalized unit, else drop as dropped_unit,
  never a blind any-unit guess; + EXACT-CASE anchoring preference so "Kinetoterapie"/"Masaj" store with capitals,
  verbatim-equals-source). Re-run: **proposed=20 licensed=20 dropped=0**; 4 services, 2 studios-by-name, the Evo
  Beauty booking line, 13 named people-with-roles; no-fabrication clean (nothing minted from "Echipa … formată
  din specialiști"); spans exact. **Usability verdict: a landing page can be written from this** (offer / where /
  CTA / proof). Atom suite 12/12. RECORDED in known-issues.md (not fixed): the INGESTION GAP — addresses/phone/
  email are on the live site but were never ingested (crawl missed the footer / "Vezi locația"), upstream of this
  feature, its own piece of work. NOT wired into carouselContext yet (operator gate). Remaining: de-anglicize
  proof proposal (diff-shape first), numeric-bound repair, then the wiring.
- 2026-10-06: **Commit 3 LANDED** (`2376078`, shared projection, characterization-first). Guard work done +
  verified (pending `approve commit` to land — the grant is one-commit-per-approval):
  - **CLASS-NUMBER INVERSION (record so the next reader does not repeat it):** in CODE the therapeutic rule
    (treat/cure/reduce a condition) is `blockedClass 2`, and the OUTCOME rules are `blockedClass 1` — the INVERSE
    of the prose shorthand ("class 1 = treating a condition"). The negation exemption anchors on the **rule**
    (therapeutic), NOT the number. Aligning to the prose number would have put the exemption on the outcome rule
    — the one case where negation manufactures the claim. Noted in-code at the exemption too.
  - **Commit A (participle coverage + therapeutic negation exemption):** stem extended to `-ată/-ate` so the
    passive "boala este tratată" is caught (was a gap); then a PER-OCCURRENCE negation exemption on the
    therapeutic rule only (never outcome/stat/prevention). Coverage first, then the exemption. Fixes the
    confirmed FP on the client's "Nu tratăm simptome…" while keeping "Nu tratăm simptome, tratăm cauza" and
    "Nu tratăm — vindecăm" BLOCKED. EN exemption deferred (its match anchors on "we", not the verb) — recorded.
  - **Commit B (negated symptom persistence):** a new CLOSED outcome family (`blockedClass 1`) — "nu (vei/te/o)
    mai … <persist-verb> … <symptom>" / pain-verb. Blocks the category's most common illegal claim ("Nu vei mai
    avea dureri"), which passed before this work; the four administrative boundary lines ("Nu mai primim
    programări", etc.) PASS. Separate rule, separate commit, separate decision.
  - Guard suite 82/82 (was 59): +13 (commit A) +10 (commit B). tsc 0, no regression.
  - **B1/B2/B3 decision = ADD COVERAGE** (done, commit B) — not the judge: the kernel is the deterministic floor
    and the gravest claim must not depend on a model's mood or a demo retry.
  - Still pending: land A+B, then atom commits 4 (service+tests) / 5 (adapter) / 6 (V083 migration), and the
    fixture derivation from the BB exports (public page text ONLY).
