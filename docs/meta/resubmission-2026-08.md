# Meta App Review — FINAL Operational Resubmission Package (Aug 2026)
**Rejection:** "Screencast Not Aligned with Use Case Details" (Dev Policy 1.6) — `instagram_business_basic` + `instagram_business_manage_insights`. `public_profile` renewed.
**App:** Business Brain · Instagram App ID `1119839884555345` (Instagram API with Instagram Login) · Live: `app.getbusinessbrain.com`
**Root cause accepted:** prior screencast showed *"You previously connected…"* (a re-connect), not a fresh permission grant; notes also weren't mapped 1:1 to the video. `/sources` is sufficient — **no code change.**

---

## 1. Revoke the app from the Instagram tester account (get a fresh authorization state)

Do this on the SAME Instagram professional/tester account you will record with (`claudiacojoc`).

**Primary path (Instagram web, most reliable):**
1. Go to **https://www.instagram.com/accounts/manage_access/** (this is the "Apps and websites" page). Log in as the tester account if prompted.
2. Open the **Active** tab.
3. Find **"Business Brain Social Conn-IG."**
4. Click it → **Remove** → confirm.
5. Verify it now appears under **Expired/Removed** (or is gone from **Active**).

**Fallback path (Instagram mobile app):**
- Profile → ☰ menu → **Settings and activity** → **Apps and websites** (or **Accounts Center → Connected experiences → Apps and websites** if the account uses Accounts Center) → **Active** → **Business Brain Social Conn-IG** → **Remove**.

**Then clear browser state so IG can't silently re-use the old session:**
- Record in a **fresh browser profile** or an **incognito/private window**, OR clear cookies for `instagram.com`. This forces Instagram to re-prompt the full consent instead of a one-tap reconnect.

## 2. What Claudia should expect on the NEXT authorization (after revocation)

When you click **Connect Instagram** you should see, on **instagram.com**:
1. (If logged out) an Instagram **login** screen — log in as the tester account.
2. A **permissions/consent screen** headed roughly *"Business Brain Social Conn-IG is requesting access to…"* that **lists the requested permissions** (profile info / your content / insights) with an **Allow** (or "Allow access") button.
3. It must **NOT** say *"You previously connected Business Brain Social Conn-IG."* — if it does, revocation didn't take: repeat §1, and clear `instagram.com` cookies / use a fresh incognito window.
4. After **Allow**, the browser returns to `app.getbusinessbrain.com/sources?connected=instagram` and status flips to **Connected**.

## 3. PRE-RECORDING CHECKLIST — do NOT start recording until every box is TRUE
- [ ] App revoked on the tester account (§1) and confirmed gone from **Active**.
- [ ] Recording in a fresh/incognito browser profile; `instagram.com` not already authorized to the app.
- [ ] Deployed web build serves **`/sources`** with the `SourcesPage` (per-permission blocks + "Data read from your account" + "Permission status"). Do **not** deploy the local Slice-0 `App.tsx`.
- [ ] Reviewer app login works: `reviewer@getbusinessbrain.com`.
- [ ] Instagram tester (`claudiacojoc`) invite accepted; the account has ≥1 recent post with reach available.
- [ ] Redirect URI registered in Meta: `https://app.getbusinessbrain.com/api/sources/instagram/callback`.
- [ ] Browser UI language = **English**; screen recorder captions/annotations ready.
- [ ] Dry-run once (not recorded) to confirm the fresh consent screen appears and `/sources` populates.

## 4. Screencast script (90–120s) — timestamps · action · visible screen · caption

| Time | Action | Visible on screen | English caption / narration |
|---|---|---|---|
| 0:00–0:06 | Show URL bar | `https://app.getbusinessbrain.com` | "Business Brain, live at app.getbusinessbrain.com." |
| 0:06–0:13 | Sign in | App login page → signed in | "The business owner signs into our app." |
| 0:13–0:20 | Go to `/sources` | Instagram card: **Not connected**; two greyed permission chips | "On Sources, Instagram is not connected. These two chips are the permissions we request." |
| 0:20–0:25 | Click **Connect Instagram** | Button click → redirect starts | "The owner clicks Connect Instagram — this uses Instagram Business Login." |
| 0:25–0:44 | (a) Fresh auth · (b) grant | **instagram.com consent screen listing the permissions** (NOT "previously connected") | "This is the Instagram authorization screen. The owner grants instagram_business_basic and instagram_business_manage_insights." |
| 0:44–0:48 | Click **Allow** | Consent → redirect back | "Clicking Allow grants both permissions." |
| 0:48–0:54 | (c) Return | `/sources`: **Connected**; chips ✓ ✓ | "Back in the app: Instagram is Connected and both permissions are granted." |
| 0:54–0:58 | (d) Click **Read Instagram data** | Button click → data loads | "The owner reads their Instagram data." |
| 0:58–1:06 | (e) basic | **Account · instagram_business_basic** — username, followers, following, media count | "Under 'Account · instagram_business_basic': the account's own profile, from GET /me." |
| 1:06–1:14 | (f) insights | **Account insights · instagram_business_manage_insights** — reach | "Under 'Account insights · instagram_business_manage_insights': account reach, from the insights permission." |
| 1:14–1:24 | (g) per-post | **Recent posts · with per-post insights** — caption + reach / likes / comments | "Each of the owner's own recent posts: caption from basic; reach, likes, comments from insights." |
| 1:24–1:31 | (h) endpoints | **Data read from your account** — GET /me · GET /me/media · GET /{ig-user-id}/insights · GET /{media-id}/insights | "'Data read from your account' lists the exact endpoints called for these two permissions." |
| 1:31–1:36 | (i) status | **Permission status** — ✓ instagram_business_basic · ✓ instagram_business_manage_insights | "Permission status confirms both were granted and used." |
| 1:36–1:55 | (j) downstream (≤20s) | `/business-brain` → **Evidence** section | "Finally, the app turns this real data into plain-language guidance — the Evidence section; every number traces to the imported posts." (Scroll once, do not dwell.) |

**Keep the downstream analysis to ≤20 seconds (1:36–1:55). Do not narrate Root Causes / Recommendations in depth.**

## 5. FINAL submission notes (paste verbatim)

**How will your app use `instagram_business_basic`?**
> A signed-in business owner connects their own Instagram professional account via **Instagram Business Login** (screencast 0:20–0:48). We read their own **profile** and **recent media**. In-product on the **Sources** screen: **"Account · instagram_business_basic"** shows username, followers, following, media count (`GET /me`, screencast 0:58); **"Recent posts · with per-post insights"** shows caption, media type, timestamp, permalink, like/comment counts (`GET /me/media`, screencast 1:14). This content is then analysed into plain-language guidance shown in **Business Brain → Evidence** (screencast 1:36). The authorization-code → token exchange is performed **server-side**; tokens are stored encrypted and never exposed to the browser.

**How will your app use `instagram_business_manage_insights`?**
> We read **reach** for the owner's own account and their own recent posts. In-product on the **Sources** screen: **"Account insights · instagram_business_manage_insights"** shows account reach (`GET /{ig-user-id}/insights`, screencast 1:06); **"Recent posts · with per-post insights"** shows each post's reach (`GET /{media-id}/insights`, screencast 1:14). Reach is shown alongside engagement so the generated guidance reflects real audience reach. The endpoints called are listed on screen under **"Data read from your account"** (1:24) and both permissions show ✓ under **"Permission status"** (1:31). The Instagram Business Login consent is the visible authorization (0:25–0:48); the token exchange and all Graph reads (`graph.instagram.com`) are **server-side** using the account's own Instagram user token. **There is no Facebook Login screen** — the visible login/consent is the Instagram screen shown.

**Will you access data of users who are not app admins/testers?**
> Only after approval. Recorded in development mode on the owner's own Instagram professional account (Tester role), with a **freshly granted** authorization.

## 6. Reviewer-proof checklist — "Can the reviewer visibly verify X?"
- [ ] **#1 Complete Meta login flow** — instagram.com consent visible at **0:25–0:48**? (not a re-connect)
- [ ] **#2 User granting access** — permissions listed and **Allow** clicked at **0:44**, on a FRESH grant?
- [ ] **#3 End-to-end per permission** — basic data at **0:58** + **1:14**; insights data at **1:06** + **1:14**?
- [ ] **Permission → data legible** — each block header names its permission; endpoint list at **1:24**; ✓ status at **1:31**?
- [ ] **Downstream use shown** — Evidence section at **1:36**, ≤20s?
- [ ] **#4 Screen Recording Guide** — English UI, captions on every scene, each button explained?
- [ ] **#5 Server-side / no FB login** — stated in the notes (§5) and consistent with the video?
- [ ] **Notes ↔ video 1:1** — every note sentence cites the on-screen label + timestamp it maps to?
- [ ] **No "previously connected"** anywhere in the recording?

## 7. Product/UI change required? — **No.** Screencast + notes only. Precondition is operational: the fresh grant (§1–§3).

---

## Runtime OAuth diagnosis (Aug 10 — feed-instead-of-consent)
- **BB authorize URL (runtime, prod values):** `https://www.instagram.com/oauth/authorize?client_id=1119839884555345&redirect_uri=https://app.getbusinessbrain.com/api/sources/instagram/callback&response_type=code&scope=instagram_business_basic,instagram_business_manage_insights&state=…` — correct endpoint/app-id/redirect/scopes/state.
- **Instagram routing (unauthenticated probe):** accepts structurally → `/oauth/authorize/third_party/` → `/accounts/login/?...&next=<authorize>`. **A BOGUS client_id routes identically** → the pre-login probe CANNOT validate app config; validation is post-login. Instagram **defaults `enable_fb_login=1`** when the param is absent (our code omits it); passing `enable_fb_login=0` is respected.
- **Callback:** a feed landing means Instagram never redirected to our `redirect_uri` → `/api/sources/instagram/callback` is **never reached**; no code, no token exchange.
- **Disconnect:** deletes the LOCAL encrypted token only. `/api/sources/instagram/deauthorize` is INBOUND (verifies Meta `signed_request`), NOT an outbound revoke — BB cannot clear an Instagram-side grant; a fresh grant requires `instagram.com/accounts/manage_access/`.
- **Repo red flag:** `screencast-package.md` lists "Redirect URI registered in Meta" as an UNCHECKED box → the Valid OAuth Redirect URI may never have been registered.
- **Verdict:** not a BB code bug (URL is correct); the failure is at Instagram's post-login consent step → **Meta app config and/or tester-account eligibility.** Needs dashboard evidence (below).
