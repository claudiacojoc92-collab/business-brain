# Business Brain

Business Brain is a decision system for founders, starting with marketing. It reads a business
(website, pasted material, documents, Instagram) and builds a held understanding of it. From there it
proposes a strategy the founder can adopt or reject, turns an adopted strategy into a 30-day plan with a
daily "Today" move, and creates on-strategy assets like carousels and reels.

This repo is an npm-workspaces TypeScript monorepo with a Fastify API, BullMQ workers, a React/Vite web
app, and Postgres (Flyway) plus Redis.

```
apps/        api (Fastify) · workers (BullMQ) · web (React + Vite, served by nginx)
packages/    shared · domain · application · infrastructure · composition · understanding-mechanics
database/    Flyway migrations (V###__*.sql) + dev seeds
prompts/     versioned LLM prompts + checksums
tools/       preflight and diagnostic scripts
docs/        ADRs, runbooks, specs
```

## Prerequisites

- **Node 20** (see `.nvmrc`; `package.json` engines is `>=20 <21`). With nvm: `nvm use`.
- **npm** (ships with Node; the lockfile is `package-lock.json`).
- **Docker** with the Compose plugin, for Postgres 16, Redis 7, Flyway, and the containerized app.
- Optional: `psql` for `make db-seed`, `jq` for `make validate-prompts`, and `ffmpeg`/`ffprobe` for reels.

## First-time setup

One command:

```bash
make setup
```

It runs these steps, which you can also run by hand:

1. **Check Node.** The major version must match `.nvmrc`. Set `SKIP_NODE_CHECK=1` to bypass.
2. **Install:** `npm ci`
3. **Create env:** `cp .env.example .env`. This only happens if `.env` is missing, so an existing `.env`
   is never overwritten. Then fill in real values. The app boots without `ANTHROPIC_API_KEY` and the JWT
   keys, but LLM features and signed auth won't work. `.env.example` has the steps for generating an
   RS256 dev keypair.
4. **Encryption-key preflight:** `bash tools/preflight-env-key.sh`
   `GOOGLE_OAUTH_ENCRYPTION_KEY` (64 hex chars) must be present. If it's missing, the script restores it
   from `~/.config/business-brain/google_oauth_encryption_key`. On a brand-new machine with no backup,
   generate a key with `openssl rand -hex 32`, put it in `.env`, and save a copy at that backup path.
   Losing this key orphans every stored OAuth credential.
5. **Start datastores:** `make db-up` (Postgres on 5432, Redis on 6379)
6. **Apply migrations:** `make db-migrate` (= `docker compose run --rm migrate`)

Optional: `make db-seed` loads a dev founder and the prompt registry (needs `psql`).

## Running locally

Full stack in Docker (the verified path; details in `docs/stand-up-runbook.md`):

```bash
bash tools/preflight-env-key.sh && docker compose --profile app up -d
# api http://localhost:3000   workers :3001   web http://localhost:8080
curl -s http://localhost:3000/health
```

Always chain the preflight (`&&`) before starting, restarting, or rebuilding the api container.

Web dev server with hot reload, against an api on :3000:

```bash
npm run dev --workspace @business-brain/web   # http://localhost:5173 (proxies /v1 /auth /api /dev)
```

Monitoring (optional): `docker compose --profile monitoring up -d` starts Prometheus on :9090 and
Grafana on :3002.

Notes:
- The api and workers run from compiled `dist/` (`npx tsc -b`). `make dev-api` and `make dev-workers`
  expect `ts-node`, which isn't installed in this repo.
- There's no dotenv loader in the code. Compose injects `.env`. A process started on the host needs its
  env provided another way.

## Tests and quality

```bash
npm test                                          # all Vitest projects: backend (node) + web (jsdom)
npx vitest run apps/api                           # one app/package/folder/file
npm run type-check                                # tsc --build across the project graph (emits dist/)
npm run lint                                      # backend ESLint, zero warnings allowed
npm run lint --workspace @business-brain/web      # web ESLint (separate config)
make validate-prompts                             # prompt checksum verification
```

Postgres integration suites are env-gated and don't run by default:

```bash
BB_IT_DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5432/<throwaway_db> \
  npm run test:integration:businessbrain
```

An ephemeral test stack is available with `docker compose -f docker-compose.test.yml up -d`
(Postgres on 5433, Redis on 6380, with migrations applied).

## Database migrations

- Migrations live in `database/migrations/V###__description.sql` and are applied by Flyway 10.
- They are append-only. Checksums are validated on migrate, so never edit an applied file. Add the next
  version instead.
- Local: `make db-migrate`. Destructive full reset: `make db-reset` (drops volumes, then runs up, migrate,
  and seed).
- Production migrations run inside Railway through `Dockerfile.migrate-founder`, which applies the whole
  folder to the Founder MVP database. `Dockerfile.migrate` is the legacy V060 to V063 set for the older
  DB.

## Deployment overview

- **App:** `app.getbusinessbrain.com` is hosted on Railway. Services are `web` (`Dockerfile.web`, nginx
  serving the SPA and proxying `/v1`, `/auth`, `/api` to the api over private networking), `api`
  (`Dockerfile.api`), Redis, the Founder MVP Postgres, and a migrate service (`Dockerfile.migrate-founder`).
  The prod DB is private. Reach it with `railway connect` or `railway ssh --service api`.
- nginx re-resolves the api on every deploy, so an api deploy shouldn't need a web restart. If the web
  proxy doesn't recover, run `railway redeploy --service web --yes`.
- Deploy only committed code from a clean checkout. Deploys and pushes happen only with the owner's
  explicit approval.
- **Marketing site:** `getbusinessbrain.com` is static HTML on the `feature/public-site` branch,
  Cloudflare-fronted. It's deployed outside this repo.
- `deployment/k8s/` holds older Kubernetes manifests that the current Railway setup doesn't use.

## Working on other branches

Use a git worktree instead of a second clone:

```bash
git worktree add .worktrees/<name> <branch>   # e.g. feature/public-site, meta/reviewer-shell
```

## Docs

- `CLAUDE.md`: conventions and hard rules (for humans and AI assistants alike)
- `docs/stand-up-runbook.md`: full-stack local bring-up and smoke checks
- `docs/adr/`: architecture decisions (ADR-007 to ADR-010)
- `docs/sources/`: connector specs (Google, Gmail, Instagram)
- `docs/composition-root-scope.md`: composition root wiring
- `deployment/prompts/NOTE.md`: prompt mirroring and checksum byte rules
- `monitoring/runbooks/`: alert-response runbooks
