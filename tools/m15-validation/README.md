# M1.5 Synthesis Validation Harness (disposable)

Standalone scaffolding to test the **engine**, not the product: reason over multiple real
sources for ONE founder as a SINGLE business, and surface synthesis-first,
evidence-grounded insights. Not wired into the app — no route, UI, DB, OAuth, or the
weekly-cycle pipeline. Reuses the Anthropic SDK directly (same construction as
`packages/infrastructure/src/llm/anthropic-client.ts`).

## Run

```bash
# uses the bundled example content:
node tools/m15-validation/run.mjs

# real content (recommended): create your own input file and pass it:
node tools/m15-validation/run.mjs path/to/input.json [path/to/report.md]
```

Requires `ANTHROPIC_API_KEY` (read from env, or the repo `.env`). Model defaults to
`claude-sonnet-4-6`; override with `M15_MODEL`.

## Input format

A JSON array of labeled real content — one entry per source, tagged with its true source.
Manual/pasted/exported content only (no scraping):

```json
[
  { "source": "website",   "content": "…real text from the site…" },
  { "source": "instagram", "content": "…real captions/posts…" },
  { "source": "linkedin",  "content": "…real posts/about…" }
]
```

## Output

A synthesis-first report (stdout + `report.md`): each insight leads with a business-level
synthesis, then its evidence chain (source → quote → why), with a founder scoring line
`[ grounded? Y/N ] [ non-obvious? Y/Somewhat/N ]`; then observations, then hypotheses; then
**excluded** items with reasons; then a summary.

## The trust rules (enforced in `schema.mjs` + `run.mjs`)

- Every insight MUST carry a non-empty evidence chain, else it is **excluded** (logged).
- Every cited `source` MUST be one of the sources actually provided, else **excluded**
  (blocks fabricated provenance — the M1 bug, engine-side).
- Observations require source + quote; hypotheses carry neither. They are never blurred.
- Exclusions are **findings**, reported explicitly — never hidden.

## Success

See the criterion printed at the top of every report. In short: at least one insight that
is **both grounded AND non-obvious**. A surprising insight with no evidence chain is the
worst outcome, not a partial win. (Grounding is enforced here; "non-obvious" is the
founder's call via the scoring line.)

## Fallback (not built yet)

v1 is a single SDK call. If synthesis quality is poor, a staged approach (per-source
extraction → cross-source synthesis) is the fallback — add it only if the single call
demonstrably underperforms.
