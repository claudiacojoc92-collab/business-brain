# Known issues

Product issues we've found and consciously parked — real, not yet scheduled. Add one when you find a gap you're
deliberately not fixing now, so it isn't rediscovered from scratch. Each entry: what, where, impact, and the
shape of the fix. Remove it when it's fixed.

## Reach collected view is discoverable only from the weekly prompt

- **Found:** 2026-10-03, during the attribution-by-asking (V081) live walkthrough.
- **What:** The reach collected view, "What you've told me" at `/b/:id/reach`
  (`apps/web/src/slice0/ReachReportsPage.tsx`), is linked from exactly one place — the `See what you've told me →`
  footer link on the weekly reach prompt (`apps/web/src/slice0/TodayPage.tsx`). There is no nav/tab entry for it.
- **Impact:** The weekly prompt hides itself once the founder answers or skips for the current ISO week. After a
  **skip** ("Not this week"), the prompt — and its only link to the collected view — is gone until the prompt
  reappears next week. So a founder who skips can review / correct / delete their collected reports only by typing
  the URL until then. Low severity (the data is safe and the view returns next week), but it undercuts the
  feature's "your report, your data — correct or delete anything" promise.
- **Fix (not done):** give `/b/:id/reach` a persistent entry point independent of the prompt's visibility — a nav
  item, or a small always-present link somewhere on Today / Business. No backend change needed.

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
