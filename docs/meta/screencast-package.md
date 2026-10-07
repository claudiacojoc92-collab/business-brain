# Meta App Review — Screencast & Submission Package
**App:** Business Brain Social Conn · **Instagram App ID:** 1119839884555345
**Live URL:** https://app.getbusinessbrain.com · **Prepared:** 2026-07-28

Permissions requested (both demonstrated in one flow):
- `instagram_business_basic`
- `instagram_business_manage_insights`

---

## Prerequisites (state before recording)
- ✅ Production live: `app.getbusinessbrain.com` (api + web deployed, DB migrated V060–V062).
- ✅ Reviewer login works: `reviewer@getbusinessbrain.com` / `MetaReview#2026`.
- ✅ Instagram Tester `claudiacojoc` added + **invite accepted**.
- ⬜ **Redirect URI registered in Meta** (you're adding now):
  `https://app.getbusinessbrain.com/api/sources/instagram/callback`
- Record on the account added as Tester (`claudiacojoc`) — dev-mode access needs no App Review approval.

---

## Screencast flow (record this, ~2–3 min, narrate each step)

1. **Open** `https://app.getbusinessbrain.com` — show the URL bar (real production domain).
2. **Sign in** with `reviewer@getbusinessbrain.com`. → lands in the app.
3. **Open Business Brain** (`/business-brain`). Show "Instagram not connected".
4. **Click "Connect Instagram."** Narrate: *"Business Brain uses Instagram Business Login to read the account's own content and insights."*
5. **Instagram consent screen** appears (instagram.com). Show the requested permissions on screen. **Approve.**
   - This is where `instagram_business_basic` + `instagram_business_manage_insights` are granted.
6. **Return to** `/business-brain` — now shows "Instagram connected".
7. **Click "Generate Business Brain"** (the refresh button). Narrate: *"This imports the account's real recent posts and their metrics."*
   - Behind this: real `GET /me`, paginated `GET /me/media` (captions), and `GET /{media}/insights` (reach) — the two permissions **used in-product**.
8. **The Business Brain renders** from the real account: Current Reality, Why This Matters, **Evidence** (real deterministic measures + "based on N posts from <date> to <date>"), Cannot Yet Know, Root Causes, Recommendations, Execution Plan.
9. Narrate: *"Every number comes from the imported posts; the reading is generated from that real data — no placeholder content."*

This directly answers the prior rejection: it shows **each permission delivering user-facing value on real data**, not a probe screen.

---

## Meta submission form — suggested answers

**How will your app use `instagram_business_basic`?**
> To let a signed-in business owner connect their own Instagram professional account and import their recent posts (media type, caption, timestamp, permalink, like/comment counts). Business Brain analyses this content to explain, in plain business language, how their communication is landing and what to improve. Shown in-product on the "Business Brain" screen (Evidence + diagnosis).

**How will your app use `instagram_business_manage_insights`?**
> To read post-level reach for the owner's own recent media, so the generated "Business Brain" reflects actual audience reach alongside engagement. Displayed in the Evidence section of the owner's Business Brain.

**Will you access data of users who are not app admins/testers?** Only after approval; the screencast is recorded in development mode with the owner's own account (Tester role).

---

## Data handling (have ready — helps approval)
- **Tokens:** long-lived Instagram user token, AES-256-GCM encrypted at rest (`app.oauth_credentials`); never returned to the client or logged.
- **Imported content:** stored per generated version (`businessbrain.bb_observation`, full captions + metrics) as provenance for the analysis; cascade-deleted with the founder / version.
- **Deauthorize / deletion:** disconnect removes the stored credential; account deletion cascades all imported content. (If Meta requires explicit Deauthorize + Data-Deletion callback URLs on the app, add them — endpoints under `/api/sources/instagram/` can serve these; flag if needed.)

---

## Compliance endpoints (DEPLOYED to production — paste into Meta)
Live under the same "Business login settings" modal as the OAuth redirect URI:
- **Deauthorize callback URL:** `https://app.getbusinessbrain.com/api/sources/instagram/deauthorize`
- **Data deletion request URL:** `https://app.getbusinessbrain.com/api/sources/instagram/data-deletion`
- **Public deletion-status URL:** `https://app.getbusinessbrain.com/api/sources/instagram/data-deletion/status?code=<confirmation_code>`

Both verify Meta's `signed_request` (HMAC-SHA256 against the Instagram app secret), purge the credential + all imported posts/captions/generation contexts + derived Business Brain versions, are idempotent, and never log secrets or personal content. Verified in production: invalid signatures → 400; status page → 200.
