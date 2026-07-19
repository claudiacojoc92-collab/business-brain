# Wave 2 — real synthesis-quality evaluation (internal artifact)

**Method.** The real frozen-engine → Layer-2 synthesis pipeline's synthesis prompt (verbatim from
`anthropic-synthesis.model.ts`) was run against five controlled, versioned ingestion fixtures via the
authorized runtime that holds `ANTHROPIC_API_KEY` (the `bb-api` container). The key was never printed,
copied, or committed — the script reads it from the container env. Reproduce:
`docker exec -i -w /app bb-api node --input-type=module - < tools/eval/wave2-synth-eval.mjs`.

- **Model:** `claude-sonnet-4-6` (the proven-available model in this environment). Production default is
  `SYNTHESIS_MODEL` → `claude-sonnet-5`; re-run the eval against the production model once availability is
  confirmed in the deploy environment.
- **Prompt version:** `synthesis-1` (unchanged; no concrete failure was found, so no iteration was made).
- **Fixtures (owned, synthetic, representative):** clear service business · ambiguous positioning · sparse
  website · conflicting offers · empty/insufficient source.

**Deterministic validation (every fixture):** `marketDemonstrated = 0` (no market-facing conclusion in a
demonstrated band), `allGrounded = true` (every OBSERVED/SYNTHESIZED conclusion cites a real source id),
statements are interpretive (not echoed page text).

**Qualitative results.**

| Fixture | Kept | Bands | Assessment |
|---|---|---|---|
| clear | 9 | OBS 3 / SYN 3 / NME 2 / HYP 1 | Specific + synthesized; found under-used credibility, missing capacity/social-proof, an offer-led-vs-person-led inconsistency, and a real strategic question (milestone vs weekly). Strong. |
| ambiguous | 9 | OBS 3 / SYN 3 / NME 2 / HYP 1 | Correctly identified the vagueness ("cannot determine what the studio does differently"); no fabricated specifics. Strong. |
| sparse | 4 | OBS 2 / SYN 1 / HYP 1 | Appropriately restrained — mostly missing-information / no-positioning; a genuinely useful referral-only-vs-underdeveloped hypothesis. Did not fabricate. |
| conflicting | 7 | SYN 4 / OBS 3 | **Detected the premium-$25k-vs-$19-template inconsistency**, named the two incompatible audiences, asked "which business is this actually?". Exactly the meaningful conflict. |
| empty | 0 | — | `insufficient_evidence`; no synthesis attempted. No fabrication. |

**Failure modes found:** none rising to a concrete defect at this fixture set. Specificity, synthesis (vs
paraphrase), grounding, epistemic correctness, usefulness, and ambiguity/inconsistency detection all met an
internally defensible threshold; no generic filler or repetition observed. **Therefore no prompt change was
made** (prompt history preserved). Re-run required against the production model and a broader cross-business
set as sources expand.
