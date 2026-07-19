# Wave 2 — real runtime flow verification (internal artifact)

The current branch's **API** (built from source, not the old docker image) was run against the **local DB**
(V056–V059) with the **real durable worker** and the **real synthesis runtime** (the key was injected into
the process env from the authorized container — never printed, copied to a file, or committed). The founder
flow was driven end-to-end over HTTP against that running API. Reproduce by running `node apps/api/dist/main.js`
with local `DATABASE_URL`/`REDIS_URL` and `ANTHROPIC_API_KEY` sourced from the container.

## Exercised — results
- **Sign-up → session:** email/password signup returned a session cookie. ✓
- **Duplicate submit during an active run:** second `POST /understanding/runs` returned the **same** runId (idempotent). ✓
- **Full lifecycle (real engine + real synthesis):** `QUEUED → ANALYZING (frozen engine ~54s) → SYNTHESIZING → READY` in ~69s. ✓
- **Reveal:** 9 grounded, epistemically-banded conclusions; `market_opportunity` correctly **HYPOTHESIS**; **0 market-claims in a demonstrated band**; statements synthesized (not raw page text). ✓
- **Correction loop:** `Correct` → new **version 2**, `confirmationState=corrected`, `founderCorrection` persisted, and a **founder/`declared`** evidence fragment written (original synthesis + evidence preserved in v1). ✓
- **Refresh / persistence:** re-`GET /understanding` returns the latest persisted revision (v2). ✓
- **Sparse / low-evidence (`example.com`):** graceful **`insufficient_evidence`** — see defect below. ✓
- **Unreachable domain:** currently surfaces as `insufficient_evidence` (see limitation). Retryable. ✓

## Defect found and fixed
- **Sparse/empty source → raw engine 400.** `example.com` produced zero observed fragments; the worker still
  called the **frozen engine**, which 400'd (`user messages must have non-empty content`) → `analysis_failed`.
  **Fix (Layer-2, engine untouched):** the worker now guards the ANALYZING stage on readable observed evidence
  and fails as **`insufficient_evidence`** *before* invoking the engine. Locked with a test asserting the
  engine is not called when evidence is absent.

## Known limitation
- **Unreachable vs insufficient:** the website connector returns empty (rather than throwing) on a DNS
  failure, so a truly unreachable site is currently categorized `insufficient_evidence` rather than
  `unreachable_website`. Both are retryable and founder-legible; sharpening the category requires a
  reachability signal from the connector (small follow-up).

## Not driven via browser here
The runtime (states, worker, synthesis, corrections, persistence, idempotency, failure/retry) was verified
against the **real running API**. The web UI polling/reveal/correction logic is built and typechecked and
reuses the Wave-1 design system (screenshotted); a full click-through would require pointing the dev proxy at
the local API port and is the one piece done via API rather than browser. No credentials/keys/cookies/paths committed.
