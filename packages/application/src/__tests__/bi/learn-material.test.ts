/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { LearnBusinessService } from '../../bi/learn-business.use-case';
import { suppliedMaterialToObservations, bridgeFragmentsToObservations } from '../../bi/bridge';
import type { SynthesisOutput, UnderstandingModelInput } from '../../bi/contracts';
import type { EvidenceFragment } from '@bb/domain';

// Minimal in-memory deps: learnFromMaterial only exercises evidenceRepo + model + understanding + aha + clock.
function harness(synth: (input: UnderstandingModelInput) => SynthesisOutput) {
  const fragments: EvidenceFragment[] = [];
  const understandings: any[] = [];
  const ahas: any[] = [];
  let captured: UnderstandingModelInput | null = null;
  const noop = async () => { /* unused in this path */ };
  const deps: any = {
    evidenceRepo: { appendMany: async (f: EvidenceFragment[]) => { fragments.push(...f); return { stored: f.length, deduped: 0 }; }, append: noop, findByFounder: async () => [], findObserved: async () => [], deleteBySource: noop },
    ingestion: { ingest: noop },
    discovery: { discover: async () => [] },
    model: { synthesize: async (input: UnderstandingModelInput) => { captured = input; return synth(input); } },
    links: { bind: noop, listFragmentIds: async () => [] },
    profiles: { upsertMany: noop, list: async () => [], setStatus: noop },
    understanding: { save: async (i: any) => { const r = { ...i, createdAt: 't' }; understandings.push(r); return r; }, latest: async () => null },
    aha: { save: async (i: any) => { const r = { ...i, createdAt: 't' }; ahas.push(r); return r; }, latest: async () => null },
    website: { setWebsite: noop, setIngestion: noop },
    rawCaptures: { appendMany: noop, listByCorpus: async () => [] },
    observations: { appendMany: noop, listByCorpus: async () => [] },
    revisions: { bumpCorpus: noop },
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
  };
  const service = new LearnBusinessService(deps);
  return { service, fragments, understandings, ahas, captured: () => captured };
}

const groundedSynth = (input: UnderstandingModelInput): SynthesisOutput => ({
  sourceLanguage: 'en',
  understanding: {
    offer: { summary: 'Handmade sourdough, baked to order', explicit: ['sourdough loaves'], unclear: [], sourceRefs: [input.observations[0]!.ref] },
    positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] },
    audience: { addressed: ['local customers'], appearsTargeted: [], unknown: ['which loaf sells most'], sourceRefs: [input.observations[0]!.ref] },
    messaging: { recurringThemes: [], sourceRefs: [] },
    acquisition: { visiblePaths: [], sourceRefs: [] },
    contradictions: [],
    unknowns: ['what the founder wants to grow'],
  },
  aha: { status: 'produced', findings: [{ finding: 'You describe four bakes but not which one the business is built on.', implication: 'a distinct thread worth carrying into the founder conversation.', sourceRefs: [input.observations[0]!.ref] }] },
});

describe('Source-flexible entry — founder-supplied material (DECLARED evidence)', () => {
  const P = { businessId: 'B', founderId: 'f1', businessName: 'Acme Bakery', interfaceLanguage: 'en' };

  it('suppliedMaterialToObservations: declared provenance, synthetic URI, never a fetched page', () => {
    const obs = suppliedMaterialToObservations('We bake sourdough.\n\nWe sell at the Saturday market.');
    expect(obs).toHaveLength(2);
    expect(obs.every((o) => o.provenance === 'declared')).toBe(true);
    expect(obs.every((o) => o.url.startsWith('founder://supplied/'))).toBe(true);
    expect(obs.every((o) => o.pageType === 'founder_supplied')).toBe(true);
    expect(suppliedMaterialToObservations('   ')).toEqual([]);
  });

  it('website bridge observations are tagged provenance=observed (lane preserved)', () => {
    const frag: any = { id: 'x', founderId: 'f1', source: 'website', platform: 'acme.com', sourceUrl: 'https://acme.com/', confidenceKind: 'observed', payload: { text: 'Acme bakery homepage', title: 'Acme', pageType: 'home', lang: 'en' } };
    const obs = bridgeFragmentsToObservations([frag], 'acme.com');
    expect(obs[0]!.provenance).toBe('observed');
  });

  it('persists supplied material as DECLARED evidence (source=founder_supplied), never observed or a correction', async () => {
    const { service, fragments } = harness(groundedSynth);
    await service.learnFromMaterial({ ...P, material: 'We bake handmade sourdough to order for local customers.' });
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.every((f) => f.source === 'founder_supplied')).toBe(true);
    expect(fragments.every((f) => f.confidenceKind === 'declared')).toBe(true); // NOT 'observed'
    expect(fragments.every((f) => f.visibility === 'private')).toBe(true);
    expect(fragments.every((f) => (f.sourceUrl ?? '').startsWith('founder://supplied/'))).toBe(true);
    // never a website source, never a business_correction (this path only writes declared evidence)
    expect(fragments.some((f) => f.source === 'website')).toBe(false);
  });

  it('provenance is preserved into synthesis (the model receives declared observations)', async () => {
    const { service, captured } = harness(groundedSynth);
    await service.learnFromMaterial({ ...P, material: 'Sourdough, sold at the Saturday market.' });
    expect(captured()!.observations.every((o) => o.provenance === 'declared')).toBe(true);
  });

  it('a founder-supplied-only business reaches Understanding + a grounded Aha', async () => {
    const { service, understandings, ahas } = harness(groundedSynth);
    const r = await service.learnFromMaterial({ ...P, material: 'We bake handmade sourdough to order.' });
    expect(r.state).toBe('synced');
    expect(understandings).toHaveLength(1);
    expect(understandings[0]!.profileVersion).toBe('sources.offer_positioning_audience.v1'); // source-neutral, not website.*
    expect(r.aha.status).toBe('produced');
    expect(ahas[0]!.status).toBe('produced');
  });

  it('the anti-transplant/grounding gate stays active — a generic or ungrounded finding does NOT survive', async () => {
    const genericSynth = (input: UnderstandingModelInput): SynthesisOutput => ({
      ...groundedSynth(input),
      aha: { status: 'produced', findings: [
        { finding: 'You should post more and build trust with a stronger CTA.', implication: '', sourceRefs: [input.observations[0]!.ref] }, // transplantable + unlicensed
        { finding: 'This is a specific real observation about the bakes.', sourceRefs: ['no-such-ref'] }, // ungrounded
      ] },
    });
    const { service } = harness(genericSynth);
    const r = await service.learnFromMaterial({ ...P, material: 'We bake sourdough.' });
    expect(r.aha.status).toBe('insufficient'); // no unsupported claim manufactured to fill the Aha
    expect(r.aha.findings).toHaveLength(0);
  });

  it('empty material never calls synthesis and returns an honest empty state', async () => {
    let called = false;
    const { service } = harness((i) => { called = true; return groundedSynth(i); });
    const r = await service.learnFromMaterial({ ...P, material: '   ' });
    expect(r.state).toBe('empty');
    expect(called).toBe(false);
  });
});
