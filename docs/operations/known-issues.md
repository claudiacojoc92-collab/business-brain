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
