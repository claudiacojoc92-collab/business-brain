# Silent-failure survey (2026-10-03)

A systematic sweep of `apps/web` and `apps/api` for one defect class: **the app fails or loses the
founder's work without telling them.** Three motivating examples found earlier the same day — a Meta
disconnect that 500'd, CarouselPage silently dropping rejected files, an upload error swallowed into a
generic "blocked" state — turned out to be instances of a wider pattern. This file is the whole picture,
ranked by what a *paying* founder in the normal loop actually hits, so we can pick what matters instead of
re-discovering it.

This is a survey, not a one-off item — that is why it lives here and not in `known-issues.md`.

## Decisions taken when this was recorded (2026-10-03)

1. **The API error-handler mapping is the highest-leverage fix, and is deliberately NOT being done in the
   long session that produced this survey.** It touches every error path in the product, so it must be done
   first in a fresh session, with a full test pass after. See "The root amplifier" below.
2. **When it is done, add specific error CODES only.** Keep the production `message` masking exactly as it is
   — codes are safe to expose and are what the web maps to localized strings; raw messages are not safe to
   expose and must stay masked in prod. Any HTTP *status* changes are a separate concern: do them in their
   own commit, after checking what the web actually does with each status today (several surfaces branch on
   401/403/404/409/422 via `actionErrorKey`).

Progress note: Tier 1 #1 (TalkDrawer) was fixed in the recording session (commit follows this file). Nothing
else from the list was changed that night.

---

## The root amplifier — ✅ FIXED 2026-10-04

Commit A (`classifyProviderError` in `packages/infrastructure` + the error-handler branch) emits granular
`MODEL_*` codes for raw Anthropic SDK failures; Commit B (web `actionErrorKey`) collapses them to two
founder messages — `action.busy` (rate-limit/overload/timeout/unavailable → a retry is worth it) and
`action.broke` (our-side request-invalid/auth → a retry won't help). HTTP status stayed 500 and the prod
message masking is unchanged, per the decisions below. `MODEL_AUTH` (a rejected API key) logs at **error**
level — it is an operational emergency, the whole product can't generate until a human acts. The original
analysis of the pre-fix behavior is kept below for the record.

**Open questions / gaps surfaced while fixing it (not done, deliberately):**
- **`MODEL_REQUEST_INVALID` has no dedicated message.** A 400/413 (our request was malformed / the context was
  too long) is folded into `action.broke`. A message like "your material was too long — try with less" would be
  more actionable, but `BadRequestError` does not cleanly separate the founder's oversized *input* from a request
  WE built badly, and telling someone they wrote too much when it was our bug is worse than the generic. **If
  `MODEL_REQUEST_INVALID` ever appears in logs with any frequency, it earns its own message.**
- **`action.broke` now points at a reporting path — but only in its own text.** With no alerting in the product,
  a founder telling us is the *only* way anyone learns of a break, so `action.broke` now carries
  `contact@getbusinessbrain.com` inline (the error banners render plain text, so a raw address beats a mailto link
  that wouldn't fire). **The better long-term home is a first-class support affordance in the account menu** — the
  authenticated AppShell menu is still just Language + Sign out, and `/contact` is linked only from the public
  landing + legal footer. That belongs with a broader decision about where support lives in the product, not
  bolted onto one error string; left for that decision.

## The root amplifier (original analysis — pre-fix)

**`apps/api/src/plugins/error-handler.plugin.ts:23-45`.** Only `DomainError` / `ApplicationError` are mapped
to a real status + code. `InfrastructureError`, its subclass `LLMError` (httpStatus 503), and the **raw
Anthropic SDK errors** (the client in `packages/infrastructure/src/llm/anthropic-client.ts` deliberately
rethrows after its own retries, never wrapping in `LLMError`) all fall through to
`500 { code: 'INTERNAL_ERROR' }`. In prod the `message` is additionally replaced with `"An error occurred."`

- **Founder experience:** every "generate / submit" button on a founder path — strategy, carousel, voice,
  conversation, aha2, impact, Home — collapses to the same opaque 500 with no reason and no actionable retry
  on any model or DB hiccup. The web `catch` blocks then have no specific code to map, so even the surfaces
  that *try* to show a specific message can't.
- **Work lost:** none directly — but it is upstream of most Tier-1/2 "generic error" experiences, which is
  why it is the highest-leverage fix.

---

## Tier 1 — hit in the core loop; loses work or misleads

1. **Talk to BB — send fails silently, no reply, no error.** `apps/web/src/slice0/TalkDrawer.tsx:104-113`.
   Input is cleared first, the turn is shown optimistically, then `catch { setView(v => v) }` is a no-op.
   *Founder sees:* their message in the thread, no BB reply, no error — concludes BB ignored them.
   *Work lost:* the message **is** persisted server-side (`conversation.service.ts:231`, before the model
   call), so on refresh it reappears as a dangling turn with no answer — not lost, but zero failure signal.
   Talk is the persistent global action; highest everyday frequency. **(Fixed 2026-10-03.)**

2. **Home screen dies whole on one read failure.** ✅ **FIXED 2026-10-04.** `apps/api/src/routes/home.routes.ts`
   now splits the five reads: the three ESSENTIAL ones (understanding / current strategy / today) stay in a
   `Promise.all` and fail-closed to an honest error (they already return `null` for a legit empty vs *throw* for a
   failure, so a throw never becomes a fabricated "start here" empty); the two ENHANCEMENT reads (`readTodayNote`
   → the "what changed" line, `cycleStatus` → the month-close prompt) are each caught to `null`, so one failed
   additive read no longer takes down the landing surface. `HomePage` retry is now a real `load()` re-fetch, not a
   full `navigate(0)` reload. No API shape change (the composer already accepts `note`/`cycle` null).
   - **Accepted degrade (recorded honestly):** a transient `cycleStatus` failure skips the month-close prompt for
     *that load* (it returns on the next load). The catch logs at warn — but with no alerting and nobody reading
     logs today (established this session), that warn is **effectively silent to us as well as to the founder**.
     The call stands (killing Home over a change-line read would be worse), but it rests on no observability we
     actually have. **If a founder ever reports "the month-close prompt never showed up," this is the first place
     to look** — and a persistent `cycleStatus` failure would only surface if someone deliberately reads the logs.

3. **Month-close reflection lost behind a generic fail screen.** `apps/web/src/slice0/HomePage.tsx:71-78`
   (`catch { setMode('fail') }`, retry = full reload at `:125`) + `apps/api/src/routes/impact.routes.ts:75`
   (for `outcome_report` / `baseline_refresh`, `persistInput=true` writes the founder's text *inside*
   `evaluate`; a throw before that write loses it, and the `outcome_reported` event that feeds month-two
   planning is only written on success). *Founder sees:* types the cycle-close outcome, hits a generic fail,
   textarea gone, reload wipes it. *Work lost:* **typed reflection.** Recurring monthly loop.

4. **Baseline refresh silently drops the verdict and navigates away.** ✅ **FIXED 2026-10-04.** `confirmBaseline`'s
   failure `catch` no longer navigates to Strategy; it surfaces the reason via `actionErrorKey` (busy-vs-broke
   wording) and keeps the founder on the page with the Mirror's confirm button up, so they can retry the
   assessment. The success path and the legit "not a refresh / nothing to assess" navigations (lines 125, 127) are
   untouched. Original finding: `apps/web/src/slice0/ConversationPage.tsx:129-130` — `catch { navigate('/strategy') }`;
   the founder asked for an impact assessment and on failure was silently bounced to Strategy with no message.

5. **Create reads as "you have nothing" when it actually failed to load.** ✅ **FIXED 2026-10-04.** `load()` now
   promotes ANY rejection of `getToday` / `getCurrentStrategy` to the existing `loadErr` path (a real error with a
   real `load()` retry), instead of ignoring it and falling through to `create.none` / the "not now" stance. A
   partial Create is meaningless (the surface leads with the strategy-derived move), so this is whole-surface
   error + retry, matching TodayPage. Original finding:
   `apps/web/src/slice0/CreateIndexPage.tsx:36-42,93-102` — `getToday` / `getCurrentStrategy` rejections in a
   `Promise.allSettled` are ignored, then `setLoaded(true)` runs unconditionally → render falls through to
   `create.none` ("nothing to create yet"), no retry offered. *Founder sees:* a top-level tab telling them the
   product has nothing for them when the backend merely blipped. Worst class (failure indistinguishable from a
   genuine empty state), on a primary tab. *Work lost:* none.

---

## Tier 2 — reachable and real; lower frequency or recoverable

6. **PhotoCreatePage: upload error → "I can't use these photos" + transient load bounces home.**
   `apps/web/src/slice0/PhotoCreatePage.tsx:42` (`catch { setPhase('blocked') }` — a 413/422/5xx all look like
   the genuine "no angle found" result; the only action, "Add more", clears `files`), `:48-49` / `:55-56`
   (no catch at all on `anotherAngle` / `createIt`), `:30` (`catch { setBusiness(null) }` → `Navigate to "/"`
   — a transient load failure ejects the founder as if the business doesn't exist). *Work lost:* selected
   photos abandoned. Create sub-path.

7. **CarouselPage silently drops a photo on a transient upload error.**
   `apps/web/src/slice0/CarouselPage.tsx:80-83` — a *known* rejection code is surfaced (good), but a transient
   / 5xx returns `null` from `uploadRejectCode`, so nothing is recorded, the loop continues, and the carousel
   generates **without that image** with no notice. *Work lost:* an uploaded photo, silently. (Separately,
   `:76` `files.slice(0,6)` and `PhotoCreatePage:37` `slice(0,10)` truncate extra selections with no
   "using 6 of 9" notice.)

8. **Day One Arc — email draft and phase flags persisted through a swallowed write that still returns 200.**
   `apps/api/src/telemetry/founder-events.ts:86-90` (`recordFounderEvent` = `void sql….catch(() => {})`) backs
   durable arc state: `apps/api/src/routes/arc.routes.ts:332-345` (Moment-8 email draft), `:207-313` (the phase
   flags that advance moments), `:48` / `:240` (mirror contrast, correction reflection). *Founder sees:* the
   email saved / the step advanced — then on refresh the email is **gone**, or the advancing button "did
   nothing," with no error. *Work lost:* **email draft; arc silently fails to progress.** Once per founder, but
   it is every new founder's first session.

9. **Plan / Conversation show "try again" even when retry can't help.** `apps/web/src/slice0/PlanPage.tsx:53,59`
   and `apps/web/src/slice0/ConversationPage.tsx:100,115` — flat `common.actionFailed` instead of the existing
   `actionErrorKey(e)` that distinguishes 409 "changed under you" / 422 "input must change" / 403. *Founder
   sees:* told to retry a 409 stale plan or a 422 claim-safety rejection a retry can never fix. *Work lost:*
   none; misleading. (Only fully pays off after the root amplifier, since the server often sends bare
   `INTERNAL_ERROR` today.)

10. **VerdictSurface collapses every failure to a boolean.** `apps/web/src/slice0/VerdictSurface.tsx:69,83,92`
    (`catch { setErr(true) }`) on adopt / seeNextPlan / sendChallenge — drops the code. `sendChallenge` keeps
    the typed text (no loss). Living-state loop.

11. **Transient load error at app start logs the founder out.** `apps/web/src/slice0/session.tsx:36-39` and
    `apps/web/src/auth/AuthContext.tsx:22-24` — *any* failure of the initial `getMe` / `listBusinesses` clears
    the token. *Founder sees:* a network blip on load drops them to the sign-in screen as if logged out.
    *Work lost:* none; conflates transient with auth.

---

## Tier 3 — edge, or off the live founder path (named, not ranked for customers)

- **Meta / Instagram disconnect is an unhandled no-op** — `apps/web/src/pages/SourcesPage.tsx:135,214`. Same
  Meta-500 class, but `SourcesPage` is the **reviewer shell, not on the live router** (`App.tsx` has no
  `/sources` route), so no paying founder reaches it.
- **Onboarding `completeIntake` fire-and-forget** — `apps/web/src/onboarding/useOnboarding.ts:119`. Real defect,
  but `onboarding/` is **not wired into `App.tsx`**; live entry is BusinessStartPage + the Arc. Dead on the
  current path.
- **photoled upload loop orphans earlier images on a later failure, then 500s the set** —
  `apps/api/src/routes/photoled.routes.ts:53-65`.
- **BusinessStartPage `confirmProfile` removes the discovered profile regardless of persist success** —
  `apps/web/src/slice0/BusinessStartPage.tsx:164-172`. May reappear on reload.
- **ArcSurface `exportEmail` save swallowed** (`apps/web/src/slice0/ArcSurface.tsx:705`, local copy still
  correct), `act()` generic error (`:297`); founder-state / observation deletes swallowed
  (`apps/web/src/slice0/ConversationPage.tsx:229,233`); `SigninCallbackPage` login-reject strands on the spinner
  (`apps/web/src/slice0/SigninCallbackPage.tsx:22`).
- **Edge server:** auth duplicate-register TOCTOU race → raw 500 (`apps/api/src/controllers/auth.controller.ts:52-58`);
  `apps/api/src/controllers/approval.controller.ts:80` malformed `edits` → raw `TypeError` / 500 (legacy
  `/founders/me` path).
- **ReelCreatePage `onSwapOpening`** (`apps/web/src/slice0/ReelCreatePage.tsx:88-100`) swallows into "no
  alternative" — **FROZEN (Slice 7 V1)**; observed only, not for change.

---

## Verified deliberate / harmless — do NOT re-audit these

These were each read in context and confirmed correct. Recorded so the next sweep doesn't re-flag them.

- `apps/api/src/telemetry/founder-events.ts:90` swallow — correct for **genuine telemetry** (events route,
  `mirror_viewed`, etc.). It is only a defect where it backs *durable* arc state (Tier 2 #8).
- `apps/api/src/routes/arc.routes.ts:89-227` — paste-link / file / instagram / text / pour-in deliberately
  return specific error states as **200 bodies** (comment at `:154-157`): this is the intended remedy for the
  prod message-masking, and the pattern other routes should adopt.
- `apps/api/src/routes/arc.routes.ts:42` (`ig.status().catch(() => 'disconnected')`), `:52-59` (lazy opener →
  per-moment `error`), `:97` (URL-parse fallback) — deliberate.
- `apps/api/src/routes/impact.routes.ts:74` (no-plan today lookup); `apps/api/src/routes/plan.routes.ts:137-139`
  (`NO_CURRENT_STRATEGY` → 200 `{state:'no_strategy'}`); `apps/api/src/routes/businessbrain.routes.ts:122-126`;
  `apps/api/src/routes/social-sources.routes.ts:103-105`; `apps/api/src/routes/google-signin.routes.ts:70`
  (OAuth degrade redirect) — all deliberate, documented, no data loss.
- `apps/api/src/routes/{m22-dev,google-dev,meta-dev,declared-dev,m21-dev}.routes.ts` — `NODE_ENV!=='production'`
  gated; not founder-facing in prod.
- Web: `apps/web/src/api/client.ts:64,221,516` (JSON error-body parse fallback that still throws a proper
  `ApiError`), `:979` (empty success body), `:229` (telemetry `emitEvent` never affects UX); `App.tsx:59-62`
  and `i18n/LocaleContext.tsx` localStorage guards; `businessbrain/useBusinessBrain.ts` sessionStorage guards;
  `slice0/ArcSurface.tsx:67` (`scrollIntoView` for jsdom), `:704` (clipboard may be blocked);
  `slice0/CarouselPage.tsx:50` (one slide object-URL fails → skip a re-derivable image);
  `slice0/VerdictSurface.tsx:67` (plan-reshape best-effort with a documented Today stale-reshape fallback);
  `slice0/parse-briefing.ts:24` (JSON parse → null fallback); `slice0/AddContextDrawer.tsx:76-80` (fallback
  after a confirmed write); supplementary projection loads in `VoicePage`/`ConversationPage` that degrade
  gracefully; `/dev/*` preview harnesses (`calendar`, `declared`, `google`, `upload`).
- Web reference pattern (the thing everything else should look like): `isNotFound`-based load branches that
  separate a transient failure from a 404/403, plus `actionErrorKey(e)` mutation banners — in TodayPage,
  BusinessPage, PlanPage (loads), VoicePage, CarouselPage revisions, ReachReportsPage, MirrorView, and the
  reporters. Clearing a field only after a confirmed awaited success is correct.
