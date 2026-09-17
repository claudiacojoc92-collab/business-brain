# Gmail & Google Business Profile — Google provider requirements

**Current status: SKELETON ONLY, hidden, not wired, pending Google approval.**

Both connectors exist in the codebase as unwired skeletons only:

- `apps/api/src/connectors/gmail/gmail-oauth.ts` + `gmail.connector.ts` (provider `gmail`)
- `apps/api/src/connectors/google-business/google-business-oauth.ts` + `google-business.connector.ts` (provider `google_business`)

Neither is registered in `apps/api/src/routes/index.ts`, exposed by any route, or surfaced in the
web UI. Their read methods are stubs that return `status: 'not_available'` and make no network
calls. Neither can go live until the Google-side requirements below are satisfied. This document is
the exact list of what must be requested from / configured at Google before either connector can be
wired up.

Both reuse the EXISTING authenticated infrastructure (ADR-009): the provider-agnostic encrypted
`app.oauth_credentials` store (provider column — **no migration**), the shared
`GOOGLE_OAUTH_ENCRYPTION_KEY`, and the generic PKCE/CSRF-state OAuth primitives. They follow the
existing Google (Drive/Calendar) connector pattern exactly; only the scope and provider value differ.

---

## 1. Gmail (`gmail.readonly`)

### Scopes to request

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.readonly` | Read-only access to messages/threads/labels |
| `openid`, `email`, `profile` | Identify the connected Google account |

### Google approval required (this is the hard part)

`gmail.readonly` is a **RESTRICTED** scope (Google's most sensitive tier). Before it works for any
user outside the app's own test users, Google requires **all** of the following:

1. **OAuth app verification** — the Google Cloud project's OAuth consent screen must be submitted for
   and pass Google's verification review.
2. **CASA (Cloud Application Security Assessment)** — a mandatory **third-party security assessment**
   performed by a Google-authorized assessor. It is **paid** and must be **renewed annually**. This
   is the single largest cost and lead-time item; plan for it well ahead of any launch.
3. **Brand / consent-screen review** — app name, logo, homepage, and privacy-policy URL are reviewed
   and must match the verified domain.
4. **Justification video** — a screencast demonstrating exactly how the app requests the scope and
   what it does with the data, submitted as part of the restricted-scope review.

Until verification + CASA complete, the app can only exercise `gmail.readonly` for accounts added as
**test users** on the consent screen, and only in "Testing" publishing status.

### Bounded-read commitment (product policy, independent of scope)

The scope technically permits reading the whole mailbox; the connector will not. The implemented
read MUST be **bounded**: only recent sent/received messages with the founder's business contacts,
or a single founder-selected label — never a full-inbox scan (ADR-009 Invariant 5). Document this in
the justification video and privacy policy.

### Env vars (following the `.env.example` naming style)

```
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GMAIL_REDIRECT_URI=http://localhost:3000/api/sources/gmail/callback
```

Production redirect URI: `https://YOUR_DOMAIN/api/sources/gmail/callback`.

### Redirect URIs to register (Cloud Console → Credentials → OAuth client)

- `http://localhost:3000/api/sources/gmail/callback` (local dev)
- `https://YOUR_DOMAIN/api/sources/gmail/callback` (production)

---

## 2. Google Business Profile (`business.manage`)

### Scopes to request

| Scope | Purpose |
| --- | --- |
| `https://www.googleapis.com/auth/business.manage` | Read the founder's locations + public reviews (also covers posts) |
| `openid`, `email`, `profile` | Identify the connected Google account |

### Google approval required

The Business Profile APIs are **not enabled by default** and the scope is **inert** until the
project is granted access:

1. **Business Profile API access request** — submit Google's **Business Profile API access request
   form** to have the Google Cloud project **allow-listed** and granted quota. The `business.manage`
   scope does not function (calls fail / return no quota) until this is approved. This must happen
   **before** the scope will work at all.
2. **Enable the Business Profile APIs** on the project once access is granted.
3. **OAuth app verification** — consent-screen / brand verification, as for any sensitive scope.
4. Business Profile **location verification** is a per-account concern (the founder must own/verify
   their listing), not an app-level gate.

### Env vars (following the `.env.example` naming style)

```
GOOGLE_BUSINESS_CLIENT_ID=
GOOGLE_BUSINESS_CLIENT_SECRET=
GOOGLE_BUSINESS_REDIRECT_URI=http://localhost:3000/api/sources/google-business/callback
```

Production redirect URI: `https://YOUR_DOMAIN/api/sources/google-business/callback`.

### Redirect URIs to register (Cloud Console → Credentials → OAuth client)

- `http://localhost:3000/api/sources/google-business/callback` (local dev)
- `https://YOUR_DOMAIN/api/sources/google-business/callback` (production)

---

## 3. Shared configuration (both connectors)

- **Consent screen**: one OAuth consent screen per Google Cloud project; add both scopes there with
  the app name, logo, homepage, privacy policy, and authorized domain. Restricted/sensitive scopes
  each carry their own review.
- **Encryption key**: both reuse the existing **`GOOGLE_OAUTH_ENCRYPTION_KEY`** (AES-256-GCM) — do
  not introduce a new key.
- **Credential store**: both reuse the existing **`app.oauth_credentials`** table via its `provider`
  column (`gmail`, `google_business`). **No database migration is required** for either provider.
- **OAuth mechanics**: authorization-code + PKCE + CSRF `state`, `access_type=offline` for refresh
  tokens, refresh ahead of expiry, best-effort revoke on disconnect — identical to the existing
  Google connector.

## 4. Go-live checklist (per connector)

1. Complete the Google-side approval above (Gmail: verification + CASA; Business Profile: access-form
   allow-listing + verification).
2. Populate the env vars and register the redirect URIs.
3. Wire the connector into `routes/index.ts` and the composition root (not done in the skeleton).
4. Implement the stub read methods against the real APIs, honoring the bounded-read commitment.
5. Surface the connector in the pour-in UI.
