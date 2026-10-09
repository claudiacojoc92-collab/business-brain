/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { LearnBusinessService, type UnderstandingModelInput, type SynthesisOutput } from '@bb/application';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import { buildSourcesBlock, selectSources } from './anthropic-understanding.model';

// End-to-end over the REAL pour-in bridge + the REAL sources block the model receives: a website with 12 pages,
// a pasted link, an uploaded PDF and an Instagram account with 50 posts. Before this fix the model read only the
// first 10 sources of the union (website first), so links, files and every Instagram post were silently dropped.
function harness() {
  const fragments: EvidenceFragment[] = [];
  const bound: string[] = [];
  let captured: UnderstandingModelInput | null = null;
  const noop = async () => { /* unused */ };
  const synth = (input: UnderstandingModelInput): SynthesisOutput => {
    const ref = input.observations[0]!.ref;
    return {
      sourceLanguage: 'en',
      understanding: {
        offer: { summary: 's', explicit: [], unclear: [], sourceRefs: [ref] }, positioning: { summary: 's', evidenceBacked: [ref], implied: [], sourceRefs: [ref] },
        audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [ref] }, messaging: { recurringThemes: [], sourceRefs: [ref] },
        acquisition: { visiblePaths: [], sourceRefs: [] }, contradictions: [], unknowns: [],
      },
      aha: { status: 'insufficient', findings: [] },
    } as unknown as SynthesisOutput;
  };
  const deps: any = {
    evidenceRepo: { appendMany: async (f: EvidenceFragment[]) => { fragments.push(...f); return { stored: f.length, deduped: 0 }; }, append: noop, findByFounder: async () => fragments, findObserved: async () => fragments, deleteBySource: noop },
    discovery: { discover: async () => [] },
    model: { synthesize: async (input: UnderstandingModelInput) => { captured = input; return synth(input); } },
    links: { bind: async (_b: string, l: { fragmentId: string }[]) => { bound.push(...l.map((x) => x.fragmentId)); return { linked: l.length }; }, listFragmentIds: async () => bound },
    profiles: { upsertMany: noop, list: async () => [], setStatus: noop },
    understanding: { save: async (i: any) => ({ ...i, createdAt: 't' }), latest: async () => null },
    aha: { save: async (i: any) => ({ ...i, createdAt: 't' }), latest: async () => null },
    website: { setWebsite: noop, setIngestion: noop },
    rawCaptures: { appendMany: noop, listByCorpus: async () => [] }, observations: { appendMany: noop, listByCorpus: async () => [] },
    revisions: { bumpCorpus: noop }, clock: { now: () => new Date('2026-10-09T00:00:00Z') },
  };
  const service = new LearnBusinessService(deps);
  const website = (n: number) => {
    for (let i = 0; i < n; i += 1) {
      const f = makeFragment({ founderId: 'f1', source: 'website', platform: 'bodymovestudio.ro', sourceUrl: `https://bodymovestudio.ro/p${i}`, confidenceKind: 'observed', visibility: 'public', occurredAt: null,
        payload: { text: `Website page ${i}: physio memberships in Cluj.`, title: `Page ${i}`, pageType: i === 0 ? 'home' : 'page', lang: 'en' } });
      fragments.push(f); bound.push(f.id);
    }
  };
  return { service, website, captured: () => captured };
}

const P = { businessId: 'B', founderId: 'f1', businessName: 'Body Move', interfaceLanguage: 'en' };

async function pourIn(posts: number) {
  const h = harness();
  h.website(12);
  await h.service.ingestTextForPourIn({ ...P, source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'A pasted link', url: 'https://press.example/bodymove', text: 'Press piece: Body Move opens a second studio.', pageType: 'founder_supplied' }] });
  await h.service.ingestTextForPourIn({ ...P, source: 'founder_supplied', provenance: 'declared', items: [{ ref: 'brochure.pdf', url: 'founder://file/brochure.pdf', text: 'Brochure: 12-week post-op programme, 89 EUR/month.', pageType: 'founder_supplied' }] });
  // Exactly what the arc Instagram route stores: one profile item + one item per post, with structured meta.
  await h.service.ingestTextForPourIn({ ...P, source: 'instagram', provenance: 'observed', items: [
    { ref: 'Instagram (@bodymove)', url: 'https://instagram.com/bodymove', text: 'Instagram @bodymove. 1200 followers. 379 posts. Account type: MEDIA_CREATOR.', pageType: 'instagram_profile',
      meta: { username: 'bodymove', followersCount: 1200, mediaCount: 379, accountType: 'MEDIA_CREATOR' } },
    ...Array.from({ length: posts }, (_, i) => {
      const caption = `IG caption ${i}: ${i % 2 ? 'knee rehab class' : 'Pilates for back pain'} with our team.`;
      return { ref: `Instagram post ${i + 1}`, url: `https://instagram.com/p/m${i}`, text: `${caption}\n(${40 - (i % 40)} likes, 3 comments, reach 120)`, pageType: 'instagram_post',
        meta: { caption, postedAt: new Date(Date.UTC(2026, 9, 8) - i * 86400000).toISOString(), likes: 40 - (i % 40), comments: 3 } };
    }),
  ] });
  const r = await h.service.bridgePourIn(P);
  expect(r.state).toBe('synced');
  return h.captured()!;
}

describe('pour-in → understanding sources: website capped, every other source always read', () => {
  it('Instagram reaches the model as ONE source with captions from all 50 posts; website, link and file are still there', async () => {
    const input = await pourIn(50);
    const ig = input.observations.filter((o) => o.sourceKind === 'instagram');
    expect(ig).toHaveLength(1);                                                   // 50 posts → one source, not 50
    const block = buildSourcesBlock(input.observations);
    for (const i of [0, 1, 25, 49]) expect(block).toContain(`IG caption ${i}:`); // newest … 50th post
    expect(block).toContain('### OBSERVED-INSTAGRAM ref="Instagram (@bodymove)"');
    expect(block).not.toMatch(/reach 120/);                                     // per-post reach left out
    expect(block).toContain('Website page 0:');                                  // website still there…
    expect(block.match(/### OBSERVED-PAGE/g)).toHaveLength(8);                   // …capped at 8 pages with other sources
    expect(block).toContain('Press piece: Body Move opens a second studio.');   // link
    expect(block).toContain('Brochure: 12-week post-op programme');             // file
    expect(selectSources(input.observations)).toHaveLength(8 + 3);
  });

  it('website-only keeps the old 10-page budget', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({ ref: `P${i}`, url: `https://x/${i}`, pageType: 'page', title: null, text: `page ${i}`, lang: null, provenance: 'observed' as const }));
    expect(selectSources(pages)).toHaveLength(10);
  });
});
