# IntakeMemoryMapper (A2) — Derivation Spec, Wiring & Green Checklist

Phase 9A.5 Task A2. Seeds Business Memory from the completed 29-question intake so a freshly
onboarded founder gets a main-path brief instead of the cold-start fallback. Engine Freeze respected:
no new layers, no new domain events, no prompt changes, no schema changes.

---

## 0. The one thing to resolve first — FOUNDATION*

The mapper does **not** assume a Foundation layer exists. It writes conviction / belief / education /
contrarian / intended-movement to whatever layer the **live pipeline reads them from**. Run:

```bash
# What layer set actually exists?
rg -n "FOUNDATION|BUSINESS_EVOLUTION|EDIT_PATTERN_INTELLIGENCE|AUDIENCE_TEMPERATURE|OFFER_INTELLIGENCE|APPROVAL_INTELLIGENCE|REJECTION_INTELLIGENCE|PERFORMANCE_INTELLIGENCE|SEASONAL_CONTEXTUAL|OUTCOME_INTELLIGENCE" packages/shared

# Which layer do Stages 4/5/11 READ conviction/belief/voice/audience from?
rg -n "findLayer|MemoryLayerEnum|memory_layers" packages -g "*s04*" -g "*s05*" -g "*s11*" \
  -g "*memory-interrogation*" -g "*extractor*" -g "*hypothes*"
```

Set `config.foundationLayer` (and `FOUNDATION_LAYER` in both test files) to that enum value.
If there is no literal `FOUNDATION`, it is almost certainly `BUSINESS_EVOLUTION` — but **the grep decides, not this doc.**
The mapper throws on construction if `foundationLayer` is unset, so a wrong write can't happen silently.

---

## 1. Signal → layer → field mapping (29 signals)

| Target | Signals (Q#) | Notes |
|---|---|---|
| **FOUNDATION\*** | CONVICTION_MECHANISM(1), FOUNDING_STORY(2), BELIEF_TARGET(3), CONVICTION_FALSIFICATION(4), EDUCATION_INSIGHT(5), CONTRARIAN_POSITION(6), BELIEF_CHAIN_STRUCTURE(18b), INTENDED_AUDIENCE_MOVEMENT(26) | conviction_angle.{statement,evidence,confidence,contrarian}, belief_chain.beliefs[], education_topics[], intended_effect |
| **OFFER_INTELLIGENCE** (L7) | OFFER_NATURAL_LANGUAGE(19), OFFER_PRICE_PHILOSOPHY(20) | offer_versions update (price_tier/promise) done by existing offer flow; layer holds language + philosophy |
| **APPROVAL_INTELLIGENCE** (L1) | APPROVAL_STANDARD_POSITIVE(23), ZERO_EDIT_CRITERIA(25), TRUST_CRITERIA(28) | positive_standard_piece, zero_edit_criteria, system_trust_criteria |
| **AUDIENCE_TEMPERATURE** (L9) | AUDIENCE_INTERNAL_MONOLOGUE(13), AUDIENCE_SOCIAL_FRAMING(14), AUDIENCE_SELF_PROTECTION(15), WARM_SIGNAL_VOCABULARY(16), COLD_SIGNAL_VOCABULARY(17), AUDIENCE_FALSE_ASSUMPTION(18) | vocabulary only — `current_temperature` stays UNKNOWN (behavioural) |
| **REJECTION_INTELLIGENCE** (L3) | PRIMARY_OBJECTION(21), CONTENT_HARD_BLOCK(12), APPROVAL_STANDARD_NEGATIVE(24) | primary_objection, content_hard_blocks[], approval_standard_negative |
| **EDIT_PATTERN_INTELLIGENCE** (L2) | VOICE_SYNONYM(9), VOICE_REJECTION_EXAMPLE(8) | stated fields seeded; `pattern_confidence = 0.0` (earns confidence only from real edits) |
| **founder_voice_versions** (row) | VOICE_OPENING_EXAMPLE(7), VOICE_CTA_EXAMPLE(10), VOICE_ANALOGY(11), OBJECTION_RESPONSE(22) | opening_pattern, cta_style, conviction_posture, objection posture |
| **QUARANTINE only** | UNSOLICITED_HIGH_VALUE(27) | never auto-mapped; QUARANTINED intelligence event for engineer release |
| **not seeded** | PERFORMANCE(L4), SEASONAL(L6), OUTCOME(L8) | behavioural — cannot come from an interview |

## 2. Seed confidences (approved ceilings) — applied **conditionally**

FOUNDATION\* 0.62 · OFFER 0.68 · APPROVAL 0.45 · AUDIENCE 0.40 · REJECTION 0.35 · EDIT_PATTERN payload-only (conf 0).

Rule (change #4): `confidence = ceiling × (strong answers ÷ contributing answers)`.
A "strong" answer is non-empty and ≥ `minStrongLen` (default 15 chars). If **zero** contributing answers
are strong, the layer is **not seeded** (stays at baseline 0). Confidence never exceeds the ceiling.
Every seeded layer gets `data_points = 1` and `intake_seeded = true`.

## 3. Decisions locked to your four changes

1. **FOUNDATION\* from code** — required config; throws if unset; grep is authoritative.
2. **No new domain event** — `CompleteIntakeHandler` keeps emitting `IntakeCompletedWithoutDerivation`
   unchanged. The mapper uses only the existing `appendIntelligenceEvents` memory path, and only if a
   founder-stated `intakeEventType` already exists in your enum. If it doesn't, layer payloads still
   seed (that's what the pipeline reads) and the mapper logs the event-type gap. **Documented gap:** the
   event name `…WithoutDerivation` is now imprecise; rename is deferred to a proper Event-Contracts change.
3. **Q27 quarantined** — excluded from all layers; optional `QUARANTINED` event; never counts toward confidence.
4. **Conditional seeding** — see §2.

Plus three correctness constraints from the frozen spec:
- Runs **inside** the caller's `tx` (no nested transaction — Impl Spec §03).
- **Idempotent** — `intake_seeded` guard on layers; deterministic intelligence-event ids
  (`intake:{founderId}:{signalType}`) so replays don't duplicate.
- Writes only to existing tables (`memory_layers`, `intelligence_events`, `founder_voice_versions`).

---

## 4. Wiring into CompleteIntakeHandler

Register in the Awilix composition root (`apps/api/src/main.ts`) and inject:

```ts
intakeMemoryMapper: asClass(IntakeMemoryMapper).singleton(),
// provide config (foundationLayer from grep; intakeEventType if it exists):
intakeMemoryMapperConfig: asValue({
  foundationLayer: MemoryLayerEnum.BUSINESS_EVOLUTION, // ← grep result
  intakeEventType: /* 'DECLARATIVE' if it exists, else */ undefined,
}),
```

> Note: the class takes `config` as its last constructor arg. With Awilix CLASSIC mode, either pass the
> config object via a small factory, or add a `config` registration the constructor name resolves to.
> Keep constructor param names matching registration keys (Impl Spec §01).

In the handler, call the mapper **inside the existing `txManager.run`, after the status transition,
before the events are appended** — so seeding is atomic with the ACTIVE transition:

```ts
return this.txManager.run(async (tx) => {
  const result = founder.completeIntake(...);        // status → ACTIVE, records IntakeCompletedWithoutDerivation
  if (result.isErr()) return result;
  await this.founderRepo.save(founder, tx);

  // A2: seed Business Memory from the 29 answers (idempotent, same tx)
  const signals = await this.intakeSessionRepo.getSignals(founder.id, tx); // existing read
  await this.intakeMemoryMapper.seedFromIntake(founder.id, signals, tx);

  await this.eventStore.append(founder.pullEvents(), tx); // unchanged
  return Ok(result.value);
});
```

If `intake_sessions.signals` is read elsewhere, reuse that path rather than adding a new repo method.

---

## 5. RESOLVE checklist (symbols to confirm — all one-liners)

- [ ] `config.foundationLayer` = grep result.
- [ ] Import paths (R1) for `MemoryLayerEnum`, `IBusinessMemoryRepository`, `IntelligenceEvent`, `IClock`, `Transaction`.
- [ ] `IBusinessMemoryRepository` exposes `findLayer` / `saveLayer` / `appendIntelligenceEvents` (R2).
- [ ] `saveLayer` payload/DTO shape (the `as never` cast in `seedLayer`) → real `MemoryLayer` shape.
- [ ] `IFounderVoiceRepository.upsertFromIntake` (R3) — confirm real name/shape; adjust the 1 call.
- [ ] `IntelligenceEvent` fields (R4): eventId, founderId, layer, eventType, content, confidence, quarantineStatus, emittedAt.
- [ ] `intakeEventType` (R4): set to the real founder-stated enum value, or leave undefined.

---

## 6. Tests

- `intake-memory-mapper.spec.ts` — unit: full-intake ceilings, conditional down-scaling, no-seed-when-absent,
  Q27 quarantine, event-type gap (layers seed, events skipped, warn logged), idempotent re-run, helpers.
- `complete-intake-memory.integration.spec.ts` — DB-backed: complete intake → six layers at seeded
  confidences with `data_points=1`, voice row present, Q27 quarantined, behavioural layers at 0,
  status ACTIVE, and a re-run that doesn't duplicate or change memory. Wire `setup()` to your test container.

## 7. Green criteria (run in repo; I can't run these from chat)

```bash
npx tsc --noEmit -p packages/application/tsconfig.json     # 0 errors
npx eslint packages/application/src/founder --max-warnings 0
npx vitest run packages/application/src/founder            # unit green
npx vitest run packages/application/src/founder/__integration__  # integration green (needs test DB)
```

Green = all four exit 0, **and** existing suite stays at 256/256 (or higher with these added).
When it's green, report: the resolved FOUNDATION\* value, whether `intakeEventType` existed, and the new
test count — I'll fold all of it into the state tracker and then we unblock Phase 9C.
```
