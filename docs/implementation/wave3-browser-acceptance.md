# Wave-2 Acceptance Debt A — Full Founder-Visible Browser Acceptance Pass

## Environment

- **Worktree:** `/Users/claudiacojoc/Desktop/business_brain-memory` (branch `feature/axe-wave2-understanding`)
- **Commit at start:** `c28579e`
- **API:** current worktree source, esbuild-bundled (`--packages=external`, engine loaded via runtime `import()`), booted on `:3000` with a non-shell env loader (secrets read from the primary `.env` into `process.env`, never printed). Real understanding worker + real market-review worker in-process (`NODE_ENV=development`). Real Anthropic synthesis/inference (key present). Google encryption key present.
- **Web:** worktree `apps/web` via vite dev server on `:5173` (proxies `/api`, `/dev` → `:3000`).
- **DB:** dockerized postgres `localhost:5432/businessbrain`, migrations through **V064** (applied). Redis `localhost:6379`.
- **Stale `bb-api` + `bb-workers` containers stopped** so they can't claim jobs with old code. `bb-postgres` + `bb-redis` kept.
- **Browser:** in-app Chromium preview pane. Viewports exercised: desktop 1280×720 and mobile 375×812 (Part E).

## Setup defects found & fixed before acceptance could begin

| # | Defect | Fix |
|---|--------|-----|
| S1 | `preview_start name:"web"` launched vite rooted in the **primary** repo (`business_brain/apps/web`, branch `feature/meta-thin`) — it served the wrong frontend (password login instead of the worktree's magic-link). Every observation would have tested the wrong code. | Stopped that preview, launched vite with the worktree `apps/web` pinned as root (`cwd=business_brain-memory/apps/web`); confirmed it serves the worktree source. |

## Outcome — Wave-2 acceptance debt A

**Debt A (founder-visible browser click-through) is CLOSED** for authentication/arrival and both founder-facing systems (Business Understanding, Public Positioning Context), driven against the real API, real web app, real local DB (V064), real understanding + market workers, and real Anthropic synthesis/inference. Processing + review refresh/reconnect, the full founder response semantics (Confirm/Partly/Correct/Reject/revise; source-accuracy × business-relevance; qualifications; supersession; effective-state-after-refresh), the reachable failure/retry paths, and two-founder isolation are all browser-verified. Six browser-discovered defects were fixed and the fixes browser-re-verified; regressions are green; production is untouched; the frozen engine is byte-identical.

**One precisely-scoped residual (not a click-through blocker):** four/five market failure categories (ROBOTS_BLOCKED, UNSUPPORTED_CONTENT, INSUFFICIENT_READABLE_EVIDENCE, RETRIEVAL_FAILED, INFERENCE_FAILED) are **worker-verified but not browser-exercised**, because the production build wires the real connector/model with no controlled-outcome injection (UNREACHABLE + understanding INSUFFICIENT were browser-exercised with real deterministic inputs). Closing this needs a dev-only, env-gated fixture adapter — a deliberate, separable addition intentionally not built in this pass to avoid touching the real retrieval/inference paths.

### Defects fixed (all browser-re-verified)
| ID | Summary | Layer |
|----|---------|-------|
| S1 | Preview server rooted in the wrong repo (primary vs worktree) | setup |
| D1 | Understanding: refresh during processing dropped to intro (no reconnect) | api + web |
| D2 | Understanding: "revise my response" was a dead control | web |
| D3 | Understanding: "(revised)" indicator could never show (`revisedEarlier` hardcoded) | api |
| D5 | Market: refresh lost findings/responses + in-flight review + terminal-failed state | api-client + web |
| D6 | Market: add form couldn't choose entity type / relevance note | web |
| E-wrap | Market add-form row cramped on mobile | web |

### Regression gate (after fixes)
API **418 passed / 1 skipped**; web **73 passed**; API + web typecheck clean; production web build OK; frozen-engine hashes byte-identical (`prompt=a39ea88…`, `schema=79802e9…`, `index=f9df116…`). New automated coverage: D1 (`GET /understanding/runs/active` reconnect + isolation) and D3 (`revisedEarlier` true-on-revision / false-once) in the existing vitest+app.inject harness. No browser-test framework exists in the repo, so none was introduced (per instruction); the frontend fixes (D2/D5/D6) are browser-verified + typechecked.

## Flows driven

### Part A — authentication & arrival ✅ (browser-verified, viewport 1280×800)
Account created for the pass: `acc.a@browser.test`.

| Check | Result |
|-------|--------|
| Sign up → session → Welcome | ✅ `/signup` → httpOnly `bb_session` set → `/welcome` ("Good to meet you…") |
| Password validation | ✅ short password → 400 → alert "Enter a valid email and a password of at least 8 characters." |
| Logout (Sign out button) | ✅ real handler → `/start`, `GET /auth/me` → 401 |
| Sign in again → session restored | ✅ `/signin` correct password → `/welcome` |
| Invalid credentials | ✅ 401 → alert "Invalid email or password." |
| Refresh while authenticated | ✅ reload `/welcome` stays `/welcome` (cookie-restored) |
| Unauthenticated protected routes | ✅ `/understand`,`/market` → `/signin`; `/account` → `/login` (both block) |
| Google hidden when not configured | ✅ server-gated via `GET /api/auth/capabilities` (`{googleLogin:true}` here since configured; hook defaults hidden). Live hidden-render not reproduced (Google IS configured in this env). |
| Back/forward no stale protected content | ✅ Back after logout → `/login` (public); `/welcome` reload while logged-out redirects to `/start` |

**Session cookie** is httpOnly (JS cannot read it) — correct. No product defects found in Part A.

Minor observation (not a defect): `/account` redirects unauthenticated users to `/login` while the newer `/understand` & `/market` redirect to `/signin`. Both correctly block access; the target is just inconsistent between the legacy and A–E pages.

### Part B — Business Understanding ✅ (browser-verified, real frozen engine + real Anthropic synthesis)
Drove `/welcome → /understand`, submitted **https://getbusinessbrain.com** (real ingest → frozen engine → real synthesis).

| Check | Result |
|-------|--------|
| Processing stages | ✅ QUEUED ("Getting ready…"), ANALYZING ("Cross-referencing what I found…"), READY (reveal) all seen in UI; SYNTHESIZING confirmed at run-state level (same STAGE mapping). |
| READY reveal | ✅ grouped ("WHAT SEEMS CLEAR"), prioritized, provenance "FROM YOUR SITE", 9 conclusions. |
| Evidence expand/collapse | ✅ "What this rests on" fetches the on-demand receipt (real site text). |
| Confirm | ✅ "You confirmed…" — no correction field required. |
| Partly | ✅ form with 2 fields; empty-qualification Save blocked; accepted + qualification stored & shown SEPARATELY. |
| Correct | ✅ "Save correction" disabled until text; correction shown as "In your words" (distinct from observed); original conclusion preserved. |
| Reject | ✅ "You said this doesn't reflect your business" — no fabricated opposite/correction. |
| Refresh restores effective responses | ✅ all four restored after reload; **original synthesis preserved**. |
| Revise an earlier response | ✅ (after D2+D3 fixes) revise form opens; "(revised)" indicator shows. |
| insufficient_evidence / failed | ✅ `https://dup-test.example` (unreachable) → FAILED/`insufficient_evidence` → founder-safe "I don't have enough to read yet…" + "Try again"/"Change website". |
| Retry | ✅ "Try again" re-queues → processing. |
| Duplicate submission | ✅ two POSTs → both 202, **same runId** (idempotent active run). |
| Refresh during processing (reconnect) | ✅ **after D1 fix** — cold load during an active run reconnects to the processing screen and resumes polling. |
| Prior READY preserved if a later run fails | ✅ dup-test FAILED while the getbusinessbrain READY understanding stayed intact and shown. |

**States not fully reproduced (honest):** API-restart-mid-run and worker-restart recovery rely on the 5-minute lease-expiry sweep (`recoverStale`), impractical to wall-clock in-session; durable state + reconnect are proven, and `recoverStale` has unit coverage. SYNTHESIZING was confirmed at the run-state level, not visually frozen in the UI (it transitions quickly; identical STAGE mapping to the confirmed stages).

## Defects found in the product

**D1 — Refresh during processing dropped the founder to the intro form (no reconnect).** `UnderstandPage` mount only checked `getUnderstanding()`; with `runId` lost on refresh, polling never resumed even though the durable worker kept running (the code comment even claimed "survives page refresh"). **Fixed:** added `GET /understanding/runs/active` (+ repo `findActiveByFounder`) and `getActiveUnderstandingRun`; mount now reconnects to an in-flight run → resumes polling. Browser-verified.

**D2 — "Revise my response" was a dead control.** The conclusion card rendered `{r ? respondedView : mode==='partly' ? … : mode==='corrected' ? …}`, so an existing response always shadowed the revise `mode` — clicking "revise my response" did nothing. **Fixed:** `{(!mode && r) ? respondedView : …}` so an active mode surfaces the revise form. Browser-verified.

**D3 — "(revised)" indicator could never appear.** `revisedEarlier` was hardcoded `false` in the understanding view (understanding.routes.ts). **Fixed:** repo `revisedConclusionIds` (conclusions with a superseded response) threaded into `toView` → `revisedEarlier: revised.has(c.id)`. Browser-verified (API reports true; UI shows "(revised)").

**D4 (minor, pre-existing infra — documented, not fixed) — rate-limit surfaces as HTTP 500.** The global `@fastify/rate-limit` (20 non-GET/min, keyed by IP since there's no JWT `user`) returns `RATE_LIMIT_EXCEEDED`, but the global error handler maps any non-`DomainError`/`ApplicationError` to `500 INTERNAL_ERROR` — so a rate-limited founder sees a 500 instead of a 429 "Too many requests." Only trips under abnormal load (my automation's burst of POSTs), never the normal single-submit path (idempotency verified clean). Out of the Wave-2/3 feature scope; fixing it means changing the global error handler's status mapping (would ripple error-handler tests). **Recommendation:** in `error-handler.plugin.ts`, preserve a 4xx `error.statusCode` (e.g. 429) instead of forcing 500.

### Part C — Public Positioning Context ✅ (browser-verified, real robots-respecting connector + real Anthropic inference)
Added **Acme Rival Studio** (https://getbusinessbrain.com, permitted) + a review.

| Check | Result |
|-------|--------|
| Add entity (type + website + relevance) | ✅ after the D6 add-form enhancement — Relationship selector + relevance-note field; created "Indirect Alt Co" as `alternative` with a note. |
| Founder-added begins confirmed | ✅ |
| Create review → polling → READY | ✅ QUEUED ("Getting ready…"), INFERRING ("Forming a careful reading…"), READY (findings). RETRIEVING/EXTRACTING are transient on a fast site (both messages exist). |
| Observations vs inference separate + source links + provenance | ✅ 5 observations (adapter=website-connector, extract-1, model=null, source URLs) + 1 inference (SYNTHESIZED_FROM_OBSERVED, model=claude-sonnet-5, prompt=market-infer-sys-1, hedged "The site presents…"). Provenance bounded — no credentials/lease/internal detail. |
| Accuracy + relevance (independent) + qualifications | ✅ full matrix: accurate-but-not-relevant (yes/not_relevant); inaccurate inference (accuracy=no) while entity stays confirmed; relevant-with-qualification (partly_relevant + qual); accuracy=partly + qual. The two judgments never collapse. |
| Orchestration projection | ✅ `/market/context`: usable = the two accurate+relevant/partly findings (with qualifications); **excluded** = not_relevant and the inaccurate (accuracy=no) inference; provisional = unreviewed. |
| Revise a response → refresh restores | ✅ supersession (history 2, one effective); **after D5 fix** findings + all effective responses + qualification textareas restore on reload. |
| Refresh during review (reconnect) | ✅ **after D5 fix** — reload mid-review reconnects to processing ("Forming a careful reading…") and resumes polling. |
| Second/third review → prior retained + lineage | ✅ 3 READY reviews in history; latest `priorSuccessfulReviewId` set; provenance present (accessible via history/export; primary UI shows the latest). |
| Dismiss → restore | ✅ dismiss → dismissed + findings preserved (18, not deleted); restore → confirmed (founder_added), dismissed_at cleared. |

**Not reproduced / gaps:** `bb_suggested → proposed` restore — no bb-suggested entities exist (no discovery in the product); covered by the deterministic `market-provenance-lineage` test. Editing entity **type/website/relevance-note _after_ creation** is not exposed in the UI (API supports it via PATCH) — a minor remaining gap (documented below as D7).

## Defects found in the product (Part C)

**D5 — Market page lost the review view on refresh (analogue of D1).** `MarketPage` loaded only entities on mount; findings lived in component state from the live poll, and there was no reconnect to an in-flight review — so a page refresh wiped the observations/inference/responses (though persisted in the DB) and dropped any in-progress review. **Fixed:** added `getEntityReviews`; the mount effect now hydrates each entity's existing findings and reconnects to any active review (resuming polling). Browser-verified (D5a findings+responses+qualifications restore on reload; D5b reconnect to processing mid-review).

**D6 — Add form couldn't choose entity type or explain relevance.** The form exposed only name + website; the task's "choose entity type"/"explain relevance" weren't reachable though the API accepted them. **Fixed (minimal, non-redesign):** added a Relationship `<select>` (direct/indirect/alternative/reference) and an optional relevance-note field; both flow to `addMarketEntity`. Browser-verified.

**D7 (minor gap — documented, not fixed).** Changing an existing entity's type / website / relevance-note is not exposed in the UI (only dismiss/restore/read + now type/note at add time). The PATCH API supports all three. Low priority; would be a small inline-edit addition.

### Part D — controlled failure fixtures & retry
| Category | Browser | Notes |
|----------|---------|-------|
| UNREACHABLE | ✅ browser-verified | `https://dup-test.example` (DNS always fails) → review FAILED/`UNREACHABLE` → founder-safe "I couldn't reach that website. Check the address and try again." + "Try again" (retryable). After the **D5 terminal-state fix**, this survives a page refresh. |
| INSUFFICIENT (understanding) | ✅ browser-verified | Part B — `dup-test.example` understanding run → `insufficient_evidence` → "I don't have enough to read yet…" + "Try again". |
| ROBOTS_BLOCKED, UNSUPPORTED_CONTENT, INSUFFICIENT_READABLE_EVIDENCE (market), RETRIEVAL_FAILED, INFERENCE_FAILED | ⚠️ **worker-verified, not browser-exercised** | These require **controlled adapter/model outcomes**. The production build wires the real robots-respecting `WebsiteResearchAdapter` + real `AnthropicMarketInference` with **no controlled-outcome injection**, so they cannot be triggered from the browser with stable inputs (and the task forbids leaning on unstable external sites to manufacture them). All six categories — with their distinct founder-safe `FAILURE_MESSAGE` and `INSUFFICIENT → retryable` eligibility — are deterministically covered by `market-review.test` ("failure categories" test: ROBOTS_BLOCKED / UNREACHABLE / UNSUPPORTED_CONTENT / INSUFFICIENT_READABLE_EVIDENCE / RETRIEVAL_FAILED / INFERENCE_FAILED via a fake adapter + throwing model). **This is the one Part-D item not fully closed in-browser**; closing it would need a dev-only env-gated fixture adapter (a deliberate, separable addition, not built in this pass to avoid touching the real retrieval/inference paths).

**D5 extended** — a *terminal-failed* latest review (FAILED/INSUFFICIENT_EVIDENCE) was not restored on mount, so its founder-safe message + retry vanished on refresh. Fixed alongside D5: mount now restores the latest review's terminal-failed state (message + "Try again"). Browser-verified via the UNREACHABLE case.

### Part E — responsive & interaction quality ✅
Desktop 1280×800 and mobile 375×812. Market page (most complex) and understanding reveal both: **no horizontal overflow** (bodyScrollW == clientW, 0 overflowing elements), controls reachable, qualification fields usable, source links + long evidence text wrap without breaking layout, loading uses non-destructive placeholders. Buttons that trigger async work carry `loading`/disabled states (no accidental double-submit); "Save correction" and the finding-review Save show clear disabled/ghost states; validation messages are founder-legible (Parts A/B). **Fix:** the enhanced add form's top row now `flex-wrap`s so the Relationship selector drops to its own line on narrow screens instead of cramping name/website.

### Part F — persistence & isolation (two founders) ✅
Founder A (`acc.a@browser.test`, 3 entities + reviews + findings + understanding) vs a fresh Founder B (`acc.b@browser.test`). As B:

| Vector | Result |
|--------|--------|
| B's own entities / understanding | ✅ 0 entities; `/understanding` → 404 |
| GET A's review by id | ✅ 404 |
| GET A's finding response history | ✅ 404 |
| POST a response to A's finding | ✅ 404 |
| PATCH (dismiss) A's entity | ✅ 404 |
| GET A's entity findings (founder-scoped) | ✅ 0 |
| Direct URL nav `/understand`, `/market` as B | ✅ B's intro / "No companies added yet" — **no A data leaks or flashes** |
| Logout clears private state | ✅ (Part A + B's fresh session shows empty) |

## Defects found in the product (Part A)

_(none in Part A)_

## States not reproducible

- **Google login hidden (live render):** Google is configured in this environment (`{googleLogin:true}`), so the button correctly shows. The hidden branch is the hook's safe default (server-declared readiness); reproducing the live hidden render would require unconfiguring Google + API reboot. Mechanism verified.

---

# Final Wave-3 founder-facing increment (from commit `7a88030`)

Two objectives: (1) controlled browser coverage for **every** market-review terminal/failure category, and
(2) **edit-after-create** for market entities. Rate-limit→429 was explicitly **excluded** (see transversal item).

## 1. Controlled-outcome adapter (gating)

`apps/api/src/business-model/fixture-research.adapter.ts` — a `FixtureResearchAdapter` + `FixtureInferenceModel`
pair wrapping the real adapter/model, installed via `maybeWrapMarketFixtures`:
- **disabled by default** (returns the real pair unchanged when `MARKET_FIXTURE_ADAPTER` is unset — verified);
- **refuses to start in production-capable mode** (`NODE_ENV=production` + flag → throws — unit-tested);
- **only the reserved dev host `fixture.market.test` triggers it**; every real URL delegates to the real
  adapter (verified in-browser: a `getbusinessbrain.com` review still ran on `retrievalAdapter=website-connector`);
- **no founder-facing internal detail** — outcomes flow through the normal founder-safe messages.

Enabled for this browser session via the boot loader (`MARKET_FIXTURE_ADAPTER=1`, `NODE_ENV=development`).

**Fixture catalog** — `https://fixture.market.test/<outcome>`: `ready`, `robots-blocked`, `unreachable`,
`unsupported`, `insufficient`, `retrieval-failed`, `inference-failed`.

## 2. All seven outcomes — browser-driven through the REAL durable worker

Seven fixture entities (`FX <outcome>`) created + reviewed via the real create-review route → DB state machine →
worker → polling → terminal-state rendering. Verified in the rendered UI after reload (mount restore):

| Fixture | Terminal state | Founder-safe message (rendered) | "Try again" shown | Retryable (policy) |
|---------|----------------|--------------------------------|-------------------|--------------------|
| ready | READY | (findings render — "WHAT THEIR SITE SAYS" + inference) | — | — |
| robots-blocked | FAILED / ROBOTS_BLOCKED | "That site asks not to be read automatically. Try a different source." | **no** | not retryable |
| unreachable | FAILED / UNREACHABLE | "I couldn't reach that website. Check the address and try again." | **yes** | retryable |
| unsupported | FAILED / UNSUPPORTED_CONTENT | "That page isn't a readable web page. Try a different page or URL." | **no** | not retryable |
| insufficient | INSUFFICIENT_EVIDENCE / INSUFFICIENT_READABLE_EVIDENCE | "I couldn't read enough from that page. Try a page with more content." | **no** | not retryable |
| retrieval-failed | FAILED / RETRIEVAL_FAILED | "Something went wrong reading that site. Nothing was lost — try again." | **yes** | retryable |
| inference-failed | FAILED / INFERENCE_FAILED | "Something went wrong forming the reading. Nothing was lost — try again." | **yes** | retryable |

- **Async start + polling + terminal + refresh/reconnect:** reviews start asynchronously (202); after a reload
  the mount hydrates findings + restores the terminal-failed message + retry (the D5 restore).
- **Retry requeues:** clicking "Try again" on `unreachable` re-queued the SAME review (attempt 2) through the
  full lifecycle → failed again. Retry is offered **only** for retryable categories (browser-confirmed).
- **No leakage:** a full scan of the rendered page + review views found **no** `lease_expires` /
  `internal_error_detail` / raw fixture error strings / stack traces / `request_id` / provider errors /
  credentials — only founder-safe messages. (The word "fixture" appears only inside the fixture's own
  synthetic page content, shown correctly as observed source text.)

## 3. Retry matrix (encoded in DOMAIN logic — `RETRYABLE_CATEGORY` in `market-review.ts`)

| Category | Retryable | Rationale (founder-legible) |
|----------|-----------|------------------------------|
| ROBOTS_BLOCKED | no | deterministic block — change the source, not blind retry |
| UNSUPPORTED_CONTENT | no | format won't change on retry — use a different URL |
| INSUFFICIENT_READABLE_EVIDENCE | no | same page → same emptiness — change the page/source |
| UNREACHABLE | yes | often transient network (or fix a typo'd URL by editing) |
| RETRIEVAL_FAILED | yes | transient fetch failure |
| INFERENCE_FAILED | yes | transient inference failure |

Enforced in `PgMarketReviewRepository.retry()` (non-retryable → the retry route 409s) and surfaced as
`retryable` in the review view; the UI shows "Try again" only when `retryable`.

## 4. Entity edit-after-create (browser-driven)

Edit affordance on each entity card → form (name / website / type / relevance note) → save. Verified:
- **name / type / note edits** persist; **id + origin preserved**.
- **name collision** with the founder's own entity → **409 "You already have a company with that name."**
- **website change** → `website_changed_at` recorded; the form warns "current reading historical"; on save the
  card shows the banner **"The website changed. The reading below is from the old site — run a fresh review to
  update it."** + a **"Review new site"** button; prior findings remain **visible + preserved with their
  original sourceUrl** but are **excluded from current orchestration** (`/market/context`); a **fresh successful
  review of the new site restores** current-context eligibility (`needsFreshReview` → false).
- editing a **dismissed** entity keeps it dismissed; **founder isolation** (B cannot edit A's entity → 404);
  **export** reflects edited fields + `website_changed_at`; **delete** still removes all founder-owned data.

## Defects found in this increment

None. The implementation behaved correctly on first browser drive; no fixes required. (Automated coverage:
`fixture-research.test.ts` 13 tests — gating/mapping/delegation + all 7 outcomes through the real worker;
`market-entity-edit.test.ts` 4 tests — edits/dedupe/website-invalidation/isolation/export/delete.)

## Closure statements

- **Residual market failure-category browser gap: CLOSED.** All seven outcomes are now browser-exercised
  end-to-end through the real create-review route, DB state machine, worker, polling, terminal rendering, retry
  rules, and founder-safe presentation — via a gated, non-production controlled adapter (never a frontend simulator).
- **Entity edit-after-create: COMPLETE** — name/website/type/note editable, all history preserved, website
  changes do not contaminate current orchestration, name collisions are founder-legible.
- **Wave 3 is now founder-facing complete.** The only remaining known item is transversal infrastructure
  (rate-limit → 429 mapping, D4), tracked separately below — deliberately **not** part of Wave-3 closure.
