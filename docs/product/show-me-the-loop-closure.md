# Show Me the Loop — Closure Record

**Milestone:** Show Me the Loop (rendered-product milestone over the frozen learning loop)
**Status:** ACCEPTED
**Commits:** `db2fae5` (audit + product contract, pre-implementation) → *this commit* (implementation + tests + demo fixture + evidence + closure)
**Constraints honoured:** no push / no deploy; production untouched; prior commits not amended; **no migration** (V088 remains latest); **no new canonical loop/journey/thread object** — the thread is a deterministic READ PROJECTION over accepted canonical records; frozen strategist engine byte-identical.

---

## 1. What shipped

A founder can now watch **one continuous, filmable journey** end-to-end, read straight off their own accepted records:

> Recommendation → Decision → Commitment → Plan → Execution → Outcome Review → Possible Learning → Strategic Learning → Promotion → **a later Recommendation whose frozen snapshot included that promoted learning** — and then trace it **backward** through the exact learning lineage to the outcome review, the plan, and the original recommendation.

- **Read projection (non-canonical):** `apps/api/src/business-model/pg-strategic-thread.projection.ts` + view types in `strategy-thread.ts`. Persists nothing, calls no model, invents no relationship. Every edge is an accepted column/frozen-reference; where an exact source is absent it is omitted and surfaced as **"Source relationship unavailable."**
- **Route:** `GET /api/strategy/threads/:rootSessionId` (`strategy.routes.ts`) — founder-scoped; 404 when not owned/found.
- **Rendered page:** `apps/web/src/strategy/StrategyThreadPage.tsx` at `/strategy/thread/:rootSessionId`; entry point ("See the whole thread →") on the strategy page's history.
- **Demo fixture (dev/test only):** `apps/api/src/routes/strategy-loop-demo.routes.ts` — `POST/DELETE /dev/demo/strategy-loop`, registered inside the `NODE_ENV !== 'production'` requireFounder nucleus. Builds the full loop through the **real repositories** for the authenticated founder only; reset governs-deletes every strategic record → zero orphans. No production data, no hidden default founder.

## 2. Final acceptance question

> *Can this complete loop be demonstrated in a single 3–5 minute screen recording without explaining the internal architecture?*

**Yes.** The rendered page (evidence screenshots `show-me-the-loop-01…10`) reads as six numbered steps in plain founder language, each showing a visible "↑ came from" edge and a backward-trace control. No hash, UUID, revision-id, or snapshot-id appears on the face of the page; the one generation reference is behind progressive disclosure and shows *"Reasoned from a frozen snapshot: Yes"*, not a hash. See `show-me-the-loop-recording-script.md`.

## 3. Product Laws (contract L1–L10) — disposition

| Law | Guarantee | Where enforced |
|-----|-----------|----------------|
| L1 | Thread is a read projection, never a persisted object | projection class; test C39 (no rows written), C41 (no helper-field leak) |
| L2 | Every visible edge is an accepted relationship | `FromEdge`; tests C7/C9/C11/C17/C21/C26 |
| L3 | Missing provenance shows "Source relationship unavailable" — never fabricated | `FromEdge` `-unavailable`; tests C49/C50 |
| L4 | Founder-isolated | route + projection `founder_id` filter; tests C44/C46 + Playwright isolation test |
| L5 | Explicit provenance-availability flags for founder copy | `provenanceAvailable`; tests C32/C49 |
| L6 | Later-recommendation wording bounded & non-causal | `USAGE_DISCLOSURE`; tests C37 + Playwright step 12 |
| L7 | Later link ONLY via genuine frozen-snapshot inclusion | `laterRecommendations`; tests C35/C47/C48 |
| L8 | No model call, deterministic | test C40 (byte-identical rebuild) |
| L9 | Origin distinctness preserved (OUTCOME_REVIEW vs PLAN_REVIEW) | test C27 |
| L10 | Projection self-declares non-canonical | `isProjectionNotCanonical`; test C2/C50 + UI read-only note |

## 4. Evidence

- **Deterministic projection tests — 52/52:** `apps/api/src/__tests__/business-model/strategy-thread-projection.live.test.ts` (criteria C1–C52). Run: `GATE_DB_URL=… npx vitest run …strategy-thread-projection.live.test.ts` → 52 passed.
- **Genuine rendered-UI Playwright — 2/2:** `apps/web/e2e/show-me-the-loop.spec.ts` — the whole forward+backward journey + founder-isolation, 10 screenshots in `apps/web/e2e/__evidence__/show-me-the-loop-*.png`.
- **Frozen engine byte-identical:** prompt `a39ea88`, schema `79802e9`, index `f9df116` (git hash-object verified).
- **Regression:** backend vitest green on clean DB (see run log); API + web typecheck 0 errors; web unit 73/73; web build clean; all 8 accepted Playwright suites + show-me-the-loop green.
- **Zero-orphan teardown:** all demo/e2e founders purged; `identity.founders` test rows = 0; strategic-record orphans = 0.

## 5. Live scenarios (Part 15) — mapped to executed evidence

| # | Scenario | Proven by |
|---|----------|-----------|
| A | Full loop reconstructs from a real seeded thread | projection C1–C32; Playwright steps 4–12 |
| B | Decision links to its recommendation | C7; Playwright step 6 |
| C | Commitment links to its decision | C9; step 7 |
| D | Plan links to its commitment; both execution states honest | C11–C14; step 8 |
| E | Outcome review links to plan; named unknown preserved | C15–C18; step 9 |
| F | Possible learning surfaced by the review; kept | C19–C22; step 10 |
| G | Strategic learning links to review; origin distinct | C23–C27; step 11 |
| H | Promotion explicit, into strategic context | C28–C31; step 11 |
| I | Later recommendation linked only via snapshot inclusion | C33–C36, C47–C48; step 12 |
| J | Later-recommendation disclosure bounded, non-causal | C37; step 12 |
| K | Backward navigation: later → learning → review → plan → root | C38; steps 13–14 |
| L | Missing provenance stays missing (bare thread) | C49–C50 |
| M | Founder isolation — no cross-founder disclosure | C44–C46; Playwright isolation test |
| N | Read-only: no persistence, no mutation, deterministic | C39–C43 |

## 6. Current-state map & roadmap

- **Now navigable:** the whole loop, forward and backward, as a rendered read projection. Entry from the strategy history.
- **Deliberately absent (correct):** no persisted "thread"/"journey" object; no causal claims; no migration.
- **Open (future, not this milestone):** approval→memory wiring remains the prior known gap (`validation-run-pipeline-cel-mismatch`); multi-plan / multi-learning threads render but the demo seeds a single representative plan; a founder-facing deep-link from a promoted context item back into its origin thread is a natural next affordance.
