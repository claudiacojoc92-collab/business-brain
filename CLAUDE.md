# Business Brain

A decision system for founders. Marketing is the first domain: it reads the business (website, pasted
material, PDFs, Instagram), builds a held understanding, proposes a strategy the founder adopts or
rejects, turns it into a 30-day plan and a "Today" move, and creates assets (carousels, reels) under
claim-safety and voice gates. The held decision state is the center of gravity. Don't claim an outcome
or results loop exists; it isn't built.

## Monorepo map

npm workspaces (`packages/*`, `apps/*`), TypeScript project references (`tsconfig.json`), Node 20.

| Path | What it is |
|---|---|
| `packages/shared` (`@bb/shared`) | ids (ulid), clock, errors (`ValidationError`, `NotFoundError`, ...), enums, events |
| `packages/domain` (`@bb/domain`) | aggregates and repository interfaces. Depends on shared only |
| `packages/understanding-mechanics` | pure offer-evaluation and invariants library |
| `packages/application` (`@bb/application`) | services and use cases per feature (`strategy/`, `plan/`, `mirror/`, `arc/`, `carousel/`, `reel/`, ...) |
| `packages/infrastructure` (`@bb/infrastructure`) | Kysely/Postgres repos, Redis/BullMQ, Anthropic client, JWT, encryption, renderers |
| `packages/composition` (`@bb/composition`) | `buildCompositionRoot(db)`, the single place that wires infra to application services |
| `packages/business-model-engine` | plain `.mjs` engine (no build) |
| `apps/api` (`@bb/api`) | Fastify HTTP API: `src/main.ts` → `server.ts` (`ServerDeps`) → `routes/*.routes.ts` |
| `apps/workers` (`@bb/workers`) | BullMQ workers + outbox relay + scheduler |
| `services/reel-studio` | INTERNAL-ONLY Hypit wrapper (Node >= 22.15, own lockfile, not a workspace). License forbids founder-facing use without a commercial license. See its README |
| `apps/web` (`@business-brain/web`) | React + Vite SPA, served by nginx in prod. Standalone: imports no `@bb/*` |
| `database/migrations` | Flyway `V###__*.sql` (V001 to V080). `database/seeds` holds dev seeds |
| `prompts/`, `deployment/prompts/` | versioned LLM prompts with sha256 checksums (hash-fragile, see `deployment/prompts/NOTE.md`) |
| `tools/` | `preflight-env-key.sh`, `founder-test-preflight.sh`, e2e/diag scripts |
| `deployment/` | k8s manifests (legacy), `scripts/` (seed, prompt validation) |
| `docs/` | ADRs (`docs/adr`), stand-up runbook, source/connector specs |

## Commands (run from the repo root)

```bash
make setup                                   # one-time: node check, npm ci, .env, key preflight, deps up, migrate
npm ci                                       # install
npm run type-check                           # tsc --build over the whole graph (NOTE: emits dist/)
npx tsc --noEmit -p apps/api/tsconfig.json   # no-emit check of one project
npm run type-check --workspace @business-brain/web
npm run lint                                 # backend eslint, --max-warnings 0 (root config ignores apps/web)
npm run lint --workspace @business-brain/web # web has its own .eslintrc.cjs
npm test                                     # vitest run: backend (node) + web (jsdom) projects
npx vitest run packages/application/src/plan # one folder or file
BB_IT_DATABASE_URL=postgresql://... npm run test:integration:businessbrain  # env-gated Postgres ITs
make validate-prompts                        # prompt checksum check (needs jq)
```

Local stack (Docker; see `docs/stand-up-runbook.md`):

```bash
make db-up        # postgres:5432 + redis:6379, waits for pg_isready
make db-migrate   # docker compose run --rm migrate (Flyway; the service is in the `migrate` profile)
make db-seed      # psql seeds (needs psql on PATH)
make db-reset     # DESTROYS local volumes, then up + migrate + seed
bash tools/preflight-env-key.sh && docker compose --profile app up -d   # api:3000, workers:3001, web:8080
npm run dev --workspace @business-brain/web  # Vite on :5173, proxies /v1 /auth /api /dev to :3000
```

Gotchas:
- `make dev-api` and `make dev-workers` call `ts-node`, which isn't installed. The Makefile
  `type-check`/`lint`/`test` targets also skip `composition`, `understanding-mechanics`, and `web`.
  Use the npm scripts above instead.
- No dotenv loader in code. Compose injects `.env` via `env_file`. A host-run `node apps/api/dist/main.js`
  needs the env already in the process environment.
- A local, git-ignored `docker-compose.override.yml` may point api and workers at a different DB name than
  the one `migrate` targets (`businessbrain`). Check it before debugging "missing table".

## Architecture conventions

- Dependency direction: shared ← domain ← application ← infrastructure ← composition ← apps. Application
  defines ports (`I*Repository`, `IObjectStore`). Infrastructure implements them. Only
  `packages/composition` constructs concrete adapters.
- Packages export `development` → `src` and `default` → `dist`. Prod and Docker run from `dist`
  (`npx tsc -b`), so `dist/` is required at runtime.
- API routes: `register*Routes(server, deps: ServerDeps)`, one file per feature. See `apps/api/CLAUDE.md`.
- LLM output is never trusted raw. Deterministic gates (claim-safety, structure, anti-fabrication) plus
  repair loops sit around model calls. Verdicts come from classifiers, and the model only supplies signal.
- State is append-only and versioned: strategy, plan, and asset versions are immutable, with lifecycle
  pointers and event ledgers. Don't mutate history.
- Provenance on evidence: `observed` vs `declared`. `founder_self` scope is separate from business scope.
- **Language rule (2026-10-07):** the product UI is ALWAYS English once logged in (buttons, labels, chrome; no
  in-app switcher, the account locale does not drive it). Everything a MODEL writes follows the business's CONTENT
  language: one per business, decided once (stored `businesses.content_language` → first understanding's
  `source_language` → account locale → `en`), never per message; only an explicit "reply in X" changes it. Every
  model call resolves it through `resolveContentLanguage` / `contentLanguageFor`, never the UI locale. UI strings
  live in `apps/web/src/i18n/messages.ts` (EN is the one used). Canonical state is language-independent.
- ESLint: `no-console` is an error, `no-explicit-any` is an error, `import/no-cycle`, and unused args must
  be prefixed `_`.
- Tests live next to the code (`*.test.ts`) or in `__tests__/`. Integration specs are
  `*.integration.spec.ts` and env-gated.

## Hard rules

- **Definition of Done (canonical, ratified 2026-10-07).** A product issue, sub-issue, milestone or project is
  **Done only when its capability is live in production**: the commit is deployed to the production Railway
  services (app.getbusinessbrain.com), and the capability has been exercised **there**, through the path a founder
  actually uses, against real data, with evidence recorded on the Linear issue (deployment ID/time, prod commit,
  what was checked, result). Built, tested, committed, merged, or deployed-but-unverified is **not** Done: keep it
  In Progress with the label `Awaiting prod`. A milestone/project is Done only when all its issues are. Claude
  never deploys just to close an issue (deploys still need `approve deploy`). Non-product work, the ONLY
  exceptions: docs/process/tooling = committed and in effect; content = published; decision = recorded in the repo
  and approved by the operator; open question = answered by the operator. Full rule:
  `docs/operations/agent-sop.md` §3.2.

- Never commit, push, branch, or build unless the task explicitly asks. Read-only tasks stay read-only.
  "Commit the changes" means the **ship flow**: commit → push the branch → PR to `main` → merge (merge
  commit, not squash). Stop on conflicts or failing checks. Merging does not deploy. See SOP §2.6.
- Before ANY api container restart or rebuild, run `bash tools/preflight-env-key.sh &&` first.
  `GOOGLE_OAUTH_ENCRYPTION_KEY` must be in `.env` or restored from the `~/.config/business-brain/`
  backup. Never restart into a missing key: that orphans every encrypted credential.
- Never print or interpolate secret values, even to check presence (use `[ -n "$VAR" ]` or
  `grep -q '^KEY=' .env`). Never shell-source `.env` or other secret files. For `.env` and `*.pem`,
  check existence only; read `.env.example` instead.
- `META_CLIENT_ID` (Facebook Login) and `INSTAGRAM_APP_ID` (Instagram Business Login) are different on
  purpose. Don't unify or "fix" them.
- "Business Brain" is the frozen working name. Don't propose renames.
- Frozen slices: the Slice 4 voice and message-safety contract, Slice 6/6.1 carousel, and Slice 7 V1/V2
  reels. Don't modify them except to fix a regression.
- A per-business reset must also clear the `understanding.*` tables (`raw_capture`,
  `normalized_observation`, `corpus_revision`, `ingestion_idempotency`), scoped by
  `business_ref='business:<id>'` (not `business_id`). Otherwise re-ingest throws a content conflict.
- The prod DB is internal-only. Reach it via `railway connect` or `railway ssh --service api`.
- `app.getbusinessbrain.com` is the Railway `web` service (nginx proxies `/v1`, `/auth`, `/api` to
  `api.railway.internal`). API deploys self-heal through the nginx dynamic resolver. If they don't,
  fall back to `railway redeploy --service web --yes`. Never run bare `railway domain` (it creates a
  public domain).

## Operating practices

Full procedures and safety protocols: `docs/operations/agent-sop.md`. Development loop (intent → plan →
build → verify → ship → handoff): `docs/operations/operator-cheatsheet.md`. Work records live in
`intent/<date>-<slug>/`. This list grows: when something is repeated or a mistake happens twice, add one
line here and the detail to the SOP.

- Orient first: `git status --short && git log --oneline -5`, then read the task's `plan.md` status log.
- Specify before building: new features/integrations/data/prod changes need `intent.md` → `spec.md` (product,
  technical, flow, design, data) → `plan.md`. Interview the operator for answers; never guess them.
- Verify narrowest-first: `npx vitest run <path>` → `npx tsc --noEmit -p <project>` → `npx eslint <paths>
  --max-warnings 0` → `npm test`. UI changes are verified live in the browser pane, not by tests alone.
- Stop and ask before: push or merge outside the ship flow, branch delete, `reset --hard`, any `railway up/redeploy/variables/domain`,
  prod writes, `rm -r` outside the scratchpad, new migrations, edits to frozen slices.
- Local DB queries: confirm the DB name first (`businessbrain` vs the override's name).
- Don't poll with `sleep`; use background tasks or Monitor.
- Sub-agents own disjoint files and never commit or push. Re-check anything destructive they recommend.
- Sessions: `/session-start` (briefing from handoff + Linear + git + active intents) and `/session-end` (Linear
  issue states + progress comments + project status updates, plan status log, handoff in
  `~/.claude/handoffs/<project>/latest.md`, memory, resume prompt). See `docs/operations/session-continuity.md`.
- Tracking: Linear team "Business Brain" (BUS-xx). Roadmap label → project (= intent folder) → milestone (plan
  stage) → issue (work step) → sub-issue. Mention BUS-xx in commits. Never invent roadmap steps. See
  `docs/operations/linear-workflow.md`.

**Enforced by hooks** (`.claude/hooks/rules.mjs`, active even in bypass mode). A blocked action is
denied with a `[rule-id]` message. Never work around it: stop, say what you want to run and why, and ask
the operator to type `approve <gate>` (valid for that one message/turn). Gates: `push`, `merge`, `commit`,
`destructive-git`, `delete`, `deploy`, `prod`, `prod-write`, `migration`, `frozen`, `rules`. Always
blocked, no approval path: printing/sourcing secrets, bare `railway domain`, force push, api restart
without the preflight, editing committed migrations. Sub-agents can never commit or push. New rule =
add it to `rules.mjs` + a case in `guard.test.mjs`, run `node --test '.claude/hooks/*.test.mjs'` (needs
`approve rules`).

## Git

- Remote is SSH (`git@github.com:claudiacojoc92-collab/business-brain.git`). Don't switch to HTTPS.
- Main dev branch: `feature/business-brain-v1`. Other long-lived branches: `feature/public-site` (root
  static HTML for getbusinessbrain.com, Cloudflare-fronted, deploy is external to this repo) and
  `meta/reviewer-shell`.
- Work on another branch with `git worktree add .worktrees/<name> <branch>` (git-ignored). Don't make
  separate Desktop copies.
