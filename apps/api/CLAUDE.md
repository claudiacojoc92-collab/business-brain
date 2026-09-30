# apps/api (@bb/api)

Fastify API. Boot path: `src/main.ts` (reads `DATABASE_URL`/`REDIS_URL`, throws if missing) →
`buildCompositionRoot(db)` from `@bb/composition` → `createServer(deps)` in `src/server.ts` →
`registerPlugins` + `registerRoutes` (`src/routes/index.ts`).

## Conventions

- One file per feature: `src/routes/<feature>.routes.ts` exporting `register<Feature>Routes(server, deps)`.
  Register it in `src/routes/index.ts`. New services arrive through `ServerDeps` in `server.ts`, wired
  in `packages/composition`. Don't construct adapters inside routes.
- Founder routes live under `/v1`. JWT is enforced by the global preHandler (`src/middleware/authenticate.ts`),
  and business membership is checked per request. `/health`, `/auth/*`, and the Instagram compliance
  callbacks sit outside `/v1`.
- Throw `@bb/shared` errors (`AuthenticationError`, `NotFoundError`, `ValidationError`). The error plugin
  (`src/plugins/error-handler.plugin.ts`) maps them to HTTP responses.
- Responses are founder-facing projections. Hide internal ids, enums, hashes, and strategy version ids,
  except the opaque handles the UI must POST back (see `projectPlan` in `plan.routes.ts`).
- Dev-only routes (`m21-dev`, `m22-dev`, `google-dev`, `declared-dev`) register only when
  `NODE_ENV !== 'production'`. Keep new debug routes behind that guard.
- Founder telemetry goes through `src/telemetry/founder-events.ts` (`app.founder_event`).

## Tests

- Route tests (`src/__tests__/routes/*.routes.test.ts`) build a bare `Fastify()`, call
  `registerErrorHandler` plus the one `register*Routes`, and back the real application service with
  in-memory repos and stub model ports. No DB or network.
- `src/__tests__/__integration__/` holds env-gated specs (`BB_IT_DATABASE_URL`, `M21_LIVE=1`). They don't
  run in plain `npm test`.
- Run just this app with `npx vitest run apps/api`.
