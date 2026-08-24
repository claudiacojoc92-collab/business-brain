import { describe, it, expect } from 'vitest';
import { ReelService } from '../../reel/reel.service';
import { edlHash } from '../../reel/reel';
import type {
  IReelRepository, IReelRenderPort, IObjectStore, IVideoObservationModelPort, IReelOpportunityModelPort, ITranscriptionPort,
  ReelContextView, VideoObservationInput, ClipObservation, ReelOpportunityInput, ReelOpportunityDraft, ClipTranscript, ProbeResult, ReelRenderInput, ReelRenderOutput,
} from '../../reel/contracts';
import type { PropositionCheckInput, PropositionCheckOutput } from '../../voice/contracts';

// ── in-memory repo ──
function memRepo(): IReelRepository & { _rendersOf: (v: string) => ReelRenderInput | undefined } {
  const m = { vsu: new Map<string, unknown>(), tr: new Map<string, unknown>(), opp: new Map<string, unknown>(), snap: new Map<string, unknown>(), asset: new Map<string, unknown>(), ver: new Map<string, unknown>(), rnd: new Map<string, unknown>(), src: new Map<string, unknown[]>(), job: new Map<string, unknown>(), trace: [] as unknown[], rev: [] as unknown[] };
  const k = (b: string, i: string) => `${b}::${i}`;
  return {
    _rendersOf: () => undefined,
    saveVideoSetUnderstanding: async (x) => void m.vsu.set(k(x.businessId, x.videoSetUnderstandingId), x),
    getVideoSetUnderstanding: async (b, i) => (m.vsu.get(k(b, i)) as never) ?? null,
    saveTranscript: async (x) => void m.tr.set(x.transcriptId, x),
    getTranscript: async (i) => (m.tr.get(i) as never) ?? null,
    saveOpportunity: async (x) => void m.opp.set(k(x.businessId, x.opportunityId), x),
    getOpportunity: async (b, i) => (m.opp.get(k(b, i)) as never) ?? null,
    saveAuthorizationSnapshot: async (x) => void m.snap.set(k(x.businessId, x.snapshotId), x),
    getAuthorizationSnapshot: async (b, i) => (m.snap.get(k(b, i)) as never) ?? null,
    saveAsset: async (x) => void m.asset.set(k(x.businessId, x.assetId), x),
    getAsset: async (b, i) => (m.asset.get(k(b, i)) as never) ?? null,
    setCurrentVersion: async (a, v) => { for (const [key, as] of m.asset) { const o = as as { assetId: string; businessId: string }; if (o.assetId === a) m.asset.set(key, { ...o, currentVersionId: v }); } },
    saveVersion: async (x) => void m.ver.set(k(x.businessId, x.versionId), x),
    getVersion: async (b, i) => (m.ver.get(k(b, i)) as never) ?? null,
    saveRender: async (x) => void m.rnd.set(x.versionId, x),
    getRender: async (v) => (m.rnd.get(v) as never) ?? null,
    recordRevision: async (e) => void m.rev.push(e),
    saveSafetyTrace: async (x) => void m.trace.push(x),
    saveSource: async (b, s) => void m.src.set(k(b, s.uploadSetId), [...(m.src.get(k(b, s.uploadSetId)) ?? []), s]),
    listSources: async (b, u) => (m.src.get(k(b, u)) as never) ?? [],
    saveJob: async (x) => void m.job.set(k(x.businessId, x.jobId), x),
    getJob: async (b, i) => (m.job.get(k(b, i)) as never) ?? null,
  };
}
function memStore(): IObjectStore { const m = new Map<string, Buffer>(); return {
  presignPut: async (key) => ({ url: 'x', method: 'PUT', objectKey: key }),
  head: async (key) => ({ exists: m.has(key), bytes: m.get(key)?.length }),
  getStream: async () => null, getToFile: async (key) => m.has(key), getToBuffer: async (key) => m.get(key) ?? null,
  put: async (key, bytes) => void m.set(key, bytes), delete: async (key) => void m.delete(key),
}; }
class FakeRender implements IReelRenderPort {
  lastSources: string[] = [];
  rendererVersion() { return 'fake-render'; }
  async ffmpegBuild() { return 'ffmpeg-fake'; }
  async probe(): Promise<ProbeResult> { return { durationMs: 6000, width: 1080, height: 1920, fps: 30, codec: 'h264', container: 'mp4', rotationDegrees: 0, hasAudio: true, audioCodec: 'aac' }; }
  async sampleFrames() { return []; }
  async render(input: ReelRenderInput): Promise<ReelRenderOutput> {
    this.lastSources = Object.keys(input.sourceFiles);
    return { mp4: Buffer.from('MP4'), poster: Buffer.from('JPG'), widthPx: 1080, heightPx: 1920, durationMs: input.timeline.totalDurationMs, edlHash: edlHash(input.timeline, input.textBlocks), ffmpegBuild: 'ffmpeg-fake', rendererVersion: 'fake-render', renderParams: {} };
  }
}
const clip = (sourceRefId: string, over: Partial<ClipObservation> = {}): Omit<ClipObservation, 'observationId' | 'transcriptRef'> => ({
  sourceRefId, durationMs: 6000, width: 1080, height: 1920, orientation: 'portrait', fps: 30, codec: 'h264', container: 'mp4', rotationDegrees: 0, hasAudio: true, audioCodec: 'aac',
  setting: 'gym', subject: 'dumbbells', objects: ['dumbbell'], activity: 'training', shot: 'b_roll', shotScale: 'medium', motion: 'static', motionIntensity: 'low', faceBoxes: [], focalSubjectBox: null,
  usableSpans: [{ startMs: 200, endMs: 5800, reason: 'x' }], rejectedSpans: [], speechPresent: false, audioKind: 'ambient', verdict: 'observed', ...over,
});
class FakeObs implements IVideoObservationModelPort {
  constructor(private readonly clips: Record<string, Partial<ClipObservation>>) {}
  descriptor() { return { modelId: 'fake-obs' }; }
  async observe(inputs: VideoObservationInput[]) { return inputs.map((i) => clip(i.sourceRefId, this.clips[i.sourceRefId] ?? {})); }
}
class FakeOpp implements IReelOpportunityModelPort {
  constructor(private readonly build: (i: ReelOpportunityInput) => ReelOpportunityDraft) {}
  descriptor() { return { modelId: 'fake-opp' }; }
  async recommend(i: ReelOpportunityInput) { return this.build(i); }
}
class FakeTr implements ITranscriptionPort {
  constructor(private readonly scripts: Record<string, { text: string }>) {}
  capabilities() { return { languages: 'auto' as const, wordTimestamps: true, confidence: true }; }
  supports() { return 'yes' as const; }
  descriptor() { return { providerId: 'fake', modelId: 'd' }; }
  async transcribe(i: { sourceRefId: string }): Promise<ClipTranscript> {
    const s = this.scripts[i.sourceRefId];
    return s ? { transcriptId: 't_' + i.sourceRefId, sourceRefId: i.sourceRefId, detectedLanguage: 'en', segments: [{ startMs: 0, endMs: 5000, text: s.text, spokenLanguage: 'en', confidence: 0.95 }], status: 'transcribed', providerId: 'fake', modelId: 'd' }
      : { transcriptId: 't0', sourceRefId: i.sourceRefId, detectedLanguage: 'en', segments: [], status: 'no_intelligible_speech', providerId: 'fake', modelId: 'd' };
  }
}
// judge that flags any clause containing "burns fat" as a new (unauthorized) proposition
const flagBurnsFat = async (input: PropositionCheckInput): Promise<PropositionCheckOutput> => {
  const text = JSON.stringify(input).toLowerCase();
  return { newPropositions: /burns fat/.test(text) ? [{ clause: 'burns fat faster', proposition: 'health outcome', reason: 'unlicensed health claim' }] : [] } as PropositionCheckOutput;
};
const ctx = (sourceRefs: { sourceRefId: string; reuseRight: 'founder_uploaded' | 'reference_only' }[]): ReelContextView => ({
  strategyVersionId: 'sv1', language: 'en', goal: 'sustainable fitness coaching', coreBet: 'consistency over extremes', audience: 'busy professionals', positioning: 'sustainable',
  ctaDirection: 'book a call', licensedPropositions: [{ ref: 'S1', text: 'We coach sustainable routines.', source: 'founder_owned' }], proofFacts: ['60 clients kept a routine for 12 months.'],
  ownedStances: ['I believe consistency beats intensity.'], sourceRefs: sourceRefs.map((s) => ({ sourceRefId: s.sourceRefId, objectKey: 'k/' + s.sourceRefId, reuseRight: s.reuseRight })), voiceLines: ['Keep it simple.'], speakingRole: 'founder', brandContextVersion: 'neutral',
});

function makeSvc(over: Partial<Parameters<typeof buildDeps>[0]> = {}) { return buildDeps(over); }
function buildDeps(opts: { opp?: (i: ReelOpportunityInput) => ReelOpportunityDraft; obsClips?: Record<string, Partial<ClipObservation>>; scripts?: Record<string, { text: string }>; sources?: { sourceRefId: string; reuseRight: 'founder_uploaded' | 'reference_only' }[]; strategy?: Partial<Pick<ReelContextView, 'goal' | 'coreBet' | 'positioning'>> }) {
  const repo = memRepo(); const store = memStore(); const render = new FakeRender();
  const sources = opts.sources ?? [{ sourceRefId: 'c1', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c2', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c3', reuseRight: 'founder_uploaded' as const }];
  const svc = new ReelService({
    repo, objectStore: store, render,
    observationModel: new FakeObs(opts.obsClips ?? {}),
    opportunityModel: new FakeOpp(opts.opp ?? defaultOpp),
    transcription: new FakeTr(opts.scripts ?? {}),
    context: async () => ({ ...ctx(sources), ...opts.strategy }), businessName: async () => 'Lean', currentPlan: async () => null,
    judge: { check: flagBurnsFat }, clock: () => '2026-01-01T00:00:00.000Z',
  });
  return { svc, repo, store, render, sources };
}
const defaultOpp = (i: ReelOpportunityInput): ReelOpportunityDraft => {
  const o = i.videoSet.observations;
  const ref = (s: string) => o.find((x) => x.sourceRefId === s)!.observationId;
  return { communicationJob: 'sustainable consistency routine', narrativeArc: 'gym build close', ctaDirection: 'book a call', whyFootageSupports: 'gym dumbbells training',
    strategicConnection: 'consistency', nonTransplantabilityTrace: 'these clips this coach',
    selectedRanges: [{ sourceRefId: 'c1', observationRef: ref('c1'), inMs: 300, outMs: 3300, role: 'hook', audioUse: 'original' }, { sourceRefId: 'c2', observationRef: ref('c2'), inMs: 200, outMs: 3000, role: 'build', audioUse: 'original' }, { sourceRefId: 'c3', observationRef: ref('c3'), inMs: 200, outMs: 2800, role: 'close', audioUse: 'original' }],
    excludedClips: [], targetDurationMs: 9000, missingMaterial: [], founderLegibleRecommendation: 'A consistent week.', hookText: 'Extreme plans don’t stick.', ctaText: 'Book a free intro call.' };
};

// a model that ALWAYS opens on the highest-motion clip (c1) regardless of treatment — the "optimize for motion" bug
const leadHighOpp = (i: ReelOpportunityInput): ReelOpportunityDraft => {
  const o = i.videoSet.observations;
  const ref = (s: string) => o.find((x) => x.sourceRefId === s)!.observationId;
  return { communicationJob: `${i.goal} ${i.coreBet}`, narrativeArc: 'gym dumbbells training build close', ctaDirection: 'book a call',
    whyFootageSupports: 'gym dumbbells training', strategicConnection: i.coreBet, nonTransplantabilityTrace: 'these clips this coach',
    selectedRanges: [{ sourceRefId: 'c1', observationRef: ref('c1'), inMs: 300, outMs: 3300, role: 'hook', audioUse: 'original' }, { sourceRefId: 'c2', observationRef: ref('c2'), inMs: 200, outMs: 3000, role: 'build', audioUse: 'original' }, { sourceRefId: 'c3', observationRef: ref('c3'), inMs: 200, outMs: 2800, role: 'close', audioUse: 'original' }],
    excludedClips: [], targetDurationMs: 9000, missingMaterial: [], founderLegibleRecommendation: 'A consistent week.', hookText: 'Keep it simple.', ctaText: 'Book a free intro call.' };
};

async function seed(repo: IReelRepository, store: IObjectStore, sources: { sourceRefId: string; reuseRight: 'founder_uploaded' | 'reference_only' }[]) {
  for (const s of sources) { await store.put('k/' + s.sourceRefId, Buffer.from('vid'), 'video/mp4'); await repo.saveSource('B', { sourceRefId: s.sourceRefId, objectKey: 'k/' + s.sourceRefId, reuseRight: s.reuseRight, uploadSetId: 'U' }); }
}

describe('Slice 7 — reel service (observe → recommend → accept → render → revise)', () => {
  it('full happy path: selects a subset, governs copy, renders a real EDL, then swaps the opening into v2', async () => {
    const { svc, repo, store, sources, render } = makeSvc({});
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U'); expect(ob.status).toBe('observed');
    const rec = await svc.recommend('B', (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    expect(rec.status).toBe('recommended');
    const opp = (rec as { opportunity: { opportunityId: string; sufficiency: string; selectedRanges: unknown[] } }).opportunity;
    expect(opp.sufficiency).not.toBe('insufficient');
    expect(opp.selectedRanges.length).toBe(3);
    const acc = await svc.accept('B', opp.opportunityId);
    expect(acc.status).toBe('accepted');
    const v1 = (acc as { version: { versionId: string; edlHash: string; timeline: { segments: { role: string; sourceRefId: string }[] } } }).version;
    const asset = (acc as { asset: { assetId: string } }).asset;
    const r1 = await svc.render('B', v1.versionId);
    expect(r1.status).toBe('rendered');
    expect((r1 as { render: { widthPx: number; heightPx: number; gateValid: boolean } }).render.gateValid).toBe(true);
    const rev = await svc.reviseOpening('B', asset.assetId, null);
    expect(rev.status).toBe('revised');
    const v2 = (rev as { version: { versionNumber: number; edlHash: string; timeline: { segments: { sourceRefId: string }[] } } }).version;
    expect(v2.versionNumber).toBe(2);
    expect(v2.timeline.segments[0]!.sourceRefId).not.toBe(v1.timeline.segments[0]!.sourceRefId); // opening swapped
    expect(v2.edlHash).not.toBe(v1.edlHash);
    void render;
  });

  it('reference_only clip is never handed to the renderer even if selected', async () => {
    const sources = [{ sourceRefId: 'c1', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c2', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c3', reuseRight: 'reference_only' as const }];
    const { svc, repo, store, render } = makeSvc({ sources });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const rec = await svc.recommend('B', (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const opp = (rec as { opportunity: { opportunityId: string; selectedRanges: { sourceRefId: string }[]; excludedClips: { sourceRefId: string }[] } }).opportunity;
    expect(opp.selectedRanges.some((r) => r.sourceRefId === 'c3')).toBe(false);   // dropped by rights
    expect(opp.excludedClips.some((e) => e.sourceRefId === 'c3')).toBe(true);
    const acc = await svc.accept('B', opp.opportunityId);
    if (acc.status === 'accepted') { await svc.render('B', acc.version.versionId); expect(render.lastSources).not.toContain('c3'); }
  });

  it('editorial-fit: same footage, DIFFERENT strategy — a calm strategy must not open on the intense clip; an energetic one leads with it', async () => {
    const obsClips = { c1: { activity: 'battle ropes', motionIntensity: 'high' as const }, c2: { activity: 'chopping', motionIntensity: 'medium' as const }, c3: { activity: 'plating', motionIntensity: 'low' as const } };
    // Strategy A — sustainable / not-extreme → calm treatment
    const A = makeSvc({ opp: leadHighOpp, obsClips, strategy: { goal: 'sustainable fitness coaching', coreBet: 'consistency over extremes', positioning: 'sustainable, realistic routines' } });
    await seed(A.repo, A.store, A.sources);
    const obA = await A.svc.observeUploadSet('B', 'U');
    const recA = await A.svc.recommend('B', (obA as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const oppA = (recA as { opportunity: { selectedRanges: { sourceRefId: string; role: string }[]; editingEnergy: string } }).opportunity;
    const hookA = oppA.selectedRanges.find((r) => r.role === 'hook')!;
    expect(oppA.editingEnergy).toBe('calm');
    expect(hookA.sourceRefId).not.toBe('c1');                                   // battle ropes does NOT open a calm reel
    expect(oppA.selectedRanges.some((r) => r.sourceRefId === 'c1')).toBe(true); // but it is still used (demoted), not discarded

    // the actual EDIT opens on the calmer clip
    const accA = await A.svc.accept('B', (recA as { opportunity: { opportunityId: string } }).opportunity.opportunityId);
    if (accA.status === 'accepted') expect(accA.version.timeline.segments[0]!.sourceRefId).not.toBe('c1');

    // Strategy B — high-energy challenge → energetic treatment
    const Bx = makeSvc({ opp: leadHighOpp, obsClips, strategy: { goal: 'high-energy launch challenge', coreBet: 'momentum and intensity', positioning: 'urgent, push hard' } });
    await seed(Bx.repo, Bx.store, Bx.sources);
    const obB = await Bx.svc.observeUploadSet('B', 'U');
    const recB = await Bx.svc.recommend('B', (obB as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const oppB = (recB as { opportunity: { selectedRanges: { sourceRefId: string; role: string }[]; editingEnergy: string } }).opportunity;
    const hookB = oppB.selectedRanges.find((r) => r.role === 'hook')!;
    expect(oppB.editingEnergy).toBe('energetic');
    expect(hookB.sourceRefId).toBe('c1');                                       // battle ropes SHOULD lead a high-energy reel

    expect(hookA.sourceRefId).not.toBe(hookB.sourceRefId);                      // same footage → materially different opener
  });

  it('editorial-fit: calm strategy with ONLY high-energy footage → honestly asks for a calmer shot (never fabricates calm)', async () => {
    const obsClips = { c1: { motionIntensity: 'high' as const }, c2: { motionIntensity: 'high' as const }, c3: { motionIntensity: 'high' as const } };
    const A = makeSvc({ opp: leadHighOpp, obsClips, strategy: { goal: 'sustainable fitness coaching', coreBet: 'consistency over extremes', positioning: 'sustainable' } });
    await seed(A.repo, A.store, A.sources);
    const ob = await A.svc.observeUploadSet('B', 'U');
    const rec = await A.svc.recommend('B', (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const opp = (rec as { opportunity: { missingMaterial: { what: string }[]; sufficiency: string } }).opportunity;
    expect(opp.missingMaterial.some((m) => /calmer/i.test(m.what))).toBe(true); // the honest ask
    expect(opp.sufficiency).toBe('sufficient_with_gap');                        // gap, not fabricated sufficiency
  });

  // ── Spike 0: the conceptSeed seam (V2 "Tell me what to film" → frozen V1) ──
  // A fake that DRIFTS its own angle and realizes the seed's roleHints (to prove V1 still owns ranges/rights/fit).
  const driftRealizeOpp = (i: ReelOpportunityInput): ReelOpportunityDraft => {
    const o = i.videoSet.observations;
    const ref = (s: string) => o.find((x) => x.sourceRefId === s)!.observationId;
    const hints = i.conceptSeed?.roleHints;
    const selectedRanges = hints?.length
      ? hints.map((h) => ({ sourceRefId: h.sourceRefId, observationRef: ref(h.sourceRefId), inMs: h.usableWindow?.inMs ?? 200, outMs: h.usableWindow?.outMs ?? 3000, role: h.sequenceRole, audioUse: 'original' as const }))
      : [{ sourceRefId: 'c1', observationRef: ref('c1'), inMs: 300, outMs: 3300, role: 'hook' as const, audioUse: 'original' as const }, { sourceRefId: 'c2', observationRef: ref('c2'), inMs: 200, outMs: 3000, role: 'build' as const, audioUse: 'original' as const }, { sourceRefId: 'c3', observationRef: ref('c3'), inMs: 200, outMs: 2800, role: 'close' as const, audioUse: 'original' as const }];
    return { communicationJob: 'A COMPLETELY DIFFERENT DRIFTED ANGLE', narrativeArc: 'drifted arc', ctaDirection: 'book a call', whyFootageSupports: 'gym dumbbells training',
      strategicConnection: 'consistency', nonTransplantabilityTrace: 'these clips this coach', selectedRanges, excludedClips: [], targetDurationMs: 9000, missingMaterial: [],
      founderLegibleRecommendation: 'A consistent week.', hookText: 'Keep it simple.', ctaText: 'Book a free intro call.' };
  };
  const SEED = { communicationJob: 'sustainable consistency day-in-the-life routine', narrativeArc: 'walk in → simple sets → done', editingEnergy: 'calm' as const, targetDurationMs: 12000, ctaDirection: 'book a call' as const };
  const seedWith = (roleHints?: { sequenceRole: 'hook' | 'build' | 'close'; sourceRefId: string; usableWindow?: { inMs: number; outMs: number } }[]) => ({ ...SEED, ...(roleHints ? { roleHints } : {}) });

  it('Spike0 §1 seed present → realizes the AGREED concept (no drift), even when the model drifts', async () => {
    const { svc, repo, store, sources } = makeSvc({ opp: driftRealizeOpp });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
    const rec = await svc.recommend('B', vsu, undefined, null, seedWith());
    const opp = (rec as { opportunity: { communicationJob: string; narrativeArc: string; editingEnergy: string; selectedRanges: unknown[] } }).opportunity;
    expect(opp.communicationJob).toBe(SEED.communicationJob);        // fixed to the agreed angle, NOT the drift
    expect(opp.narrativeArc).toBe(SEED.narrativeArc);
    expect(opp.editingEnergy).toBe('calm');                          // treatment from the seed
    expect(opp.selectedRanges.length).toBeGreaterThanOrEqual(3);     // V1 still produced an edit
  });

  it('Spike0 §2/§3 V1 still chooses exact ranges + excludes weak/unusable extras (seed does not lock the edit)', async () => {
    const { svc, repo, store, sources } = makeSvc({ opp: driftRealizeOpp, obsClips: { c3: { verdict: 'unusable' } } });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
    // seed hints an out-of-bounds window on c1 and hints the (unusable) c3 — V1 must clamp c1 and drop c3
    const rec = await svc.recommend('B', vsu, undefined, null, seedWith([
      { sequenceRole: 'hook', sourceRefId: 'c1', usableWindow: { inMs: 300, outMs: 99000 } },
      { sequenceRole: 'build', sourceRefId: 'c2', usableWindow: { inMs: 200, outMs: 3000 } },
      { sequenceRole: 'close', sourceRefId: 'c3', usableWindow: { inMs: 0, outMs: 3000 } },
    ]));
    const opp = (rec as { opportunity: { selectedRanges: { sourceRefId: string; outMs: number }[]; excludedClips: { sourceRefId: string }[] } }).opportunity;
    const c1 = opp.selectedRanges.find((r) => r.sourceRefId === 'c1')!;
    expect(c1.outMs).toBeLessThanOrEqual(6000);                      // clamped by V1 to the real clip duration, not 99000
    expect(opp.selectedRanges.some((r) => r.sourceRefId === 'c3')).toBe(false);   // unusable clip excluded despite the hint
    expect(opp.excludedClips.some((e) => e.sourceRefId === 'c3')).toBe(true);
  });

  it('Spike0 §4 rights override a seed hint — a reference_only hinted clip never renders', async () => {
    const sources = [{ sourceRefId: 'c1', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c2', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c3', reuseRight: 'founder_uploaded' as const }, { sourceRefId: 'c4', reuseRight: 'reference_only' as const }];
    const { svc, repo, store } = makeSvc({ opp: driftRealizeOpp, sources });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
    const rec = await svc.recommend('B', vsu, undefined, null, seedWith([
      { sequenceRole: 'hook', sourceRefId: 'c1' }, { sequenceRole: 'build', sourceRefId: 'c4' }, { sequenceRole: 'close', sourceRefId: 'c3' },
    ]));
    const opp = (rec as { opportunity: { selectedRanges: { sourceRefId: string }[] } }).opportunity;
    expect(opp.selectedRanges.some((r) => r.sourceRefId === 'c4')).toBe(false);   // rights win over the seed hint
  });

  it('Spike0 §5 editorial-fit overrides a bad seed/clip — a calm seed opening on high-energy is demoted', async () => {
    const { svc, repo, store, sources } = makeSvc({ opp: driftRealizeOpp, obsClips: { c1: { motionIntensity: 'high' }, c2: { motionIntensity: 'medium' }, c3: { motionIntensity: 'low' } } });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
    const rec = await svc.recommend('B', vsu, undefined, null, seedWith([
      { sequenceRole: 'hook', sourceRefId: 'c1' }, { sequenceRole: 'build', sourceRefId: 'c2' }, { sequenceRole: 'close', sourceRefId: 'c3' },
    ]));
    const opp = (rec as { opportunity: { selectedRanges: { sourceRefId: string; role: string }[] } }).opportunity;
    expect(opp.selectedRanges.find((r) => r.role === 'hook')!.sourceRefId).not.toBe('c1');   // intense opener demoted despite the seed
  });

  it('Spike0 §6 authorization governs copy independently of the seed — a load-bearing unsupported spoken claim still FAILS CLOSED', async () => {
    // c1 (the hook) is a talking-head that SPEAKS an unsupported claim; the seed must not authorize it.
    const { svc, repo, store, sources } = makeSvc({ opp: driftRealizeOpp, obsClips: { c1: { shot: 'talking_head', speechPresent: true } }, scripts: { c1: { text: 'This training burns fat faster than any other program.' } } });
    await seed(repo, store, sources);
    const ob = await svc.observeUploadSet('B', 'U');
    const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
    const rec = await svc.recommend('B', vsu, undefined, null, seedWith());
    const acc = await svc.accept('B', (rec as { opportunity: { opportunityId: string } }).opportunity.opportunityId);
    expect(acc.status).toBe('fail_closed');                          // seed never authorizes a load-bearing spoken claim
  });

  it('Spike0 §7 seed ABSENT → frozen behavior unchanged + deterministic EDL hash (regression anchor)', async () => {
    const run = async () => {
      const { svc, repo, store, sources } = makeSvc({});               // defaultOpp, no seed
      await seed(repo, store, sources);
      const ob = await svc.observeUploadSet('B', 'U');
      const vsu = (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId;
      const rec = await svc.recommend('B', vsu);                       // NO conceptSeed
      const opp = (rec as { opportunity: { opportunityId: string; communicationJob: string; selectedRanges: { sourceRefId: string; role: string }[] } }).opportunity;
      const acc = await svc.accept('B', opp.opportunityId);
      return { job: opp.communicationJob, sel: opp.selectedRanges.map((r) => `${r.sourceRefId}/${r.role}`).join(','), edl: acc.status === 'accepted' ? acc.version.edlHash : 'x' };
    };
    const a = await run(); const b = await run();
    expect(a.job).toBe('sustainable consistency routine');            // the model's own angle survives (no override)
    expect(a.sel).toBe('c1/hook,c2/build,c3/close');                  // frozen selection unchanged
    expect(a.edl).toBe(b.edl);                                        // same deterministic inputs → same EDL hash
    expect(a.edl).not.toBe('x');
  });

  it('spoken claim: load-bearing (hook) unsupported claim FAILS CLOSED; incidental one is MUTED and not amplified', async () => {
    // hook talking-head speaks an unsupported claim → fail closed
    const hookClaim = (i: ReelOpportunityInput): ReelOpportunityDraft => { const d = defaultOpp(i); return { ...d, selectedRanges: d.selectedRanges.map((r) => (r.sourceRefId === 'c1' ? { ...r } : r)) }; };
    const a = makeSvc({ opp: hookClaim, obsClips: { c1: { shot: 'talking_head', speechPresent: true } }, scripts: { c1: { text: 'This training burns fat faster than any other program.' } } });
    await seed(a.repo, a.store, a.sources);
    const ob = await a.svc.observeUploadSet('B', 'U');
    const rec = await a.svc.recommend('B', (ob as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const acc = await a.svc.accept('B', (rec as { opportunity: { opportunityId: string } }).opportunity.opportunityId);
    expect(acc.status).toBe('fail_closed');

    // same claim on a NON-hook (incidental) clip → clip used but MUTED, claim not amplified into copy
    const buildClaim = (i: ReelOpportunityInput): ReelOpportunityDraft => defaultOpp(i);
    const b = makeSvc({ opp: buildClaim, obsClips: { c2: { shot: 'talking_head', speechPresent: true } }, scripts: { c2: { text: 'This training burns fat faster than any other program.' } } });
    await seed(b.repo, b.store, b.sources);
    const ob2 = await b.svc.observeUploadSet('B', 'U');
    const rec2 = await b.svc.recommend('B', (ob2 as { understanding: { videoSetUnderstandingId: string } }).understanding.videoSetUnderstandingId);
    const acc2 = await b.svc.accept('B', (rec2 as { opportunity: { opportunityId: string } }).opportunity.opportunityId);
    expect(acc2.status).toBe('accepted');
    if (acc2.status === 'accepted') {
      const seg = acc2.version.timeline.segments.find((s) => s.sourceRefId === 'c2')!;
      expect(seg.audioUse).toBe('muted');                                       // incidental claim → muted
      expect(acc2.version.textBlocks.some((t) => /burns fat/i.test(t.text))).toBe(false); // never amplified
    }
  });
});
