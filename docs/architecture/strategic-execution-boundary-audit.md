# Strategic Execution Boundary — pre-implementation audit (2026-07-21)

Code-traced audit of the Recommendation → Decision → Commitment → Plan → Review lifecycle, to establish what the product
currently claims about execution **before** designing the Execution Boundary. No inference from names.

## Traced surfaces
- **Plan** — `strategic-plan.ts`, `pg-strategic-plan.repository.ts`, routes `POST /strategy/commitments/:id/plans`,
  `/strategy/plans/:id/{activate,supersede,retire,cancel}`; table `business.strategic_plan_record` (V074, append-only).
- **Review** — `strategic-plan-review.ts`, `pg-strategic-plan-review.repository.ts`, `POST /strategy/plans/:id/reviews`;
  table `business.strategic_plan_review_record` (V075, append-only).
- **UI** — `apps/web/src/strategy/StrategyPage.tsx` (PlanView / ReviewForm).

## Answers (from code)
1. **A Plan represents** intended strategic moves — milestones, assumptions, dependencies, resource constraints, review
   conditions — translating an exact commitment revision. An **intention artifact**.
2. **Descriptive / prescriptive / evidentiary?** Prescriptive (intended action), not evidentiary of execution.
3. **Can the product mark a Plan/step done?** **No.** `PlanStatus = ACTIVE | SUPERSEDED | RETIRED | CANCELLED | EXPIRED`
   (all lifecycle); `Milestone.statusAtPlanning = 'PLANNED'` is the only milestone status; there is no completion field or
   command anywhere in the strategy domain (grep: no markComplete/completePlan/inferCompletion/progressPercent).
4. **What event causes that?** None exists.
5. **Does Review treat plan state as execution proof?** **No.** Review records founder `MilestoneAssessment`
   (`NOT_REVIEWED | EVIDENCE_NOT_AVAILABLE | CONDITION_NOT_MET | CONDITION_PARTIALLY_MET | CONDITION_MET |
   CONDITION_NO_LONGER_RELEVANT | CONDITION_CANNOT_BE_DETERMINED`) as **FOUNDER_AUTHORED** testimony; the module header
   states it "creates NO execution/task/score object" and "NEVER rewrites the historical plan."
6. **Competing execution representations?** None. Review milestone assessments are the only execution-adjacent data, and
   they are testimony (condition-met, not product-performed).
7. **Plan items mutable or append-only?** Append-only immutable revisions; milestones are JSONB with stable `id`s inside an
   immutable plan record.
8. **Any status implying a product-performed external action?** No — all statuses are lifecycle.
9. **Can wording mislead a founder into believing BB executed something?** No — the UI states throughout: "It does not
   execute work or create tasks", "not execution, tasks, or a calendar".
10. **Execution inferred from time/interaction/lifecycle?** No. `EXPIRED` is plan-window expiry, not execution.
11. **Hidden execution assumptions in Decision/Commitment/Plan/Review?** No. One mild ambiguity: Review's `CONDITION_MET`
    is *condition-assessment* testimony and must never be conflated with "executed/done".
12. **Data required to distinguish planned / founder-reported / externally-evidenced / product-executed?**
    - *planned* — the Plan milestone (**exists**).
    - *founder-reported* — a founder execution-report ledger (**absent** — this slice adds it).
    - *externally-evidenced* — bounded evidence references (**absent** — added, never verified).
    - *product-executed* — connectors/action receipts (**absent; must remain unsupported**).

## Classification: **A** — Plan and execution are already truthfully separated
The Plan is intention-only; nothing infers or marks execution; Review is labelled founder testimony; the UI never claims
the product executed anything. The **gap** is that the founder has no way to *report* what actually happened. This slice
adds a truthful, append-only **founder-reported execution ledger** — kept strictly separate from Plan and Review — and
introduces **no** product-execution claim. (Minor ambiguity to guard: Review's `CONDITION_MET` stays condition-assessment
testimony and is NOT wired to the new execution ledger — Review boundary = deferred/absent, Part 11 option C.)
