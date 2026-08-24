import { describe, it, expect } from 'vitest';
import {
  filterRenderableRanges, validateSelectionRefs, assessNonTransplantable, assessSufficiency, targetDuration,
  buildTimeline, edlHash, disposeSpokenClaim, isLoadBearingRange, MIN_REEL_MS, MAX_REEL_MS,
  deriveEditingEnergy, assessEditorialFit, leadWith, rangeMotionIntensity,
} from '../../reel/reel';
import type { ClipObservation, ReelSourceRef, SelectedClipRange, VideoSetUnderstanding, ReelOpportunityDraft, ReelTextBlock } from '../../reel/contracts';

const obs = (id: string, sourceRefId: string, extra: Partial<ClipObservation> = {}): ClipObservation => ({
  observationId: id, sourceRefId, durationMs: 6000, width: 1080, height: 1920, orientation: 'portrait', fps: 30, codec: 'h264', container: 'mp4',
  rotationDegrees: 0, hasAudio: true, audioCodec: 'aac', setting: 'gym', subject: 'dumbbells', objects: ['dumbbell'], activity: 'training',
  shot: 'b_roll', shotScale: 'medium', motion: 'static', motionIntensity: 'low', faceBoxes: [], focalSubjectBox: null, usableSpans: [{ startMs: 200, endMs: 5800, reason: 'x' }],
  rejectedSpans: [], speechPresent: false, audioKind: 'ambient', transcriptRef: null, verdict: 'observed', ...extra,
});
const src = (sourceRefId: string, reuseRight: ReelSourceRef['reuseRight']): ReelSourceRef => ({ sourceRefId, objectKey: `k/${sourceRefId}`, reuseRight });
const rng = (sourceRefId: string, observationRef: string, inMs: number, outMs: number, role: SelectedClipRange['role'] = 'build'): SelectedClipRange => ({ sourceRefId, observationRef, inMs, outMs, role, audioUse: 'original' });

describe('Slice 7 — reel rights + selection (real ranges, not whole files)', () => {
  const observations = [obs('o1', 'c1'), obs('o2', 'c2'), obs('o3', 'c3', { verdict: 'unusable' })];
  const sources = [src('c1', 'founder_uploaded'), src('c2', 'reference_only'), src('c3', 'founder_uploaded')];

  it('reference_only + unusable + too-short ranges are dropped; only renderable ranges survive', () => {
    const ranges = [rng('c1', 'o1', 500, 3500), rng('c2', 'o2', 0, 3000), rng('c3', 'o3', 0, 3000), rng('c1', 'o1', 100, 300)];
    const { kept, dropped } = filterRenderableRanges(ranges, sources, observations);
    expect(kept.map((r) => r.sourceRefId)).toEqual(['c1']);               // only the owned, usable, long-enough one
    expect(dropped.find((d) => d.sourceRefId === 'c2')!.reason).toMatch(/rights/);     // reference_only never renders
    expect(dropped.some((d) => d.reason === 'clip unusable')).toBe(true);
    expect(dropped.some((d) => d.reason === 'no clean usable range')).toBe(true);      // 200ms range
  });

  it('selection refs must exist AND belong to their clip', () => {
    const vs = { observations } as unknown as VideoSetUnderstanding;
    expect(validateSelectionRefs([rng('c1', 'o1', 0, 3000)], vs).ok).toBe(true);
    expect(validateSelectionRefs([rng('c1', 'oX', 0, 3000)], vs).ok).toBe(false);       // unknown ref
    expect(validateSelectionRefs([rng('c1', 'o2', 0, 3000)], vs).ok).toBe(false);       // ref belongs to c2
  });
});

describe('Slice 7 — non-transplantability + sufficiency + duration', () => {
  const draft = (over: Partial<ReelOpportunityDraft>): ReelOpportunityDraft => ({
    communicationJob: 'sustainable consistency routine', narrativeArc: 'gym build', ctaDirection: null, whyFootageSupports: 'gym dumbbells',
    strategicConnection: 'consistency', nonTransplantabilityTrace: 'these clips + this coach', selectedRanges: [rng('c1', 'o1', 0, 3000)],
    excludedClips: [], targetDurationMs: 9000, missingMaterial: [], founderLegibleRecommendation: 'x', hookText: 'h', ctaText: null, ...over,
  });
  const strat = new Set(['sustainable', 'consistency', 'routine']);
  const observed = new Set(['gym', 'dumbbells', 'training']);

  it('rejects an angle ungrounded in the clips, and a generic template', () => {
    expect(assessNonTransplantable(draft({ whyFootageSupports: 'x', narrativeArc: 'x', communicationJob: 'sustainable consistency', strategicConnection: 'consistency' }), 'Lean', strat, new Set(['unrelated'])).ok).toBe(false);
    expect(assessNonTransplantable(draft({ communicationJob: 'show your behind-the-scenes journey', narrativeArc: 'day in the life', strategicConnection: '', nonTransplantabilityTrace: '' }), 'Lean', strat, observed).ok).toBe(false);
  });
  it('accepts a strategy- AND clip-grounded angle', () => {
    expect(assessNonTransplantable(draft({}), 'Lean', strat, observed).ok).toBe(true);
  });
  it('sufficiency needs ≥3 ranges + a claim basis + ≥5s; duration never pads and is bounded', () => {
    const three = [rng('c1', 'o1', 0, 2500), rng('c1', 'o1', 0, 2500), rng('c1', 'o1', 0, 2500)];
    expect(assessSufficiency(three, true, [])).toBe('sufficient');
    expect(assessSufficiency(three, false, [])).toBe('insufficient');           // no claim basis
    expect(assessSufficiency(three, true, [{ what: 'a close-up' }])).toBe('sufficient_with_gap');
    expect(assessSufficiency([rng('c1', 'o1', 0, 2500)], true, [])).toBe('insufficient');
    expect(targetDuration(three, 60000)).toBeLessThanOrEqual(MAX_REEL_MS);
    expect(targetDuration(three, 60000)).toBe(7500);                            // = sum, not padded to 60s
    expect(targetDuration([rng('c1', 'o1', 0, 2000)], 0)).toBeGreaterThanOrEqual(MIN_REEL_MS);
  });
});

describe('Slice 7 — immutable EDL/timeline + hash', () => {
  const ranges = [rng('c1', 'o1', 500, 3500, 'hook'), rng('c2', 'o2', 0, 3000, 'build'), rng('c3', 'o3', 0, 2500, 'close')];
  const blocks: ReelTextBlock[] = [
    { blockId: 'h', role: 'hook', text: 'Extreme plans don’t stick.', language: 'en', authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null } },
    { blockId: 'c', role: 'cta', text: 'Book a free intro call.', language: 'en', authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: 'book' } },
  ];
  it('orders hook→…→close, puts the hook overlay on the opener and the CTA on the closer', () => {
    const tl = buildTimeline([ranges[1]!, ranges[2]!, ranges[0]!], blocks);   // out of order input
    expect(tl.segments.map((s) => s.role)).toEqual(['hook', 'build', 'close']);
    expect(tl.segments[0]!.overlays.some((o) => o.blockId === 'h')).toBe(true);
    expect(tl.segments[2]!.overlays.some((o) => o.blockId === 'c')).toBe(true);
    expect(tl.canvas).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(tl.totalDurationMs).toBe(3000 + 3000 + 2500);
  });
  it('EDL hash is deterministic and changes when overlay COPY changes (not identity)', () => {
    const tl = buildTimeline(ranges, blocks);
    const h1 = edlHash(tl, blocks);
    expect(edlHash(buildTimeline(ranges, blocks), blocks)).toBe(h1);            // deterministic
    const edited = blocks.map((b) => (b.role === 'hook' ? { ...b, text: 'Different hook.' } : b));
    expect(edlHash(tl, edited)).not.toBe(h1);                                   // copy change → new EDL
  });
});

describe('Slice 7 — editorial-fit (visual energy of the opener must match the treatment)', () => {
  // literal visual-energy observations, no psychology
  const gymHigh = obs('oGym', 'cGym', { setting: 'gym', subject: 'person', activity: 'battle ropes', motionIntensity: 'high' });
  const chopMed = obs('oChop', 'cChop', { setting: 'kitchen', subject: 'person', activity: 'chopping', motionIntensity: 'medium' });
  const plateLow = obs('oPlate', 'cPlate', { setting: 'kitchen', subject: 'prepared_dish', activity: 'plating', motionIntensity: 'low' });
  const all = [gymHigh, chopMed, plateLow];
  const R = (ref: string, src: string, role: SelectedClipRange['role']): SelectedClipRange => ({ sourceRefId: src, observationRef: ref, inMs: 0, outMs: 3000, role, audioUse: 'original' });

  it('deriveEditingEnergy: sustainable/not-extreme → calm; launch/urgency/challenge → energetic; mixed/neutral → balanced', () => {
    expect(deriveEditingEnergy('sustainable fitness, consistency over extremes, not extreme')).toBe('calm');
    expect(deriveEditingEnergy('high-energy launch challenge with urgency and momentum')).toBe('energetic');
    expect(deriveEditingEnergy('a clear positioning for busy professionals')).toBe('balanced');
    expect(deriveEditingEnergy('sustainable but with a high-energy launch')).toBe('balanced'); // both markers → neutral
  });

  it('rangeMotionIntensity reads the literal observed energy of a range', () => {
    expect(rangeMotionIntensity(R('oGym', 'cGym', 'hook'), all)).toBe('high');
    expect(rangeMotionIntensity(R('oPlate', 'cPlate', 'build'), all)).toBe('low');
  });

  it('CALM concept opening on HIGH energy with a calmer clip available → conflict_has_alternative (calmer lead offered)', () => {
    const kept = [R('oGym', 'cGym', 'hook'), R('oChop', 'cChop', 'build'), R('oPlate', 'cPlate', 'close')];
    const fit = assessEditorialFit(kept, all, 'calm');
    expect(fit.verdict).toBe('conflict_has_alternative');
    expect(fit.calmerLeadRef).toBe('oPlate');                              // the calmest eligible clip
  });

  it('leadWith deterministically promotes the calmer clip to hook and demotes the intense opener to build', () => {
    const kept = [R('oGym', 'cGym', 'hook'), R('oChop', 'cChop', 'build'), R('oPlate', 'cPlate', 'close')];
    const led = leadWith(kept, 'oPlate');
    expect(led.find((r) => r.role === 'hook')!.observationRef).toBe('oPlate');   // calm clip now opens
    expect(led.find((r) => r.observationRef === 'oGym')!.role).toBe('build');    // battle ropes demoted, still used
    // and the resulting timeline actually opens on the calmer clip
    const tl = buildTimeline(led, []);
    expect(tl.segments[0]!.sourceRefId).toBe('cPlate');
  });

  it('CALM concept but ALL clips are HIGH energy → conflict_no_alternative (honest ask, no fabricated calm)', () => {
    const allHigh = [gymHigh, obs('oGym2', 'cGym2', { motionIntensity: 'high' }), obs('oGym3', 'cGym3', { motionIntensity: 'high' })];
    const kept = [R('oGym', 'cGym', 'hook'), R('oGym2', 'cGym2', 'build'), R('oGym3', 'cGym3', 'close')];
    expect(assessEditorialFit(kept, allHigh, 'calm').verdict).toBe('conflict_no_alternative');
  });

  it('ENERGETIC concept SHOULD lead with high-energy footage — calm opener while a high clip is eligible is under-strength', () => {
    const kept = [R('oPlate', 'cPlate', 'hook'), R('oChop', 'cChop', 'build'), R('oGym', 'cGym', 'close')];
    const fit = assessEditorialFit(kept, all, 'energetic');
    expect(fit.verdict).toBe('understrength_has_alternative');
    expect(fit.energeticLeadRef).toBe('oGym');                             // battle ropes should lead
    // and an energetic concept ALREADY opening on high energy is coherent (never demoted)
    const led = [R('oGym', 'cGym', 'hook'), R('oChop', 'cChop', 'build'), R('oPlate', 'cPlate', 'close')];
    expect(assessEditorialFit(led, all, 'energetic').verdict).toBe('coherent');
  });

  it('CALM concept already opening on a calm clip is coherent (no change)', () => {
    const kept = [R('oPlate', 'cPlate', 'hook'), R('oChop', 'cChop', 'build'), R('oGym', 'cGym', 'close')];
    expect(assessEditorialFit(kept, all, 'calm').verdict).toBe('coherent');
  });
});

describe('Slice 7 — spoken-claim disposition (using a clip ≠ broadcasting its claim)', () => {
  it('authorized → may feature; unsupported+incidental → use muted; unsupported+load-bearing → blocked', () => {
    expect(disposeSpokenClaim({ hasUnauthorizedClaim: false, loadBearing: true })).toBe('authorized_may_feature');
    expect(disposeSpokenClaim({ hasUnauthorizedClaim: false, loadBearing: false })).toBe('no_substantive_claim');
    expect(disposeSpokenClaim({ hasUnauthorizedClaim: true, loadBearing: false })).toBe('incidental_use_muted');
    expect(disposeSpokenClaim({ hasUnauthorizedClaim: true, loadBearing: true })).toBe('load_bearing_blocked');
  });
  it('the hook range and a sole proof range are load-bearing; a non-sole build range is not', () => {
    const all = [rng('c1', 'o1', 0, 3000, 'hook'), rng('c2', 'o2', 0, 3000, 'build'), rng('c3', 'o3', 0, 3000, 'proof')];
    expect(isLoadBearingRange(all[0]!, all)).toBe(true);
    expect(isLoadBearingRange(all[2]!, all)).toBe(true);
    expect(isLoadBearingRange(all[1]!, all)).toBe(false);
  });
});
