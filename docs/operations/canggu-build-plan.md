# Canggu build plan

*Written 2026-10-03, mid-build, after step 1 shipped.*

This is the program roadmap across steps. Individual pieces still get their own `intent/<date>-<slug>/`
records as they're built; this document is the index above them and the continuation handoff between steps.

## Governing rules

How we have actually been working. They hold for every step.

- **One step at a time.** A step ships before the next one starts.
- **Each commit separate and reversible.** No mixed commits.
- **Full test suite green before any commit.**
- **A step isn't done until it's verified live against real data.**
- **Pre-existing bugs found along the way get their own commit**, never folded into the feature commit.

## Step 1 — Attribution by asking at the door

**Status: built, NOT YET DEPLOYED.**

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
out not to be buildable as imagined.

### 2a — Durable photo storage

**MUST ship before any photo feature reaches a user.**

- Today: carousel and photo-set bytes go to `FsBlobStore` at `/tmp/bb-carousel-blobs`. `CAROUSEL_BLOB_DIR`
  is set in no committed config, no persistent volume exists in any committed manifest, and R2 is wired for
  reels only.
- Consequence: uploaded photos are lost on every restart or redeploy, silently — the DB rows survive and
  point at nothing.
- Latent, not yet triggered: prod has no carousel history, so no founder has lost anything yet. It bites the
  first real user.
- **Decided 2026-10-03:** move carousel/photo blobs to R2, behind the existing `IBlobStore` port, reusing the
  R2 setup already proven in prod for reels. Chosen over a Railway persistent volume because a volume pins the
  api to a single replica, which conflicts with the horizontal scaling the repo's `hpa.yaml` already
  anticipates — and because we would end up building the R2 path anyway, plus a migration.
- Open, non-blocking: whether Railway's dashboard currently sets `CAROUSEL_BLOB_DIR` to a mounted volume.
  Nothing in the repo does.

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
