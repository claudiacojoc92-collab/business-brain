/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { LearnBusinessService } from '../../bi/learn-business.use-case';
import type { SynthesisOutput, UnderstandingModelInput } from '../../bi/contracts';
import { makeFragment, type EvidenceFragment } from '@bb/domain';

// DAY ONE multi-source pour-in: each source is ingested as business-bound evidence WITHOUT synthesizing; the
// bridge fires ONCE on "Done adding — start" over the UNION of every source. This harness is stateful so the
// bridge can read back everything the founder poured in (evidenceRepo + links accumulate).
function harness(synth: (input: UnderstandingModelInput) => SynthesisOutput) {
  const fragments: EvidenceFragment[] = [];
  const bound: string[] = [];
  const understandings: any[] = [];
  let captured: UnderstandingModelInput | null = null;
  const noop = async () => { /* unused */ };
  const deps: any = {
    evidenceRepo: {
      appendMany: async (f: EvidenceFragment[]) => { fragments.push(...f); return { stored: f.length, deduped: 0 }; },
      append: noop,
      findByFounder: async () => fragments,
      findObserved: async (_fid: string, source?: string) => fragments.filter((f) => !source || f.source === source),
      deleteBySource: noop,
    },
    // Mimics the real website ingestion adapter: appends one observed website PAGE fragment to the store.
    ingestion: {
      ingest: async (founderId: string, url: string) => {
        const host = new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, '');
        fragments.push(makeFragment({
          founderId, source: 'website', platform: host, sourceUrl: `https://${host}/`,
          confidenceKind: 'observed', visibility: 'public', occurredAt: null,
          payload: { text: 'Physio memberships for post-op recovery in Cluj.', title: 'Body Move', pageType: 'home', lang: 'en' },
        }));
        return { state: 'synced', url, pagesRead: 1, fragmentsStored: 1, gaps: [] };
      },
    },
    discovery: { discover: async () => [] },
    model: { synthesize: async (input: UnderstandingModelInput) => { captured = input; return synth(input); } },
    links: {
      bind: async (_b: string, links: { fragmentId: string; source: string }[]) => { bound.push(...links.map((l) => l.fragmentId)); return { linked: links.length }; },
      listFragmentIds: async () => bound,
    },
    profiles: { upsertMany: noop, list: async () => [], setStatus: noop },
    understanding: { save: async (i: any) => { const r = { ...i, createdAt: 't' }; understandings.push(r); return r; }, latest: async () => null },
    aha: { save: async (i: any) => ({ ...i, createdAt: 't' }), latest: async () => null },
    website: { setWebsite: noop, setIngestion: noop },
    rawCaptures: { appendMany: noop, listByCorpus: async () => [] },
    observations: { appendMany: noop, listByCorpus: async () => [] },
    revisions: { bumpCorpus: noop },
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
  };
  return { service: new LearnBusinessService(deps), fragments, understandings, captured: () => captured };
}

// Grounded, well-formed, non-transplantable synthesis that cites the union's own refs.
const groundedSynth = (input: UnderstandingModelInput): SynthesisOutput => ({
  sourceLanguage: 'en',
  understanding: {
    offer: { summary: 'Physio memberships for post-op recovery', explicit: ['physio memberships'], unclear: [], sourceRefs: [input.observations[0]!.ref] },
    positioning: { summary: 'recovery-led', evidenceBacked: [input.observations[0]!.ref], implied: [], sourceRefs: [input.observations[0]!.ref] },
    audience: { addressed: ['post-op patients'], appearsTargeted: [], unknown: ['corporate partnerships'], sourceRefs: [input.observations[0]!.ref] },
    messaging: { recurringThemes: ['recovery'], sourceRefs: [input.observations[0]!.ref] },
    acquisition: { visiblePaths: [], sourceRefs: [] },
    contradictions: [],
    unknowns: ['which channel drives the most members'],
  },
  aha: { status: 'produced', findings: [{ finding: 'Your site leads with recovery but your brochure leads with classes — two different front doors.', implication: 'worth resolving before outreach.', sourceRefs: [input.observations[0]!.ref] }] },
});

const P = { businessId: 'B', founderId: 'f1', businessName: 'Body Move', interfaceLanguage: 'en' };

describe('Day One multi-source pour-in — ingest per source, synthesize ONCE over the union', () => {
  it('ingestTextForPourIn (declared) persists private DECLARED fragments and binds them to the business', async () => {
    const { service, fragments } = harness(groundedSynth);
    const r = await service.ingestTextForPourIn({ businessId: 'B', founderId: 'f1', source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'Brochure', url: 'founder://file/brochure/1', text: 'Post-op rehab classes and memberships.', pageType: 'founder_supplied' }] });
    expect(r.stored).toBe(1);
    expect(fragments[0]!.confidenceKind).toBe('declared');
    expect(fragments[0]!.visibility).toBe('private');
  });

  it('ingestTextForPourIn (observed) persists public OBSERVED fragments (Instagram = same lane as the website)', async () => {
    const { service, fragments } = harness(groundedSynth);
    const r = await service.ingestTextForPourIn({ businessId: 'B', founderId: 'f1', source: 'instagram', provenance: 'observed', items: [{ ref: 'Instagram post 1', url: 'https://instagram.com/bodymove/p/1', text: 'Recovery is a practice, not an event.', pageType: 'instagram_post' }] });
    expect(r.stored).toBe(1);
    expect(fragments[0]!.confidenceKind).toBe('observed');
    expect(fragments[0]!.visibility).toBe('public');
    expect(fragments[0]!.source).toBe('instagram');
  });

  it('an item with empty text or empty url is not stored (no hollow evidence)', async () => {
    const { service } = harness(groundedSynth);
    const r = await service.ingestTextForPourIn({ businessId: 'B', founderId: 'f1', source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'x', url: '', text: 'has text but no url' }, { ref: 'y', url: 'founder://file/x/1', text: '   ' }] as any });
    expect(r.stored).toBe(0);
  });

  it('bridgePourIn synthesizes ONE snapshot over website + PDF + Instagram, provenance preserved per source', async () => {
    const { service, captured, understandings } = harness(groundedSynth);
    // Pour in three sources of three types (order arbitrary), each ingest-only (no synthesis yet).
    await service.ingestWebsiteForPourIn({ businessId: 'B', founderId: 'f1', url: 'www.bodymovestudio.ro' });
    await service.ingestTextForPourIn({ businessId: 'B', founderId: 'f1', source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'Brochure', url: 'founder://file/brochure/1', text: 'Our brochure: post-op rehab classes.', pageType: 'founder_supplied' }] });
    await service.ingestTextForPourIn({ businessId: 'B', founderId: 'f1', source: 'instagram', provenance: 'observed', items: [{ ref: 'Instagram post 1', url: 'https://instagram.com/bodymove/p/1', text: 'Recovery is a practice.', pageType: 'instagram_post' }] });
    expect(captured()).toBeNull(); // NOTHING synthesized during the pour-in

    const r = await service.bridgePourIn(P);
    expect(r.state).toBe('synced');
    const obs = captured()!.observations;
    // The strategist reads the COMPLETE business: all three sources reach the ONE synthesis.
    const texts = obs.map((o) => o.text).join(' | ');
    expect(texts).toContain('Physio memberships'); // website
    expect(texts).toContain('brochure');           // PDF (declared)
    expect(texts).toContain('Recovery is a practice'); // Instagram (observed)
    // Provenance preserved end-to-end: website + Instagram observed, brochure declared.
    expect(obs.some((o) => o.provenance === 'observed')).toBe(true);
    expect(obs.some((o) => o.provenance === 'declared')).toBe(true);
    // One snapshot; declared present ⇒ the source-neutral profile version (never a website-only reinterpretation).
    expect(understandings).toHaveLength(1);
    expect(understandings[0]!.profileVersion).toBe('sources.offer_positioning_audience.v1');
  });

  it('a website-only pour-in stays on the website profile version (no declared source present)', async () => {
    const { service, understandings } = harness(groundedSynth);
    await service.ingestWebsiteForPourIn({ businessId: 'B', founderId: 'f1', url: 'www.bodymovestudio.ro' });
    const r = await service.bridgePourIn(P);
    expect(r.state).toBe('synced');
    expect(understandings[0]!.profileVersion).toBe('website.offer_positioning_audience.v1');
  });

  it('bridgePourIn with nothing poured in returns empty and never calls synthesis', async () => {
    const { service, captured } = harness(groundedSynth);
    const r = await service.bridgePourIn(P);
    expect(r.state).toBe('empty');
    expect(captured()).toBeNull();
  });
});
