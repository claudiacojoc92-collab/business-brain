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
