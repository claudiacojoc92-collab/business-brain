import { describe, it, expect } from 'vitest';
import type {
  EvidenceFragment,
  IEvidenceRepository,
  NormalizedObservation,
  RawCapture,
  CorpusRevision,
} from '@bb/domain';
import {
  LearnBusinessService,
  type LearnBusinessDeps,
  type SynthesisOutput,
  type WebsiteIngestionResult,
  type DiscoveredProfileInput,
  type DiscoveredProfile,
  type SaveUnderstandingInput,
  type UnderstandingSnapshotRecord,
  type SaveAhaInput,
  type AhaRecord,
} from '../../bi/index';

function pageFrag(url: string, text: string): EvidenceFragment {
  return {
    id: 'frag-' + url,
    founderId: 'F',
    source: 'website',
    platform: 'acme.com',
    sourceUrl: url,
    confidenceKind: 'observed',
    occurredAt: null,
    capturedAt: new Date(0),
    visibility: 'public',
    payload: { text, pageType: 'home', title: 'Acme' },
    derivedFrom: null,
  } as EvidenceFragment;
}

const GROUNDED_SYNTH: SynthesisOutput = {
  understanding: {
    offer: { summary: 'Custom builds', explicit: ['custom'], unclear: ['price'], sourceRefs: ['Homepage'] },
    positioning: { summary: 'premium', evidenceBacked: [], implied: ['premium'], sourceRefs: ['Homepage'] },
    audience: { addressed: ['teams'], appearsTargeted: [], unknown: [], sourceRefs: ['Homepage'] },
    messaging: { recurringThemes: ['craft'], sourceRefs: ['Homepage'] },
    acquisition: { visiblePaths: ['contact'], sourceRefs: ['Homepage'] },
    contradictions: [],
    unknowns: ['pricing'],
  },
  aha: {
    status: 'produced',
    findings: [{ finding: 'The homepage leads with custom builds but never shows a price.', sourceRefs: ['Homepage'] }],
  },
};

function makeDeps(over: {
  fragments?: EvidenceFragment[];
  ingestion?: WebsiteIngestionResult;
  synth?: SynthesisOutput;
  discovered?: DiscoveredProfileInput[];
}): { deps: LearnBusinessDeps; bindCalls: string[][]; savedUnderstanding: SaveUnderstandingInput[]; synthCalls: number } {
  const fragments = over.fragments ?? [pageFrag('https://acme.com/', 'Custom builds for teams. Contact us.')];
  const bindCalls: string[][] = [];
  const savedUnderstanding: SaveUnderstandingInput[] = [];
  const ledgerObs: NormalizedObservation[] = [];
  const boundSet = new Set<string>();
  const profileStore: DiscoveredProfile[] = [];
  let synthCalls = 0;

  const evidenceRepo: IEvidenceRepository = {
    append: async () => ({ stored: true }),
    appendMany: async () => ({ stored: 0, deduped: 0 }),
    findByFounder: async () => fragments,
    findObserved: async () => fragments,
    deleteBySource: async () => undefined,
  };

  const deps: LearnBusinessDeps = {
    evidenceRepo,
    ingestion: { ingest: async () => over.ingestion ?? { state: 'synced', url: 'https://acme.com', pagesRead: fragments.length, fragmentsStored: fragments.length, gaps: [] } },
    discovery: { discover: async () => over.discovered ?? [] },
    model: { synthesize: async () => { synthCalls += 1; return over.synth ?? GROUNDED_SYNTH; } },
    links: {
      bind: async (_b, links) => {
        bindCalls.push(links.map((l) => l.fragmentId));
        let linked = 0;
        for (const l of links) if (!boundSet.has(l.fragmentId)) { boundSet.add(l.fragmentId); linked += 1; }
        return { linked };
      },
      listFragmentIds: async () => Array.from(boundSet),
    },
    profiles: {
      upsertMany: async (_b, ps) => { for (const p of ps) if (!profileStore.some((x) => x.url === p.url)) profileStore.push({ id: 'dp-' + p.url, platform: p.platform, url: p.url, status: 'discovered' }); },
      list: async () => profileStore,
      setStatus: async () => null,
    },
    understanding: {
      save: async (input: SaveUnderstandingInput): Promise<UnderstandingSnapshotRecord> => { savedUnderstanding.push(input); return { ...input, createdAt: '1970-01-01T00:00:00Z' }; },
      latest: async () => null,
    },
    aha: {
      save: async (input: SaveAhaInput): Promise<AhaRecord> => ({ id: input.id, businessId: input.businessId, understandingSnapshotId: input.understandingSnapshotId, language: input.language, status: input.status, findings: input.findings, modelId: input.modelId, createdAt: '1970-01-01T00:00:00Z' }),
      latest: async () => null,
    },
    website: { setWebsite: async () => undefined, setIngestion: async () => undefined },
    // In-memory canonical ledger: appended web observations are read back for synthesis.
    rawCaptures: {
      appendMany: async (_ref, _caps: readonly RawCapture[]) => undefined,
      getByIds: async () => [],
    },
    observations: {
      appendMany: async (_ref, obs: readonly NormalizedObservation[]) => { ledgerObs.push(...obs); },
      listByCorpus: async () => ledgerObs,
    },
    revisions: {
      currentCorpus: async () => 'corpus-0',
      currentUnderstandingCtx: async () => 'uctx-0',
      bumpCorpus: async (_ref, rev: CorpusRevision) => rev.id,
      bumpUnderstandingCtx: async () => 'uctx-0',
    },
    clock: { now: () => '1970-01-01T00:00:00.000Z' },
  };
  return { deps, bindCalls, savedUnderstanding, synthCalls };
}

const P = { businessId: 'B', founderId: 'F', businessName: 'Acme', url: 'https://acme.com', interfaceLanguage: 'en' };

describe('LearnBusinessService', () => {
  it('happy path: binds fragments, synthesizes, persists understanding + grounded Aha', async () => {
    const { deps, bindCalls, savedUnderstanding } = makeDeps({});
    const r = await new LearnBusinessService(deps).learn(P);
    expect(r.state).toBe('synced');
    expect(r.aha.status).toBe('produced');
    expect(r.aha.findings).toHaveLength(1);
    expect(bindCalls[0]).toEqual(['frag-https://acme.com/']); // bound the immutable fragment (by id)
    expect(savedUnderstanding).toHaveLength(1);
  });

  it('unreachable site → failed, synthesis never called', async () => {
    const probe = makeDeps({ ingestion: { state: 'failed', url: 'https://acme.com', pagesRead: 0, fragmentsStored: 0, gaps: [], error: 'unreachable' } });
    const r = await new LearnBusinessService(probe.deps).learn(P);
    expect(r.state).toBe('failed');
    expect(r.error).toBe('unreachable');
    expect(probe.synthCalls).toBe(0);
  });

  it('no readable pages → aha insufficient, synthesis never called', async () => {
    const probe = makeDeps({ fragments: [] });
    const r = await new LearnBusinessService(probe.deps).learn(P);
    expect(r.aha.status).toBe('insufficient');
    expect(probe.synthCalls).toBe(0);
  });

  it('generic synthesis is rejected by the gate → insufficient (no filler)', async () => {
    const genericSynth: SynthesisOutput = {
      ...GROUNDED_SYNTH,
      aha: { status: 'produced', findings: [{ finding: 'You should post more and improve your SEO.', sourceRefs: ['Homepage'] }] },
    };
    const { deps } = makeDeps({ synth: genericSynth });
    const r = await new LearnBusinessService(deps).learn(P);
    expect(r.aha.status).toBe('insufficient');
  });

  it('binding is idempotent across re-runs', async () => {
    const probe = makeDeps({});
    const svc = new LearnBusinessService(probe.deps);
    await svc.learn(P);
    await svc.learn(P);
    expect(probe.bindCalls).toHaveLength(2);
    // Second run links nothing new (idempotent) — boundSet already has the fragment.
  });

  it('discovered profiles are recorded as discovered, never ingested', async () => {
    const { deps } = makeDeps({ discovered: [{ platform: 'instagram', url: 'https://instagram.com/acme', discoveredFromUrl: 'https://acme.com' }] });
    const r = await new LearnBusinessService(deps).learn(P);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0]?.status).toBe('discovered');
  });
});
