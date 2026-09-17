# Instagram in the pour-in — deferred until after MVP validation

**Status: HIDDEN, not deleted.** Founder decision (post-Issue-2): move to MVP validation now with the three
working no-OAuth connectors (website, paste-a-link, file upload); return to Instagram after real testers
validate the MVP. This note captures exactly what to do when we return, so nothing has to be re-investigated.

## What is in place right now
- **Hidden in the UI:** `apps/web/src/slice0/ArcSurface.tsx` `PourIn` no longer renders the Instagram card.
  No "NEXT" pill, no stub, no "coming soon" — it is simply absent.
- **Left untouched (do not delete/modify until we return):**
  - The **direct Instagram Login** connector — `apps/api/src/connectors/instagram/*`,
    `getInstagramConnector()`, scopes `instagram_business_basic` + `instagram_business_manage_insights`
    (App-Review approved). This remains available as a FALLBACK for founders whose personal Instagram *is*
    their business account.
  - The arc route `POST /v1/businesses/:id/arc/source/instagram` and the web client fns `arcAddInstagram` /
    `getInstagramConnectUrl` (unused, reversible).
  - `ArcView.igConnected` (still computed server-side, unused by the UI).

## The correct flow when we return: Facebook Login for Business
Direct Instagram Login forces the browser's logged-in (usually personal) account with no picker. The correct
flow for reading a **business** Instagram is **Facebook Login for Business** via the EXISTING Meta connector
(`apps/api/src/connectors/meta/*`), which already: authorizes at facebook.com, `listPages()` (the founder's
Pages, each with `hasInstagram`), `readSelectedPage(pageId)` (a chosen Page + its linked IG Business account).

### Build steps (deferred — do NOT build now)
1. Switch the arc's Instagram source from the direct connector to the **Meta** connector.
2. Add a **page-selection** step in the pour-in: Connect Facebook → list Pages → founder picks the business
   Page → read the linked Instagram Business account.
3. Extend the Meta connector to read Instagram **post captions**:
   `GET /{ig-business-account-id}/media?fields=caption,like_count,comments_count,permalink,timestamp` with the
   Page token under `instagram_basic`. (`readSelectedPage` currently reads IG profile only — no captions.)
4. Route the captions into the arc engine as OBSERVED evidence (the `ingestTextForPourIn` +
   `bridgePourIn` seam already exists and is proven).

## Requirements to check before that build
- **Env (verified present in prod 2026-09):** `META_CLIENT_ID`, `META_CLIENT_SECRET`, `META_REDIRECT_URI`
  (host `app.getbusinessbrain.com`), `META_CONFIG_ID` — all SET.
- **Permissions:** `instagram_basic`, `pages_show_list`, `pages_read_engagement` need **Advanced Access** for
  production founders, OR each founder must be added as a **Meta Tester** (Standard Access works for
  testers/admins — fine for a small pilot). Approval state is only visible in the Meta App Dashboard
  (developers.facebook.com → app `1497368125469672` → App Review → Permissions and Features; and App Mode
  Live/Dev) — not determinable from the codebase.
- **Founder prerequisite (hard Meta platform constraint, no workaround):** the business Instagram must be a
  Professional (Business/Creator) account **linked to a Facebook Page the founder administers**. A personal IG,
  or a business IG not linked to a Page, cannot be read by any Instagram API.

See also `docs/sources/gmail-and-google-business-request.md` (the other deferred, approval-gated connectors).
