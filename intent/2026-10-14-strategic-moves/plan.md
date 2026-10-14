# Plan: Strategic Moves — 2 weeks

- **Intent:** ./intent.md
- **Approved by:** operator, 2026-10-14 (step order and decisions in intent.md)

## Steps (one commit each; report after each; stop on failure)
Week 1
1. `@anthropic-ai/sdk` 0.36.3 → 0.131.0 (only the dependency; full suite).
2. Anthropic `web_search` / `web_fetch` adapter behind a search port (application port, infrastructure adapter).
3. Candidate generator from model knowledge (internal only).
4. 3-field capture UI + founder-state mapping; strategy gates skip Moves scopes; audit every founder-state reader
   (mirror, container, strategy) so Moves scopes don't leak.
5. Obviousness filter + novelty gate.

Week 2
6. StrategicMove writer + gates (quote anchoring on fetched text, freshness, dated timing or null, motive chip, no
   number without quote, regulated-category block, refs resolvable).
7. Moves card: 3 reaction buttons + one-line why; "Why this" with URL + quote.
8. "Show me others" → re-run with updated ledger + taste.
9. Run on Business Brain, Body Move, LFG Gold; founder reads them.

## Search failure mode
Local query empty → retry in the local language and English → widen geography → fetch the candidate's own site (URL
passed in the user message) → else drop (`search_empty` / `unverifiable`). Never model-only.

## Status log
- 2026-10-14: done — design agreed; step 1 (SDK 0.36.3 → 0.131.0) built: tsc -b --force clean, full suite 2116 pass;
  error-classifier name check found a PRE-EXISTING bug (SDK errors have `name === 'Error'` in 0.36 and 0.131, so
  connection-error branches never match) — not caused by the upgrade, not fixed here. Live API call not run (key check
  denied). / next — `approve commit` for step 1, then step 2 / blockers — commit approval
- 2026-10-14: done — step 1 shipped (e425a1a, PR #28 merged d03cabf; live call PASS). Step 2 adapter built:
  `moves/contracts.ts` (IWebResearchPort) + `AnthropicWebResearchAdapter` (web_search_20250305 / web_fetch_20250910,
  one tool use per call, snippets dropped, errors as codes); 8 parser tests; suite 2124 pass. Not wired into
  composition yet (no consumer until step 3). / next — operator runs `node tools/moves-search-check.mjs` (RO vs EN
  live quality) / blockers — .env not readable from this session
- 2026-10-14: done — step 2 diagnosed + fixed: `user_location.country: 'RO'` → 400 "Country code RO is not
  supported" (DE accepted but ignored for a RO query) → location is city + timezone only, never country. Live RO/EN
  (operator run, all hits fetched): RO 10 hits / 10 fetched / 9 usable; EN 10 / 6 / 5; overlap 5; example.com fetch =
  237 chars (matches the raw call). Body Move found itself; real local peers found (Maternity Club, Stress-Away, Hanna
  Pilates, Clinica Integro, Med.ro). Problems for step 3: Facebook blocked (url_not_allowed), directories mixed with
  businesses, noise (people, Wikipedia). / next — step 3 (candidate generator + qualification), 5 days, stop before
  day 5 real runs / blockers — none
- Step 3 design (approved 2026-10-14): 6 v1 patterns (distribution bridge, moment-of-need, platform entering the
  market, someone else's budget, trust bridge, complementary pairing); directory vs business = blocklist + path
  patterns + page counts (≥3 phones/addresses/legal IDs, listicle) + single-business signals (one CUI/SRL/Impressum,
  "despre noi", brand in title) + model tie-break with a verbatim evidence quote; single-business profile pages
  allowed; social hosts never fetched (`social_only`), no own site → dropped (`no_own_site`); link-in-bio aggregators
  (linktr.ee, beacons.ai, bio.link, …) blocklisted as a class; bar = URL ok + fetch ≥500 chars + business/profile +
  2-of-3 commercial (services, price, legal) + a REQUIRED public contact channel (email / phone / contact form / social
  DM link; else `no_contact_channel`) + relevant to the pattern + not the founder's own domain + not in the ledger;
  every directory verdict logged (blocklist grows from data). Known limitation: Facebook/Instagram-only businesses
  cannot be verified and are dropped (lower recall in beauty, local fitness, crafts).
