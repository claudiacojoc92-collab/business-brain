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
