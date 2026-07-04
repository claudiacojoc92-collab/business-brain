# Source Spec — Google Calendar — Behavior Dimension (Track A)

**Type:** Source Specification (BUILD document — implementation-ready)
**Status:** DRAFT FOR APPROVAL
**Governed by:** ADR-007/008/009 (inherited, not reopened). A new Source inside Capability A. Reuses the Google authenticated infra merged at 1ec8374.

> **The one gate:** temporal evidence becomes a new *observed* evidence shape — it types, fuses, and produces honest tensions without corrupting the model. Everything else REUSES the proven Google Source. No OAuth/connector/evidence redesign.

---

## 1. What this is

Google Calendar as the next evidence Source — the **behavior dimension**. Business Brain currently sees what the founder *published* (website), *wrote* (docs/google), and *told it* (declared). It has no perception of how the founder *spends time*. Calendar adds that: calendar patterns → temporal `observed` evidence → fuses into recompute → **C can now surface time-vs-intent tensions** ("you declared X is the priority, but your time shows Y"), the highest-leverage new tension axis.

Second scope on the existing Google Source. The OAuth lifecycle, credential store, connector contract, evidence pipeline, two-beat, honesty gate — all already built and proven. This adds one scope + one new evidence shape.

---

## 2. What's IN (build this)

- **Add the Calendar read scope** to the existing Google connector: `calendar.readonly` (or `calendar.events.readonly`). Same OAuth flow, same credential store, same refresh/revoke — just an added scope. (Founder re-consents to include Calendar; incremental auth on the proven flow.)
- **Calendar client:** read the founder's calendar events over a recent window (default: last 30–90 days — reversible).
- **Temporal evidence extraction (THE new shape):** turn events into `observed` evidence about *how time is allocated* — NOT raw event dumps. Aggregate into patterns: time-by-category (meetings/deep-work/sales/ops), recurring commitments, where the hours actually go. The evidence is the *pattern*, not the calendar.
- **Evidence typing:** `observed`, `source:'google-calendar'` (or `source:'google'` + a calendar marker), `calendar://` opaque provenance anchor (mirroring `google://`/`upload://`, never dereferenced), `visibility:private`, `occurred_at` from event times.
- **Fusion into recompute:** calendar temporal evidence flows the SAME `recomputeFromSources` path as every observed source. Engine byte-identical. C's ranking now includes time-vs-intent tensions.
- **Honest states:** reuse the existing machine (connecting/reading/synced/empty/partial/unsupported/failed).

---

## 3. What's OUT (do not build)

- OAuth redesign / new connector framework / new evidence pipeline. (Reuse — hard rule.)
- Reading event *content/notes/attendees' private data* beyond what's needed for time-allocation patterns. (Privacy: patterns, not surveillance. Prefer metadata — titles/times/categories — over deep content.)
- Meeting transcription, attendee analysis, who-the-founder-meets social graph. (Off-scope, privacy-heavy.)
- Background sync / scheduled re-read (ADR-009 Inv 5 — founder-action/refresh only).
- Writing to the calendar. (Read-only.)
- A new confidence_kind. (Temporal evidence is still `observed` — observed *behavior* — not a new kind.)
- Calendar/Sheets/Gmail as separate sources here. (Calendar only.)

---

## 4. THE one gate — temporal evidence as a new observed shape

Every prior source emits **prose** (documents, pages, declared text). Calendar emits **time/structure** — a genuinely new evidence shape. The gate: *does temporal evidence type, fuse, and produce honest tensions without corrupting the model?*

Build the temporal-evidence path first, then VERIFY and report BEFORE building further:
- Temporal evidence is typed `observed` through the UNCHANGED three-layer gate, with real provenance (`calendar://` anchor to the pattern's source events) — fail closed, no fabricated patterns.
- It **fuses** with existing observed + declared: an inferred claim can cite calendar temporal evidence + declared intent and render a **time-vs-intent tension** ("you told me X is the priority (declared), but your calendar shows most time on Y (observed-behavior)") — WITHOUT the engine choking on the non-prose shape.
- **Epistemic ceiling holds:** calendar is evidence of *how time was spent*, NOT of *what the business is* — "40% of time in sales meetings" is observed behavior, not a claim that sales is the strategy. No laundering time-allocation into external fact.
- Engine byte-identical; no new confidence_kind; same recompute path.

If temporal evidence corrupts fusion, mis-types, or the engine can't reason over the non-prose shape → STOP and report. That's the one real risk. Everything else reuses proven machinery.

---

## 5. Reversible defaults (noted, shipped as-is)

Read window (default 30–90 days); time-categorization heuristic (how events bucket into categories — reasonable default, tunable); how patterns render in the reflection; scope choice (`calendar.readonly` vs `calendar.events.readonly` — pick the narrower that works). All reversible, don't debate.

---

## 6. Acceptance criteria

1. Founder adds Calendar (incremental consent on the existing Google flow); credential lifecycle unchanged.
2. Calendar events → temporal `observed` evidence as *time-allocation patterns* (not raw dumps), `visibility:private`, `calendar://` anchored, through the unchanged gate.
3. Temporal evidence fuses: C surfaces at least one **time-vs-intent tension** grounding to calendar temporal evidence + declared intent.
4. Epistemic ceiling holds (time-allocation ≠ external fact); dangling=0.
5. Engine byte-identical; no new confidence_kind; no second pipeline; Website/Upload/Google/declared not regressed; suite green.
6. Live: real Google account, real calendar, temporal evidence created, a live time-vs-intent tension renders in "what matters now," watched.

---

## 7. Build order

Phase 1 — Add Calendar scope to the Google connector (incremental auth) + calendar read. Reuse OAuth/credential lifecycle wholesale.
Phase 2 — **Temporal evidence extraction → the gate (§4).** Type/fuse/ceiling verified BEFORE proceeding. STOP here if the new shape corrupts anything.
Phase 3 — Recompute fusion + reflection: time-vs-intent tension surfaces in C's "what matters now."
Phase 4 — UI + live: incremental consent in the connect surface, live manual gate (real calendar → temporal evidence → live time-vs-intent tension), dangling=0, engine frozen. Report + commit plan (feature branch, per-commit-green, gated merge).

---

*Governed by ADR-007/008/009. Second scope on the proven Google Source. One gate: temporal evidence as a new observed shape. Reuse everything else. Build, don't redesign.*
