# Wave 4 · Founder Strategic Context — evaluation record

Extends the strategy evaluation **without duplicating production prompts**: the harness imports the exact production
`SYSTEM` prompt (`strategy-2`) + the exact production `normalizeStrategicOutput`, and populates `founderContext` (the
effective resolver's output shape) on synthetic `StrategicContext` fixtures. Synthetic only; no DB; no secrets.

- Harness: [`tools/eval/wave4-strategic-context-eval.ts`](../../tools/eval/wave4-strategic-context-eval.ts)
- Results: [`tools/eval/wave4-strategic-context-eval-results.json`](../../tools/eval/wave4-strategic-context-eval-results.json)
- Model: `claude-sonnet-5`. Single-shot per fixture; **two consecutive runs recorded: 11/12 then 12/12**.

## Fixtures (12) & what each checks

low_budget, tight_capacity, pref_vs_evidence, nonneg_exclusion, goal_no_target, dual_primary, unknown_not_zero,
personal_capacity, nonneg_cost, income_predictability, resource_audience, horizon_scoped.

## Criteria (graded programmatically)

- **parsed** (single-shot); **no_inferred_interiority** (never "risk-averse", "lack discipline", "not ready", "low
  capacity", "you struggle", "avoid selling"); **no_market_truth_assertion** (own-voice);
- **cites_context** (personalization — a `FOUNDER_STRATEGIC_CONTEXT` reference or a context statement is used);
- **context_provenance_resolves** (any cited context ref carries a `logicalItemId`/`refId` that matches a provided id);
- **respects_nonnegotiable** (negation-aware: the *core* recommendation must not positively advocate the excluded
  approach — naming it to negate it, "don't raise", "rather than outbound", is respecting it);
- **names_preference_tension** (preference vs evidence); **exposes_conflict**; **no_zero_assumption** (unknown ≠ zero
  — only definitive zero-assertions fail); **actionable**; **sovereignty_what_would_change**.

## Result: every parsed run met every contract criterion

- Run A: 11/12 — the single miss was `horizon_scoped` returning unparseable JSON (single-shot `stop_reason:max_tokens`
  truncation), which the durable worker retries in production; it was **not** a contract violation.
- Run B: **12/12**.

## Grader precision fixes (found during eval, not production defects)

Two initial "failures" were grader false-positives, corrected: (1) the model **respects** a non-negotiable by naming
it to negate it ("Do not pursue external funding") — the grader now checks the *core* recommendation with
negation-awareness rather than flagging any mention; (2) acknowledging an unknown ("your budget is unknown") is not
assuming zero — the zero-assumption check now targets only definitive assertions. No production code changed for
these; the model behaved correctly throughout.

## Variance

Single-shot JSON truncation appears occasionally on the largest outputs (the durable worker's `MODEL_FAILED` + retry
path handles it). Recorded rather than tuned away, per the brief.
