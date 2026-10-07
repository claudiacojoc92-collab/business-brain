# Plan: the move arrives written — landing page

- **Intent:** ./intent.md
- **Approved by:** Claudia on 2026-10-05

## Approach

A `leadsToCreate` move that calls for the landing page arrives with its copy **already drafted**,
produced by a new structured-prose generator and routed through the frozen Slice-4 proposition
kernel plus a **new medical/regulated-claim gate**, fail-closed. The draft is a first-class
artifact stored beside the immutable move (its own table, with an immutable authorization snapshot
+ safety trace), drafted lazily and async when the move first surfaces — not eagerly for every
create-move at adoption. It is built as the first `kind` of a general `MoveDraft` shape so the
message and carousel moves reuse the same spine rather than re-solving it.

Why not the cheap paths: generalising the Email model gives an email-shaped blob with prompt-only
safety (the ungated anti-pattern); eager-at-adoption runs N safety-critical generations most
founders never see. A structured generator + lazy async + a real gate is the version that is both
a better page and auditable.

## The generator (design §1)

New prose generator, **not** a generalised Email model. Produces a typed multi-section
`LandingDraft` (hero headline + subhead, what-it-is, who-it's-for, proof/credibility, one CTA;
each section a prose block + a role), in the founder's language. Same grounding inputs the Email
model proves work (strategy bet, audience, voice working-set, licensed propositions, proof facts)
but structured — and the per-section structure is exactly what lets the gate attribute a violation
to a section (the carousel's per-slide / whole-asset split). The Email model falls short on form
(flat ~1200-char body, no sections) and on auditability (nothing to attribute to); it is the
anti-pattern for safety, not the template.

## The claim-safety & voice gate (design §2 — the long pole)

**Reused as-is (frozen hard core, do NOT rebuild):**
- `validateAgainstAuthorization` kernel — `packages/application/src/voice/proposition-safety.ts`
  (Layer 1 deterministic proposition classes, Layer 2 discourse exemptions, Layer 3 N=3 union-fail
  judge). Operates on free-text `SampleContent {hook?, beats?[], caption?, cta?}`, not slide shapes.
- `AuthorizedMessageSpec` + `LicensedProposition` allowlist; the proof substrate (`ProofFact`
  true-by-construction, `UnsourcedClaim` never licensed, provenance).
- Deterministic backstop `classifyVoiceSample` / `auditAssertions` — CTA survival, parroting,
  numeric discipline (every number token must match the licensed factual blob), outcome/market/causal typing.
- The realize→check→repair→fail-closed loop shape (`generateWithWorkingSet`).

**Built new:**
1. **Medical/regulated-claim guard — the long pole.** No positive medical detection exists today;
   `REEL_FORBIDDEN_CLASSES` is inert (never read by the kernel — recorded as a present risk in
   known-issues). The allowlist only blocks *unlicensed* claims; a medical surface must also catch
   *licensed-sounding-but-regulated* phrasing (treats / cures / heals / "gets you back to…" /
   recovery-rate figures) and attach disclaimer requirements. A new deterministic classifier
   (vocabulary + patterns, like the MARKET/CAUSAL/OUTCOME regexes) **plus** a judge pass, wired as
   an actually-consulted fail-closed gate, in **RO + EN + IT** (the per-language vocabulary is most
   of the cost). This guard lives in the shared spine so every future `kind` inherits it.
2. `LandingAuthorizationSnapshot` + a `specFromSnapshot`-style adapter (~carousel-sized) and the
   prose→`SampleContent` mapping with per-section + whole-page attribution.
3. A `MoveDraftService` orchestration: realize→gate→repair→fail-closed (NOT the ungated email path).

**Fail-closed stance:** if safe copy can't be produced, the move arrives as today's plain
instruction, never unsafe copy.

## Regulated-claim guard — definition (Day 2)

> **This is a PRODUCT rule, not legal advice.** Before this reaches real clinics, Romanian and EU rules on
> advertising health services must be checked by someone qualified — neither Claudia nor Claude knows them.
> The rule below is how BB decides what to write; it is not a claim about what the law permits.

**Why it exists — the first line of the definition.** The Layer-3 judge is an **allowlist checker**: it asks
*"did BB invent this?"* — anything in the authorized set passes. So a regulated claim sitting in the
business's **own** material (e.g. "we cure back pain" in their notes) would be *licensed* and waved through.
The deterministic guard's **irreplaceable job is catching regulated claim classes regardless of license
status.** That is the reason it exists; the judge cannot do it, because the judge is defined to permit
whatever is licensed.

### Judge baseline (live, N=3, measured 2026-10-05 before building — the design rests on this)

| Case | Judge verdict | Passes |
|---|---|---|
| "We get you back to running after an injury and speed up your recovery." | **FLAGGED** — new outcome / causal claim | 3/3 |
| "We treat herniated discs." | **FLAGGED** — clinical scope of practice not in the authorized set | 3/3 |
| "A 50-minute physiotherapy session with a licensed therapist." (grounded/licensed) | **CLEAN** | 3/3 |

The judge already catches **unlicensed** medical/clinical claims, consistently, and passes a grounded factual
service description. So the deterministic guard is a **second line** for those — and the **first and only
line** for the licensed-but-regulated case above. It is also the non-stochastic floor (the judge is a model).

### The line

NOT "mentions health." A recovery studio's copy must talk about bodies, injuries and recovery or it says
nothing. The blocked set is three classes:
1. **Promising a health outcome** — stating or implying what will happen to the reader's body/health.
2. **Claiming a therapeutic effect** — that the service treats, heals, corrects, cures or relieves a condition.
3. **Implying clinical competence beyond stated credentials** — a scope of practice / specialty not backed by
   a credential the business actually holds and has stated.

### The axis that decides the hard cases

**Describing what you DO (pass) vs promising what WILL HAPPEN (fail).** The same subject matter — bodies,
injury, recovery — is fine as the thing you work *on*; it fails the moment it becomes a promise about an
outcome or an assertion of therapeutic/clinical effect.

### Worked examples

**BLOCKED (fail — regardless of whether the business's own material contains them):**
- "We get you back to running after an injury." — promises a health outcome.
- "Speeds up your recovery." — therapeutic effect / causal outcome.
- "We treat herniated discs." — clinical scope of practice.
- "Heal your back pain." / "corrects your posture." — therapeutic effect.
- "90% of our clients return to sport." — outcome claim (and an unsourced number).

**ALLOWED (pass):**
- "A 50-minute session with a licensed therapist." — a service + a credential actually held.
- "We work with people recovering from injury." — who you serve (subject matter, not a promise).
- "Movement, guided one-on-one, at your own pace." — what you do.
- "Our instructor is a licensed physiotherapist." — clinical competence AS STATED (not beyond).
- "Tell us where your body is and we'll build the sessions around it." — the approach, promising no outcome.

### Naming a condition vs claiming to treat it (the verb-and-frame rule)

Naming a condition or clinical context is the normal language of this market — a clinic that can't say what it
works on is invisible to the people searching for it. So the mention of a condition never decides it; **the
verb and the frame do.**
- **Description (PASS)** — "[service/modality] **for / in the context of** [condition]": names what you do and
  who it is for, with no verb asserting an effect on the condition and no promised outcome.
- **Claim (FAIL)** — a treatment/clinical verb asserting an effect ON the condition, or a promised outcome.

The four real Romanian cases this rule was built on:

| RO | gloss | verdict | why |
|---|---|---|---|
| Te ajutăm să revii la alergat | we help you return to running | **FAIL** | an outcome promise; "we help" is a softener, not a change in kind |
| Mulți clienți revin la sport în 6-8 săptămâni | many clients return to sport in 6–8 weeks | **FAIL** | a claim about THIS clinic's client results; "many" doesn't rescue it; distinct from the sourced general-information hard middle below |
| Terapie manuală pentru dureri lombare | manual therapy for lower-back pain | **PASS** | *pentru* = offered-for; names modality + who it is for; no treatment verb |
| Recuperare post-operatorie | post-operative recovery | **PASS** | a service-category label naming a context, not an effect |

Two conditions on every PASS: (i) the service named must be a **licensed fact** (the studio actually offers
it), and (ii) it must not expand into an effect or outcome — "recuperare post-operatorie" passes as a label,
but "**te recuperăm** după operație" (*we rehabilitate you after surgery*) fails on the verb.

**Specificity does NOT decide it.** "Terapie pentru hernie de disc" (*therapy for a herniated disc*) **PASSES** —
someone with that diagnosis is searching for exactly those words, and blocking it makes the clinic invisible to
the people it serves. Only the verb distinguishes it from "**tratăm** herniile de disc" (*we treat herniated
discs*), which fails. Rewarding vague language over specific would be worse for patients, not safer.

**NAMED GAP — a known limitation of the deterministic layer, NOT a rule to implement.** Structure can promise
relief with no treatment verb at all: *"Dureri lombare? Terapie manuală, 50 de minute."* (*Lower-back pain?
Manual therapy, 50 minutes.*) — the question-then-service structure implies "this fixes that," yet there is no
verb to key on. A verb-keyed deterministic classifier **passes** this, and we do **not** try to catch it with
patterns (that way lies blocking every service-for-condition line). It is covered only by the stochastic
Layer-3 judge. Recorded here so that in three months no one assumes the deterministic layer handles it — by
design, it does not.

### Nominalizations are left to the judge (point 3, recorded)

A nominalization of a blocked verb — "tratamentul afecțiunilor coloanei", "reducerea durerii", "creșterea
mobilității", "restabilirea echilibrului" — is NOT blocked by the deterministic layer, deliberately. Under our
own rule "tratamentul afecțiunilor coloanei" is the nominal form of *service-for-condition*, which PASSES;
blocking it would contradict the definition and make the product invisible to its market. The deterministic
guard therefore matches verb inflections (infinitive/finite/subjunctive) but not the noun-forming suffixes
(-ament, -are, -ere). The marginal nominal claim is the judge's to catch.

### The hard middle — sourced vs unsourced

- "Recovery typically takes 6–8 weeks." **WITH a credible source** (a ProofFact carrying provenance — a
  clinical guideline, not the studio's own assertion), phrased as **general information** (not "*your*
  recovery will take 6–8 weeks") → **PASS.** A sourced factual statement, not a promise about this reader.
- The **same sentence UNSOURCED** → **FAIL.** An unsupported medical timeframe presented as fact. The proof
  substrate (ProofFact + provenance) is exactly what separates the two; without the source there is no
  license and it is a regulated claim.

### Disclaimers are not a laundering mechanism

A disclaimer may only accompany a statement that **already passes** (e.g. the sourced timeframe, as general
info). A disclaimer **never rescues a blocked claim.** "Results may vary" under "we heal your back pain" is
*worse* than blocking it — it looks considered. Disposition is strict and fail-closed: a blocked claim is
removed and the section regenerated; if the page cannot be produced without it, the move degrades to the
plain instruction. A blocked claim is never disclaimed into acceptance.

### Language coverage & verification (hard rule)

The guard covers **RO, EN and IT from the start** — the generator must never be able to emit a language the
guard doesn't cover, or that language ships ungated. Generation is enabled per language not by capability but
by **verification**: a language is enabled only once a speaker of it has reviewed its guard vocabulary.
- **Romanian** — Claudia reviews it herself.
- **English** — stands.
- **Italian** — **disabled for generation** until a native speaker reads its guard vocabulary. The disabling
  is a **config fact with a comment stating why**, never a TODO.

### False-positive cost (the design problem)

A guard too eager fails closed on everything, and a founder who never gets a page has a broken product, not a
safe one. The test set is built with **as many should-pass cases as should-fail**, drawn from real
recovery-clinic language, and the describe-vs-promise axis is the discriminator. Build + run that balanced set
before wiring the guard into generation.

## Storage & timing (design §3)

- **New table `plan_move_draft`** (one migration, `approve migration`), keyed by `actionId` +
  `planVersionId` + `businessId`: the structured draft, the immutable `LandingAuthorizationSnapshot`,
  the `SafetyDecision` trace, a `status` (drafted|edited|accepted), language, append-only versions.
  Not the handoff payload — the draft has its own lifecycle and the safety snapshot must be stored
  immutably for audit replay, exactly as `AssetAuthorizationSnapshot` is per carousel.
- **Lazy + async, triggered when the create-move first enters Today's ready set**, on the reel
  BullMQ precedent (enqueue → persist stages → poll). Usually done by the time the founder opens
  Today; if not, the "writing your landing page…" in-progress state shows and it lands moments later.
  Not eager-at-adoption; not drafted-on-open.

## The Today surface (design §4)

The move block (`apps/web/src/slice0/TodayPage.tsx:272-316`) shows, instead of the instruction +
"becomes an asset": *"Your landing page — a first version is written,"* with the structured draft
rendered by section (reuse the carousel Preview pattern for text). The founder edits any section
inline (their words — not re-gated — and fed into the voice working-set's before→after `edits` so
voice improves per business); a per-section "rewrite this" re-runs the gated generator for that
section. Accept marks the draft `accepted`, records it as the move's produced artifact, advances
the move's outcome, and exposes the copy to copy-out/export. Fail-closed shows the plain
instruction with an honest line, Talk-to-BB intact. EN/RO/IT strings.

## Reusable shape beyond the landing page (design §5)

`MoveDraft` = typed draft + authorization snapshot + safety trace + status, keyed by `actionId`,
with a `kind`. `landing` first; `message` next (which finally routes the ungated Email model
through the same kernel); `carousel`/`reel` delegate to the existing frozen asset path via the
handoff. Shared spine built once: authorization-snapshot builder, kernel + backstop + **medical
guard**, repair/fail-closed orchestration, `plan_move_draft` storage + status lifecycle, the Today
draft surface. Only the per-kind generator (prompt + output shape) and its prose→`SampleContent`
mapping are new each time.

## Files to change

| File | Change |
|---|---|
| `packages/application/src/voice/contracts.ts` | **FROZEN** — extend `SampleChannel` with `'landing'` (`approve frozen`) |
| `packages/infrastructure` voice repository + a migration | **FROZEN-adjacent** — persist the new channel (`approve frozen` + `approve migration`) |
| `packages/application/src/move-draft/` (new) | `MoveDraftService`, `MoveDraft`/`LandingDraft` types, `LandingAuthorizationSnapshot`, prose→`SampleContent` mapping |
| `packages/application/src/.../medical-safety.ts` (new) | the deterministic medical/regulated-claim guard + judge pass, RO/EN/IT |
| `packages/infrastructure/src/business-intelligence/anthropic-landing.model.ts` (new) | the landing prose generator adapter + prompt |
| `database/migrations/V0xx__create_move_draft.sql` (new) | `plan_move_draft` table (`approve migration`) |
| `packages/infrastructure/.../pg-move-draft.repository.ts` (new) | repo |
| `apps/workers/src/move-draft/` (new) | BullMQ draft-on-surface job (reel pattern) |
| `apps/api/src/routes/move-draft.routes.ts` (new) | get draft / rewrite section / accept |
| `apps/web/src/slice0/TodayPage.tsx` + new draft components | render / edit / rewrite / accept + fail-closed state |
| `apps/web/src/i18n/messages.ts` | EN/RO/IT strings |

## Tests / verification

- Unit: the medical guard (adversarial — regulated claims must fail), the kernel against landing prose, the snapshot adapter.
- Types: `npx tsc -b`; Lint: web `--max-warnings 0`.
- Live: Body Move (real medical business, RO) — surfaced landing move shows a gated multi-section
  draft; adversarial regulated-claim attempt fails closed; edit + accept + export; fail-closed path shown.

## Risks

- **Frozen Slice-4 touched** (`SampleChannel` enum + voice repo) — `approve frozen`, scoped to the additive channel.
- **New migration** — `approve migration`.
- **Medical safety** is the correctness-critical piece; an adversarial gate pass on real RO copy is a release gate, not a nicety.
- Rollback: fail-closed degrades to today's plain instruction; the feature is additive (new tables/services), so disabling the draft-on-surface job restores current behaviour.

## Status log

- 2026-10-05: design approved by Claudia. Channel = extend `SampleChannel` (not reuse `'caption'`).
  Honest estimate ~1.5 weeks; the medical guard (RO/EN/IT) is the long pole. One-week cut, if forced:
  Romanian-only + landing-only, storage/gate still shaped for reuse.
- 2026-10-05: **proof-first (riskiest assumption settled).** Ran the real frozen kernel + backstop against
  hand-fed landing prose (scratchpad harness): clean copy passes; an unlicensed numeric is caught by the
  backstop (`fabricated_claim`); parroting is caught; the **medical outcome "get you back to running" passes
  everything deterministic** — confirming no positive medical detection exists (auditAssertions has no medical
  vocab; `predictsUnlicensedOutcome` is a closed business-outcome list). Kernel is usable as-is on prose; a
  found nuance (CTA-survival is channel-shaped — caption expects the CTA in the caption field, carousel/reel
  use a separate `cta`) reinforces adding a real `'landing'` channel with carousel-like CTA semantics.
- 2026-10-05: **Day 1 built.** `packages/application/src/move-draft/` (contracts: MoveDraft / LandingDraft /
  LandingAuthorizationSnapshot / IMoveDraftRepository; landing-safety: `specFromLandingSnapshot` +
  `landingDraftToSampleContent` + `landingSectionToSampleContent`); migration **V082** `workspace.move_draft`
  (applied locally, verified: columns + PK + action index + FK to businesses); `PgMoveDraftRepository`.
  tsc -b clean; 6 new unit tests (incl. a mapped-clean-draft → kernel-clean wiring proof); full suite
  1695 green. NOT the generator/gate/worker/routes/UI yet.
- **Day 2 note (do NOT lose):** before writing the medical classifier, run case C ("get you back to running")
  through the **live Layer-3 N=3 judge** and report what it does. If the judge already catches it, the
  deterministic guard is a second line and can be tighter; if not, the guard carries it alone. Either way the
  guard is built (a regulated-claim surface can't rest on a stochastic judge) — the result only shapes coverage.
- 2026-10-05: **Day 2 baseline taken + definition written (awaiting review).** Live N=3 judge FLAGGED both the
  recovery-outcome and clinical cases 3/3 and passed the grounded service description 3/3 (table above). So the
  deterministic guard is a second line for unlicensed claims and the ONLY line for the licensed-but-regulated
  case. The regulated-claim definition is written into this doc (three blocked classes, describe-vs-promise
  axis, worked examples both sides, sourced-vs-unsourced hard middle, strict no-laundering disclaimer stance,
  RO/EN/IT coverage with per-language verification: RO Claudia, EN stands, IT config-disabled-with-reason).
- 2026-10-05: **definition finalized + approved by Claudia.** Verb-and-frame is the boundary; c/d (service-for-
  condition) PASS; specificity does NOT decide it ("terapie pentru hernie de disc" passes, "tratăm herniile de
  disc" fails — verb only); the "Dureri lombare? …" juxtaposition recorded as a NAMED GAP covered only by the
  judge; legal-scope note added (product rule, not legal advice — RO/EU health-ad rules need a qualified check).
  Next: build the RO test set (service-for-condition dominated), **show it to Claudia before the classifier is
  written.** Classifier still NOT coded.
- 2026-10-05: **RO test set reviewed + enriched + committed** (`landing-medical-cases.ro.ts`, 18 pass / 26 fail):
  full first-person verb set, prevention claims, SECOND-person outcome constructions (the structural
  requirement — the classifier must catch the construction, not a we-verb list), paired same-truth fail/pass
  lines, and the named deterministic gap.
- 2026-10-05: **medical guard BUILT + green against the spec.** `medical-guard.ts` — `detectRegulatedClaims`
  keyed on constructions (first-person therapeutic verbs / second-person outcome / prevention / statistics-
  guarantee / clinical-authority), diacritic-folded (robust to RO typed without diacritics), RO + EN vocab;
  **Italian config-DISABLED** (`GUARD_ENABLED_LANGUAGES`, with a reason comment, not a TODO) and **fail-closed**
  on any unenabled language. 46 tests green: all 18 pass cases pass (no false positives), all 25 non-gap fails
  caught, the gap passes deterministically (judge-only), Italian fails closed. tsc -b clean; full suite 1741.
  Next: wire the guard into the generate→gate→repair→fail-closed orchestration + the landing prose generator.
- 2026-10-05: **OUT-OF-SAMPLE RUN 1 (raw, PRE-FIX — recorded before any change).** 46/46 in-sample was hollow
  (we wrote both the spec and the classifier). Ran the guard unchanged over **42 verbatim sentences from 6 real
  RO clinics** (kinetoconsult, fiziokinetoclinic, kinetovital, smartkineto, cabinet-kinetoterapie, orthocareclinic;
  bodymovestudio.ro UNREACHABLE — host refused, ECONNREFUSED). Result: **5 flagged, 37 clean.**
  - 1 TRUE POSITIVE: "Tratăm afecțiuni ale coloanei…" (class 2) — a real published treatment claim, correctly caught.
  - 4 FALSE POSITIVES from two over-broad rules: bare `\d+%` caught two discounts ("20% REDUCERE", "-40% SENIORI");
    blanket `specialist` caught a held credential ("plan stabilit de medic specialist") and a team naming its own
    profession ("specialiști în fiziokinetoterapie").
  - 2 clear FALSE NEGATIVES (construction holes): imperative "scapă … de durere" (only `scapi` covered) and
    polite-plural "să vă întoarceți la sport" (only informal singular `te întorci` covered).
  - 4 borderline FNs left ALONE by ruling: "asigurând diagnosticarea timpurie" (licensing/snapshot decides, not a
    regex); "sprijină îmbunătățirea coordonării" (hedged, responsible — PASS); "Mișcarea fără durere începe cu
    primul pas" (slogan — judge territory, same class as the named gap); "Specializați în Recuperare Medicală"
    (resolved by narrowing the specialist rule to condition-scoped claims).
- 2026-10-05: **FIX + OUT-OF-SAMPLE RUN 2 (fixed guard, 7 FRESH clinics, NOT tuned against them).** Fixed the two
  construction holes (imperative "scapă de durere"; polite-plural dumneavoastră "vă întoarceți/recuperați/vindecați")
  and narrowed the two over-broad rules (the % fires only attached to clients/patients + outcome; "specialist"
  fires only over a named condition, letting held credentials and own-discipline naming pass). 6 real-copy
  regression cases added to the RO fixture (52 in-sample green). Re-ran on 7 clinics none of which were in run 1
  (kinetonext, urbankineticstherapy, fizioteraconcept, kinetikcluj, kineticimpact, cardiokinetic, fiziotop):
  **45 sentences, 5 flagged, 40 clean. 5/5 flagged are TRUE POSITIVES, 0 false positives** (the narrowings held;
  the run-1 imperative/polite-plural fixes caught fresh claims on sites never seen).
  - **NEW hole run 2 revealed (reported raw, not tuned):** the layer keys on FINITE verbs, but RO clinic copy uses
    INFINITIVE purpose-clauses ("pentru a trata cauza durerii", "pentru a-ți reda calitatea vieții") and
    NOMINALIZATIONS ("tratamentul afecțiunilor", "scăderea durerii") that carry the claim with no finite verb; plus
    3rd-person-with-service-subject ("crește imunitatea organismului"). Under-represented in run 1's sites.
- 2026-10-05: **FIX (stem generalization + 3rd-person-service) + OUT-OF-SAMPLE RUN 3 (6 THIRD-batch fresh clinics:
  fiziothera, clinicaremed, biocentermedical, kineto-brasov, osteokinesisbrasov, centrulrafael).** Closed the run-2
  families by matching the verb STEM in any inflection (so the infinitive "a reduce/trata/reda" and 3rd-person
  service-subject "masajul reduce" / "reface mobilitatea" are caught — not a brittle "pentru a" pattern), with a
  lookbehind so reflexive descriptive "se recuperează" stays clean; nominalizations LEFT (point 3). 7 regression
  cases added (59 in-sample green). Run 3: **32 sentences, 3 flagged, ALL 3 TRUE POSITIVES, 0 false positives.**
  - The run-2 holes are verified closed on fresh copy: infinitive "pentru a reduce durerea" (Arch Kinetic) and
    service-subject "reface mobilitatea" (Remed) both caught; "tratăm simptomele" (Osteokinesis) caught.
  - Nominalizations correctly PASSED: "Reducerea durerii", "creșterea mobilității", "restabilirea echilibrului",
    "Specialiști în mobilitate/fiziokinetoterapie" — all clean (point 3 + narrowed authority held). Zero FPs.
  - Remaining misses are SCATTERED individuals, not a family: one uncovered verb ("readucem echilibrul"), one
    missing inflection of an already-covered verb ("recapete"), slogans ("Redescoperă mobilitatea…"). Per the
    stopping rule these belong to the judge.
- 2026-10-05: **STOPPING RULE MET — the deterministic guard is DONE.** Three fresh out-of-sample runs; run 3
  surfaced NO new systematic family (only scattered individuals). 0 false positives across runs 2 and 3. Next:
  wire the guard into the generate→gate→repair→fail-closed orchestration + the landing prose generator. No
  further guard tuning — chasing the scattered misses would be tuning against specific sites, which the rule
  forbids; they are the judge's.
- 2026-10-05: **generator + orchestration BUILT, live draft produced.** `AnthropicLandingModel` (structured
  LandingDraft, grounded-only, three classes forbidden in-prompt, fail-safe to a thin licensed-only draft) +
  `MoveDraftService`: gate in CHEAP-FIRST order (medical → kernel+backstop → Layer-3 judge last, fail-fast so the
  3-call judge never runs on copy the regex rejected), **2 targeted repairs** (told which section + rule) then
  fail-closed, and the drafted/blocked outcome + failing layer STORED on every row (MoveSafetyDecision) so the
  ratio is queryable, not just logged. Generator must never emit a non-guard-enabled language (fail-closed before
  generating). 6 orchestration tests (gate order / repair recovery / bounded-2-then-blocked / judge-blocks /
  language-disabled) + tsc -b clean + full suite 1760. LIVE on a representative Body-Move snapshot (real host
  unreachable; NO licensed results): produced a DRAFTED RO landing page (hero/what/who/proof/cta) through the full
  gate incl. the live judge, 1 repair — grounded, warm, no therapeutic claims, and the proof section correctly
  cited no results (none licensed). Remaining: compose-root wiring + API routes + BullMQ draft-on-surface + Today
  UI; and a real-data run once a fresh prod token is available.
- 2026-10-06: **SampleChannel `'landing'` added (frozen-slice change, `approve frozen`) — the borrowed-'carousel'
  label removed.** `SampleChannel = 'reel' | 'carousel' | 'caption' | 'landing'` (voice/contracts.ts); documented
  at the enum that landing shares the carousel-like discrete-CTA shape (CTA in its own field, never in a section
  body), which the existing `channel === 'caption' ? … : …` split in validation.ts carries over for free — landing
  takes the same discrete-`cta` branch as reel/carousel, so the CTA-survival check is byte-identical and no branch
  was restructured. `MoveDraftService.GATE_CHANNEL` switched `'carousel'` → `'landing'`: every voice-gate call for a
  web page now reads the real channel. No persisted leak either way — move-draft stores only MoveSafetyDecision +
  the snapshot, neither of which carries a channel, so GATE_CHANNEL was always transient. DB/repo: the voice
  `channel` columns are permissive `TEXT` with NO CHECK (V068, committed — can't and needn't touch it; it already
  stores 'landing'); the repo's addSample/addExample type-flow from the widened enum and read back pass-through, so
  no repo literal changed. tsc -b 0 (full graph); move-draft 71/71; frozen voice suite 93/93 (unchanged). NOT
  committed (no `approve commit` this turn). Deferred/optional: a one-line CTA-shape comment at validation.ts:212
  (pure doc, blocked when the frozen grant lapsed mid-turn — the enum already documents it). Still: the wiring.
- 2026-10-06: **enum committed (`022c568`); real-facts re-run BLOCKED twice — the block IS the finding; substrate
  trace done (measurement, no building).** Ran the full chain on the operator's REAL Body Move facts (4 services,
  2 Cluj addresses, Evo Beauty booking, 1h sessions, staff mix, ~7-8y; positioning passed as TONE ONLY;
  proofFacts=[]). Run A (short voice slogans): BLOCKED at backstop/**parroting** (model lifted the slogans
  verbatim). Run B (voiceLines=[], the faithful condition — Body Move has no calibrated voice): BLOCKED at
  **kernel**/Layer-1 after both repairs on "totul într-un singur studio" (invented one-stop positioning) + "Un
  studio construit în timp" (tenure dressed as positioning). **No publishable draft.** Both blocks = the gate
  correctly refusing positioning-as-fact on a STARVED substrate, NOT an over-strict gate.
  **CORRECTED FRAMING (the earlier "sees and forgets" was wrong and does not survive):** understanding DOES feed
  the licensed substrate (`carouselContext` composition-root.ts:516 → `allowedBusinessFacts` over the LLM
  `GovernedUnderstanding`), and proof extraction is a 2nd site-derived path. Accurate finding, narrower: the
  pipeline **SYNTHESIZES AND DISCARDS THE ATOMS** — `GovernedUnderstanding` (bi/contracts.ts:34) is an
  interpretation schema with no slot for operational specifics. **Atom coverage measured:** service names
  absent-in-licensable-form (survive only if the LLM enumerates `offer.explicit[]`, no per-item provenance);
  addresses absent (proof `location` can pass as an unstructured reported-speech blob); session duration absent;
  booking tool-name absent (facet only records presence of the word "book"); staff roles absent. The deterministic
  facet layer (V052/V053) is **not wired in the composition root at all**, is 5 interpretive kinds over a **pinned
  English physio regex catalog** (no diacritic folding → Romanian matches nothing), and does NOT feed the
  substrate — so fix (a) "read the facet layer" is **insufficient**. Structural fix (b) = an atomic-facts lane
  (extend `GovernedUnderstanding` OR a new deterministic atom extractor sibling to proof extraction); operator
  decides. Also found: proof extraction has **NO numeric sanity bound** (a "0 years" tenure / 0 team_size isn't
  rejected on value — only accidentally, by an English-only about-business regex that also drops legitimate RO
  tenure), and the proof extractor is English-coupled throughout. All three recorded in `known-issues.md`.
  **DO NOT WIRE move-draft yet** — the wiring's acceptance test ("publishable draft on Body Move's real facts")
  cannot pass until the atomic-fact lane exists; operator decides the substrate fix first. No commits beyond
  `022c568` this step.
- 2026-10-06: **Today draft surface committed (`8bb2502`); provenance display next.** The draft is the primary
  object on screen — sections render top-to-bottom as readable copy (canonical order), per-section edit + rewrite
  stay quiet until used, rewrite fail-closed shows WHY and keeps prior text, accept adopts, blocked/pending are
  legible (no blank screen). EN/RO/IT; route `/b/:id/landing/:actionId`; `editSection` append path + edit route.
  **PRODUCT PROPERTY TO RECORD, not a bug (design, by intent):** a founder HAND-EDIT of a section bypasses the
  safety layers — it is the founder's own words and their liability; `editSection` appends an `edited` version and
  runs NO gate (medical/kernel/backstop/people-fidelity/judge are skipped on hand edits). This is correct, but it
  is a real property: an edited section must therefore NEVER be shown with sourcing markers (that would imply BB
  sourced text the founder typed). The provenance display distinguishes THREE states honestly, per section:
  (1) **anchored** → the fact + where it came from (atom `sourceUrl`, verbatim-present in the section);
  (2) **synthesized** → "BB's reading, not a sourced quote" (no source claimed);
  (3) **founder-edited** → "your text" (no gate ran, no source claimed). Rewrite re-gates and returns the section
  to generated provenance. Never discover the hand-edit bypass by surprise — it is written here on purpose.

## Security incident — 2026-10-06: prod DB connection string exposed in a session transcript

**What happened.** While confirming the live Flyway schema before deploy, a schema read was attempted as
`railway ssh --service api -- sh -c 'psql "$DATABASE_URL" -tAc "…"'`. `psql` was NOT on that non-login
shell's PATH, and the shell's "command not found" error **echoed the entire expanded `$DATABASE_URL`,
including the password**, into stdout — which the session captured. The DB user, host, port and password
for the `postgres-wbae` Postgres were surfaced in the transcript/logs.

**Scope (triaged without reprinting any value).** The leaked host is a **`*.railway.internal`** address —
reachable only from inside the Railway project, not from the internet. Whether the Postgres service also has
a **public TCP proxy** (`*.rlwy.net` / `DATABASE_PUBLIC_URL`) was NOT confirmed (reading it is behind the
`approve prod` gate; dashboard: Postgres → Settings → Networking → TCP Proxy). If no public proxy, the
exposure is internal-only and rotation is a planned chore; if a proxy exists, rotate same-day. Repo-wide
credential scan run the same day: **no real hardcoded credentials committed** (all URL-embedded creds target
localhost/docker-service dev defaults; the only matches are i18n labels, an HTML autocomplete attr, and a
preflight that reads a key from `.env`).

**The rule this produces (do this, not that).**
- **Never put a secret-bearing connection string on a command line — local OR remote.** A missing binary,
  a typo, or a non-zero exit makes the shell echo its argv (incl. the full URL) in the error. `psql "$URL"`
  is the trap.
- **Remote DB reads go through the `node` + `process.env` probe** that connects via
  `process.env.DATABASE_URL` and prints **only the query result**, with a FIXED error string
  (`CONNECT_FAILED`) in `catch` — never `e.message`, never the URL. The secret is referenced by name, never
  interpolated into a command or printed.
- If `psql` is unavoidable, pass connection **components** via `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`
  env (libpq reads them) and invoke bare `psql` — never the full URL as an argv token.
- This is the same family as the standing rule "never print or interpolate secret values": extend it to
  "never let a tool print them for you" — assume any command that can fail will put its argv in an error.

### Runbook — rotate a Railway Postgres password (DO NOT EXECUTE without `approve prod` + `approve prod-write` + `approve deploy`)

Railway has **no rotate-password button**, and setting `POSTGRES_PASSWORD` does nothing to an
already-initialized database. The real rotation is a **dual-role SQL procedure** (a volume-backed service
cannot run two deployments at once, so the DB itself must not be restarted mid-rotation):

1. **Connect interactively** — `railway connect Postgres` (opens psql against the DB with NO connection
   string on any command line; nothing to leak). Do the SQL here.
2. **Create the new role** with a fresh strong password:
   `CREATE ROLE bb_app_v2 LOGIN PASSWORD '<new-strong-secret>';`
3. **Grant it everything the old role has** (role membership is simplest and complete):
   `GRANT <oldrole> TO bb_app_v2;`  (plus, if the app role is not the owner, the usual
   `GRANT USAGE/ALL ON SCHEMA/TABLES/SEQUENCES …` + `ALTER DEFAULT PRIVILEGES`).
4. **Point the services at the new role WITHOUT restarting the database** — on the Postgres service, update
   its credential vars with deploys suppressed:
   `railway variables --service Postgres --set PGUSER=bb_app_v2 --set PGPASSWORD=<new> --skip-deploys`
   (and any `DATABASE_URL` it composes from them). `--skip-deploys` is load-bearing: a volume-backed
   Postgres can't run two deployments at once.
5. **Redeploy only the CONSUMERS** (they pick up the new creds; the DB stays up):
   `railway redeploy --service api --yes` and `--service workers`. Verify both boot and connect.
6. **Retire the old role** once nothing uses it:
   `REASSIGN OWNED BY <oldrole> TO bb_app_v2;` → `DROP OWNED BY <oldrole>;` → `DROP ROLE <oldrole>;`.

Every step 4–6 command is gated (`deploy` / `prod` / `prod-write`) and must be individually approved. Record
the new secret only in the Railway service vars — never in the repo, a file, or chat.

**Live schema confirmed 2026-10-06 (safe node+process.env probe, versions-only):** `Postgres-WbaE` is at
**V081** (V066→V081 all applied, success). So the earlier "V080/V081 may also be missing" inference was WRONG
— they are present. **The deploy's migrate step applies exactly V082 (`move_draft`) + V083 (`business_atom`),
nothing else.** Q2 (is a public TCP proxy enabled on `Postgres-WbaE`?) remains unconfirmed — `railway variables`
is categorically blocked by the `railway-variables-read` hook even with `approve prod`; confirm via the
dashboard (Postgres-WbaE → Settings → Networking → TCP Proxy) before deciding rotation urgency.

## Deploy 2026-10-07 — the inline BRIDGE (declared, not the design)

**Discovery mid-deploy:** there is no `workers` service in production, so `bb-move-draft` had no consumer and
the move-draft job would sit `pending` forever (full write-up + the proper fix sized in
docs/operations/known-issues.md). Rather than stand up a workers service on deploy morning (it would drain
EVERY queue, incl. never-run reel/reel-shoot and their possible stale Redis backlog, all at once on real
data), the move draft is produced **inline in the api route**, exactly as carousel already is in this same
prod.

**The bridge, precisely:**
- On `GET …/landing-draft`, when a strategy is adopted and no draft exists yet, the route calls
  `deps.produceLandingMove(...)` **synchronously** and returns the finished (drafted / no_safe_copy) result.
  First view generates + persists; later views read the stored draft (fast).
- **The enqueue path is kept, unused,** directly below the inline block with a comment that it is the intended
  design once a workers service exists. Not deleted — the next person must see where this is going.
- **The wait is honest, not a spinner.** While the synchronous GET is in flight, web shows
  `landing.generating` — "BB is writing your page — this usually takes a couple of minutes" (EN/RO/IT) — not a
  bare spinner, because a multi-minute spinner is precisely the broken-page experience this screen exists to
  end.

**This is a stopgap. The real design:** the draft should ALREADY exist when Today opens — generated when the
understanding or the strategy changes (an event-driven produce), stored, and simply read on open. Generating
on first view is the bridge; it trades a one-time multi-minute first-view wait for not needing a worker yet.
Rejected (explicitly): firing generation in the api background and polling — better UX, but an api restart
mid-generation loses the work with nothing durable tracking it, so the synchronous path is safer for now.

## Post-deploy verification 2026-10-07 — the landing move is UNREACHABLE (dead code in practice)

Walking the eye-verification surfaced two things:

**Correction (stale export):** v17 IS adopted. Today shows "You're betting on *Construiești un drum clar
pentru pacientele trimise de medici*" — that is v17, Current. The earlier reading from the export dump (17
versions all `proposal`/`insufficient`, v17 never adopted) was STALE on that point; the adopted bet is live.

**The blocker — nothing puts a landing move in front of the founder.** Traced end to end:
- Today = `selectToday(plan, readiness)` (today.ts) — a deterministic projection over the CURRENT
  PlanVersion's actions, ranked by readiness + strategy leverage. Its actions are **generated by the plan
  model** (`plan.service` → `model.draftPlan({strategy,…})`); each action's text, `leadsToCreate`,
  `generatesDemand`, intent are model-set (plan.service.ts:72). So "Fă un audit rapid al sitului…" is a
  **generated plan action**, not a template and not the landing move — Today assigns homework because the
  planner produced a manual-audit action (ironically asking the founder to catalog by hand what the atom
  extractor already licensed as ~30 atoms).
- A `leadsToCreate` action, when ready, shows "Make it" → `createFromAction` → `emitCreateHandoff` →
  `/b/:id/create/:handoffId` → **CarouselPage** (hardcoded). `CreateHandoff` carries `requestedAssetFormat`
  but **nothing branches on it** — the create route is carousel-only.
- **There is no "landing" action kind** in the plan Action contract (only `leadsToCreate`/`generatesDemand`;
  "landing" appears only in sequencing *comments*), and **nothing in web navigates to `/b/:id/landing/:actionId`**
  — `getLandingDraft` is called only by `LandingMovePage`, which is mounted only by that unlinked route.
- The MoveDraft is keyed by a plan `actionId`; the intended design ("a leadsToCreate move shows up already
  drafted") was never connected: the planner emits no landing-typed action and Today's affordance hard-codes
  the carousel handoff.

**So everything we deployed today (route, page, provider, inline bridge) is reachable by URL only, not by the
product.** To make it reachable (NOT built — recorded for the operator's decision):
1. The planner (or a deterministic post-generation mapping) must designate an action as a landing-page move —
   e.g. a `createKind: 'landing'` (or route by `requestedAssetFormat`/`channel`) on a conversion_path action.
2. Today (web) must branch that action's "Make it" to `/b/:id/landing/:actionId` instead of the carousel
   handoff (or the create-handoff router must route `format: 'landing'` to the landing surface).
3. Decide whether the atom-redundant "manual site audit" action should even be generated now that atoms exist
   (plan-generation quality, separate from reachability).

### STANDING CHECK (process finding, 2026-10-07): a feature isn't done until a person can REACH it

Today's deploy shipped a complete, working pipeline (route + page + provider + inline bridge, all verified
part-by-part) that **no user can reach** — nothing links Today to it. We verified the parts and never asked
"can a person get to this from the product?". From now on, verification of any founder-facing feature MUST
include a **reachability walk from the founder's real entry point** (home → … → the feature) with no typed
URLs and no internal knowledge. If the only way in is a URL you were told, it is not done. (Belongs in the
agent-SOP verify step too.)

## Design: the planner knows BB's capabilities and holdings (fixes both problems as ONE change)

The surface bug (landing has no door) and the root bug (the planner assigned "catalogue your own site" for a
business whose site BB already catalogued into 30 atoms) are the SAME defect: **the plan model is given a
strategy and nothing else — not what BB can DO, not what BB already HOLDS.** One design, not two patches.

**A — planner knows what BB can DO.** `draftPlan` input gains a closed, named `executableFormats` list. **The
vocabulary is `landing | carousel` ONLY — not caption, not reel.** The model sets, per action, a new
`executableFormat: ExecutableFormat | null` — non-null ⇒ BB performs this move; null ⇒ founder-only work
(call a referrer, visit a clinic, sign a contract). `leadsToCreate` becomes derivable from / validated against
it.

> **RULE (today's lesson, generalized): a format enters `ExecutableFormat` only when it has a REACHABLE
> SURFACE — not when the generator exists.** Reel has a generator but no worker, so it never completes;
> caption has no surface. Putting either in the vocabulary lets the planner assign a move that leads nowhere —
> exactly the bug this whole change fixes. Add a format the day it is reachable, not before.

**B — planner knows what BB HOLDS.** `draftPlan` input gains a bounded `heldFacts` summary — fact CLASSES with
counts and a few examples (e.g. "service: 11, location: 2, contact_booking: 1, people: 13, policy: 4" + the
understanding facets), assembled in composition from the SAME substrate carousel/atoms already use. Not the
raw facts — a summary, so the model can SEE it already holds the site catalogue.

**C — use the field that already exists.** `CreateHandoff.requestedAssetFormat` exists and nothing sets or
branches on it. `emitCreateHandoff` sets it from `action.executableFormat`; the create entry branches:
`landing` → `/b/:id/landing/:actionId`, `carousel` → `/b/:id/create/:handoffId` (unchanged). Problem 1 closes
INSIDE Problem 2's fix, no parallel mechanism.

**D — the affordance changes meaning.** For an action with `executableFormat != null`, Today's button is
**"Vezi ce a scris BB" / "See what BB wrote"**, not "Make it" — the draft already exists or is being written.
Founder-only actions get no "Make it". Tool vs colleague, in one label. EN/RO/IT.

### Preventing "assign work BB already did" — structural vs prompt (the honest answer)

Two layers, and only the second is a real guard:
- **Prompt-conditioning (necessary, NOT sufficient):** giving the model `heldFacts` + an instruction "never
  assign the founder to gather information BB already holds" relies on the model reading a summary and obeying
  prose. Fragile alone — it is model-following.
- **Structural enforcement (the guard):** the model emits, per action, a **REQUIRED** machine-checkable
  `gathersFactClass: AtomClass | 'none'` — a named atom class OR an explicit `'none'`, never omitted. Required,
  not optional, ON PURPOSE: an optional field the model omits fails SILENTLY and the defect ships looking
  clean; a required field that is missing **fails validation**. A DETERMINISTIC rule in
  `plan-quality.validatePlan` then fails any founder-assigned action whose `gathersFactClass` is a class
  `heldFacts` already contains (`assigns_held_info:<class>`), routed through the EXISTING repair loop.
  **Honest caveat:** this is not zero-model. The DECISION is deterministic, but the per-action classification
  is model-supplied (same pattern as claim-safety: gate decides, model supplies signal). Detecting "this prose
  asks for info we have" from free text alone would need an LLM judge (non-deterministic) or brittle keyword
  matching — both worse. So: deterministic verdict over a model-supplied typed tag, not a pure prose instruction.

### Commit sequence (plan only — NOT built)

1. **C1 — contract + closed vocab (no behavior):** `ExecutableFormat = 'landing' | 'carousel'` closed type; add
   `executableFormat: ExecutableFormat | null` and the REQUIRED `gathersFactClass: AtomClass | 'none'` to
   `Action`; extend `draftPlan` input with `executableFormats` + `HeldFactsSummary`. Because `gathersFactClass`
   is required, C1 must give the existing model impl a default (`'none'`) so the build stays green until C2
   teaches the model to set it. Types compile, behavior unchanged.
2. **C2 — planner prompt + projection:** teach `PLAN_SYSTEM` (inline in `anthropic-plan.model.ts`) the
   executable-format list + heldFacts, to set `executableFormat`/`gathersFactClass`, and to not assign held
   info; map the new fields in the draft→PlanVersion projection (plan.service.ts:72).
3. **C3 — structural gate + repair:** add `assigns_held_info:<class>`; require `gathersFactClass` on every
   founder-assigned action (missing ⇒ `missing_gathers_tag` failure, no silent escape); and the
   `leadsToCreate ⇔ executableFormat` consistency check, which **FAILS CLOSED** — `leadsToCreate: true` with
   `executableFormat: null` is an action promising creation with no surface behind it (a dead "Make it" / "See
   what BB wrote" button) → reject, never default. Wire all into the existing repair loop. Tests: a
   "catalogue your services" action with services held → fails → repairs; a leadsToCreate/no-format action →
   rejected. **Report after C3, before touching the surface (C5/C6).**
4. **C4 — composition wiring:** assemble `heldFacts` (atom class counts + understanding facets) and
   `executableFormats`, pass into `generateProposedPlan`/`draftPlan` (reuses the already-wired substrate).
5. **C5 — CreateHandoff + routing:** populate `requestedAssetFormat` from `action.executableFormat`; branch the
   create entry landing→landing surface, carousel→carousel (carousel path untouched).
6. **C6 — Today affordance (web):** branch on `executableFormat` — BB move ⇒ "See what BB wrote" to the right
   surface; founder work ⇒ no "Make it". EN/RO/IT.

Each commit is independently revertable; behavior only moves at C3 (gate), C5/C6 (surface).

### Hash-fragile / frozen in this path

- **Plan prompt is NOT in the `make validate-prompts` checksum set** (that gates the PR-xxx decision prompts).
  `PLAN_SYSTEM` is inline and sha256-hashed into the generation audit trace (`draftContractHash`), so a C2
  edit changes the recorded contract hash on subsequent plans — expected, append-only provenance, not a break.
- **Frozen Slice 6/6.1 carousel:** C5 adds the landing branch BEFORE the carousel handoff; the carousel
  generator/page are NOT touched. **Frozen Slice 4 voice:** owns the `SampleChannel` type — do NOT import plan
  logic into it; define `ExecutableFormat` independently in plan/shared (a sibling closed list), even though it
  mirrors SampleChannel's members. Nothing else in the path is frozen.

### Sizing (honest, work-sessions)

C1 ≈ 0.5 · C2 ≈ 1 (prompt-behaviour iteration is the risk — getting the model to reliably set the tags AND
stop assigning held info may stretch) · C3 ≈ 1 · C4 ≈ 0.5 · C5 ≈ 0.5 · C6 ≈ 1 → **≈ 4–4.5 sessions**, plus a
**reachability walkthrough** with a real founder (the step we skipped). C2 is the one that can overrun.
