# Wave 3 — Formal Closure Artifact

This document freezes the state of Wave 3. Wave 3 is founder-facing complete; Wave-2 acceptance debts A and B
are closed. Production is untouched and the frozen engine is byte-identical.

- **Branch:** `feature/axe-wave2-understanding`
- **Closure commit range (Wave 3 + debts):** `03a0e77` → HEAD
  - `03a0e77` durable market-review lifecycle · `401f0c4` source-accuracy vs business-relevance ·
    `c28579e` review lineage + model/prompt provenance + restore-dismissed · `7e06245` browser acceptance (debt A) ·
    `c6bd42f` explicit validated model config (debt B freeze) · `7a88030` production-model evaluation (debt B) ·
    `18016db` controlled-outcome coverage + entity edit-after-create · plus this pass (HTTP-429 mapping fix).
- **Migrations:** through **V065** (`V061`–`V065` are the Wave-3 market range; `V058`–`V060` the Wave-2
  understanding range). Applied to the local dev DB only.
- **No deployment performed. No push.**

## 1. Scope completed

| Capability | State |
|------------|-------|
| Durable Business Understanding lifecycle (QUEUED→INGESTING→ANALYZING→SYNTHESIZING→READY / FAILED / insufficient) | ✅ DB-authoritative, lease-claimed, restart-safe, atomic READY |
| Business Understanding synthesis (frozen engine → Layer-2 synthesis) | ✅ bounded, epistemically-banded conclusions; normalizer safety net |
| Founder correction semantics (Confirm / Partly / Correct / Reject / revise) | ✅ append-only responses, supersession, "(revised)", original synthesis immutable |
| Prioritized grouped presentation | ✅ grouped + ranked (prioritize, not truncate) |
| Public Positioning Context (known-entity, source-backed; **no discovery**) | ✅ founder-added entities, robots-respecting retrieval |
| Durable market-review lifecycle (QUEUED→RETRIEVING→EXTRACTING→INFERRING→READY / INSUFFICIENT / FAILED) | ✅ mirrors understanding lifecycle; atomic finalize; lineage |
| Market entity lifecycle (confirm / dismiss / restore, origin-correct) | ✅ founder_added→confirmed, bb_suggested→proposed |
| Source-accuracy vs business-relevance semantics | ✅ two independent judgments, never collapsed; append-only |
| Provenance + review lineage | ✅ adapter/extraction/model/prompt provenance; prior_successful_review_id |
| Edit-after-create (name / website / type / relevance note) | ✅ identity + history preserved; name-collision 409 |
| Website-change invalidation | ✅ prior findings historical, excluded from current context until a fresh review |
| All seven market-review outcomes | ✅ ROBOTS_BLOCKED / UNREACHABLE / UNSUPPORTED_CONTENT / INSUFFICIENT_READABLE_EVIDENCE / RETRIEVAL_FAILED / INFERENCE_FAILED / READY |
| Retry policy | ✅ explicit per-category, encoded in domain logic |
| Browser acceptance | ✅ auth/arrival + both founder-facing systems + 7 outcomes + edit, driven in a real browser |
| Model configuration + evaluation | ✅ explicit validated config + fail-fast; configured (sonnet-5) vs baseline (sonnet-4-6) evaluated |

## 2. Architectural contracts now relied upon

1. **The frozen engine remains byte-identical** (`prompt=a39ea88…`, `schema=79802e9…`, `index=f9df116…`).
2. **Layer 2 never mutates Layer 1 output** — synthesis/inference read the engine's result; they never write it.
3. **Observations, inference, and founder declarations remain separate** — distinct rows/columns/bands; a market
   inference is never OBSERVED and is capped so it can't assert a market fact.
4. **Original synthesis / findings are immutable** — a correction or response never rewrites the conclusion or
   the observed/inference text.
5. **Founder responses are append-only + superseded, not overwritten** — exactly one effective response, full
   history preserved, deterministic after refresh.
6. **Long-running work is database-backed and restart-safe** — QUEUED rows, `FOR UPDATE SKIP LOCKED` claiming,
   lease expiry + stale recovery; the in-process worker is the first execution mechanism, DB is authoritative.
7. **READY publication is atomic** — findings + READY (and provenance) commit in one transaction; a crash before
   commit publishes nothing; after commit is idempotent.
8. **Previous successful context survives later failure** — a later FAILED/INSUFFICIENT review preserves the
   prior successful review (`prior_successful_review_id`) and its findings.
9. **Current orchestration uses only eligible/current evidence** — confirmed entity + latest READY review +
   accuracy≠no + relevance relevant/partly; unreviewed → provisional only; excluded otherwise.
10. **A changed website invalidates prior evidence as current context** — findings from a review predating
    `website_changed_at` are historical (auditable, original sourceUrl preserved) and excluded until a fresh
    successful review of the new site.
11. **Unverified suggested entities never become accepted market truth** — bb_suggested stays `proposed` until
    the founder confirms; never silently promoted.
12. **No discovery capability currently exists** — the website connector is retrieval+extraction only
    (`supportsDiscovery = false`); entities are founder-provided.

## 3. Epistemic boundaries

**The product CAN:** understand founder-provided business evidence; synthesize a small set of bounded,
epistemically-banded conclusions; retrieve a KNOWN public website (robots-respecting); summarize how a company
publicly presents itself; preserve ambiguity and contradictions rather than smoothing them; and let the founder
confirm, qualify, correct, reject, and mark source-accuracy + business-relevance.

**The product CANNOT currently:** discover the market; discover competitors; estimate demand; prove category
leadership; infer market share; establish superiority; validate willingness to pay; or treat a company's own
marketing claims as independent market truth. Company self-claims ("market leader", "trusted by", "we created
the category") are preserved as self-claims with an explicit "this does not establish …".

## 4. Configuration frozen

| Item | Value |
|------|-------|
| Business Understanding — provider / model | Anthropic / `claude-sonnet-5` (env `SYNTHESIS_MODEL`) |
| Business Understanding — prompt / schema version | `synthesis-1` / `conclusions-1` |
| Market Inference — provider / model | Anthropic / `claude-sonnet-5` (env `MARKET_INFERENCE_MODEL`, falls back to `SYNTHESIS_MODEL`) |
| Market Inference — prompt / schema version | `market-infer-sys-1` / `market-inference-1` |
| Baseline compared against | `claude-sonnet-4-6` |
| Config contract | `apps/api/src/business-model/model-config.ts` — explicit, validated, **fail-fast in production-capable mode**; declared in `.env.example` + `deployment/k8s/configmaps/app-config.yaml` |
| Frozen-engine tier (separate) | `LLM_STRONG_MODEL=claude-sonnet-4-6`, `LLM_MEDIUM_MODEL=claude-haiku-4-5` (LLM-router / engine path) |
| Migration range | through **V065** |
| Branch | `feature/axe-wave2-understanding` |
| Deployment | **none performed** |

No credentials are recorded here or in any committed artifact.

## 5. Acceptance evidence

- **API regression:** 445 passed / 1 skipped (the 1 skip is the gated website live test). _(This closure run.)_
- **Web regression:** 73 passed; production web build OK.
- **Browser acceptance:** [wave3-browser-acceptance.md](wave3-browser-acceptance.md) — auth/arrival, Business
  Understanding, Public Positioning Context, all seven market outcomes, retry matrix, entity edit + website-change
  invalidation, two-founder isolation.
- **Model evaluation:** [wave2-model-eval.md](wave2-model-eval.md) (+ [wave2-synthesis-eval.md](wave2-synthesis-eval.md))
  — configured vs baseline, per capability, with recommendations and raw results (`tools/eval/prod-model-eval-results.json`).
- **Real-site integration checks:** `market-review-durable.live.test.ts` (getbusinessbrain.com → real
  robots-respecting connector + real Anthropic inference → READY) and, in-browser, real ingest → frozen engine →
  real synthesis.
- **Controlled-outcome fixtures:** `fixture-research.adapter.ts` (gated, dev/test-only) + `fixture-research.test.ts`
  — all seven outcomes through the real durable worker.
- **Founder isolation:** verified in-browser (two founders) and in tests across market + understanding.
- **Frozen-engine hashes:** `prompt=a39ea8833287c9904b736ad4723930f664358805`,
  `schema=79802e909eca974a3ecbf02e3c97b275b1c05bab`, `index=f9df116abcf8e85ba6b268819a5f471af6194848`.

## 6. Known non-blocking limitations

- **No market-discovery provider** — by design; entities are founder-provided (retrieval+extraction only).
- **In-process workers** — the understanding + market workers run in the API process; the DB claiming
  (`FOR UPDATE SKIP LOCKED` + leases) already supports multi-instance safety, but multi-instance is not yet deployed.
- **Controlled failure adapter is dev/test-only** — off by default, refuses to start in production; it exists to
  exercise outcomes, not for founder use.
- **Model-output variance remains possible** — single-shot inference, no determinism knob; the normalizer +
  epistemic caps bound the risk (a rare transient market parse failure degrades gracefully to the safe default).
- **Browser-automation evidence depends on the local environment** — the in-app preview + local dev stack.
- **Production migration / deployment not yet executed** — config + migrations are versioned in-repo (through
  V065); the boot fail-fast enforces the model config at deploy time.

## 7. Wave 3 closure decision

- **Wave-2 acceptance debt A (founder-visible browser acceptance): CLOSED.**
- **Wave-2 acceptance debt B (production-model configuration + evaluation): CLOSED.**
- **Wave-3 founder-facing scope: COMPLETE.**
- **Wave 3 is CLOSED.**
- **No known founder-facing blocker remains.** The only remaining item was the transversal HTTP-429 mapping,
  fixed in this pass (rate-limit → 429; unknown errors stay 500; no internal-detail leakage).
- **Production is untouched; the frozen engine is byte-identical.**

## 8. Boundary before Wave 4

Wave 4 (Founder Conversation) **must not** quietly expand Public Positioning Context into market discovery — the
`supportsDiscovery = false` contract and the "self-claims are not market truth" boundary stand.

The next implementation question to answer before building Founder Conversation is:

> **How should Founder Conversation consume the now-stable Business Understanding and Public Positioning Context
> without flattening epistemic status, provenance, founder corrections, or unknowns?**

That conversation is **not** designed or implemented in this pass.
