# database/

Flyway migrations (`migrations/V###__snake_description.sql`, currently V001 to V080) and dev seeds
(`seeds/`).

- Append only. Never edit an applied migration: `validateOnMigrate=true`, so a checksum change breaks
  every environment. Add the next `V###`. `outOfOrder=false`, so pick the next number, not a gap.
- `placeholderReplacement=false`, so `${...}` in SQL is literal.
- Write idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Start the file with a
  comment block explaining why the change exists.
- Flyway manages `founder,cycle,memory,campaign,outcome,app,audit` (history table in `founder`). Later
  schemas (`businessbrain`, `understanding`, `evidence`, `workspace`, `bb_types`) are created by
  migrations themselves.
- Ids are `text` (ulid) and timestamps are `timestamptz`. Versioned product state is append-only
  (immutable versions plus lifecycle pointers), so don't design UPDATE-in-place history.
- Local apply: `make db-migrate` (= `docker compose run --rm migrate`, mounts `./migrations`). Local
  config for a host flyway lives in `flyway.conf`.
- Two prod lineages: `Dockerfile.migrate-founder` copies the whole folder into the Founder MVP Postgres
  (the live app DB). `Dockerfile.migrate` is the legacy V060 to V063 set for the old DB. Don't mix them.
  Prod migrations run only through Railway deploys, never from a laptop.
- Per-business resets must also clear `understanding.*` rows by `business_ref='business:<id>'` (see
  root CLAUDE.md).
