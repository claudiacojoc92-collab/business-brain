# Known issues

Product issues we've found and consciously parked — real, not yet scheduled. Add one when you find a gap you're
deliberately not fixing now, so it isn't rediscovered from scratch. Each entry: what, where, impact, and the
shape of the fix. When one is fixed, mark it **RESOLVED** in place with the fix and the commit — a list that
shows what was found *and* what was done is worth more than a list of only open items. Prune the resolved ones
later if the file gets long.

## ✅ RESOLVED — Reach collected view was discoverable only from the weekly prompt

- **Resolved:** 2026-10-03, commit `c6d2d8f`. The link into the collected view is now a persistent quiet link
  in the Today footer (`apps/web/src/slice0/TodayPage.tsx`), under "see the 30-day plan", rendered in every
  active stage and gated only on the business id — so it survives a skip (the page carries its own empty state).
  No new nav tab (a sixth phone tab was rejected as too much permanent space for a once-a-week page) and no new
  strings (reuses `reach.see`). The copy inside the weekly prompt was removed so it isn't shown twice.
- **Found:** 2026-10-03, during the attribution-by-asking (V081) live walkthrough.
- **What:** The reach collected view, "What you've told me" at `/b/:id/reach`
  (`apps/web/src/slice0/ReachReportsPage.tsx`), is linked from exactly one place — the `See what you've told me →`
  footer link on the weekly reach prompt (`apps/web/src/slice0/TodayPage.tsx`). There is no nav/tab entry for it.
- **Impact:** The weekly prompt hides itself once the founder answers or skips for the current ISO week. After a
  **skip** ("Not this week"), the prompt — and its only link to the collected view — is gone until the prompt
  reappears next week. So a founder who skips can review / correct / delete their collected reports only by typing
  the URL until then. Low severity (the data is safe and the view returns next week), but it undercuts the
  feature's "your report, your data — correct or delete anything" promise.
- **Fix (done):** gave `/b/:id/reach` a persistent entry point independent of the prompt's visibility — the
  always-present Today-footer link described under **Resolved** above. No backend change needed.

## Carousel/photo blobs sit on a single Railway volume

- **Found:** 2026-10-03, inspecting the running environment while scoping step 2 (photos).
- **What:** Carousel and photo-set blobs live on one Railway volume — `api-volume`, mounted at `/data`
  (`CAROUSEL_BLOB_DIR=/data/bb-carousel-blobs`), **4.9 GB total, ~0.1 GB used**. They are durable (persist
  across restarts/redeploys), so this is **not** a data-loss bug. Two non-urgent consequences:
  1. **The api cannot scale horizontally** while it depends on that volume — a Railway volume attaches to a
     single replica; multiple replicas can't share it (conflicts with the intent in `deployment/k8s/hpa.yaml`).
  2. **The volume has no backup story of its own** — durable against redeploys, not against corruption/accident.
- **Capacity trigger (concrete):** at ~3 MB per phone photo, ~4.8 GB free ≈ **~1,600 photos**. One customer
  uploading ten a week lasts years; fifty customers lasts about three weeks. **The ceiling arrives with
  customers, not with time** — it's fine today precisely because almost nothing is stored.
- **Fix (not done):** move carousel/photo blobs to R2. The adapter was scoped 2026-10-03 — `S3BlobStore` behind
  the existing `IBlobStore` port, three methods (`put`/`get`/`putZip`), **zero call-site changes**, roughly half
  a day (see the Canggu build plan). Before reusing the **reel** R2 bucket for photos, its object-lifecycle
  rules must be checked — reels are disposable and may have an expiry rule; the founder's photos must persist
  indefinitely, so an expiry rule applying to `carousel/` keys would be a loss and would force a separate bucket.

## Blob keys are always named `.png` regardless of actual format

- **Found:** 2026-10-03, hardening the photo-upload path.
- **What:** `carouselService.addMedia` writes every uploaded image to a blob key `carousel/media/{id}.png`,
  even when the stored bytes are JPEG (`packages/application/src/carousel/carousel.service.ts`). The upload path
  now normalizes format correctly (PNG stays PNG, else JPEG), but the key extension is still hardcoded `.png`.
- **Impact:** cosmetic **today** — the renderer reads the bytes (not the extension), the uploaded bytes are
  never served to a browser as a file, and the serve routes set their own `content-type`. So nothing breaks.
- **Fix (not done):** it must be corrected **if anything ever hands the founder the file itself** (a download, an
  email attachment, a share link) — then the extension would be a real lie. `addMedia` is a frozen slice, so a
  deliberate `approve frozen` is needed; not warranted for cosmetics alone.

## HEIC uploads are rejected — verify on a real iPhone before 2b

- **Found:** 2026-10-03, hardening the photo-upload path.
- **What:** the upload path rejects HEIC/HEIF with a specific localized message ("save as JPEG and try again"),
  because the renderer can't decode HEIC and sharp's default prebuilt has no libheif.
- **Open question (NOT a settled fact — must be tested):** iOS Safari's file picker **may already convert HEIC
  to JPEG on upload**, in which case the bytes arriving at the server are JPEG and the rejection never fires —
  and libheif would be unnecessary. This is **unverified**; do not build on it. **Test it on a real iPhone**
  (pick a HEIC photo from the library via the web file input, inspect the uploaded bytes' magic number) before
  deciding whether 2b needs HEIC decoding (libheif-enabled sharp, heavier image + licensing review) or whether
  the reject-with-message path is sufficient.

## Strategy output has no deterministic language gate — ACCEPTED

- **Found:** 2026-10-03, tracing the downstream consumers of the now-bilingual understanding (commit `86ccf75`).
- **What:** strategy generation is supposed to produce founder-facing prose entirely in one language (the
  founder's). That guarantee is **prompt-only**: the strategy model
  (`packages/infrastructure/src/business-intelligence/anthropic-strategy.model.ts`) runs at **temperature 0**
  with an explicit anti-leak instruction ("write the ENTIRE output in that ONE language … never let
  other-language content in this prompt leak into your text"), and the understanding evidence is fed as
  input-only context the model re-expresses — there is no field in the output where evidence is quoted
  verbatim. The deterministic gate stack (`packages/application/src/strategy/validation.ts`) checks structure,
  refs, constraints, coherence and claim discipline, but **does not detect language** or scrub a
  source-language fragment from the prose.
- **Impact:** none observed. If the model ever carried a short source-language fragment through verbatim
  (realistically a proper noun, a service name, or a 2–3 word theme — often the *correct* thing to leave
  untranslated), nothing downstream would catch or scrub it, and the founder would see a foreign phrase inside
  their-language strategy prose.
- **Status: ACCEPTED, not scheduled.** A language detector / fragment scrub is not worth building on this
  evidence — the lifted (source-language) surface reaching strategy is narrow (three themed lists), it is
  input-only, and temp 0 + the anti-leak instruction is aimed squarely at this case. The value of recording it
  is that **if a founder ever reports a foreign phrase in their strategy, this turns a mystery into a known
  limitation** with a known cause and a known (deliberately deferred) fix.

## The reel path has NO medical-claim guard — the one it looks like it has is inert

- **Found:** 2026-10-05, mapping the claim-safety machinery while designing the landing-move feature.
- **What:** `reel-safety.ts` defines `REEL_FORBIDDEN_CLASSES = ['health_outcome','nutrition_fact','earnings_claim','clinical_claim','guarantee','comparative_superiority']` and assigns it to `spec.forbiddenClasses`, which **reads as a medical/regulated-claim guard but is never enforced.** The field is **not read by the safety kernel** — a grep across `packages/` + `apps/` finds zero reads in `proposition-classes.ts` / `proposition-safety.ts` / `validation.ts`. Its only consumer is a **soft prompt line** (`anthropic-voice.model.ts:114`, "FORBIDDEN — never introduce: …"). So on the reel path, a `clinical_claim` / `health_outcome` is at most a model hint, never a deterministic gate; on the carousel and voice paths it is not wired at all.
- **Impact:** a regulated medical/therapeutic claim (treats / cures / recovery rate) in reel on-screen copy is blocked today **only indirectly** — by the allowlist, because such a claim usually isn't a licensed proposition and trips the `outcome`/`causal`/`market` buckets in `auditAssertions`. That catches *unlicensed* claims, but there is **no positive detection of a regulated medical claim** and no escalation/disclaimer. For a medical-recovery business shipping a reel, the apparent "forbidden classes" protection is a false comfort. Severity is real but bounded: reels are founder-reviewed before use, and the allowlist still blocks the common case.
- **Fix (not done here):** the **new medical/regulated-claim guard built for the landing-move feature** (intent/2026-10-05-landing-move) is designed to live in the *shared* safety spine, so once it lands it covers reel (and carousel) too — at which point `forbiddenClasses` either becomes a real consulted input to that guard or is removed as dead. Until then: do not rely on `forbiddenClasses` as protection. Flagged here as a **present risk**, separate from that build.

## The licensed-fact substrate SYNTHESIZES AND DISCARDS THE ATOMS

- **Found:** 2026-10-06, tracing why a landing draft came out thin on real Body Move facts (intent/2026-10-05-landing-move).
- **SHIPPED-FEATURE DEFECT (not a move-draft gap — this affects carousel + reel in production TODAY):** for a
  **Romanian or Italian** business, BOTH site-derived fact paths are effectively **inert**. Path 1 (understanding
  synthesis) yields only interpretive summaries — no operational atoms. Path 2 (proof extraction) is
  **English-coupled in code**: `BIZ_REF_RE` is English-only and the `wrap()` templates are English
  (`packages/application/src/proof/proof-extraction.service.ts`), so Romanian/Italian site facts fail the
  about-business guard and are dropped. The facet layer is an unwired English regex catalog with no diacritic
  folding. **Net effect: the licensed-fact substrate for a non-English business contains only LLM-authored
  summaries plus founder conversation input — zero concrete, verifiable facts about the business.** Carousel and
  reel generate on that substrate today, so **every piece of content BB has generated for a Romanian business was
  written with no concrete business facts available to it.** The fix is scoped in `intent/2026-10-06-licensed-atoms`.
- **Correction to an earlier framing:** it is **wrong** to say the pipeline "sees and forgets" the website. It does
  not. Understanding **does** feed the licensed-fact substrate, and proof extraction is a second site-derived path.
  The accurate, narrower finding: the pipeline **synthesizes the site into an interpretation and discards the
  operational atoms.** `GovernedUnderstanding` is an interpretation schema; it has **no slot** for operational
  specifics.
- **What (the substrate):** the one builder is `carouselContext` (`packages/composition/src/composition-root.ts:516`)
  — shared by carousel, reel and reel-shoot. Licensed facts come from two site-derived paths plus conversation:
  (1) `allowedBusinessFacts(understandingRepo.latest(bid).understanding)`
  (`packages/application/src/voice/voice.service.ts:428`) → `business_evidence`; (2)
  `proofExtractionService.facts()` → licensed `proofFacts`. `allowedBusinessFacts` reads **only** the interpretive
  fields of `GovernedUnderstanding` (`packages/application/src/bi/contracts.ts:34`):
  `offer.summary/explicit`, `positioning.summary`, `audience.addressed`, `acquisition.visiblePaths`,
  `messaging.recurringThemes`, `contradictions.tension`. There is no locations / hours / session-length /
  contact / service-list field.
- **What (the facet layer does NOT help):** the deterministic facet/observation slice (V052/V053,
  `packages/application/src/understanding/`, `understanding.facet`) is **not constructed in the composition root
  at all** — it never runs for live businesses — and even for fixtures its `FacetKind` is frozen to five
  **interpretive** kinds (`activity_theme | offer_mention | addressed_audience | communication_theme |
  communication_style`, `packages/domain/src/understanding/facets/facet.ts:5`) filled by a **pinned English regex
  catalog for a physio fixture** (`profile understanding.physio_movement.v1`,
  `packages/domain/src/understanding/facets/rules.ts`), with a **frozen semantic boundary**: "a rule may only
  assert that a directly observable textual signal is PRESENT … never infers … A Facet describes what is visibly
  present." Its `offer_mention` values are generic tokens (`assessment` / `program` / `one_to_one` / `booking`),
  **not real service names**, and the rules are English with **no diacritic folding** (so Romanian copy matches
  nothing). It also does **not** feed `allowedBusinessFacts`.
- **Atom-coverage measurement** (for a business whose site has been ingested — "can this become a licensable fact
  with provenance?"):
  - **Individual service names** — *absent in licensable form.* Survive only if the understanding LLM happens to
    enumerate them into `offer.explicit[]`; no per-item provenance. Facet `offer_mention` holds generic tokens, not
    names, and isn't wired live.
  - **Street addresses per location** — *absent.* No facet kind, no `GovernedUnderstanding` field. Proof extraction
    has a `location` ProofKind (exempt from the English about-business guard) so an address *can* slip through as a
    reported-speech blob ("The site states: …") if the model emits it — unstructured, not a per-location field.
  - **Session duration ("one hour")** — *absent.* No facet kind, no understanding field, not a ProofKind.
  - **Booking method / tool name ("Evo Beauty")** — *present but degenerate.* Facet `offer_mention/'booking'`
    records only the PRESENCE of the word "book" (not the tool name), and isn't wired live; `acquisition.visiblePaths`
    might hold "book via app" if the LLM extracts it. The tool name itself is **absent** in licensable form.
  - **Staff roles & qualifications** — *absent via facets* (no kind). Proof extraction has `credential` / `team_size`,
    but `team_size` needs a clean count and `credential` is English/about-business-gated; Romanian role nouns
    ("kinetoterapeuți, maseuri, traineri") resolve to neither → absent.
- **Why this is one problem with the blocked drafts:** on real-but-thin licensed facts the generator has nothing
  *specific* to write, so it reaches for positioning (live run blocked at the kernel on "totul într-un singur
  studio" and "construit în timp"); the kernel correctly refuses. The gate is not too strict — **the substrate is
  starved.** More licensed *atoms* starve the overreach and fill the copy.
- **Fix (not done — measured, not built):** reading the facet layer (fix "a") is **insufficient** — it holds none
  of the atoms and isn't wired. The structural fix ("b") is an **atomic-facts lane**: either extend
  `GovernedUnderstanding` with an operational-facts section (locations, services, hours, contact/booking) that the
  understanding prompt fills from observed atoms and `allowedBusinessFacts` emits as provenance-carrying
  `business_evidence`, **or** add a new deterministic atom extractor over the ingested fragments (sibling to proof
  extraction). Touches the understanding schema + a hash-fragile prompt; **operator to decide before the move-draft
  wiring.** The move-draft wiring's acceptance test ("produces a publishable draft on Body Move's real facts")
  **cannot pass until this lane exists.**

## Proof extraction has NO numeric sanity bound — a "0 years" counter is not rejected on its value

- **Found:** 2026-10-06, testing the real Body Move homepage (which renders a broken counter, "Ani de experiență 0 +").
- **What:** `ProofExtractionService` (`packages/application/src/proof/proof-extraction.service.ts`) *does* read
  tenure from ingested site content — `tenure`, `team_size`, `service_count`, `location`, `credential`, `award`
  are CHECKABLE ProofKinds. A candidate is kept if its `anchorQuote` appears verbatim in the cited unit, isn't a
  perf-figure/superlative without an external source, and (for most checkable kinds) passes an about-business
  check. **There is no plausibility bound on any numeric.** No `> 0` check on tenure / service_count / team_size;
  `cleanTeamSize` accepts `"0"` (`\b\d+\b` matches 0); the perf-exclusion regex only catches %/satisfaction/
  success-style figures, not a bare `0`.
- **What actually happens to "Ani de experiență 0 +":** it would most likely be **dropped — but for the wrong
  reason.** The about-business guard `BIZ_REF_RE` (`:29`) is **English only** (`we|our|the clinic|…`), so a Romanian
  tenure phrase without the business name fails `aboutThisBusiness` and is dropped as "not about this business."
  That is **accidental, language-fragile protection, not a numeric sanity bound** — the same English gate would
  drop a *legitimate* Romanian tenure ("Peste 7 ani de experiență") too, and a zero `team_size` passes outright.
  (Related: the whole proof extractor is English-coupled — regexes and the `wrap()` reported-speech templates
  ["The site states:", "A client stated:"] are English — so for a Romanian business the second site-derived fact
  path is largely inert.)
- **Impact:** low today (proof extraction is model-proposed, anchor-verified, founder-reviewed downstream), but a
  broken/garbage numeric on a site ("0 years", "0 clients") is not rejected on its value — only, sometimes, by an
  unrelated English gate. A business that states tenure in English with its name nearby could license a nonsense
  figure.
- **Fix (not done):** a numeric plausibility bound on checkable numeric proof (reject tenure/team_size/service_count
  ≤ 0, and implausibly large values), independent of language; and, separately, the English-only coupling of the
  proof extractor is its own limitation to record against any Romanian/Italian rollout.

## The landing generator can block the whole draft on PARROTING once a business has calibrated voice

- **Found:** 2026-10-06, the first live landing run on real Body Move facts (intent/2026-10-05-landing-move).
- **What:** `MoveDraftService` seeds the backstop's parrot-guard from the same `voiceLines` it hands the generator
  as tone (`ctx.acceptedExamples = voiceLines`, `move-draft.service.ts`). When a run supplied short, quotable voice
  lines ("Mișcare, în ritmul tău", "Vino așa cum ești"), the generator lifted them verbatim into the hero/subhead
  and the parrot-guard (`parrotsExample`, ≥4-token shared run) blocked the **whole draft** — through both repairs,
  then fail-closed. No copy produced.
- **Why it isn't just a harness artifact:** today `voiceLines` is empty for every business (the context only fills
  it `if (p.calibrated)`), so this can't fire yet — **but it will the moment voice calibration runs.** At that
  point a business *with* a calibrated voice is exactly the one whose landing generator is most likely to echo its
  own calibrated lines and get blocked. So: **for businesses with calibrated voice, the landing generator may
  block on parroting rather than produce copy** — a real failure mode, recorded ahead of the wiring.
- **Impact:** none in production yet (no calibrated voice anywhere). Becomes real with voice calibration + the
  landing wiring.
- **Fix (not done):** decouple "voice tone the generator imitates" from "stored examples it must not parrot" (don't
  seed the parrot-guard from the tone lines), and/or make the repair prompt explicit ("express the voice, do not
  reuse these lines verbatim"), and/or relax the parrot threshold for very short lines. Decide alongside the
  move-draft wiring.

## Dead schema in production: the facet pipeline (V052/V053) is migrated but never constructed

- **Found:** 2026-10-06, during the substrate trace.
- **What:** migrations `V052__create_understanding_ingestion.sql` and `V053__create_understanding_facets.sql` create
  `understanding.facet` / `facet_correction` / `facet_extraction_run` (plus the ingestion tables), and a full
  application slice exists (`packages/application/src/understanding/`, `FacetExtractionService`, profile
  `understanding.physio_movement.v1`). **None of it is constructed in the composition root** — `FacetExtractionService`
  appears nowhere in `packages/composition/src/composition-root.ts`, so the tables are never written in the api/workers
  runtime. Applied schema with no live writer.
- **Impact:** none functionally (empty tables), but it's a standing source of confusion — the facet layer *looks* like
  the business-fact store and is not. The substrate trace had to rule it out explicitly.
- **Fix (not done — do NOT touch):** recorded deliberately. Removing dead schema means a new forward migration (never
  edit applied ones), and the slice may be intended for a later knowledge-architecture build (ADR-011). Leave it;
  just know it is not wired.
