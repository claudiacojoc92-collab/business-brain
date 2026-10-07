/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { attachHookMedia, attachPlannedMedia } from '../../carousel/compose';
import type { Slide, CarouselSourceRef, AssetAuthorizationSnapshot, MediaPlanItem } from '../../carousel/contracts';
import {
  setSignal, observedTokens, hashOf, stableStringify, filterRenderable, validateObservationRefs,
  assessNonTransplantable, assessSufficiency,
} from '../../photocarousel/photoled';
import { PhotoLedService } from '../../photocarousel/photoled.service';
import type { MediaObservation, PhotoSetUnderstanding, OpportunityDraft, CarouselOpportunity, SelectedMediaItem } from '../../photocarousel/contracts';

const src = (id: string, over: Partial<CarouselSourceRef> = {}): CarouselSourceRef => ({ sourceRefId: id, sourceType: 'uploaded_image', provenance: 'founder upload', reuseRight: 'founder_uploaded', mediaRef: `media/${id}.png`, ...over });
const slide = (order: number, role: Slide['semanticRole']): Slide => ({ slideId: 's' + order, order, semanticRole: role, textBlocks: [{ blockId: 'b' + order, role: 'headline', text: 'x', authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null }, locked: false }], mediaSlots: [], layoutFamily: 'statement', layoutParams: {}, lockedFields: [], sourceRefIds: [] });
const snap = (sources: CarouselSourceRef[]): AssetAuthorizationSnapshot => ({ snapshotId: 'sn', businessId: 'B', createHandoffId: 'ch', strategyVersionId: 'sv', language: 'en', speakingRole: 'founder', audienceUseContext: 'aud', licensedPropositions: [], proofFacts: [], ctaFunction: 'book', ownedStances: [], sourceRefs: sources, modelId: null, safetyContractHash: null, producedAt: 't' });
const obs = (id: string, sourceRefId: string, over: Partial<MediaObservation> = {}): MediaObservation => ({ observationId: id, sourceRefId, verdict: 'observed', setting: 'gym', subject: 'scene', objects: ['dumbbell'], activity: null, containsText: false, orientation: 'portrait', hasClearSubject: true, usability: 'hero', ...over });
const photoSet = (observations: MediaObservation[]): PhotoSetUnderstanding => ({ photoSetUnderstandingId: 'ps1', businessId: 'B', observations, setSignal: setSignal(observations), modelId: 'm', contentHash: 'h', producedAt: 't' });

describe('Slice 6.1 — compose seam (attachPlannedMedia; frozen attachHookMedia untouched)', () => {
  const slides = [slide(0, 'hook'), slide(1, 'proof'), slide(2, 'cta')];

  it('empty plan falls back to the frozen attachHookMedia (same placement; only the fresh slotId differs)', () => {
    const s = snap([src('a')]);
    const norm = (arr: Slide[]) => JSON.stringify(arr, (k, v) => (k === 'slotId' ? '_' : v));
    expect(norm(attachPlannedMedia(slides, s, []))).toBe(norm(attachHookMedia(slides, s)));
  });

  it('honors role/order: hero → hook, supporting → next non-CTA slide', () => {
    const s = snap([src('a'), src('b')]);
    const plan: MediaPlanItem[] = [{ sourceRefId: 'b', role: 'supporting' }, { sourceRefId: 'a', role: 'hero' }];
    const out = attachPlannedMedia(slides, s, plan);
    expect(out[0]!.mediaSlots[0]?.sourceRefId).toBe('a'); // hero on hook
    expect(out[1]!.mediaSlots[0]?.sourceRefId).toBe('b'); // supporting on proof
    expect(out[2]!.mediaSlots).toHaveLength(0);           // never the CTA slide
  });

  it('RIGHTS DISPOSE: a reference_only / unknown / missing planned source is NOT rendered (defense-in-depth)', () => {
    const s = snap([src('a', { reuseRight: 'reference_only' }), src('c', { reuseRight: 'unknown' }), src('ok')]);
    const plan: MediaPlanItem[] = [{ sourceRefId: 'a', role: 'hero' }, { sourceRefId: 'c', role: 'supporting' }, { sourceRefId: 'missing', role: 'supporting' }, { sourceRefId: 'ok', role: 'supporting' }];
    const out = attachPlannedMedia(slides, s, plan);
    const rendered = out.flatMap((sl) => sl.mediaSlots.map((m) => m.sourceRefId));
    expect(rendered).toEqual(['ok']);                     // only the renderable one
    expect(rendered).not.toContain('a');
    expect(rendered).not.toContain('c');
    expect(rendered).not.toContain('missing');
  });

  it('brand_asset is never used as a slide photo even if planned', () => {
    const s = snap([src('logo', { sourceType: 'brand_asset' }), src('photo')]);
    const out = attachPlannedMedia(slides, s, [{ sourceRefId: 'logo', role: 'hero' }, { sourceRefId: 'photo', role: 'supporting' }]);
    expect(out.flatMap((sl) => sl.mediaSlots.map((m) => m.sourceRefId))).toEqual(['photo']);
  });
});

describe('Slice 6.1 — deterministic domain gates', () => {
  it('setSignal is a literal observed distribution', () => {
    expect(setSignal([obs('o1', 'a', { subject: 'prepared_dish' }), obs('o2', 'b', { subject: 'prepared_dish' }), obs('o3', 'c', { subject: 'scene', setting: 'gym' })])).toBe('2 prepared_dish, 1 gym scene');
  });

  it('filterRenderable drops non-renderable/brand/missing with reasons', () => {
    const sources = [src('ok'), src('ro', { reuseRight: 'reference_only' }), src('logo', { sourceType: 'brand_asset' })];
    const sel: SelectedMediaItem[] = [{ sourceRefId: 'ok', role: 'hero', observationRefs: [] }, { sourceRefId: 'ro', role: 'supporting', observationRefs: [] }, { sourceRefId: 'logo', role: 'supporting', observationRefs: [] }, { sourceRefId: 'gone', role: 'detail', observationRefs: [] }];
    const { kept, dropped } = filterRenderable(sel, sources);
    expect(kept.map((k) => k.sourceRefId)).toEqual(['ok']);
    expect(dropped.map((d) => d.sourceRefId).sort()).toEqual(['gone', 'logo', 'ro']);
  });

  it('validateObservationRefs rejects unknown ref and wrong-source ref', () => {
    const ps = photoSet([obs('o1', 'a'), obs('o2', 'b')]);
    expect(validateObservationRefs([{ sourceRefId: 'a', role: 'hero', observationRefs: ['o1'] }], ps).ok).toBe(true);
    expect(validateObservationRefs([{ sourceRefId: 'a', role: 'hero', observationRefs: ['zzz'] }], ps).ok).toBe(false);   // unknown
    expect(validateObservationRefs([{ sourceRefId: 'a', role: 'hero', observationRefs: ['o2'] }], ps).ok).toBe(false);   // o2 belongs to b
  });

  it('assessNonTransplantable fails a generic rec, passes a strategy+photo-specific one', () => {
    const strat = new Set(['finance', 'runway', 'founders']); const observed = new Set(['gym', 'dumbbell', 'meal']);
    const generic: OpportunityDraft = { communicationJob: 'post great content', ctaDirection: null, whyPhotosSupport: 'nice photos', strategicConnection: 'grow your brand online', nonTransplantabilityTrace: 'engaging posts', proposedConceptFamily: 'x', founderLegibleRecommendation: 'share a fun update with your community', selectedMedia: [], excludedMedia: [], missingMaterial: [] };
    expect(assessNonTransplantable(generic, 'Acme', strat, observed).ok).toBe(false);
    const specific: OpportunityDraft = { ...generic, founderLegibleRecommendation: 'turn your gym and meal photos into a runway-discipline routine for founders', strategicConnection: 'connects finance runway to daily founder discipline', nonTransplantabilityTrace: 'specific to gym+meal photos and the runway strategy' };
    expect(assessNonTransplantable(specific, 'Acme', strat, observed).ok).toBe(true);
  });

  it('assessSufficiency: no media → insufficient; no claim basis → insufficient; gap; sufficient', () => {
    const ps = photoSet([obs('o1', 'a', { usability: 'hero' })]);
    const kept: SelectedMediaItem[] = [{ sourceRefId: 'a', role: 'hero', observationRefs: ['o1'] }];
    expect(assessSufficiency([], ps, true, []).verdict).toBe('insufficient');
    expect(assessSufficiency(kept, ps, false, []).verdict).toBe('insufficient');
    expect(assessSufficiency(kept, ps, true, [{ what: 'a finished-dish photo', whyItHelps: 'stronger proof' }]).verdict).toBe('sufficient_with_gap');
    expect(assessSufficiency(kept, ps, true, []).verdict).toBe('sufficient');
  });

  it('hashOf is stable regardless of key order', () => {
    expect(hashOf({ a: 1, b: [2, { c: 3, d: 4 }] })).toBe(hashOf({ b: [2, { d: 4, c: 3 }], a: 1 }));
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('observedTokens are literal set facts', () => {
    const t = observedTokens(photoSet([obs('o1', 'a', { setting: 'kitchen', subject: 'prepared_dish', objects: ['plate', 'bowl'] })]));
    expect(t.has('kitchen')).toBe(true); expect(t.has('plate')).toBe(true);
  });
});

// ── PhotoLedService: 1:1 handoff, accept validation, insufficient block ──
function makeSvc(over: { opportunity?: CarouselOpportunity; photoSet?: PhotoSetUnderstanding }) {
  const saved: { opps: CarouselOpportunity[]; contexts: any[]; sets: PhotoSetUnderstanding[] } = { opps: [], contexts: [], sets: [] };
  const repo = {
    savePhotoSetUnderstanding: async (x: PhotoSetUnderstanding) => { saved.sets.push(x); },
    getPhotoSetUnderstanding: async (_b: string, id: string) => saved.sets.find((s) => s.photoSetUnderstandingId === id) ?? over.photoSet ?? null,
    saveOpportunity: async (x: CarouselOpportunity) => { saved.opps.push(x); },
    getOpportunity: async (_b: string, id: string) => saved.opps.find((o) => o.opportunityId === id) ?? over.opportunity ?? null,
    savePhotoLedContext: async (x: any) => { if (saved.contexts.some((c) => c.createHandoffId === x.createHandoffId)) throw new Error('1:1 violated'); saved.contexts.push(x); },
    getPhotoLedContextByHandoff: async (_b: string, h: string) => saved.contexts.find((c) => c.createHandoffId === h) ?? null,
  };
  let emitted = 0;
  const svc = new PhotoLedService({
    observationModel: { observe: async () => [] },
    opportunityModel: { recommend: async () => ({} as OpportunityDraft) },
    repo: repo as any,
    context: async () => ({ strategyVersionId: 'sv', language: 'en', goal: 'g', coreBet: 'c', audience: 'a', ctaDirection: 'book', licensedPropositions: [{ ref: 'P', text: 't', source: 'business_evidence' }], proofFacts: [], ownedStances: [], sourceRefs: [], brand: { brandContextVersion: 'v', mode: 'restrained_default' }, voiceLines: [], speakingRole: 'founder' } as any),
    businessName: async () => 'Acme',
    currentPlan: async () => ({ planVersionId: 'pv', actionId: null }),
    emitHandoff: async () => { emitted += 1; return { createHandoffId: 'ch_' + emitted }; },
    clock: () => 't',
  });
  return { svc, saved, emitted: () => emitted };
}
const opp = (over: Partial<CarouselOpportunity> = {}): CarouselOpportunity => ({ opportunityId: 'op1', businessId: 'B', photoSetUnderstandingId: 'ps1', origin: 'strategic_opportunity', strategyVersionId: 'sv', planVersionId: 'pv', actionId: null, communicationJob: 'job', ctaDirection: 'book', whyPhotosSupport: 'w', strategicConnection: 's', nonTransplantabilityTrace: 'n', proposedConceptFamily: 'proof_statement', usableMediaSubset: [{ sourceRefId: 'a', role: 'hero', observationRefs: ['o1'] }], excludedMedia: [], sufficiency: 'sufficient', missingMaterial: [], founderLegibleRecommendation: 'rec', alternativeAvailable: true, modelId: 'm', producedAt: 't', ...over });

describe('Slice 6.1 — PhotoLedService accept (1:1 handoff, strict ref validation, insufficient block)', () => {
  it('accepts a sufficient opportunity → emits handoff + persists a 1:1 PhotoLedCarouselContext', async () => {
    const { svc, saved } = makeSvc({ opportunity: opp(), photoSet: photoSet([obs('o1', 'a')]) });
    const r = await svc.accept('B', 'op1');
    expect(r.status).toBe('accepted'); if (r.status !== 'accepted') return;
    expect(saved.contexts).toHaveLength(1);
    expect(saved.contexts[0].createHandoffId).toBe(r.createHandoffId);
    expect(saved.contexts[0].selectedMedia[0].sourceRefId).toBe('a');
    expect(typeof saved.contexts[0].contentHash).toBe('string');
    expect(saved.contexts[0].strategyTrace.strategyVersionId).toBe('sv');
  });

  it('rejects accept of an insufficient opportunity (no handoff, no context)', async () => {
    const { svc, saved } = makeSvc({ opportunity: opp({ sufficiency: 'insufficient' }), photoSet: photoSet([obs('o1', 'a')]) });
    expect((await svc.accept('B', 'op1')).status).toBe('insufficient');
    expect(saved.contexts).toHaveLength(0);
  });

  it('rejects accept when a selected observation ref does not belong to the source (§5)', async () => {
    const { svc, saved } = makeSvc({ opportunity: opp({ usableMediaSubset: [{ sourceRefId: 'a', role: 'hero', observationRefs: ['o2'] }] }), photoSet: photoSet([obs('o1', 'a'), obs('o2', 'b')]) });
    const r = await svc.accept('B', 'op1');
    expect(r.status).toBe('invalid');
    expect(saved.contexts).toHaveLength(0);
  });
});
