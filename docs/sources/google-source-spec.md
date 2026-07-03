# Source Spec — Google (Docs/Drive) — First Authenticated Source

**Type:** Source Specification (BUILD document — optimized for implementation, not elegance)
**Status:** DRAFT FOR APPROVAL
**Date:** 3 July 2026
**Governed by:** ADR-007 (honesty, LOCKED) · ADR-008 (roadmap, LOCKED) · ADR-009 (authenticated boundaries, LOCKED). Inherited by reference; not restated.
**Inside:** Capability A (Connect Your World) — this is a new Source, not a new capability.

> **Build rule for this spec:** reversible decisions are defaulted with a noted assumption and we move. The only hard gate is the OAuth credential lifecycle (§ Risk gate). Everything else builds fast.

---

## 1. What this is (one paragraph)

Google is the first **authenticated Source** inside Capability A. It builds the minimal authenticated infrastructure (OAuth + credential lifecycle) **together with** Google as its proving provider, per ADR-009 Invariant 6. The founder connects their Google account; Business Brain reads the working documents they grant access to; those documents become typed evidence through the unchanged honesty gate; the two-beat reflection deepens using this new private evidence alongside any existing Website/Upload evidence.

The founder-felt outcome is **depth, not freshness**: "it understood my business from my own private working documents — things I never published and never uploaded." Not "always current." (ADR-009 forbids background sync; the honest promise is depth of reach, not continuity.)

---

## 2. Founder experience (the block, not the polish)

1. Founder chooses to connect Google (a "Connect Google" action inside Connect Your World).
2. OAuth consent — Google's screen, `drive.file` picker scope. Founder picks which files/folders to grant. (Picker = founder explicitly selects; nothing is read that they didn't pick. This also dodges the CASA audit — see §5.)
3. Business Brain reads the granted docs, shows live progress ("Reading 4 documents… your strategy doc… your plan…").
4. Two-beat reflection: Beat 1 (observed, fast) grounded in the granted docs with document+location provenance; Beat 2 (inferred, behind) fusing Google docs + any Website/Upload evidence.
5. Honest states throughout (§7). Closing handoff line into declared intent, same as every Source.

**Reversible defaults (assumed, not debated):**
- Entry point: a "Connect Google" button in the existing connect surface. *Assumption: reuse the M2.1/M2.2 connect UI pattern; exact placement is polish.*
- Progress copy, chip wording, button labels: reuse M2.2's editorial patterns. *Polish, deferred.*
- Which doc types to prioritize reading first: Google Docs > PDFs-in-Drive > other text. *Reasonable default; reorderable later.*

---

## 3. What's IN (build this)

- **Minimal authenticated infrastructure** (built cleanly-separable from Google, per ADR-009 Invariant 6's extraction commitment):
  - OAuth 2.0 authorization-code flow (+ PKCE).
  - Encrypted credential storage (tokens server-side only, never client-exposed).
  - Token refresh (managed lifecycle, ahead of expiry).
  - Revoke / disconnect (deletes credentials + this Source's evidence).
- **Google connector** implementing the full standard connector contract (ADR-009 Invariant 3 — `authorize()` becomes real OAuth; emits evidence only; no engine calls):
  - `drive.file` scope + Google Picker so the founder selects granted files.
  - Read granted Google Docs and Drive files (text-extractable types).
  - Extract → evidence with document identity + location anchors, `visibility: private`, through the **unchanged** three-layer honesty gate.
- **Recompute integration** on the existing shared path: Google evidence → frozen engine → fail-closed resolution spanning Website + Upload + Google → two-beat reflection. Engine byte-identical (`992666a6…`/`6dff794d…`).
- **Honest state machine** (§7).
- **Live transport** (reuse M2.2's SSE pattern — the U+2028-safe frame reader/writer already on main).

---

## 4. What's OUT (do not build — flag if tempted)

- **Google Calendar — DEFERRED.** New evidence type (temporal, not prose) = a second novel risk. Keeping v1 to one novel risk (the OAuth lifecycle). Calendar is a strong *next* Source increment. Not now.
- **Full Drive read (`drive.readonly`) — OUT.** Triggers the CASA security audit. Use `drive.file` + picker only.
- **Gmail / email — OUT.** Separate sensitive evidence type; own future Source.
- **Background sync / scheduling / autonomous refresh — OUT** (ADR-009 Invariant 5). Read on founder action / explicit refresh only.
- **Any generalization for future providers — OUT.** Build for Google. Extract the shared infra when provider #2 (Notion, etc.) actually arrives (ADR-009 Invariant 6). No "make it reusable for Instagram" anticipation now.
- **Scanned/image-only Google files (OCR) — OUT.** Honest `unsupported`, like M2.2.
- **Google Sheets — OUT for v1.** Tabular = different evidence shape (same reasoning that deferred spreadsheets in M2.2). Defer.

---

## 5. Scope / OAuth decisions (the ones that matter)

- **Scope: `drive.file` + Google Picker.** *Decided, not reversible-cheap:* this avoids the CASA audit (which `drive.readonly` would trigger — real money, annual). Founder-picks-files is also the honest consent model (they grant specific files, nothing more). This is the deliberate scope choice; do not widen it.
- **Identity:** Sign-in with Google (OpenID) for the account connection. *Default; standard.*
- **Verification:** Google OAuth app verification will be needed for production (sensitive-scope review). Build + test against test users now; submit verification in parallel (same "start the clock, don't block on it" move as M2.1's Instagram-review advice). *Verification timeline is Google's, not ours — don't block the build on it.*
- **Credential containment (ADR-009 Invariant 4 — hard):** tokens are access, never information. Never in evidence, never in provenance, never in founder-facing output, never logged/echoed. Enforced structurally.

---

## 6. Evidence & provenance (inherits ADR-007 — restated only where Google-specific)

- Google doc fragments: `observed`, `source: google` (or `google-drive`), `sourceDocument: {fileId, filename, contentHash}`, location anchor (doc section/heading, or page), `visibility: private`, `occurred_at` from Google's file metadata (modified/created) or null, content-addressed id.
- Provenance chips show document + location ("from your 'Q3 Strategy' doc").
- `derived_from` for inferred claims points at specific Google fragments (ratchet holds — most-specific-anchor-wins, per M2.2).
- **Redundancy detection** (reuse M2.2's exact-overlap classifier): a granted Google doc that duplicates already-connected Website/Upload content → `redundant`, contributes no new evidence, honestly surfaced. Free reuse of M2.2's work.
- **Epistemic ceiling** (ADR-007 / M2.2, applies): a Google doc is evidence *of the document*, not of external reality. No upload-/google-only inferred claim about the market. Enforced at recompute.

*Everything in this section is inherited from ADR-007 + M2.2. Restated here only so Claude Code has the Google-specific field values. No new honesty rules.*

---

## 7. Honest states (reuse M2.2's machine)

connecting · authorizing · reading · synced · partial · empty · redundant · unsupported · failed. Same honest handling as M2.2 (no fabrication on empty/failed; redundant surfaced, not silent; unsupported honest). Reuse, don't reinvent.

---

## 8. Security (authenticated Source = real surface)

- Tokens encrypted at rest, server-side only, founder-scoped, deleted on disconnect (ADR-009 Invariant 4).
- OAuth state param / PKCE against CSRF.
- Never log/echo tokens (standing rule).
- Google file content is untrusted data — extracted text is evidence content, **never** instruction position (prompt-injection-inert, same guarantee proven in M2.2; reuse it).
- Google API responses treated as data, not commands.

---

## 9. THE risk gate (one gate, this capability's load-bearing risk)

**Gate: the OAuth credential lifecycle.** This is the first authenticated flow in the codebase and the one expensive-to-reverse, security-critical thing. Build it, then **STOP for review before building the Docs/Drive evidence path and reflection on top of it.**

Prove at the gate:
- OAuth authorization-code + PKCE flow completes; credential stored **encrypted, server-side**.
- Token refresh works ahead of expiry; revoke deletes credentials.
- **Credential containment proven** (ADR-009 Invariant 4): demonstrate a token never appears in any evidence fragment, provenance chip, founder-facing output, or log — a test that asserts this, not just inspection.
- The credential store is **cleanly separable from Google** (ADR-009 Invariant 6): its interface isn't Google-shaped in a way that'd fight extraction when provider #2 arrives. (Doesn't need to be *extracted* now — just not entangled.)
- Connector emits evidence only; no engine call (ADR-009 Invariant 3).

**One gate is sufficient** because Calendar is deferred (§4) — that deferral is *why* the novel-risk surface is a single thing (OAuth). If Calendar were in, this would be two gates. It's not, so it's one.

---

## 10. Acceptance criteria (capability complete when)

1. Founder connects Google via OAuth (`drive.file` + picker), grants files, and receives a two-beat traceable reflection fusing Google + any Website/Upload evidence.
2. Every rendered claim traces to a specific Google fragment (document + location). No untraceable claim renders.
3. Credential lifecycle works: store (encrypted), refresh, revoke/disconnect (deletes creds + evidence). Credential containment proven by test.
4. Redundant Google content (duplicating Website/Upload) → honest redundant, no double-count. Epistemic ceiling holds. `visibility: private` on all Google fragments.
5. Honest empty/partial/redundant/unsupported/failed — no fabrication.
6. Engine byte-identical; three-layer gate unchanged; connector→evidence boundary intact; Website/Upload not regressed.
7. Full suite green; connector implements full contract.
8. Live: a real Google account, real granted docs, streamed two-beat, dangling refs = 0. (Manual observation gate, like M2.2 — real connect, watched render.)

---

## 11. Build order (for the Implementation Brief that follows)

**Phase 1 — Auth infra + Google connector skeleton → STOP at the credential-lifecycle gate (§9).**
OAuth flow, encrypted credential store, refresh, revoke, connector `authorize()` real, containment proven. Review before proceeding.

**Phase 2 — Evidence path (after gate):** Docs/Drive read via `drive.file`+picker → extract → evidence (private, anchored) → through unchanged gate. Redundancy reuse (M2.2).

**Phase 3 — Recompute + reflection:** Google evidence → shared frozen-engine path → fail-closed resolution across Website+Upload+Google → two-beat. Epistemic ceiling.

**Phase 4 — Surface + states:** connect UI (reuse pattern), live SSE (reuse U+2028-safe transport), honest states.

**Phase 5 — Measure + close:** live manual connect, dangling=0, containment verified, suite green. Then finishing pass (feature branch, gated merge — separate task).

---

## 12. Deferred as polish (noted, not now)

- Exact connect-UI placement, copy, chip wording, progress phrasing → reuse M2.2 patterns, refine later.
- Doc-type read priority ordering → reasonable default, tune later.
- Calendar, Sheets, Gmail → future Sources.
- Shared-infra *extraction* → when provider #2 arrives (ADR-009 Invariant 6).
- Google OAuth production verification → submit in parallel, don't block build.

---

*Governed by ADR-007/008/009. Google is the implementation; the Source is "your private working documents"; the founder outcome is depth. One gate: the OAuth credential lifecycle. Build, don't polish.*
