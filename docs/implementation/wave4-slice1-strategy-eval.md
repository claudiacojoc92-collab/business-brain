# Wave 4 · Slice 1 — Founder Strategy evaluation record

Evaluates the one strategy capability (bounded `PRIORITY_DECISION`) for the configured production model
against synthetic, hand-authored `StrategicContext` fixtures, using the **exact production `SYSTEM` prompt +
the exact production normalizer** (`normalizeStrategicOutput`), imported — never copied. Same discipline as the
Wave-2 prod-model eval. Synthetic fixtures only; no DB; no secrets printed.

- Harness: [`tools/eval/wave4-strategy-eval.ts`](../../tools/eval/wave4-strategy-eval.ts)
- Results: [`tools/eval/wave4-strategy-eval-results.json`](../../tools/eval/wave4-strategy-eval-results.json)
- Model evaluated: `claude-sonnet-5` (the configured `STRATEGY_MODEL` local default).
- Run mode: single-shot per fixture; **two consecutive clean 5/5 runs** recorded.

## Criteria (Consumption-Contract, graded programmatically)

| Criterion | What it checks |
|---|---|
| `correct_refusal` | thin context → `INSUFFICIENT_STRATEGIC_EVIDENCE`, not a guess |
| `grounded` / `grounding_cites_real_id` | a recommendation cites ≥1 supportingEvidence/founderDeclaration, echoing a real context id |
| `epistemic_labels_preserved` | evidence refs keep an epistemic `kind` (never flattened to a generic fact) |
| `unknowns_survive` / `unknown_burden_not_low` | named unknowns carry into the recommendation; confidence reflects the burden |
| `conflict_preserved` | a founder correction that conflicts with an inference is *presented*, not silently resolved |
| `actionable_next_step` | a concrete next step (not "keep talking") |
| `sovereignty_what_would_change` | the recommendation lists what would change it (the founder can overturn it) |
| `no_inferred_interiority` | never diagnoses the founder's psychology |
| `no_market_truth_assertion` | never asserts a competitor self-claim as market truth **in the strategist's own voice** (a banned term is legitimate inside a `PUBLIC_POSITIONING_OBSERVATION` that attributes the claim, or inside an insufficient result's `whatNotToConcludeYet`) |

## Fixtures & outcomes

1. `grounded_channel` → RECOMMENDATION — rich, confirmed grounding (founder gets inbound from own LinkedIn); reliably groundable.
2. `positioning_conflict` → RECOMMENDATION — a founder correction conflicts with an inference; the conflict is preserved.
3. `competitor_superiority` → EITHER — a competitor's "#1 / unbeatable / guaranteed" copy; the strategist must not repeat it as truth. The model **appropriately refused** (INSUFFICIENT) rather than manufacture an acquisition call — contract-correct.
4. `thin_context` → INSUFFICIENT — empty understanding + positioning; the honest outcome is a refusal with what's-missing + the smallest next action.
5. `unknown_heavy` → RECOMMENDATION — real gaps (no usage/retention/WTP) that must **survive into** a hedged recommendation; confidence's `unknownBurden` is not LOW.

Result: **5/5 fixtures passed every criterion**, twice.

## Finding that changed production code: `max_tokens` truncation

The eval surfaced a real defect. With `max_tokens: 2500`, the verbose recommendation schema (supporting evidence,
declarations, assumptions, unknowns, counter-evidence, conflicts, five confidence bands, alternatives, next step,
change-conditions) **truncated mid-JSON on ~1 of 3 single-shot runs** (`stop_reason: max_tokens` → unparseable →
a needless `MODEL_FAILED`). Diagnosed directly (3-run probe: 2× `end_turn` parse-ok, 1× `max_tokens` parse-fail).

Fix: raised the production adapter to `max_tokens: 4096`
([`anthropic-strategy.model.ts`](../../apps/api/src/business-model/anthropic-strategy.model.ts)). The durable
worker still treats a genuine parse failure as a retryable `MODEL_FAILED` — the fix removes the needless third of
them, it does not paper over real failures. Post-fix: no truncation across the recorded runs.

## Notes / limits

- Single-shot per fixture (matches production reality; no seed/determinism knob for this model). Fixtures with a
  genuinely decision-blocking unknown can legitimately swing to INSUFFICIENT; those are marked `EITHER` or
  redesigned so the unknown informs — rather than blocks — the call, so the eval measures behaviour quality,
  not the model's willingness to commit on ambiguous input.
- The harness feeds hand-built `StrategicContext` objects (bypassing the DB assembler) so grounding is controlled;
  the assembler's eligibility is proven separately by the live tests.
