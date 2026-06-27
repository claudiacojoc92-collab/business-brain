# Runbook: Full-Stack Stand-Up (local / dev)

**Purpose:** Bring up the complete Business Brain stack (postgres + redis + migrate + api + workers + web)
reproducibly, and smoke-test it. Every command and port below was verified end-to-end against
`docker-compose.yml` and `deployment/scripts/`.

> This is a stand-up/deploy procedure, not an alert-response runbook (those live in
> `monitoring/runbooks/`). It is placed under `docs/` alongside other operator docs.

## Prerequisites

- **Docker** (Engine 24+; verified on 29.5.3) with the Compose plugin.
- **`.env`** at the repo root. `.env` and `.env.example` already exist; copy the example if needed:
  `cp .env.example .env`.
- **Boot env reality** (no real secrets required just to boot):
  - `DATABASE_URL` and `REDIS_URL` are **set by compose** (`environment:`) to the service hostnames
    (`postgres:5432`, `redis:6379`) and take precedence over `.env`. They are **required** — api/workers
    throw `DATABASE_URL is required` / `REDIS_URL is required` if absent.
  - `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` / `ANTHROPIC_API_KEY` **default to `''`** → the stack **boots
    fine without them**, but the LLM pipeline and real signed-JWT auth are **not exercised** (see caveat
    below).

## Service map (verified ports)

| Service   | Container       | Profile      | Host port → container |
|-----------|-----------------|--------------|-----------------------|
| postgres  | bb-postgres     | _(default)_  | 5432 → 5432           |
| redis     | bb-redis        | _(default)_  | 6379 → 6379           |
| migrate   | bb-migrate      | `migrate`    | _(one-shot, no port)_ |
| api       | bb-api          | `app`        | 3000 → 3000           |
| workers   | bb-workers      | `app`        | 3001 → 3001           |
| web       | bb-web          | `app`        | 8080 → 80             |
| prometheus| bb-prometheus   | `monitoring` | 9090 → 9090           |
| grafana   | bb-grafana      | `monitoring` | 3002 → 3000           |

> **Gotcha — the `migrate` service is under `profiles: [migrate]`, not the default profile.** A plain
> `docker compose up` or `--profile app up` will **not** run migrations. Run it explicitly (below).

## Bring-up sequence (verified)

```bash
# 0. Clean slate (DESTROYS local DB/redis volumes — omit -v to preserve data).
docker compose --profile app --profile migrate down -v

# 1. Start datastores and wait for healthchecks (postgres + redis report "healthy").
docker compose up -d postgres redis
docker compose ps   # confirm postgres + redis = "Up (healthy)" before continuing

# 2. Apply migrations (one-shot flyway; explicit because it's in the `migrate` profile).
docker compose run --rm migrate
# Expect: "Successfully applied 48 migrations to schema founder, now at version v048"
# (idempotent V040–V042 may log "already exists, skipping" — harmless.)

# 3. Build (first run) + start the app services.
docker compose --profile app up -d        # builds Dockerfile.api/.workers/.web if needed
docker compose ps                          # api, workers, web = "Up"; postgres/redis "healthy"
```

### Gotcha — host port 3001 already in use

`bb-workers` publishes host `3001`. If an **orphaned `node` process** (e.g. a leftover local
`node apps/workers/dist/main.js` from a prior session) holds it, the workers container fails with
`bind: address already in use`. This is **environmental, not an image defect**.

```bash
lsof -i :3001            # find the PID holding the port
kill <PID>               # free it (only if it's a stray leftover, not something you need)
docker compose --profile app up -d workers   # restart the workers container
```

## Smoke checks (verified results)

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/            # 200  (SPA shell)
curl -s http://localhost:8080/review | grep -o "<title>[^<]*</title>"      # <title>Business Brain</title> (SPA fallback)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/v1/founders/me  # 401  (nginx → api round trip; NOT 502)
curl -s -X POST http://localhost:8080/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@test.dev","password":"x","grant_type":"password"}'   # 401 INVALID_CREDENTIALS (real DB lookup)
```

- **200** on `/` and `/review` → web serves the SPA and the nginx SPA fallback works on direct navigation.
- **401 (not 502)** on `/v1/...` → nginx proxied to the api container (same-origin `/v1` + `/auth` proxy).
- **401 `INVALID_CREDENTIALS`** on `/auth/token` → the api executed a real DB query (api ↔ postgres confirmed).

Useful during a smoke:

```bash
docker compose logs api workers      # api: "API server started, port 3000"; workers: scheduler jobs firing
```

## LLM / signed-auth caveat

With `JWT_*` and `ANTHROPIC_API_KEY` empty, the stack runs but **does not exercise**:

- the **LLM pipeline** (any Anthropic call needs a real `ANTHROPIC_API_KEY`), and
- **real signed-JWT auth** (login/token issuance with real keys).

Set real values in `.env` to exercise those paths. **Do not commit real secrets.**

## Prompt seeding (only needed for LLM-path testing)

Prompt seeding is **separate from migrations** — run it **after** step 2, and only if you intend to test
the LLM pipeline (with `ANTHROPIC_API_KEY` set):

```bash
# Seeds the dev founder + prompt-registry rows (stubs) via psql against the published 5432 port.
DATABASE_URL=postgresql://bbuser:bbpassword@localhost:5432/businessbrain \
  bash deployment/scripts/seed-dev.sh
#   → applies database/seeds/dev-founder.seed.sql + database/seeds/prompt-registry.seed.sql

# Loads the full prompt bodies from prompts/*.txt and recomputes SHA-256 hashes in the registry.
python3 deployment/scripts/load-prompts.py
#   (uses: docker compose exec -T postgres psql -U bbuser -d businessbrain)

# Optional: verify prompt file checksums against prompts/checksums.json.
bash deployment/scripts/validate-prompts.sh
```

## Teardown

```bash
docker compose --profile app --profile migrate down      # stop + remove containers, KEEP volumes
docker compose --profile app --profile migrate down -v    # also remove volumes (full reset)
```

## Optional: observability

```bash
docker compose --profile monitoring up -d     # prometheus :9090, grafana :3002
```
