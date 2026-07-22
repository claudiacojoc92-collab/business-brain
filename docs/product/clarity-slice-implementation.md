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

## Known limitations (this slice)

- V1 scopes by `founder_id` as the single Business (no `Business` table — justified variation; future-compatible).
- Accepted proposals are surfaced as founder-confirmed clarity items; they are intentionally **not** merged into the website-synthesis Understanding versioning (kept separate to avoid disturbing that path).
- The live `AnthropicClarityModel` is wired but exercised deterministically via the fixture in tests/verification.
- Home is the existing `/welcome` hub with a clarity entry; a full stateful Home (Phase 7) is a later slice.
- No Playwright spec yet for the rendered flow (covered by the 15 service/DB tests + manual browser verification).
