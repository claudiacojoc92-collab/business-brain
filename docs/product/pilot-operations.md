# Business Brain — Founder Validation Readiness (Pilot Operations)

This slice makes the **current** product safe, observable, and practical for a small invited founder cohort. It adds **no strategic capability** — only invite/access, minimal setup, research instrumentation, optional feedback, facilitator annotations, admin visibility, safe export, and privacy controls. The purpose is to discover whether the clarity engine creates **genuine perceived value**, not to optimize engagement.

## The validation question
> When a founder brings a real business tension, does Business Brain create a **noticeable and consequential shift** in how they understand what is happening, what remains uncertain, and what deserves attention now?

## What was added
- **V092 `pilot` schema** — `invite`, `pilot_founder` (access + consent + minimal setup), `research_event` (append-only, metadata only), `concern_reality`, `concern_feedback`, `facilitator_note`, `wtp_record`.
- **Founder routes** (`/api/pilot/*`, session-scoped): `activate` (+ consent), `setup` (feeds the accumulation engine — stated facts become founder-governed Understanding), `reality`, `should-feedback`, `feedback`, `ending`, `wtp` (admin-opened).
- **Admin routes** (`/api/admin/pilot/*`, `X-Pilot-Admin-Token`, fail-closed): invite create/list/disable; founder access enable/disable (data kept); `wtp-open`; `facilitator-note`; `wtp`; `summary`; `export.csv` (raw excluded); `events.csv` (anonymized); per-founder `raw` (deliberate).
- **Instrumentation** on the clarity routes (best-effort; never breaks a request): invite accepted, setup started/completed, concern submitted (with ordinal/kind), **second distinct concern**, clarity produced/failed, proposal accepted/rejected, context revalidated/corrected, ended (enough/keep-exploring/strategy-thread), feedback submitted, export/deletion requested.
- **Access gate** — enforced ONLY when `PILOT_MODE=1` (existing tests/dev unaffected): a disabled/unactivated founder gets 403 on clarity, **without data deletion**.
- **Export + deletion extended** — the founder export now includes their clarity + own pilot data (portability); account deletion now purges clarity + pilot personal rows and **anonymizes** research events (aggregate signal kept, PII dropped).
- **Web** — `/activate` (invite + consent + short setup) and, in the clarity reading, a **reality marker** + an optional, dismissible **feedback prompt**.

## Environment / how to run a 5–10 founder pilot
1. Boot the API in pilot mode with a real model and an admin token (never printed):
   ```
   PILOT_MODE=1  PILOT_ADMIN_TOKEN=<strong-secret>  ANTHROPIC_API_KEY=<key>  NODE_ENV=production  <boot>
   ```
   (Dev/staging: omit `NODE_ENV=production`; use `CLARITY_FIXTURE=1` only for facilitator dry-runs, never for real founders.)
2. Create invites (one per founder): `POST /api/admin/pilot/invites` with `X-Pilot-Admin-Token` → returns codes. Send each founder their code + the `/activate` link.
3. Founder: sign up → `/activate` (enter code, give consent, optional review opt-in) → short setup → uses `/clarity`.
4. Monitor: `GET /api/admin/pilot/summary` (metadata) and `events.csv`. Record facilitator notes and, at pilot end, open the WTP prompt (`wtp-open`) or record the interview (`POST /api/admin/pilot/wtp`).
5. Analyze: `export.csv` (research, raw excluded) + `events.csv`; use the deliberate per-founder `raw` export only when a founder consented to review.
6. **Smoke test** (facilitator dry-run): `ADMIN=<token> BASE=http://localhost:3000 bash tools/pilot-smoke.sh` (boot the API with `CLARITY_FIXTURE=1 PILOT_ADMIN_TOKEN=<token>`). Live model: boot with a real key; the founder flow is identical.

## Validation scorecard (reported SEPARATELY — never a single flattering score)
| Signal | Definition (measurable) |
|---|---|
| **Activation** | founder submits ≥1 genuine current concern (`reality = yes_now`/`yes_not_urgent`) |
| **Immediate clarity** | feedback `clearer ∈ {yes, somewhat}` |
| **Consequence** | feedback `changedAttention = yes` |
| **Unique value** | feedback `reachedAlone = probably_not`, or a stated advantage over the usual alternative |
| **Accumulation** | ≥1 Understanding item accepted or corrected |
| **Continuity** | a later concern's reading drew on prior accepted Understanding (context reuse recorded) |
| **Natural return** | a `second_distinct_concern` event that is **not** facilitator-prompted |
| **Willingness to continue** | founder says they would continue if access remained |
| **Willingness to pay** | a concrete positive amount or an accepted paid continuation offer |

## Decision rules (initial hypotheses — thresholds are NOT validated targets)
- **Continue investing in the clarity engine** only if a meaningful share of *activated* founders show **immediate clarity + consequence + (natural return OR explicit willingness to continue)**.
- Compliments without repeated use or payment intent → **weak** evidence.
- Facilitator-led second sessions are counted **separately** from voluntary returns.
- "I would pay" without a concrete amount/offer → **weak** evidence.
- Accepted Understanding with **no later reuse** → evidence of usability, **not yet** compounding value.
- Exploratory-marked concerns are analyzed separately from `yes_now` — polite testing must not be mistaken for real behavior.

## Privacy & founder control (what the product actually does)
- **Consent**: activation requires explicit pilot consent; human review of conversations is a **separate, optional opt-in** (`consent_research_review`).
- **What's stored**: business context the founder provides (understanding, concerns, clarity results) to make the product work; research events store **metadata + entity ids only** (no raw concern/result text).
- **Export**: `/api/account/export` returns the founder's own data, now including clarity + their pilot research rows.
- **Deletion**: `/api/account/delete` (or admin on request) permanently removes the founder's business + clarity + personal pilot rows in one atomic transaction; because some ledgers are append-only for integrity, deletion is the sanctioned removal path, and **research events are anonymized** (founder link dropped, aggregate kept) — the strongest feasible deletion. Disabling access is separate and does **not** delete data.
- **Admin boundaries**: admin endpoints are token-authorized (fail-closed), never session-based, and expose **metadata by default**; raw founder text requires a deliberate per-founder export. Facilitator notes are research-only and **never enter Business Understanding or the AI context**.
- **Secrets**: no API keys or private business content in logs or error traces; founder-facing errors never expose technical detail; the live-verify/admin token are read in-process and never printed.

## Tests & verification
- Deterministic: `apps/api/src/__tests__/pilot/pilot.live.test.ts` — **20/20** (P1–P20). Clarity unchanged at **46/46** (66 together). API + web typecheck clean; web build clean; frozen engine byte-identical.
- Smoke: `tools/pilot-smoke.sh` — 12-step journey, **all pass** (deterministic run).

## Deliberately NOT implemented
The next product capability (Strategy Thread continuity), dashboards/analytics products, task/project management, engagement mechanics (streaks, nudges, reminders), a public growth funnel, teams/multi-user, and billing infrastructure. WTP is captured as **research evidence**, never treated as validated revenue.
