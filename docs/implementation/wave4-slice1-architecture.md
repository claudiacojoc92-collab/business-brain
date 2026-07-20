# Wave 4 — First Founder Strategy vertical slice: proposed smallest architecture

Recorded **before** implementation (per the increment's gate). Governed by
[founder-conversation-consumption-contract.md](../governance/founder-conversation-consumption-contract.md).
One bounded job — `PRIORITY_DECISION` — proven end-to-end, reusing Waves 1–3 and the durable-worker conventions.

## Principle: reuse, don't recreate

- **Current-eligibility rules are reused, not re-derived.** Public Positioning Context comes from the existing
  `effectiveMarketContext(...)` (confirmed entity + latest READY review + website-change validity + accuracy≠no +
  relevance relevant/partly; unreviewed → provisional; dismissed/suggested/superseded excluded). Business
  Understanding comes from `understanding.latest()` + `responses.effectiveByConclusion()` +
  `responses.revisedConclusionIds()` — the same effective-response overlay the `/understanding` view uses.
- **Durable lifecycle mirrors the market-review lifecycle** (`pg-market-review.repository` + `market-review.worker`
  + `market-review.ts` state machine): DB-authoritative, `FOR UPDATE SKIP LOCKED` claim + lease, stale recovery,
  bounded retry, atomic READY, prior-successful preservation.
- **Model config mirrors `model-config.ts`**: a new `strategy` capability, `STRATEGY_MODEL` env, fail-fast in
  production-capable mode, local default `claude-sonnet-5` — no change to synthesis/market models.

## Components (new)

| Layer | File | Role |
|-------|------|------|
| Contract types | `apps/api/src/business-model/strategy.ts` | `StrategicJob`/subtypes, `StrategicSessionStatus` state machine, `StrategicRecommendation` + `InsufficientStrategicEvidence` schema types, `EvidenceReference`/`EpistemicKind`, normalizer, founder-safe boundary message, retry policy. |
| Classifier | `apps/api/src/business-model/strategy-classifier.ts` | deterministic, bounded `classifyStrategicJob(question)` → `{ job:'PRIORITY_DECISION', subtype }` or `{ job:'OUT_OF_SCOPE' }`. Keyword/intent heuristics only — **not** an open intent router. |
| Assembler | `apps/api/src/business-model/strategic-context.assembler.ts` | read-only `assembleStrategicContext(founderId, question, deps)` → typed `StrategicContext` (below). Reuses the eligibility functions; deterministic ordering; bounded payload with explicit truncation. |
| Model adapter | `apps/api/src/business-model/anthropic-strategy.model.ts` | `AnthropicStrategyModel` — explicit `strategyModelConfig()`, exported `SYSTEM` prompt (version `strategy-1`), strict JSON parse + `normalizeStrategicOutput`, safe fallback; raw output never surfaced. |
| Session repo | `apps/api/src/business-model/pg-strategic-session.repository.ts` | durable session CRUD + claim/lease/advance/markReady/markInsufficient/markFailed/recoverStale/retry, mirroring the review repo. |
| Response repo | `apps/api/src/business-model/pg-strategic-response.repository.ts` | append-only founder responses to a recommendation, supersession (one effective), history. |
| Worker | `apps/api/src/business-model/strategic-session.worker.ts` | `processSession`: assemble (outside tx) → classify → model (outside tx) → **atomic** persist recommendation + READY (or INSUFFICIENT, or FAILED). |
| Routes | `apps/api/src/routes/strategy.routes.ts` | `POST /strategy/sessions` (202), `GET /strategy/sessions/:id`, `GET /strategy/sessions` (history), `POST /strategy/sessions/:id/retry`, `POST /strategy/sessions/:id/responses`, `GET .../responses`. Session-guarded, `/api` prefix. |
| Migration | `database/migrations/V066__create_strategic_session.sql` | `business.strategic_session` + `business.strategic_response`. |
| Export/delete | extend `export.service.ts` + `delete.service.ts` | new records are founder-owned. |
| Web | `apps/web/src/strategy/StrategyPage.tsx` + client fns | structured strategy result (not chat bubbles). |

## `StrategicContext` (typed, explicit — no raw dumps)

```
StrategicContext {
  businessUnderstanding: { version, conclusions:[{id,type,statement,epistemicStatus,group,evidenceCount}],
                           founderResponses:[{conclusionId,type,acceptedText,qualificationText,correctionText,revisedEarlier}],
                           conflicts:[{conclusionId, observation, founderCorrection}], unknowns:[{conclusionId,statement}] }
  publicPositioningContext: { entities:[{id,name,entityType,websiteUrl}],
                              observations:[{findingId,entityId,sourceUrl,text,accuracy,relevance,relevanceQualification}],
                              inferences:[{findingId,entityId,text,epistemicStatus,accuracy,relevance}],
                              provisional:{observations,inferences}, provenance:[{findingId,reviewId,adapter,model,promptVersion}] }
  founderContext: { explicitGoals:[], explicitConstraints:[], explicitPreferences:[] }   // empty this slice (no goals model yet)
  question: { rawText, normalizedStrategicJob, subtype, decisionHorizon }
  contextHealth: { missingAreas:[], staleAreas:[], contradictoryAreas:[], truncated:boolean }
}
```

`contextHealth` surfaces: no Business Understanding yet; no confirmed market entities; entities `needsFreshReview`
(stale website); observation-vs-correction contradictions; and whether the payload was truncated (bounded).

## Durable session lifecycle

States: `QUEUED → PROCESSING → { READY | INSUFFICIENT_EVIDENCE | FAILED }`. Legal transitions enforced; terminal
protected. Worker: `claimQueued` (→ PROCESSING + lease) → assemble + classify + model (outside tx) →
- **OUT_OF_SCOPE** (classifier): the route returns the boundary response synchronously (no session created), OR a
  session resolves to a founder-safe boundary — chosen: reject **at the route** with a 200 boundary payload so no
  durable job is spun up for unsupported questions.
- **model → INSUFFICIENT_STRATEGIC_EVIDENCE** → `markInsufficient`.
- **model → StrategicRecommendation** → atomic: persist recommendation JSON + `markReady` in one tx.
- **assemble/model throws** → `markFailed(category)`. Retry policy: `MODEL_FAILED` retryable (transient);
  `INSUFFICIENT_STRATEGIC_EVIDENCE` **not** retryable via blind retry (the founder must add evidence). Prior
  successful session preserved (`prior_successful_session_id`). Restart-safe via lease + `recoverStale`.

## Failure/insufficient taxonomy

`MODEL_FAILED` (parse/call failure — retryable), `INSUFFICIENT_STRATEGIC_EVIDENCE` (structured; not retryable),
`ASSEMBLY_FAILED` (unexpected — retryable). Founder-safe messages only; internal detail never surfaced.

## Founder response semantics (append-only)

`ACCEPT | REJECT | QUALIFY | NEEDS_MORE_EVIDENCE | NOT_RELEVANT_NOW`, append-only with supersession (one effective,
history preserved). `ACCEPT` does **not** trigger execution or write accepted context (contract §8) — it is a
recorded decision candidate. The original generated recommendation is immutable.

## DB schema (V066)

- `strategic_session`: id, founder_id, status, strategic_job, subtype, question_text, decision_horizon,
  understanding_version (snapshot ref), context_health (jsonb), recommendation (jsonb, null until READY),
  insufficient_reason (jsonb), failure_category, founder_safe_error, internal_error_detail,
  prior_successful_session_id, model_id, prompt_version, schema_version, attempt_count, max_attempts,
  claimed_at, lease_expires_at, started_at, finished_at, created_at, updated_at. Partial-unique active index on
  (founder_id) WHERE status in active — actually per (founder_id, question hash?) → **no**; multiple questions are
  allowed, so idempotency is on (founder_id, question_text) WHERE status active, to dedupe a double-submit.
- `strategic_response`: id, founder_id, session_id, response_type, qualification, supersedes_id, superseded_at,
  created_at. Partial-unique effective index on (founder_id, session_id) WHERE superseded_at IS NULL.

**Snapshot vs raw context:** the session stores stable *reference* fields (`understanding_version`,
`context_health`) + the final `recommendation` (with embedded provenance references), **not** the entire raw
assembled context (contract-compliant, bounded).

## Model boundary

`STRATEGY_MODEL` env (fallback `SYNTHESIS_MODEL`), fail-fast in production, prompt `strategy-1`, schema
`strategy-recommendation-1`. Prompt lives in the adapter, never in routes/React. Strict parser + normalizer;
malformed → `MODEL_FAILED` (never a raw dump to the founder). No silent model switch.

## UI (smallest)

`/strategy`: ask one supported priority question → "analyzing your business + public positioning" → durable async
(poll `GET /sessions/:id`) → refresh/reconnect (mount hydrate, like `/market`) → structured result:
**1 recommendation · 2 why · 3 what it's based on · 4 unknowns · 5 alternatives · 6 what would change my view ·
7 next step**, each item visibly tagged by `EpistemicKind` (observed / inference / declaration / assumption /
unknown / recommendation). Founder responses (accept/reject/qualify/needs-more/not-relevant). Insufficient +
boundary states rendered founder-safe. **Not** a chat transcript.

## Explicitly OUT of scope this slice

Other job families; multi-turn conversation; autonomous execution; goals/constraints persistence model (the
`founderContext` block is present but empty); converting ACCEPT into memory/execution; market discovery. No change
to the frozen engine or the synthesis/market-inference models.

## Build order

contract + this doc (done) → strategy.ts types/schema/normalizer + classifier → assembler + tests → model config
(strategy) + adapter → V066 + session/response repos + worker → routes + export/delete → deterministic tests →
eval fixtures → UI → browser acceptance → regression → closure notes.
