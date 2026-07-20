# Wave-2 Acceptance Debt B — Production-Model Evaluation

Two model-dependent Layer-2 capabilities evaluated **separately** (never merged into one "model quality"
verdict): Business Understanding **synthesis** and Market-context **inference**. The configured
production-capable model was compared with the `claude-sonnet-4-6` baseline on identical synthetic fixtures,
the exact production prompts (imported, not copied), and the exact production normalizers.

- **Commit (freeze):** `c6bd42f` · harness `tools/eval/prod-model-eval.ts` · raw results `tools/eval/prod-model-eval-results.json`
- **Frozen engine:** untouched (`prompt=a39ea88…`, `schema=79802e9…`) — out of scope; it is byte-frozen and separately versioned.

## 1. Production configuration — investigation & finding

**Finding (a real configuration-ambiguity defect, now fixed):** before this pass, both capabilities ran on an
**implicit hardcoded default** — `AnthropicSynthesisModel` read `SYNTHESIS_MODEL ?? 'claude-sonnet-5'` and
`AnthropicMarketInference` read `MARKET_INFERENCE_MODEL ?? SYNTHESIS_MODEL ?? 'claude-sonnet-5'`, and **neither
env var was set anywhere** (`.env`, `.env.example`, the k8s configmap, or CI). The deployment configmap
declared only `LLM_STRONG_MODEL=claude-sonnet-4-6` / `LLM_MEDIUM_MODEL=claude-haiku-4-5`, which feed the
**LlmRouter / frozen-engine** path and were **never wired** to synthesis or market inference. So a production
deploy would silently run both capabilities on the hardcoded `claude-sonnet-5` while an operator reading the
configmap would reasonably assume `claude-sonnet-4-6` — a **silent-divergence risk with no authoritative value**.

| Dimension | Business Understanding synthesis | Market inference |
|-----------|----------------------------------|------------------|
| Provider | Anthropic | Anthropic |
| Model id (effective) | `claude-sonnet-5` | `claude-sonnet-5` |
| Configured via | `SYNTHESIS_MODEL` | `MARKET_INFERENCE_MODEL` → falls back to `SYNTHESIS_MODEL` |
| Prompt version | `synthesis-1` | `market-infer-sys-1` |
| Schema version | `conclusions-1` | `market-inference-1` |
| Before this pass | implicit hardcoded default; unset everywhere | implicit hardcoded default; unset everywhere |
| After this pass | explicit + validated (fail-fast in prod); declared in `.env.example` + k8s configmap | same |

**Resolution (Step 2, no model change):** `apps/api/src/business-model/model-config.ts` resolves each
capability's model separately, **fails fast in production-capable mode** (`NODE_ENV=production`) when the model
is missing/invalid, and keeps the previously-hardcoded value (`claude-sonnet-5`) as a clearly-separated
local/test default. `main.ts` validates + logs the resolved config at boot (no secrets). `SYNTHESIS_MODEL`
and `MARKET_INFERENCE_MODEL` are now declared explicitly (= `claude-sonnet-5`, the current effective value) in
`.env.example` and `deployment/k8s/configmaps/app-config.yaml`.

## 2. Method

Repeatable harness (`tools/eval/prod-model-eval.ts`): imports the exact production `SYSTEM` prompts + the exact
normalizers (`normalizeConclusions`, `capMarketEpistemics`), builds the exact production user prompts, and runs
each fixture through both models. Per-fixture records preserve fixture id, source evidence, model/provider,
prompt + schema version, parsed + normalized output, automated checks, latency, and token usage
(`tools/eval/prod-model-eval-results.json` — synthetic fixtures, **no secrets, no founder data**).

**Eval-blocking defect (Step 9), fixed & re-run:** the harness first set `temperature: 0` for determinism, but
`claude-sonnet-5` **rejects `temperature`** ("deprecated for this model") → every sonnet-5 call 400'd (baseline
was unaffected). **Production code never sets `temperature`**, so this was a harness-only bug (no product
defect). Fix: omit `temperature` to match production; both models re-run cleanly. Pre-fix run discarded; all
results below are from the post-fix production-equivalent run. No seed/determinism knob exists — single-shot
per fixture (matching production reality); variance is noted.

**Automated checks:** schema validity, parse failure, evidence-reference grounding, forbidden/demonstrated
market claims (via the real `MARKET_TYPES` cap + `capMarketEpistemics`), required uncertainty markers /
hedging, missing/duplicated conclusions, and `epistemicStatus != OBSERVED` for inference. Automated checks
establish discipline, **not** semantic truth — the qualitative judgments below are explicit human review.

## 3. Business Understanding synthesis — 9 fixtures

Fixtures: clear · ambiguous · sparse · contradictory · empty · promotional-without-evidence · multiple-offers ·
elegant-but-vague · founder-claim-conflicts-with-website.

**Automated checks (post-fix run):**

| Model | parse fail | demonstrated market claims | ungrounded fixtures | duplicates | empty guarded | avg latency | tokens in/out |
|-------|-----------|----------------------------|---------------------|-----------|---------------|-------------|---------------|
| baseline `claude-sonnet-4-6` | 0/8 | 0 | 0 | 0 | ✅ | 13.3s | 3385 / 5879 |
| configured `claude-sonnet-5` | 0/8 | 0 | 0 | 0 | ✅ | 10.5s | 5178 / 7923 |

**Human review (grounding · epistemic discipline · usefulness · constitution):** both models were clean; every
conclusion was grounded or explicitly hypothesis/needs-more-evidence, no invented products/metrics/geography/
pricing, market-facing types never in a demonstrated band, unknowns retained. On the two hardest fixtures both
**preserved the contradiction rather than smoothing it**:
- *contradictory* ($25k bespoke vs $19 template): both named the incompatible audiences and asked "funnel vs.
  separate revenue?"; sonnet-5 added a correctly-capped `market_position` HYPOTHESIS ("actual audience reactions
  are unknown from this material alone").
- *founder-claim-conflicts-with-website*: both flagged the solo-freelancer-vs-40-person-agency contradiction as
  an `inconsistency` and refused to pick a side; the founder-declared claim did **not** override observed
  evidence. sonnet-5 was more thorough (9 vs 3 conclusions) without fabricating.

Constitution: no founder diagnosis, no inferred motive/interiority, no flattery, no manufactured urgency, no
"final truth" framing — held for both. sonnet-5 is faster and more thorough (more tokens), with **no grounding
or epistemic regression**.

## 4. Market inference — 12 fixtures

Fixtures: clear · ambiguous · sparse · contradictory · promotional-superiority · pricing-without-response ·
leadership-without-proof · trusted-by-logos · category-creation · reference-brand-not-competitor · twin_a /
twin_b (similar language, different offer structure).

**Automated checks (post-fix run):**

| Model | parse fail | ever OBSERVED | not hedged | forbidden-claim caps applied | avg latency | tokens in/out |
|-------|-----------|---------------|-----------|------------------------------|-------------|---------------|
| baseline `claude-sonnet-4-6` | 0/12 | 0 | 0 | as expected | 8.6s | 3150 / 3906 |
| configured `claude-sonnet-5` | 1/12 (transient) | 0 | 1 (the parse-failure record) | as expected | 6.5s | 4978 / 5520 |

**Human review (source fidelity · inference discipline · comparative usefulness):** both models held the line —
inference **never OBSERVED**, self-claims kept as self-claims ("market leader", "we define the category",
"5,000+ trusted by") with explicit "this does not establish market share/demand/leadership", pricing presented
never read as pricing success, and the **reference** brand (Patagonia) correctly treated as low-relevance, not a
competitor. Both **distinguished the twins** (flat $2k/mo subscription vs bespoke $75k/6-mo retainer) despite
identical "premium brand strategy for ambitious founders" language — neither inferred identical strategy from
similar wording.

**Two sonnet-5 robustness/coherence artifacts (baseline had neither):**
1. **One transient parse failure** on `trusted_by_logos`. A targeted 3× re-probe of that exact fixture on
   sonnet-5 parsed cleanly 3/3 and produced excellent, disciplined output — so this was **one-off generation
   variance**, not systemic. In production the identical parser + `capMarketEpistemics` guard degrade
   gracefully to the safe default reading; no unsupported claim can leak.
2. **One isolated language-mixing glitch** (`self-描述` for "self-description") in `leadership_no_proof` — 1 of
   23 sonnet-5 outputs. A coherence blemish, not a grounding failure.

## 5. Comparison (grounding + epistemic discipline outrank style)

- **Regressions:** none on grounding or epistemic discipline for either capability. sonnet-5's only regressions
  vs baseline are the two minor market robustness/coherence artifacts above (transient, gracefully handled).
- **Improvements:** sonnet-5 is faster on both capabilities (synthesis 10.5s vs 13.3s; market 6.5s vs 8.6s) and
  more thorough on synthesis (more grounded conclusions) — without over-claiming.
- **Unchanged weaknesses:** none material; both are strong.
- **Variance:** inherent (no determinism knob); observed as the single transient market parse failure.
- **Token usage:** sonnet-5 uses ~35–40% more output tokens (more thorough). **Cost:** not calculable — the repo
  has no authoritative pricing source; usage is reported, cost is deliberately not invented.
- **Failures/retries:** baseline 0; sonnet-5 1 transient market parse failure (non-reproducing).

## 6. Decision (each capability independently — no silent switch)

- **Business Understanding synthesis → APPROVE the configured model (`claude-sonnet-5`).** Parity-or-better
  grounding + epistemic discipline vs baseline, faster, more thorough, zero defects in the clean run. No model
  change (sonnet-5 is already the effective value; now explicit + validated).
- **Market inference → APPROVE WITH DOCUMENTED LIMITATIONS (`claude-sonnet-5`).** Parity on every discipline
  criterion (source fidelity, inference discipline, comparative usefulness). **Documented limitations:** (a) rare
  output-format variance — a low-frequency transient parse failure that degrades gracefully to the safe default
  via the existing parser + epistemic cap; (b) a rare language-mixing glitch. Neither introduces an unsupported
  claim. No model change.

Neither decision switches the model. `claude-sonnet-4-6` is **not** recommended as a replacement (it is the
frozen-engine tier, not currently used for these capabilities; switching to it would itself be an unrequested
model change).

## 7. Defects found

| ID | Defect | Disposition |
|----|--------|-------------|
| CFG-1 | Layer-2 models were an implicit hardcoded default; deployment's declared strong model not wired to them (silent-divergence risk; no authoritative value) | **Fixed** — explicit validated config + fail-fast + declared in `.env.example` + configmap (Step 2). |
| EVAL-1 | Harness set `temperature:0`, which `claude-sonnet-5` rejects → sonnet-5 calls all 400'd (eval-blocking) | **Fixed** in the harness only (omit `temperature`, matching production) + re-run. No product defect. |
| M5-1 | sonnet-5: transient market parse failure (non-reproducing) | Documented limitation; graceful production fallback. No prompt change (production prompt not tuned during the benchmark). |
| M5-2 | sonnet-5: rare language-mixing glitch in one market output | Documented limitation. No prompt change. |

No production prompt or schema was tuned during the benchmark (prompt history preserved).

## 8. Wave-2 acceptance debt B — verdict

**Debt B is CLOSED.** The production-capable configuration source is now identified and made **authoritative**
(explicit `SYNTHESIS_MODEL` / `MARKET_INFERENCE_MODEL`, validated, fail-fast in production, declared in the
env template + k8s configmap, versioned at `c6bd42f`); both capabilities were evaluated **separately** against
the `claude-sonnet-4-6` baseline; recommendations are explicit and independent; limitations + variance are
recorded; **no silent model switch** occurred; production remains untouched (config is versioned in-repo, not
applied to a live cluster — the boot fail-fast enforces its presence at deploy time); the frozen engine is
byte-identical.
