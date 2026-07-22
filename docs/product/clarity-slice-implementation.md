# Clarity / Sensemaking — Vertical Slice Implementation Log

The first functional slice of the cognitive entry point: a founder brings a tension, Business Brain **audits** what is actually happening (known / assumed / unknown / conflicting), proposes — never saves — Understanding updates, and crystallizes a Strategy Thread only on explicit confirmation. Additive; the frozen strategist engine is byte-identical (`a39ea88 / 79802e9 / f9df116`).

## What was built

| Layer | Files |
|---|---|
| Schema | `database/migrations/V089__clarity_sensemaking.sql` — `concern`, `concern_message` (append-only), `clarity_result` (immutable), `proposed_understanding_change` (pending→one-way resolution; content immutable). Confirmation boundary enforced by DB triggers. |
| Contract | `clarity-result.ts` — the validated structured response + a FAIL-CLOSED normalizer. Five founder-facing truth labels. |
| Prompt | `clarity-prompt.ts` — the auditor system prompt (resists generic "run ads/post/funnel"; distinguishes traffic vs offer/conversion/targeting/trust/sales/delivery/retention; smallest useful next move; no psychoanalysis; no fabricated certainty). |
| Model | `clarity-model.ts` — `ClarityModel` interface, `AnthropicClarityModel` (JSON-only → safe parse → normalize), `FixtureClarityModel` (deterministic; the advertising scenario). |
| Context | `clarity-context.ts` — reads CONFIRMED Understanding + strategic context, maps to truth labels. Read-only. |
| Persistence | `pg-clarity.repository.ts` — `PgClarityStore` over the four tables, founder-scoped. |
| Service | `clarity.service.ts` — the clarity turn + the confirmation boundary (accept/reject) + `crystallizeConcern` (explicit → Strategy Thread). |
| API | `routes/clarity.routes.ts` — `POST /api/clarity/turn`, `GET /api/clarity/concerns[/:id]`, `POST /api/clarity/changes/:id/{accept,reject}`, `POST /api/clarity/concerns/:id/crystallize`. Cookie session; dev-only `CLARITY_FIXTURE=1` toggle. |
| Web | `clarity/ClarityPage.tsx` (`/clarity`, `/clarity/:concernId`), client fns in `api/client.ts`, Home entry ("What feels unclear right now?") in `WelcomePage.tsx`. |
| Tests | `__tests__/business-model/clarity.live.test.ts` — 15 tests (T1–T13 + fail-closed T14/T15). |

## How the constitutional rules are guaranteed (not just intended)

- **Conversation never writes confirmed state.** A clarity turn persists an *immutable* result + *pending* proposed changes only. The `proposed_understanding_change` trigger makes the proposal content immutable and its resolution one-way (`pending → accepted|rejected`); an already-resolved proposal cannot be reopened. Verified by DB smoke tests and tests T2/T3/T11.
- **Business Brain proposes; the founder confirms.** Accept/reject are separate explicit routes; keep-nothing-until-accepted. T2/T3/T4.
- **Founder correction distinct from inference.** Accepted proposals carry a truth label (`you_told_me` / `you_corrected_this` / `unconfirmed_or_disagree`) and live in their own table, never merged into synthesized conclusions. T4.
- **Disagreement preserved.** `conflicts[]` holds both the founder claim and the evidence. T5.
- **Unknowns visible; no invented certainty.** The normalizer fails closed and never fabricates `clarifiedIssue`/`possibleStrategicQuestion` (null = honestly unknowable). T6, T14, T15.
- **No auto-advance to a thread.** `crystallizeConcern` runs only on explicit confirmation; a conversation may end with clarity only. T7, T8, T9.
- **Founder isolation.** Every read/write is `founder_id`-scoped. T12.
- **Frozen engine untouched; recommendations immutable.** No strategy/recommendation record is written by the clarity flow. T11.

## Verification performed

- API + web typecheck: clean.
- `clarity.live.test.ts`: **15/15** against the dev DB (fixture-driven, deterministic).
- Rendered end-to-end in the browser (real API + persisted DB, `CLARITY_FIXTURE=1`): the advertising tension → full audit (does NOT recommend ads) → truth-labelled context → known/assumed/unknown separation → core issue → smallest next move → alternative → what-would-change → pending "only if you agree" proposal → **accept** (pending→accepted, 200) → persists across a fresh navigation. Concern ended `clarified` (no forced thread).
- Frozen strategist hashes unchanged.

## Known limitations (slice 1)

- V1 scopes by `founder_id` as the single Business (no `Business` table — justified variation; future-compatible).
- The live `AnthropicClarityModel` is wired but exercised deterministically via the fixture in tests/verification.
- Home is the existing `/welcome` hub with a clarity entry; a full stateful Home (Phase 7) is a later slice.
- No Playwright spec yet for the rendered flow (covered by the DB tests + manual browser verification).

---

# Slice 2 — Clarity → Confirmed Understanding → Reused Context (the accumulation loop)

Closes the loop: an accepted clarity proposal becomes a durable, founder-governed **Understanding item** that joins the effective current Understanding, is visible + labelled, is retrieved by later clarity sessions, and can be corrected/superseded **without rewriting history**. Additive; frozen engine byte-identical.

## What changed
| Layer | Change |
|---|---|
| Schema | `V090__understanding_item.sql` — append-only `business.understanding_item` (founder-governed items: clarity acceptances + corrections; supersession links; clarity-origin refs) + `resulting_understanding_item_id` on `proposed_understanding_change` (bidirectional link). Immutable (no UPDATE) + one-successor-per-item invariant. |
| Repo | `pg-understanding-item.repository.ts` — `create`/`listCurrent` (current = not-superseded, derived)/`history` (supersession chain)/`get`; tx-aware. |
| Bridge | `clarity.service.ts` — **transactional accept**: item insert + proposal resolution in ONE tx (both or neither; a proposal is never accepted while its Understanding write fails). `correctUnderstanding` supersession. `resolveProposedChange` made tx-aware + records the resulting item id. |
| Composer | `effective-understanding.ts` — composes the effective view at read time: synthesized conclusions (minus founder-corrected ones) + current founder items; open unknowns (minus resolved); disagreements; recently-accepted. Never mutates either source. |
| Context reuse | `clarity-context.ts` now includes current founder-governed items → later sessions start from accumulated understanding, and disclose it in "What I'm drawing on". |
| API | `GET /understanding/effective`, `GET /understanding/items/:id/history`, `POST /understanding/correct`. |
| Web | `understanding/UnderstandingSurfacePage.tsx` (`/understanding`): current items + truth labels, open unknowns, unresolved disagreements, recently-accepted, expandable origin/history, correct action, "Talk something through". Welcome hub link "What I understand". |
| Tests | +14 continuity tests (U1–U15) in `clarity.live.test.ts` → **29/29**. Context-echo fixture for two-session continuity. |
| Live verify | `clarity-live-model.verify.test.ts` — controlled, skip-guarded (`RUN_LIVE_MODEL=1`), self-loads the key in-process (never printed), writes no confirmed Understanding. |

## Guarantees (slice 2)
- **Atomic acceptance** (U2, U13): item + resolution in one tx; a forced write-failure leaves the proposal *pending* with no item.
- **Uncertainty stays uncertainty** (U5, U6): an accepted "unconfirmed / we disagree" item is surfaced as a disagreement, never asserted as fact.
- **Unknown preserved** (U7): the original "where prospects stop" unknown remains visible after acceptance.
- **History preserved** (U8, U9): corrections supersede via a new append-only row; the superseded item stays in history; no in-place UPDATE (DB-enforced).
- **Effective selection** (U4, U5, U10): the surface + later context use the *current* effective item, not the superseded one.
- **Two-session continuity** (U11/U15): a second concern visibly draws on the accepted item — remembers the bottleneck is unconfirmed, does not start from zero, does not claim ads are wrong, calls doubling spend premature.
- **Isolation** (U12) and **strategy immutability** (U14, T11): cross-founder access impossible; existing strategy sessions/decisions unchanged by Understanding updates.

## Verification
- API + web typecheck clean; web build clean. `clarity.live.test.ts` **29/29**. Live-model verify test **skips** in the default suite.
- **Live Anthropic run** (`RUN_LIVE_MODEL=1`): contract valid; `jumpedToRecommendation: false`; separated known/assumed/unknown; bounded next move; 1 proposal (nothing saved); alternative offered. (Live quality is NOT claimed from fixtures — this is a real call.)
- **Rendered end-to-end** (`CLARITY_FIXTURE=1`): clarity → accept → `/understanding` shows the accepted item under "What we currently understand", "Still unresolved / where we disagree", and "Recently added from a clarity conversation", with Correct / history actions.
- Frozen engine hashes unchanged.

## Known limitations (slice 2)
- Correcting a *synthesized* conclusion is supported via `conclusionRef` but the surface exposes correction primarily on founder items; deeper inline correction of synthesized conclusions is a later refinement.
- No Playwright spec for the Understanding surface yet (covered by 29 DB tests + browser verification).

---

# Slice 3 — Legible continuity + context revalidation

Makes accumulated Understanding **legible and trustworthy at the moment Business Brain reasons with it**: the founder sees what prior Understanding is being used, where it came from, why it matters to the current concern, whether it may no longer be current, and can revalidate or correct it — without losing the conversation. Additive; frozen engine byte-identical.

## What changed
| Layer | Change |
|---|---|
| Schema | `V091__continuity_revalidation.sql` — append-only `clarity_context_use` (which items materially informed each clarity result — durable, never invented) + `understanding_revalidation` (founder 'confirmed'/'unsure' events; "changed" is a correction, not here). Both immutable. |
| Selection | `context-selection.ts` — deterministic, bounded relevant-context selection (`MAX_CONTEXT_ITEMS=5`) + a truthful staleness model (no clock expiry): `contradicted` (the message implies change), `unresolved` (an `unconfirmed_or_disagree` condition), `time_sensitive` (a current-condition term, until revalidated). Distinguishes old/stale/contradicted/unknown/superseded. |
| Contract | `clarity-result.ts` — `ContinuityRef` (model output: id + relevance + effect) and `ContinuityItem` (resolved: identity/label/origin/lastConfirmedAt/staleness from PERSISTED state + model relevance). `normalizeContinuityRefs` parses only the model's refs; the service resolves. |
| Model | `clarity-model.ts` — `ClarityInput.contextItems` (the id-bearing selection); `clarify()` returns `{ result, continuityRefs }`. Prompt updated: reference only supplied ids, explain consequence not restatement, treat flagged items as possibly stale / unresolved as unresolved. Fixtures echo supplied ids. |
| Service | `clarity.service.ts` — `produceReading` (select → audit → **resolveContinuity**: drop invented ids, always surface items that need checking); persist `clarity_context_use`. `revalidate` (confirmed/unsure), `refreshReading` (re-read with corrected context). `resolveContinuity` never trusts the model for identity/label/origin/timestamps. |
| API | `POST /clarity/concerns/:id/revalidate` — `confirmed` (event, no dup) · `unsure` (uncertainty kept) · `changed` (founder correction/supersession + **refreshed** reading). |
| Web | ClarityPage "What I'm building on" — per item: statement, truth label, why-it-matters, effect, origin + last-confirmed, and when flagged "May need checking" + "Is this still true?" → Yes / This has changed (→ correct & re-read) / I'm not sure. |
| Tests | `clarity.live.test.ts` now **46** (adds V1–V18: exact-reference, no-invented-ids, superseded-excluded, corrections-outrank, bounded selection, UI fields, revalidate confirmed/unsure/changed, contradiction flag, stale-not-fact, isolation, clarity-immutable-after-revalidation, refresh-after-correction, advertising-budget + capacity-contradiction scenarios end-to-end, continue-without-resolving). |
| Live verify | Extended: references valid (no invented ids), continuity explained, contradiction handled truthfully, explicit correction (not silent). |

## Guarantees (slice 3)
- **The AI cannot invent a reference** — identity/origin/label/timestamps come from persisted state; ids not in the supplied selection are dropped (V2); `clarity_context_use` records exactly the items used (V1).
- **Bounded, not a dump** — selection ≤ 5, relevance-scored, superseded excluded, corrections outrank inferences (V3–V5, V18).
- **Truthful staleness** — "may need checking", never "wrong"; contradiction detected from the message; unresolved stays unresolved; time-sensitive until revalidated (V10, V11, V16).
- **Revalidation is explicit** — confirmed (no duplicate), unsure (uncertainty kept), changed (correction + refreshed reading); conversation alone commits nothing (V7–V9, V14).
- **History immutable** — a revalidation never edits a prior clarity result; a correction supersedes without deleting (V8, V13).
- **Founder-scoped** (V12); the session continues even with unresolved items (V17).

## Verification
- API + web typecheck clean; web build clean. `clarity.live.test.ts` **46/46**. Live-model verify **skips** in the default suite.
- **Live Anthropic run** (`RUN_LIVE_MODEL=1`): contractValid, persistedReferencesValid (no invented ids), continuityExplained, 2 visible context items, jumpedToRecommendation false, staleOrContradictedHandledTruthfully, boundedNextMove, 1 explicit proposed correction, alternative offered.
- **Rendered end-to-end** (`CLARITY_FIXTURE=1`): accept → new concern → "What I'm building on" shows the prior item, its label, why-it-matters, origin + last-confirmed, "still unresolved — worth confirming", and "Is this still true?" (Yes / changed / not sure).
- Frozen engine hashes unchanged.

## Known limitations (slice 3)
- Continuity operates over founder-governed items (accepted/corrected); synthesized website conclusions remain background context (not revalidatable in-line).
- Relevance selection is lexical + domain-signal (no embeddings); sufficient for the current scale, a future refinement for large item sets.
- No Playwright spec yet (covered by 46 DB tests + live-model verify + browser verification).
