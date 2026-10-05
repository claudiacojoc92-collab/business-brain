# Canggu build plan

*Written 2026-10-03, mid-build, after step 1 shipped.*

This is the program roadmap across steps. Individual pieces still get their own `intent/<date>-<slug>/`
records as they're built; this document is the index above them and the continuation handoff between steps.

## Product thesis (settled 2026-10-05)

The organizing principle the rest of the roadmap now answers to.

- **People pay because it does something they can't or won't do themselves. Advice is not that;
  production is.** A tool that tells a founder what to do is advice. A tool that shows up with the
  thing made is production. BB has been giving advice.
- **Therefore moves should arrive done or drafted, not assigned.** BB currently knows the answer and
  hands the founder the question. The site-audit move is the clearest example: BB has already read the
  site and holds the strategy, yet it asks the founder to go write the page. The move should arrive with
  the page written.
- **First instance being built:** the landing-page move arrives written —
  [intent/2026-10-05-landing-move](../../intent/2026-10-05-landing-move/plan.md). It is deliberately
  built as the first `kind` of a general "a move arrives with its content produced" shape, so the message
  and carousel moves reuse the spine rather than each being a special case.

## Governing rules

How we have actually been working. They hold for every step.

- **One step at a time.** A step ships before the next one starts.
- **Each commit separate and reversible.** No mixed commits.
- **Full test suite green before any commit.**
- **A step isn't done until it's verified live against real data.**
- **Pre-existing bugs found along the way get their own commit**, never folded into the feature commit.
- **Verify deployed configuration against the running environment, not the repo.** The repo did not show the
  Railway `/data` volume, and a repo-only read produced a false "blobs are ephemeral" conclusion (see 2a).
  Check the running environment (Railway variables, volumes) before building on an assumption about prod.

## Step 1 — Attribution by asking at the door — WITHDRAWN 2026-10-05

**Status: the manual-asking feature is WITHDRAWN.** It fails the product thesis — asking the founder
to go collect attribution by hand is assigning work, not doing it — and it is inapplicable to
location-less businesses (a coach has no door to greet people at). **The storage and the weekly rhythm
stay** (the `reach_report` table, the weekly-prompt cadence — reusable scaffolding for a future
attribution approach that BB does *for* the founder). **The manual asking goes** — the door-question
teaching, the "say this sentence at the door" first-run copy, and the ask-the-founder framing are
retired. What shipped is recorded below for history; do not extend it.

**(Historical — what was built, NOT YET DEPLOYED at the time of writing.)**

- Weekly prompt on Today: how many new people came, and how they heard about the business.
- First run teaches three things: why no analytics tool can answer this at their size, the exact sentence to
  say at the door, and to carry that question out of the app to wherever people are greeted.
- No OAuth, no Meta or Google connection, no pixel, no tracking. The data comes from the founder asking
  people. Deliberate.
- "Not this week" records a dismissal, never a false zero. The prompt returns the next ISO week and keeps
  teaching until the founder has answered at least once.
- Collected view at `/b/:id/reach` — the founder's own notes, correctable and deletable by them.
- Commits: `bc3d572` (feature), `df35bbd` (Meta disconnect bug, pre-existing), `e0835c8` (first-run copy),
  `2f5d7e4` (known-issues doc).
- Parked gap in [known-issues.md](./known-issues.md): the collected view is reachable only from the prompt,
  so it's URL-only after a skip.
- The copy change reaches users only on the next deploy.

## Step 2 — Photos from the founder's own phone

**Status: not started.** Reframed 2026-10-03 after investigation; the original "camera roll" framing turned
out not to be buildable as imagined. Durable storage (2a) turned out to be **already met**, so **step 2 is
2b only**.

### 2a — Durable photo storage — ALREADY MET, not a precondition

Resolved 2026-10-03 by inspecting the running environment — it was never a bug fix.

- Prod has a Railway volume, `api-volume`, mounted at `/data`, and `CAROUSEL_BLOB_DIR=/data/bb-carousel-blobs`
  points at it. Carousel and photo blobs persist across restarts and redeploys today.
- The earlier claim that blobs are "lost on every restart or redeploy" was **wrong**. It was read from the
  repo, which does not reflect the deployed configuration — the repo defines no volume and sets no
  `CAROUSEL_BLOB_DIR`, but Railway's dashboard does both. Recorded here rather than quietly deleted: a plan
  that erases its own mistakes is worth less than one that keeps them.
- `R2_BUCKET` is not set on the api service. R2 is not in the api's path at all today.
- Durable storage is therefore **not a precondition for step 2** — it is already met. There is no R2 decision
  to make here; that line was removed.
- The volume does carry two non-urgent consequences — a single-replica scaling limit and no backup story of
  its own — parked in [known-issues.md](./known-issues.md), not a blocker for step 2.

### 2b — Photos into the product

- **Hard constraint:** the app is a React/Vite web SPA. No PWA (no manifest, no service worker), no native
  wrapper. A browser cannot enumerate a photo library. The only possible path is the OS file picker via
  `<input type="file" accept="image/*">`.
- So "camera roll" means the founder deliberately picks each photo. BB never sees anything they did not choose.
- **Rule**, in the design from the start, not added later: BB proposes, BB never publishes. The founder looks,
  the founder presses.
- **Rule:** any photo containing faces gets an explicit confirmation step in the normal flow — not buried in
  settings.
- Why: founders in this market (gyms, clinics, coaches) have phones full of photos taken at work, including of
  clients and patients. Those people consented to nothing. One wrong suggestion costs the founder a client and
  costs us the founder.
- Already exists and is reusable: the upload → base64 → blob + DB path, and the vision model that observes a
  photo and returns the focal subject and face boxes.
- Does not exist: MIME/type validation (only size is checked), EXIF/orientation handling, resize or
  thumbnailing. Files are stored named `.png` regardless of actual format.

## Steps 3–6 — NOT YET RECORDED

These steps exist in conversation only. They are **not** written down, and they must be transcribed here
before they are built. Nothing about them is recorded in this document or inferable from the codebase on
purpose — a fabricated step is worse than an empty one. Do not fill this section with plausible-sounding
placeholders; transcribe the real steps from the operator when they are stated.

## Changes outside the step sequence

Work that belongs to no step, recorded so it isn't lost.

- **Generated-content language follows the founder** (commit `86ccf75`, 2026-10-03). The understanding model
  now writes the prose BB *composes* for the founder in the **founder's language** (`account.interfaceLocale`)
  and keeps the items BB *lifts* from the source in the source language, with proper nouns preserved in both
  halves. It previously tied the whole output to the source material's language. **Affects new ingests only**
  (persisted understandings are immutable). **Committed but NOT deployed.** Important caveat: the tests prove
  the **prompt contains the right instructions**, not that the model obeys them — this is **unverified against
  a live model** until a real business is re-ingested.

## Open product questions

Things raised but not yet specified. Record them verbatim; do not interpret, propose, or infer what was meant
— that has to be defined before anything is built from it.

- **2026-10-03 — "BB trebuie să aibă o structură coerentă."** (*BB needs a coherent structure.*) Unspecified:
  what "coherent" means here has not been defined. It must be defined before anything is built from it.
- **2026-10-05 — Instagram and the connected online presence as the centre of the first session, rather than
  the website.** Raised today, NOT part of the landing-move build. Unspecified; record and define before building.
- **2026-10-05 — A visible onboarding / working boundary with named steps.** The founder should be able to see
  where onboarding ends and the working product begins, as named steps. Raised today, NOT part of this build.
- **2026-10-05 — Where new material comes from.** The founder rejected recycling existing posts, so the source
  of fresh material is an open question. Raised today, NOT part of this build; must be answered before anything
  that depends on a material source is built.
