# Wave 4 · Slice 1 — Founder Strategy (PRIORITY_DECISION): closure record

The first bounded Founder Strategy vertical slice. Business Brain now answers **one** strategic job —
`PRIORITY_DECISION` ("help the founder decide what business or marketing priority to pursue next") — by reasoning
over the stable Waves 1–3 outputs (Business Understanding + Public Positioning Context), under a frozen governance
contract, through a durable session lifecycle, with a structured epistemic-tagged result surface.

Gate discipline (as instructed): the **Consumption Contract** and the **smallest architecture** were written and
committed *before* any implementation —
[`founder-conversation-consumption-contract.md`](../governance/founder-conversation-consumption-contract.md) and
[`wave4-slice1-architecture.md`](./wave4-slice1-architecture.md) (commit `4573e88`).

## What was built

**Domain / contract** — [`business-model/strategy.ts`](../../apps/api/src/business-model/strategy.ts): the strict
`StrategicRecommendation` schema, the `InsufficientStrategicEvidence` shape, 10 never-flattened epistemic kinds,
compositional confidence (five LOW/MEDIUM/HIGH dimensions — never a %), the durable session state machine
(`QUEUED→PROCESSING→READY|INSUFFICIENT_EVIDENCE|FAILED`, retry from `FAILED`), the failure taxonomy + retry policy,
the founder-safe `toSessionView` (hides internal error detail + lease internals), and `normalizeStrategicOutput`
(the deterministic safety net: enforces title+action+nextStep+≥1 change-condition+≥1 grounding, else downgrades a
baseless "recommendation" to an explicit insufficient-evidence result).

**Bounded classification** — [`strategy-classifier.ts`](../../apps/api/src/business-model/strategy-classifier.ts):
deterministic heuristic recognising only a business/marketing priority decision (+ subtype); everything else →
`OUT_OF_SCOPE` → founder-safe boundary (no model call, no durable job). Not an open-domain intent router.

**Read-only assembler** —
[`strategic-context.assembler.ts`](../../apps/api/src/business-model/strategic-context.assembler.ts): reuses the
existing eligibility (current Understanding with *effective* founder responses; current eligible positioning via
`effectiveMarketContext`) — never re-derives it. Deterministic order, bounded payload with explicit truncation,
conflicts from founder corrections, surviving unknowns, context-health signals. No dismissed/superseded/historical
data, no credentials.

**Model boundary** — [`anthropic-strategy.model.ts`](../../apps/api/src/business-model/anthropic-strategy.model.ts)
+ the `strategy` capability in [`model-config.ts`](../../apps/api/src/business-model/model-config.ts) (explicit
validated config, production fail-fast, separate `STRATEGY_MODEL` env). Raw model output is never surfaced.

**Durability** — migration `V066` (`business.strategic_session` + `business.strategic_response`, partial-unique
active-idempotency + single-effective-response); repositories
([session](../../apps/api/src/business-model/pg-strategic-session.repository.ts),
[response](../../apps/api/src/business-model/pg-strategic-response.repository.ts)); the durable worker
([`strategic-session.worker.ts`](../../apps/api/src/business-model/strategic-session.worker.ts)) — claim/lease-safe,
stale-recovery, bounded retry, prior-successful preservation, atomic READY publication, immutable recommendation.

**Routes / surface** — [`strategy.routes.ts`](../../apps/api/src/routes/strategy.routes.ts) (session-guarded,
`/api/strategy/*`; worker started when `NODE_ENV!=='test'`); the structured, non-chat
[`StrategyPage.tsx`](../../apps/web/src/strategy/StrategyPage.tsx) (1 call · why · what it's based on · unknowns ·
alternatives · what-would-change · one next step; boundary / insufficient / failed states; mount-hydrate reconnect).

**Export / delete** — extended so strategy sessions + responses are founder-exportable (founder-safe: no internal
error detail) and hard-deleted with the account.

## Contract adherence (the twelve rules)

Conversation owns no facts (assembler is read-only); epistemic status + provenance preserved end-to-end; a founder
**correction outranks an inference but the conflict is presented, not resolved**; unknowns survive into the
recommendation; recommendations are allowed (strategist, not mirror); **no fake certainty** (compositional
confidence, and a baseless recommendation is downgraded to insufficient); **no silent memory writes** — `ACCEPT`
records a decision and writes **zero** business context (verified in the browser: understanding stayed v1, 0 new
conclusion responses); current-eligible context only; recommendations serve founder action (concrete next step, no
"keep talking"); personal context as a constraint only, never psychology; founder sovereignty (`whatWouldChange…`
+ append-only response supersession).

## Evidence

- **Deterministic tests** — [`strategy-contract.test.ts`](../../apps/api/src/__tests__/business-model/strategy-contract.test.ts)
  (30 pure: classification/scope/schema/normalizer/confidence/unknowns/conflicts/parser-failure/state-machine/
  retry/boundary/safe-view) + [`strategy-session.live.test.ts`](../../apps/api/src/__tests__/business-model/strategy-session.live.test.ts)
  (8 live, DB-backed, stub model: assembler eligibility + isolation, atomic READY + immutability, insufficient as a
  valid terminal, fail-closed MODEL_FAILED + retry + stale-recovery, routes end-to-end, append-only responses,
  ACCEPT-writes-no-memory) + `model-config.test.ts` (strategy capability).
- **Full regression (green):** API `471 passed, 1 skipped`; web `73 passed`; both type-checks clean; web
  production build OK.
- **Frozen engine byte-identical:** `prompt a39ea88…`, `schema 79802e9…`, `index f9df116…` — unchanged.
- **Evaluation:** [`wave4-slice1-strategy-eval.md`](./wave4-slice1-strategy-eval.md) — 5/5 twice; found + fixed a
  real `max_tokens` truncation defect.
- **Browser acceptance (states):** boundary (out-of-scope), QUEUED/PROCESSING thinking, INSUFFICIENT_EVIDENCE, and a
  full READY structured recommendation — all rendered; refresh/reconnect restored both an INSUFFICIENT and a READY
  result after a full reload; ACCEPT→QUALIFY supersession recorded from the live UI (single effective, full history),
  ACCEPT wrote no memory.

## Combined-context browser acceptance (Business Understanding + Public Positioning Context)

One controlled, non-production case proving a single recommendation consumes **both** current-eligible contexts.

**Acceptance founder** `accept.wave4@bb.test` (isolated, created for this case, deleted afterward):
- **Business Understanding** — a *synthetic non-production acceptance seed* (see disclosure below): understanding v1
  with 4 conclusions (2 OBSERVED, 1 SYNTHESIZED inference, 1 NEEDS_MORE_EVIDENCE) + one effective **founder
  correction** on the promise conclusion.
- **Public Positioning Context** — created through the **real API + durable worker lifecycle** (not seeded): a
  founder-added, auto-confirmed entity at the reserved dev host `fixture.market.test/ready`; the real review worker
  produced one **observation** finding (OBSERVED) and one **market inference** finding (HYPOTHESIS, provenance
  `model=claude-sonnet-5`, `prompt=market-infer-sys-1`); founder responses recorded (accuracy=yes, relevance=relevant)
  so both are current-eligible, not merely provisional. Assembler probe confirmed the context reached the model:
  `entities:1 observations:1 inferences:1 provenance:2`.

**Question** (a supported POSITIONING_PRIORITY for which both contexts materially matter): *"A direct competitor's
website publicly states clear positioning and pricing for our shared audience. Should I sharpen my own positioning
before investing in paid acquisition?"* → session `01KXZPHNJFQM6WTTRN339T5AQQ`, READY.

**Epistemic categories actually consumed** (from the persisted recommendation, rendered in the browser):
`OBSERVED_BUSINESS_EVIDENCE` ("FROM YOUR BUSINESS"), `BUSINESS_UNDERSTANDING_INFERENCE` ("MY READING OF YOUR
BUSINESS"), `FOUNDER_CORRECTION` ("YOU CORRECTED ME") with the conflict preserved ("WHERE YOUR INPUT OVERRIDES MINE"),
`PUBLIC_POSITIONING_OBSERVATION` ("FROM A PUBLIC SITE" — labeled *"a self-claim, not evidence of market demand or
superiority"*), and `MARKET_INFERENCE` ("MY READING (NOT A MARKET FACT)" — hedged: *"overlap … possible but not
confirmed"*). Plus 3 surviving unknowns (incl. *"whether ClarityCo's public pricing/positioning is actually winning
customers, or just visible"*), 5-band compositional confidence (`marketContextQuality LOW`, `unknownBurden HIGH`),
alternatives, what-would-change (4), one practical next step. No demand or competitor superiority invented.

**Provenance resolution (acceptance gate):** every material evidence reference was checked against stored records —
BU `refId`s resolve to conclusion ids `c-2`/`c-3`; the founder correction to a stored conclusion response; the
`PUBLIC_POSITIONING_OBSERVATION` `refId` to the stored observation finding; the `MARKET_INFERENCE` `refId`/`entityId`
to the stored inference finding + entity. **Zero unresolved or manufactured references.**

**ACCEPT semantics (verified):** ACCEPT records a founder's positive response to the immutable recommendation — it does
**not** execute the recommendation, update Business Understanding, update Market Context, create a committed plan, or
become accepted business truth. Verified on the live founder: after ACCEPT, understanding stayed v1 and no new
conclusion responses were written. The effective response may later be superseded (append-only). No strategy-decision
memory model exists in this slice.

**Export / delete (verified on the live founder):** export included 3 strategic sessions + 1 response, founder-safe —
**no** `internal_error_detail`, **no** lease internals, provenance limited to `{modelId, promptVersion, schemaVersion}`.
Account delete (real endpoint, 204) removed **all** founder-owned strategic sessions, responses, market entities,
reviews, findings, finding responses, understanding, and conclusion responses — **zero orphans**. Founder isolation
holds (cross-founder 404 in the live tests; delete removed only the acceptance founder).

### Synthetic-seed disclosure

The Business Understanding above was inserted directly into the dev database as a **synthetic, non-production
acceptance seed** (`understanding.model_version = 'ACCEPTANCE_SEED_synthetic_nonproduction'`) — it is **not** a normal
founder lifecycle (which generates understanding from ingested website evidence via the understanding-run worker). It
was minimal, deterministic, founder-isolated, and **fully removed** (account delete). The Public Positioning Context
was created through the real lifecycle, not seeded. All temporary local artifacts (the acceptance API bundle
`apps/api/_acceptance_api.cjs`, esbuild probes) were removed and the temporary local acceptance servers stopped. The
reserved fixture host `fixture.market.test` can never activate in production: the fixture adapter throws if enabled in
production-capable mode, and a `.test` TLD never resolves. Production remains untouched.

## Deliberately out of scope (this slice) — what is NOT claimed

This slice delivers exactly one bounded strategic job. It explicitly does **not** claim, and does not implement:

- **Founder Conversation is not complete** — one bounded PRIORITY_DECISION job only; no arbitrary open-domain conversation.
- **The Strategic Reasoning Engine is not complete** — this is the first vertical slice, not the whole engine.
- **No business planning / plan execution** — a recommendation is advisory; ACCEPT does not execute it or create a committed plan.
- **No strategy memory** — accepting a recommendation writes no business context; there is no strategic-decision memory model.
- **No market discovery** — positioning context is known-entity, founder-supplied only.
- No autonomous agents, no generic chatbot, no life-coaching product.
- No `founderContext` goals/constraints model yet (assembler emits empty arrays; the model treats their absence as an unknown).

Production is untouched; nothing deployed or pushed. The frozen engine is byte-identical.
