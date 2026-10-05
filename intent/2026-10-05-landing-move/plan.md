# Plan: the move arrives written — landing page

- **Intent:** ./intent.md
- **Approved by:** Claudia on 2026-10-05

## Approach

A `leadsToCreate` move that calls for the landing page arrives with its copy **already drafted**,
produced by a new structured-prose generator and routed through the frozen Slice-4 proposition
kernel plus a **new medical/regulated-claim gate**, fail-closed. The draft is a first-class
artifact stored beside the immutable move (its own table, with an immutable authorization snapshot
+ safety trace), drafted lazily and async when the move first surfaces — not eagerly for every
create-move at adoption. It is built as the first `kind` of a general `MoveDraft` shape so the
message and carousel moves reuse the same spine rather than re-solving it.

Why not the cheap paths: generalising the Email model gives an email-shaped blob with prompt-only
safety (the ungated anti-pattern); eager-at-adoption runs N safety-critical generations most
founders never see. A structured generator + lazy async + a real gate is the version that is both
a better page and auditable.

## The generator (design §1)

New prose generator, **not** a generalised Email model. Produces a typed multi-section
`LandingDraft` (hero headline + subhead, what-it-is, who-it's-for, proof/credibility, one CTA;
each section a prose block + a role), in the founder's language. Same grounding inputs the Email
model proves work (strategy bet, audience, voice working-set, licensed propositions, proof facts)
but structured — and the per-section structure is exactly what lets the gate attribute a violation
to a section (the carousel's per-slide / whole-asset split). The Email model falls short on form
(flat ~1200-char body, no sections) and on auditability (nothing to attribute to); it is the
anti-pattern for safety, not the template.

## The claim-safety & voice gate (design §2 — the long pole)

**Reused as-is (frozen hard core, do NOT rebuild):**
- `validateAgainstAuthorization` kernel — `packages/application/src/voice/proposition-safety.ts`
  (Layer 1 deterministic proposition classes, Layer 2 discourse exemptions, Layer 3 N=3 union-fail
  judge). Operates on free-text `SampleContent {hook?, beats?[], caption?, cta?}`, not slide shapes.
- `AuthorizedMessageSpec` + `LicensedProposition` allowlist; the proof substrate (`ProofFact`
  true-by-construction, `UnsourcedClaim` never licensed, provenance).
- Deterministic backstop `classifyVoiceSample` / `auditAssertions` — CTA survival, parroting,
  numeric discipline (every number token must match the licensed factual blob), outcome/market/causal typing.
- The realize→check→repair→fail-closed loop shape (`generateWithWorkingSet`).

**Built new:**
1. **Medical/regulated-claim guard — the long pole.** No positive medical detection exists today;
   `REEL_FORBIDDEN_CLASSES` is inert (never read by the kernel — recorded as a present risk in
   known-issues). The allowlist only blocks *unlicensed* claims; a medical surface must also catch
   *licensed-sounding-but-regulated* phrasing (treats / cures / heals / "gets you back to…" /
   recovery-rate figures) and attach disclaimer requirements. A new deterministic classifier
   (vocabulary + patterns, like the MARKET/CAUSAL/OUTCOME regexes) **plus** a judge pass, wired as
   an actually-consulted fail-closed gate, in **RO + EN + IT** (the per-language vocabulary is most
   of the cost). This guard lives in the shared spine so every future `kind` inherits it.
2. `LandingAuthorizationSnapshot` + a `specFromSnapshot`-style adapter (~carousel-sized) and the
   prose→`SampleContent` mapping with per-section + whole-page attribution.
3. A `MoveDraftService` orchestration: realize→gate→repair→fail-closed (NOT the ungated email path).

**Fail-closed stance:** if safe copy can't be produced, the move arrives as today's plain
instruction, never unsafe copy.

## Storage & timing (design §3)

- **New table `plan_move_draft`** (one migration, `approve migration`), keyed by `actionId` +
  `planVersionId` + `businessId`: the structured draft, the immutable `LandingAuthorizationSnapshot`,
  the `SafetyDecision` trace, a `status` (drafted|edited|accepted), language, append-only versions.
  Not the handoff payload — the draft has its own lifecycle and the safety snapshot must be stored
  immutably for audit replay, exactly as `AssetAuthorizationSnapshot` is per carousel.
- **Lazy + async, triggered when the create-move first enters Today's ready set**, on the reel
  BullMQ precedent (enqueue → persist stages → poll). Usually done by the time the founder opens
  Today; if not, the "writing your landing page…" in-progress state shows and it lands moments later.
  Not eager-at-adoption; not drafted-on-open.

## The Today surface (design §4)

The move block (`apps/web/src/slice0/TodayPage.tsx:272-316`) shows, instead of the instruction +
"becomes an asset": *"Your landing page — a first version is written,"* with the structured draft
rendered by section (reuse the carousel Preview pattern for text). The founder edits any section
inline (their words — not re-gated — and fed into the voice working-set's before→after `edits` so
voice improves per business); a per-section "rewrite this" re-runs the gated generator for that
section. Accept marks the draft `accepted`, records it as the move's produced artifact, advances
the move's outcome, and exposes the copy to copy-out/export. Fail-closed shows the plain
instruction with an honest line, Talk-to-BB intact. EN/RO/IT strings.

## Reusable shape beyond the landing page (design §5)

`MoveDraft` = typed draft + authorization snapshot + safety trace + status, keyed by `actionId`,
with a `kind`. `landing` first; `message` next (which finally routes the ungated Email model
through the same kernel); `carousel`/`reel` delegate to the existing frozen asset path via the
handoff. Shared spine built once: authorization-snapshot builder, kernel + backstop + **medical
guard**, repair/fail-closed orchestration, `plan_move_draft` storage + status lifecycle, the Today
draft surface. Only the per-kind generator (prompt + output shape) and its prose→`SampleContent`
mapping are new each time.

## Files to change

| File | Change |
|---|---|
| `packages/application/src/voice/contracts.ts` | **FROZEN** — extend `SampleChannel` with `'landing'` (`approve frozen`) |
| `packages/infrastructure` voice repository + a migration | **FROZEN-adjacent** — persist the new channel (`approve frozen` + `approve migration`) |
| `packages/application/src/move-draft/` (new) | `MoveDraftService`, `MoveDraft`/`LandingDraft` types, `LandingAuthorizationSnapshot`, prose→`SampleContent` mapping |
| `packages/application/src/.../medical-safety.ts` (new) | the deterministic medical/regulated-claim guard + judge pass, RO/EN/IT |
| `packages/infrastructure/src/business-intelligence/anthropic-landing.model.ts` (new) | the landing prose generator adapter + prompt |
| `database/migrations/V0xx__create_move_draft.sql` (new) | `plan_move_draft` table (`approve migration`) |
| `packages/infrastructure/.../pg-move-draft.repository.ts` (new) | repo |
| `apps/workers/src/move-draft/` (new) | BullMQ draft-on-surface job (reel pattern) |
| `apps/api/src/routes/move-draft.routes.ts` (new) | get draft / rewrite section / accept |
| `apps/web/src/slice0/TodayPage.tsx` + new draft components | render / edit / rewrite / accept + fail-closed state |
| `apps/web/src/i18n/messages.ts` | EN/RO/IT strings |

## Tests / verification

- Unit: the medical guard (adversarial — regulated claims must fail), the kernel against landing prose, the snapshot adapter.
- Types: `npx tsc -b`; Lint: web `--max-warnings 0`.
- Live: Body Move (real medical business, RO) — surfaced landing move shows a gated multi-section
  draft; adversarial regulated-claim attempt fails closed; edit + accept + export; fail-closed path shown.

## Risks

- **Frozen Slice-4 touched** (`SampleChannel` enum + voice repo) — `approve frozen`, scoped to the additive channel.
- **New migration** — `approve migration`.
- **Medical safety** is the correctness-critical piece; an adversarial gate pass on real RO copy is a release gate, not a nicety.
- Rollback: fail-closed degrades to today's plain instruction; the feature is additive (new tables/services), so disabling the draft-on-surface job restores current behaviour.

## Status log

- 2026-10-05: design approved by Claudia. Channel = extend `SampleChannel` (not reuse `'caption'`).
  Honest estimate ~1.5 weeks; the medical guard (RO/EN/IT) is the long pole. One-week cut, if forced:
  Romanian-only + landing-only, storage/gate still shaped for reuse. NOT started.
