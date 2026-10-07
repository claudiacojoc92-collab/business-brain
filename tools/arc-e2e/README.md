# Arc end-to-end test (Phase 3)

Drives all nine Day-One arc moments through the **real composition + real models** against a local
test Postgres, seeded with **real Body Move source content** (`body-move-seed.json`: 8 website pages +
both brochures + a link). Verifies at each moment: structure, one-language (no leak), source grounding,
and hierarchy (opener bullets ≤3 and short, no monster paragraphs). Prints a PASS/FAIL report per
moment and exits non-zero on any failure.

## Run

```bash
# 1. bring up + migrate the throwaway test DB
docker compose -f docker-compose.test.yml up -d postgres-test
docker compose -f docker-compose.test.yml run --rm migrate-test

# 2. build the packages (dist) the harness imports
npx tsc -b packages/shared packages/domain packages/application packages/infrastructure packages/composition

# 3. run (uses ANTHROPIC_API_KEY from .env; DEBUG_E2E=1 prints per-answer timing)
node tools/arc-e2e/run.mjs
```

It creates a scoped test founder + business and deletes the business rows at the end; the test DB is
ephemeral (tmpfs) anyway. Nondeterministic in wording (real models) but stable in pass/fail at
temperature 0.
