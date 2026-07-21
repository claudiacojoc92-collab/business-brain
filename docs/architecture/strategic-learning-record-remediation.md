# Strategic Learning Record — remediation & closure audit

Bounded remediation of the SLR slice (from `2aa9a23`). Records the audit **before** any code change, the honest lifecycle
scope, the epistemic-vocabulary decision, the terminology correction, the backend-count root cause, the enriched object,
and the criterion-to-test matrix. Governed by [`strategic-learning-record-contract.md`](../governance/strategic-learning-record-contract.md).

---

## Part 1 — Remediation audit (recorded before any code change)

### Starting state (confirmed)
Branch `feature/axe-wave2-understanding`; HEAD `2aa9a23`; gate `b3d8f2e` and impl `2aa9a23` present and unamended; tree
clean except untracked `node_modules`; V076 latest; no acceptance servers running; nothing pushed; production untouched;
frozen hashes byte-identical (`prompt a39ea88…`, `schema 79802e9…`, `index f9df116…`); prior Recommendation/Decision/
Commitment/Plan/Plan-Review commits unchanged.

### What the slice actually persisted (before remediation — V076)
`business.strategic_learning_record`: `id, founder_id, logical_learning_id, revision(=1), schema_version`, lineage
(`review_record_id, review_revision, plan_record_id, commitment_record_id, decision_record_id,
recommendation_session_id, provenance_manifest_version`), founder-authored (`learning_statement, learning_category,
confidence`), authorship (`founder_authored, model_suggested, accepted_by_founder`), `idempotency_key, created_at`.
Append-only (`slr_no_update` BEFORE-UPDATE trigger); unique `(founder, idempotency_key)`.

### Audit findings (numbered per the remediation prompt)
1. **Exact schema:** as above — statement + category + confidence + lineage + authorship. **No** before/after
   understanding, change statement, scope, broad-scope acknowledgement, boundary conditions, counterevidence, unresolved
   unknowns, observations, or evidence references.
2. **Field meanings:** documented in the domain module; lineage SYSTEM_DERIVED from the immutable review;
   statement/category/confidence FOUNDER_AUTHORED; authorship booleans fixed (founder true, model false).
3. **Lifecycle:** **CREATE-only.** Each create is an immutable standalone record at `revision = 1`
   (`logical_learning_id = id`). No REFINE / CONTEST / SUPERSEDE / RETIRE.
4. **Routes/ops that exist:** repo `create` / `listByFounder` / `getById` / `byIdempotencyKey`; routes
   `POST /strategy/plan-reviews/:reviewId/learnings`, `GET /strategy/learnings`, `GET /strategy/learnings/:id`. No
   PATCH/PUT/DELETE.
5–13. **Requested deterministic criteria vs implemented (before):** implemented = owned-review gate, statement/category/
   confidence/idempotency required, lineage carried, no-auto-creation, append-only, isolation, export, delete, no-BU/FSC
   mutation. **Not implemented (before):** before/after understanding, change statement, scope, broad-scope
   acknowledgement, causal-claim guard, counterevidence, boundary conditions, unresolved unknowns, observation-source
   preservation, evidence-reference lineage restriction, INSUFFICIENT_INFORMATION / CONTESTED epistemic states,
   uncertainty-may-increase.
14. **Multiple learnings per review (before):** yes — distinct idempotency keys create distinct immutable records.
15. **Contradictory later learning (before):** only as another independent immutable record; **no** governed
    contest/supersede relationship or effective-state derivation.
16. **Historical revisions visible (before):** `GET /:id` returns the single record as `history:[…]`; there is no
    multi-revision chain (CREATE-only).
17. **UI completable through real interaction (before):** the LearningPanel rendered, but the prior "acceptance" drove the
    nested review/learning forms through the browser's authenticated **fetch**, not the rendered controls — **not** a
    genuine UI acceptance.
18–19. **Backend count 897 vs 656 — root cause:** the root `vitest.workspace.ts` defines a **`backend`** project
    (`packages/*/src/**/*.test.ts` + `apps/api/src/**/*.test.ts` + `apps/workers/src/**/*.test.ts`) plus a separate
    `apps/web` (jsdom) project. Prior slices reported the **backend project** total (SCR 842 → SPR 873 → SPRR 897). The
    SLR run reported **656 / 84 files = the `apps/api` project alone**, because the persistent Bash shell was left
    `cd`'d into `apps/api` from an earlier scoped run, so `npx vitest run` resolved only that project and silently
    dropped `packages/*` + `apps/workers` (241 tests). Verified: `npx vitest run --project backend` from the repo root =
    **131 files / 912 passed / 1 skipped** (= 897 + 15 new SLR tests). Same runner/config/env; only the working directory
    (hence project resolution) differed. **The "656 = full backend suite" claim was wrong.**
20. **"promotion" usage:** pervasive for *creation* ("promote ONE immutable learning from a review", UI var `promote`,
    route/comment "promotion from a review", contract "a learning is promoted from a review"). This conflates creation
    with the future **BU/FSC promotion** (Law 14). To be corrected — reserve "promotion" for the future capability only.

### Lifecycle-scope decision — **CREATE-only, explicitly governed**
The governance contract permitted a CREATE-only first slice: Law 10 ("append-only; a correction is another append-only
learning"), Law 14 (BU/FSC promotion is a *future* gate), and architecture Part 2 ("intentionally small… each create at
revision 1") with SLR-3 (revision-based corrections) recorded as deferred debt. This remediation keeps CREATE-only and
labels every lifecycle-mutation criterion (REFINE/CONTEST/SUPERSEDE/RETIRE, effective-state, historical-revision UI) as
**DEFERRED_BY_GOVERNANCE** with the exact citations. The record is described honestly as the **initial immutable creation
slice** of the Strategic Learning Record.

### Epistemic-vocabulary decision — **replace ESTABLISHED**
`ESTABLISHED` can be misread as objectively proven / permanently valid, contrary to Law 9 ("never absolute truth"). It is
replaced by a bounded, non-truth-inflating set: **`PROVISIONAL | SUPPORTED | CONTESTED | INSUFFICIENT_INFORMATION`**
(none imply objective or permanent truth; `CONTESTED` preserves mixed evidence; `INSUFFICIENT_INFORMATION` records "cannot
currently be justified"; the former `CONDITIONAL` is expressed by explicit **boundary conditions**). A forward migration
(V077) adds the new columns and maps any existing values (`ESTABLISHED→SUPPORTED`, `TENTATIVE→PROVISIONAL`,
`CONDITIONAL→SUPPORTED`); V076 is not edited.

### Object enrichment (this remediation)
The record is enriched to be an honest Strategic Learning object: **priorUnderstanding**, **revisedUnderstanding**,
**changeStatement** (before/after kept separate); **learningScope** + **broadScopeAcknowledged**; **isCausalHypothesis**
with a deterministic causal-claim bound; **boundaryConditions[]**, **counterevidence[]**, **unresolvedUnknowns[]**;
**observations[]** (source-classified; founder-reported stays founder-reported) and **evidenceReferences[]** restricted to
the review's own lineage. Same append-only CREATE-only architecture; no model; no BU/FSC mutation.

---

## Part 2 — Criterion-to-test matrix

Legend: **COVERED** (executable assertion) · **DEFERRED_BY_GOVERNANCE** (out of the CREATE-only slice, cited) ·
`det` = `strategic-learning.test.ts` · `live` = `strategic-learning.live.test.ts` · `e2e` =
`apps/web/e2e/strategic-learning.spec.ts` (Playwright).

| # | Criterion | Location | Test | Status |
|---|---|---|---|---|
| 1 | recommendation creation does not create learning | live A | no-auto-learning | COVERED |
| 2 | recommendation ACCEPT does not create learning | live A | no-auto-learning (feedback saved, 0 learnings) | COVERED |
| 3 | decision creation does not create learning | live A | no-auto-learning | COVERED |
| 4 | commitment creation does not create learning | live A | no-auto-learning | COVERED |
| 5 | plan creation does not create learning | live A | no-auto-learning | COVERED |
| 6 | review creation does not create learning | live A | no-auto-learning | COVERED |
| 7 | contradicted assumption does not auto-create learning | live A | no-auto-learning (review w/ contradiction) | COVERED |
| 8 | explicit action creates exactly one learning | live B / e2e | exactly-one | COVERED |
| 9 | founder may leave review without creating learning | det / e2e | leave-without-creating | COVERED |
| 10 | multiple explicit learnings per review | live C | two-distinct | COVERED |
| 11 | idempotent retry | det / live B | idempotent | COVERED |
| 12 | exact founder-owned review | det / live | owned-review-required | COVERED |
| 13 | cross-founder rejection | live H | isolation | COVERED |
| 14 | exact plan revision | det / live B | lineage | COVERED |
| 15 | exact commitment revision | det / live B | lineage | COVERED |
| 16 | exact decision/recommendation/manifest lineage | det / live B | lineage | COVERED |
| 17 | prior understanding required | det | prior-required | COVERED |
| 18 | revised understanding required | det | revised-required | COVERED |
| 19 | change statement required | det | change-required | COVERED |
| 20 | uncertainty required (bounded vocab) | det | confidence-required/bounded | COVERED |
| 21 | scope required | det | scope-required | COVERED |
| 22 | broad-scope acknowledgement | det / live / e2e | broad-scope-ack | COVERED |
| 23 | causal-hypothesis guard | det / live F | causal-bound | COVERED |
| 24 | uncertainty may increase | live D | increased-uncertainty | COVERED |
| 25 | insufficient-information learning | det / live E | insufficient-info | COVERED |
| 26 | mixed evidence remains visible | det / live E | contested/counterevidence | COVERED |
| 27 | counterevidence preserved | det / live | counterevidence-persisted | COVERED |
| 28 | boundary conditions preserved | det / live | boundary-persisted | COVERED |
| 29 | founder-reported remains founder-reported | det / live | observation-source | COVERED |
| 30 | verified reference belongs to allowed set | det | evidence-in-lineage | COVERED |
| 31 | invented reference rejected | det | evidence-not-in-lineage | COVERED |
| 32 | invalid observation rejected | det | observation-invalid | COVERED |
| 33 | duplicate reference rejected | det | evidence-duplicate | COVERED |
| 34 | review not mutated | live B | mutates-nothing | COVERED |
| 35 | plan not mutated | live B | mutates-nothing | COVERED |
| 36 | commitment not mutated | live B | mutates-nothing | COVERED |
| 37 | decision not mutated | live B | mutates-nothing | COVERED |
| 38 | BU not updated | live B | mutates-nothing | COVERED |
| 39 | FSC not updated | live B | mutates-nothing | COVERED |
| 40 | no recommendation created | live B | mutates-nothing | COVERED |
| 41 | no task created | live A | no execution/task table | COVERED |
| 42 | no execution created | live A | no execution/task table | COVERED |
| 43 | append-only lifecycle | live H | UPDATE rejected | COVERED |
| 44 | refine preserves history | — | Law 10/SLR-3 | DEFERRED_BY_GOVERNANCE |
| 45 | contest preserves history | — | Law 10/SLR-3 | DEFERRED_BY_GOVERNANCE |
| 46 | supersede preserves history | — | Law 10/SLR-3 | DEFERRED_BY_GOVERNANCE |
| 47 | retire preserves history | — | Law 10/SLR-3 | DEFERRED_BY_GOVERNANCE |
| 48 | contradictory later learning preserves history | live C (independent records) | two-distinct | COVERED (as independent immutable records; governed contest = DEFERRED) |
| 49 | historical lineage never rebuilt from current state | det | lineage-from-review | COVERED |
| 50 | database UPDATE rejected | live H | trigger | COVERED |
| 51 | founder isolation | live H | isolation | COVERED |
| 52 | export fidelity | live H | export | COVERED |
| 53 | deletion and zero orphans | live H | delete | COVERED |
| 54 | no legacy memory.* writes | live B | no memory write | COVERED |
| 55 | no hidden memory table | live A | table introspection | COVERED |
| 56 | no progress or learning score | det (view keys) / live A (no score col/table) | no-score | COVERED |

Result totals are recorded in the closure record after execution.
