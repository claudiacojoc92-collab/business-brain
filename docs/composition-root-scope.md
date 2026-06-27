# Composition Root — Scoping Document
*Goal: make the end-to-end pipeline verification (token → signals → trigger → committed brief → intelligence events) pass. No code in this document.*

## GAP 1 — Auth middleware never registered

**Diagnosis:** `createAuthMiddleware(jwtService)` is implemented and correct (sets `request.user = payload`). It is simply never attached, so every `/v1/...` handler reads `request.user.sub` on `undefined`.

**Files to change:**
- `apps/api/src/routes/founder.routes.ts` — register the middleware as a Fastify `preHandler` (or scoped hook) on all `/v1/founders/me/*` routes.
- `apps/api/src/server.ts` — `ServerDeps` must carry a constructed `JwtService` (or the keys to build one) so routes share the same instance the token endpoint signs with.
- `apps/api/src/middleware/authenticate.ts` — likely no change; possibly export a typed `AuthenticatedRequest` so controllers stop reading `(request as any).user`.

**What changes:** Build one `JwtService` in the composition root from `JWT_PUBLIC_KEY`/`JWT_PRIVATE_KEY`; pass it through `ServerDeps`; apply `createAuthMiddleware` as a `preHandler` on the founder route group (not on `/health` or `/auth/*`). Return 401 on the `AuthenticationError` it throws (the error plugin likely already maps this — to confirm).

**New files:** 0 (wiring only).

**Depends on:** Nothing structurally, but only becomes *useful* once GAP 3 makes `sub` a real founder id.

---

## GAP 2 — All routes use `makeStubBus()`; no real buses exist

**Diagnosis:** `auth.routes.ts` and `founder.routes.ts` each construct a local `makeStubBus()` returning `ok({})`. The concrete `CommandBus`/`QueryBus` classes that the comments promise ("Implementation in packages/infrastructure/") were never written.

**Files to create:**
- `packages/infrastructure/src/cqrs/command-bus.ts` — concrete `CommandBus implements ICommandBus` (type→handler map, `register`, `dispatch`).
- `packages/infrastructure/src/cqrs/query-bus.ts` — concrete `QueryBus implements IQueryBus`.
- `apps/api/src/composition-root.ts` (new) — the single wiring module: instantiate repositories, `PgEventStore`, transaction manager, both buses; register all 21 command + 14 query handlers; return `{ commandBus, queryBus, jwtService }`.
- `packages/infrastructure/src/index.ts` — export the two new bus classes.

**Files to change:**
- `apps/api/src/server.ts` — extend `ServerDeps` to carry `commandBus`, `queryBus`, `jwtService` (replacing the implicit stub).
- `apps/api/src/main.ts` — call the composition root and pass real deps into `createServer`.
- `apps/api/src/routes/auth.routes.ts` + `founder.routes.ts` — delete `makeStubBus()`; take buses from `deps`.

**What changes:** A real DI container. Each handler's constructor deps (repository interfaces + `IEventStore` + `ITransactionManager`) get satisfied from the 5 existing Pg repositories, `PgEventStore`, and the existing `transaction.ts`. Registration maps each command/query `type` string to its handler instance.

**New files:** ~3 (two bus classes + composition root).

**Depends on:** Nothing — this is the foundation. **GAPs 1, 3, 4 all build on it.**

---

## GAP 3 — Token `sub` is a generated ULID, not the real founder

**Diagnosis:** `AuthController.token` ignores the password and signs `sub: generateId()` (explicit "replaced with real founderId after M15" comment). There is no query/repository that reads `app.founder_auth`.

**Files to create:**
- `packages/application/src/founder/queries/authenticate-founder.handler.ts` (new) — a query `AuthenticateFounder { email }` returning `{ founderId, passwordHash } | null`.
- A repository method for `app.founder_auth` — either extend `IFounderProfileRepository` / `pg-founder-profile.repository.ts` with `findAuthByEmail(email)`, or add a small `pg-founder-auth.repository.ts`. (Design choice to settle: extend vs. new repo.)

**Files to change:**
- `apps/api/src/controllers/auth.controller.ts` — `token()` flow becomes: dispatch `AuthenticateFounder` → if null, 401 → `PasswordService.verify(body.password, passwordHash)` → if false, 401 → `jwtService.sign({ sub: founderId, … })`.
- `apps/api/src/composition-root.ts` — register the new query handler; pass `PasswordService` to the controller.
- `packages/application/src/founder/index.ts` (+ infra index) — export the new query/handler/repo method.

**What changes:** Real credential verification. Join `app.founder_auth` to `founder.founders` by email, return the stored bcrypt hash, verify with the existing `PasswordService.verify`, and sign the token with the **real** founder id — so `sub` becomes `01HDEV…FOUNDER` for the seeded dev login.

**New files:** ~1–2 (query handler, optional dedicated repo).

**Depends on:** **GAP 2** (needs the real `queryBus` + repositories). Makes GAP 1 meaningful.

---

## GAP 4 — No `LLM_PIPELINE` consumer; trigger never enqueues; signal-load stub

This gap is three linked pieces:

**4a. Nothing enqueues the pipeline.** `QueueRegistry.enqueueLLMPipeline()` exists but is never called. The trigger path (`CycleController.trigger` → `StartWeeklyCycle`) creates a cycle but never produces an `LLM_PIPELINE` job.
- Likely home: `packages/application/src/cycle/process-managers/weekly-cycle.process-manager.ts` (already exists) reacts to the `WeeklyCycleStarted` event and calls `enqueueLLMPipeline`. Requires the process manager to be subscribed to the event bus and given the `QueueRegistry` — which means the **workers** composition root must also wire the event bus + process managers (today `apps/workers/src/main.ts` runs a stub event bus for the outbox relay).

**4b. No worker consumes `bb-llm-pipeline`.**
- Create `apps/workers/src/llm-pipeline/llm-pipeline.worker.ts` (new) — a `LLMPipelineWorker` class mirroring the other workers: `new Worker(QUEUES.LLM_PIPELINE, process, { connection: bullMq })`. Its `process(job)` must:
  1. Build context via the existing `ContextBuilder.build({cycleId, founderId, cycleNumber, …})` → `{ context, pseudonymiser }`.
  2. Call the existing `executePipeline(context, llmRouter, pseudonymiser)`.
  3. On success: persist `context.committedBrief` to `cycle.internal_briefs` and enqueue Stream-A memory accumulation (`enqueueMemoryAccumulate`) so the existing `MemoryAccumulatorWorker` writes `memory.intelligence_events`. **Design decision to settle:** persist the brief via the existing `CommitBrief` command (handler exists) vs. a direct repository write — recommend `CommitBrief` to stay in the CQRS/outbox model.
  4. On failure: the pipeline already runs S11F fallback internally; persist the fallback brief (`is_fallback = true`) the same way.
  5. Always rely on `executePipeline`'s `finally` for `pseudonymiser.destroy()`.
- Register it in `apps/workers/src/main.ts` alongside the other 9, using the dedicated `bullMq` connection.

**4c. `ContextBuilder.build()` raw-signal loader is stubbed.** It returns `[]` ("stub for M13; full in M15"). Must load this cycle's rows from `cycle.cycle_signals` (via `IWeeklyCycleRepository` — add `findSignalsForCycle` or similar) so the pipeline runs on the three submitted Friday signals rather than nothing.

**Files to create:** `apps/workers/src/llm-pipeline/llm-pipeline.worker.ts`; possibly a workers-side `composition-root.ts` to construct `LLMRouter` (needs `AnthropicClient` + `PromptRegistryClient`), `ContextBuilder`, the event bus, and the process managers.

**Files to change:** `apps/workers/src/main.ts` (register worker + real event bus + process managers); `context-builder.ts` (real signal load); `pg-weekly-cycle.repository.ts` (signal-load method); cycle `index.ts` exports.

**New files:** ~2–3.

**Depends on:** **GAP 2** (CommitBrief handler + repos + buses) and the workers needing a real event bus (shared concern with 4a).

---

## Cross-cutting note — the event bus

Both 4a (process manager enqueues on `WeeklyCycleStarted`) and the outbox relay need a **real in-process event bus** wired in the workers. Today `main.ts` passes a `stubEventBus`. A concrete `IEventBus` (publish/subscribe) is required for domain events emitted via the outbox to reach the process managers that enqueue the pipeline. Confirm whether a concrete `IEventBus` exists in infrastructure or must be created (~1 new file if missing). This is the most likely hidden dependency and should be validated first.

---

## Recommended implementation order

1. **GAP 2 first (foundation):** concrete `CommandBus`/`QueryBus` + API `composition-root.ts` + `ServerDeps`. Nothing else functions without real buses.
2. **Event bus (cross-cutting):** confirm/create concrete `IEventBus`; it's a prerequisite for 4a and for outbox→process-manager delivery.
3. **GAP 3:** `AuthenticateFounder` query + `founder_auth` read + real `token()` flow. Now logins yield the seeded founder id.
4. **GAP 1:** register `createAuthMiddleware` on the founder routes. Now protected routes resolve a real `request.user.sub`. *(At this point signal submission + cycle trigger persist real rows.)*
5. **GAP 4c:** real signal loading in `ContextBuilder`.
6. **GAP 4a + 4b:** wire the workers composition root (event bus + process managers + `LLMRouter`/`ContextBuilder`), create and register `LLMPipelineWorker`, persist brief via `CommitBrief`, fan out memory accumulation.

**Rough new-file estimate:** ~9–12 files (2 buses, 2 composition roots, 1 pipeline worker, 1 auth query handler, possibly 1 auth repo, possibly 1 event bus, plus index/export touch-ups), with edits to ~10 existing files. No spec files (migrations, prompts, domain) change.

## What Phase 8 verification will confirm once complete

With the composition root in place, re-running the exact Phase-8 sequence will demonstrate, end to end:
- **Token** issued with `sub = 01HDEV000000000000000FOUNDER` (real credential verification against `app.founder_auth`).
- **Signals accepted** — three rows land in `cycle.cycle_signals` for the dev founder (proving auth middleware + real command bus + repository persistence).
- **Cycle triggered** — a `cycle.weekly_cycles` row created and a domain event written to `app.domain_events`, relayed by the outbox to the process manager, which enqueues a `bb-llm-pipeline` job.
- **Pipeline completes against the live Anthropic API** — `LLMPipelineWorker` builds context from the real signals, runs S01→S12, and the worker log shows the stage progression and `PR-008` on the STRONG model.
- **Brief committed** — one `cycle.internal_briefs` row with real `mode`, `brief_confidence`, `belief_target_primary`, `conviction_angle`, `strategic_purpose`, and `is_fallback = false`.
- **Intelligence events written** — rows in `memory.intelligence_events` across the relevant layers (via the existing `MemoryAccumulatorWorker`).
- **No fallback / no Anthropic errors** in the worker log — confirming the API key is not just present but valid.

In short: it will prove the system is functionally wired end to end, not merely component-complete — the one thing no milestone checkpoint has yet exercised.
