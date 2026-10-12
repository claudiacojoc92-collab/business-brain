# Intent: Strategic Depth — Week 1 (constraint + stage)

- **Date:** 2026-10-12
- **Originator:** operator (Claudia)
- **Approved by:** operator brief on 2026-10-12 (Linear P-BUS-16, BUS-64)
- **Status:** in-build

## Problem
The understanding lists 3–4 equal tensions. That's an analyst's report. A strategist names the ONE thing holding the
business back, treats the rest as symptoms, and says what stage the business is in, because the stage decides what
kind of move makes sense.

## Outcome
The understanding card opens with "Your real constraint: …" (or an honest "Not enough evidence to name the
constraint. Here are the tensions I see."). Under it, small: "Stage: validating / growth / plateau. Why: <evidence
from the sources>", plus one line on what that stage implies. The existing tensions follow as "Also on my mind".
Check: 5 businesses run through the dogfood harness and the operator reads all 5 outputs before any deploy.

## Affected users and systems
Founders at the arc understanding moment. `packages/infrastructure` (understanding prompt), `packages/application`
(contracts, gates, arc projection), `apps/web` (ArcSurface understanding card, i18n). Storage:
`understanding` JSONB (V065) carries the new fields; no migration.

## Constraints
- Claim-type gate applies to the constraint; the stage needs cited evidence.
- Never put a test business (Business Brain, Body Move) into the prompt.
- UI chrome is English; model prose follows the content language.

## Out of scope
New connectors, arc-flow changes, strategy/plan (the stage is stored for Weeks 2–3, not consumed), pattern library and
cascades (Week 2), reconsider conditions (Week 3).

## Decisions (operator, 2026-10-12)
- Test set: Body Move + Business Brain (prod fragments) + 3 URLs the operator provides (website-only).
- Stage implication: one fixed line per stage on the card.
- Tracking: Linear project Strategic Depth, milestones Week 1/2/3, BUS-64.
