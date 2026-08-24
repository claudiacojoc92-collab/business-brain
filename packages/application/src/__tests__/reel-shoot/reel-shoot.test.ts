import { describe, it, expect } from 'vitest';
import { assembleReport, matchFootage } from '../../reel-shoot/matching';
import { assemblePlanVersion, assembleConcept } from '../../reel-shoot/plan';
import { ReelShootService } from '../../reel-shoot/reel-shoot.service';
import { ReelService } from '../../reel/reel.service';
import type { ClipObservation, VideoSetUnderstanding, ReelOpportunityInput, ReelOpportunityDraft, ReelContextView, VideoObservationInput, ClipTranscript, ProbeResult, ReelRenderInput, ReelRenderOutput, IReelRepository, IObjectStore, IReelRenderPort, IVideoObservationModelPort, IReelOpportunityModelPort, ITranscriptionPort } from '../../reel/contracts';
import { edlHash } from '../../reel/reel';
import type { ShotRequest, ConceptPlanDraft, ConceptPlanInput, IReelShootRepository, ReelConcept, ShootingPlanVersion, FulfillmentReport, ReelShootContext } from '../../reel-shoot/contracts';

const NOW = '2026-01-01T00:00:00.000Z';

// ── frozen-side observations ──
const obs = (id: string, sourceRefId: string, x: Partial<ClipObservation> = {}): ClipObservation => ({
  observationId: id, sourceRefId, durationMs: 6000, width: 1080, height: 1920, orientation: 'portrait', fps: 30, codec: 'h264', container: 'mp4',
  rotationDegrees: 0, hasAudio: true, audioCodec: 'aac', setting: 'gym', subject: 'person', objects: [], activity: 'training', shot: 'b_roll', shotScale: 'medium',
  motion: 'static', motionIntensity: 'low', faceBoxes: [], focalSubjectBox: null, usableSpans: [{ startMs: 200, endMs: 5800, reason: 'x' }], rejectedSpans: [],
  speechPresent: false, audioKind: 'ambient', transcriptRef: null, verdict: 'observed', ...x,
});
const vsuOf = (observations: ClipObservation[]): VideoSetUnderstanding => ({ videoSetUnderstandingId: 'vsu1', businessId: 'B', uploadSetId: 'U', observations, setSignal: '', modelId: null, contentHash: 'h', producedAt: NOW });

// ── a minimal concept + plan built from hand-written shots (bypasses the LLM for deterministic matcher tests) ──
const concept = (energy: ReelConcept['editingEnergy'] = 'calm'): ReelConcept => assembleConcept({
  businessId: 'B', strategyVersionId: 'sv', planVersionId: null, actionId: null, editingEnergy: energy, authorizationBasis: [], speakingRole: 'founder',
  contentLanguage: 'en', brandContextVersion: 'neutral', modelId: null, now: NOW,
  draft: { communicationJob: 'a calm day', strategicReason: 'now', narrativeArc: 'in→sets→food→done', beats: [], targetDurationMs: 14000, ctaDirection: 'book a call', sufficiencyAssumptions: [], nonTransplantabilityTrace: 't', estimatedEffort: '3 min', generalGuidance: [], shots: [] },
});
type ShotSeed = Partial<ShotRequest> & { sequenceRole: ShotRequest['sequenceRole']; matchTokens: string[]; required: boolean };
const planOf = (shots: ShotSeed[], energy: ReelConcept['editingEnergy'] = 'calm'): { c: ReelConcept; p: ShootingPlanVersion } => {
  const c = concept(energy);
  const draft: ConceptPlanDraft = {
    communicationJob: c.communicationJob, strategicReason: '', narrativeArc: '', beats: [], targetDurationMs: 14000, ctaDirection: null, sufficiencyAssumptions: [], nonTransplantabilityTrace: '', estimatedEffort: '3 min', generalGuidance: [],
    shots: shots.map((s) => ({ sequenceRole: s.sequenceRole, storyJob: s.storyJob ?? '', subject: s.subject ?? '', visibleAction: s.visibleAction ?? '', framing: s.framing ?? 'medium', cameraBehavior: s.cameraBehavior ?? 'static', approxDurationMs: s.approxDurationMs ?? 4000, orientation: 'vertical', audioNeed: s.audioNeed ?? 'none', textSafeSide: s.textSafeSide ?? 'none', visualEnergyNeed: s.visualEnergyNeed ?? null, required: s.required, founderFilms: s.founderFilms ?? true, completionCriteria: s.completionCriteria ?? '', whyThisShot: s.whyThisShot ?? '', alternativesAllowed: s.alternativesAllowed ?? true, founderProse: s.founderProse ?? 'film it', matchTokens: s.matchTokens, spokenLineIntent: s.exactSpokenLine ?? null })),
  };
  const p = assemblePlanVersion({ concept: c, draft, uiLanguage: 'en', constraints: [], spokenLines: {}, modelId: null, now: NOW });
  return { c, p };
};

describe('Slice 7 V2 — deterministic shot matching + fulfillment', () => {
  it('§I matches by story job (flexible), rejects wrong footage (strict on which job)', () => {
    const { p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym', 'training'], required: true },
      { sequenceRole: 'close', matchTokens: ['dish', 'plate', 'food'], required: true },
    ]);
    const vsu = vsuOf([
      obs('o1', 'cGym', { setting: 'gym', subject: 'person', activity: 'battle ropes training' }),
      obs('o2', 'cDish', { setting: 'kitchen', subject: 'prepared_dish', activity: 'plating food', objects: ['plate'] }),
      obs('o3', 'cShelf', { setting: 'retail', subject: 'shelf', activity: 'browsing groceries' }),  // wrong for both
    ]);
    const f = matchFootage(p, vsu, NOW);
    expect(f.find((x) => x.shotId === p.shotRequests[0]!.shotId)!.status).toBe('satisfied');   // gym → hook
    expect(f.find((x) => x.shotId === p.shotRequests[1]!.shotId)!.matchedSourceRefId).toBe('cDish'); // dish → close (not shelf)
  });

  it('§K 4/5 required present → sufficient_with_gap asking for exactly ONE missing shot', () => {
    const { c, p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym'], required: true },
      { sequenceRole: 'build', matchTokens: ['grocery', 'shelf'], required: true },
      { sequenceRole: 'proof', matchTokens: ['chopping', 'knife'], required: true },
      { sequenceRole: 'close', matchTokens: ['dish', 'plate'], required: true, framing: 'close', approxDurationMs: 3000, founderProse: 'the finished dish' },
    ]);
    const vsu = vsuOf([
      obs('o1', 'cGym', { activity: 'gym training' }), obs('o2', 'cGro', { setting: 'retail', subject: 'shelf', activity: 'grocery' }),
      obs('o3', 'cChop', { setting: 'kitchen', subject: 'knife', activity: 'chopping' }),
      // no dish clip → the close beat is the one missing
    ]);
    const rep = assembleReport(p, vsu, c.editingEnergy, NOW);
    expect(rep.sufficiency).toBe('sufficient_with_gap');
    expect(rep.smallestMissing!.shotId).toBe(p.shotRequests.find((s) => s.sequenceRole === 'close')!.shotId);
    expect(rep.smallestMissing!.founderAsk).toMatch(/finished dish/);
  });

  it('§J substitution — a clip filmed for an optional beat fills a missing REQUIRED beat by story job', () => {
    const { p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym'], required: true },
      { sequenceRole: 'build', matchTokens: ['grocery'], required: true },
      { sequenceRole: 'close', matchTokens: ['bag', 'counter'], required: true },              // requested: "bag onto counter"
      { sequenceRole: 'detail', matchTokens: ['unpacking', 'groceries', 'counter'], required: false }, // optional texture
    ]);
    const vsu = vsuOf([
      obs('o1', 'cGym', { activity: 'gym' }), obs('o2', 'cGro', { setting: 'retail', activity: 'grocery browsing' }),
      obs('o3', 'cUnpack', { setting: 'home', subject: 'counter', activity: 'unpacking groceries onto counter', objects: [] }),
    ]);
    const f = matchFootage(p, vsu, NOW);
    const close = f.find((x) => x.shotId === p.shotRequests.find((s) => s.sequenceRole === 'close')!.shotId)!;
    expect(close.status).not.toBe('missing');          // the unpacking clip serves the "bag onto counter" beat
    expect(close.matchedSourceRefId).toBe('cUnpack');
    expect(close.substitutedFromShotId).not.toBeNull(); // its strongest match was the optional detail → substituted
  });

  it('§L optional shot missing → still sufficient (does not block)', () => {
    const { c, p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym'], required: true },
      { sequenceRole: 'build', matchTokens: ['grocery'], required: true },
      { sequenceRole: 'close', matchTokens: ['dish'], required: true },
      { sequenceRole: 'detail', matchTokens: ['sky', 'window'], required: false },   // optional, no footage
    ]);
    const vsu = vsuOf([obs('o1', 'cGym', { activity: 'gym' }), obs('o2', 'cGro', { setting: 'retail', activity: 'grocery' }), obs('o3', 'cDish', { subject: 'dish', activity: 'plating' })]);
    expect(assembleReport(p, vsu, c.editingEnergy, NOW).sufficiency).toBe('sufficient');
  });

  it('§M calm concept + only intense footage → asks for one CALMER shot (never fabricates calm)', () => {
    const { c, p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym'], required: true, visualEnergyNeed: 'low' },
      { sequenceRole: 'build', matchTokens: ['gym'], required: true, visualEnergyNeed: 'low' },
      { sequenceRole: 'close', matchTokens: ['gym'], required: true, visualEnergyNeed: 'low' },
    ], 'calm');
    const vsu = vsuOf([obs('o1', 'c1', { activity: 'gym', motionIntensity: 'high' }), obs('o2', 'c2', { activity: 'gym', motionIntensity: 'high' }), obs('o3', 'c3', { activity: 'gym', motionIntensity: 'high' })]);
    const rep = assembleReport(p, vsu, c.editingEnergy, NOW);
    expect(rep.sufficiency).toBe('sufficient_with_gap');
    expect(rep.smallestMissing!.founderAsk).toMatch(/calmer/i);
  });

  it('non-filmed on-screen text-card shots are auto-satisfied and never counted as a missing gap', () => {
    const { c, p } = planOf([
      { sequenceRole: 'hook', matchTokens: ['gym'], required: true },
      { sequenceRole: 'build', matchTokens: ['grocery'], required: true },
      { sequenceRole: 'proof', matchTokens: ['stat', 'card'], required: true, founderFilms: false, founderProse: 'A text card you make in your editor' },
      { sequenceRole: 'close', matchTokens: ['dish'], required: true },
    ]);
    const vsu = vsuOf([obs('o1', 'cGym', { activity: 'gym' }), obs('o2', 'cGro', { setting: 'retail', activity: 'grocery' }), obs('o3', 'cDish', { subject: 'dish', activity: 'plating' })]);
    const rep = assembleReport(p, vsu, c.editingEnergy, NOW);
    const card = rep.fulfillments.find((f) => f.shotId === p.shotRequests.find((s) => !s.founderFilms)!.shotId)!;
    expect(card.status).toBe('satisfied');            // BB/the editor makes it — never asked of the founder
    expect(rep.sufficiency).toBe('sufficient');        // the 3 filmed beats are covered; the card is not a gap
  });

  it('§F spoken-line shot with no speech in the clip → not falsely satisfied', () => {
    const { p } = planOf([{ sequenceRole: 'hook', matchTokens: ['coach', 'person'], required: true, audioNeed: 'spoken_line', exactSpokenLine: 'Consistency beats intensity.' }]);
    const vsu = vsuOf([obs('o1', 'c1', { subject: 'coach person', activity: 'standing', shot: 'b_roll', speechPresent: false })]);
    expect(matchFootage(p, vsu, NOW)[0]!.status).toBe('missing');
  });
});

// ── service-level: propose / constrain / converge, with frozen fakes ──
function memShootRepo(): IReelShootRepository {
  const c = new Map<string, ReelConcept>(), pv = new Map<string, ShootingPlanVersion>(), fr = new Map<string, FulfillmentReport>(), sc = new Map<string, ReelShootContext>();
  return {
    saveConcept: async (x) => void c.set(x.reelConceptId, x), getConcept: async (_b, i) => c.get(i) ?? null,
    savePlanVersion: async (x) => void pv.set(x.versionId, x), getPlanVersion: async (_b, i) => pv.get(i) ?? null,
    getCurrentPlanVersion: async (_b, sp) => [...pv.values()].filter((v) => v.shootingPlanId === sp).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null,
    saveFulfillmentReport: async (x) => void fr.set(x.shootingPlanVersionId, x), getFulfillmentReport: async (_b, i) => fr.get(i) ?? null,
    saveShootContext: async (x) => void sc.set(x.assetId, x), getShootContextByAsset: async (_b, a) => sc.get(a) ?? null,
    getShootContextByPlan: async (_b, pv) => [...sc.values()].find((c) => c.shootingPlanVersionId === pv) ?? null,
  };
}
function memReel() {
  const m = { vsu: new Map(), tr: new Map(), opp: new Map(), snap: new Map(), asset: new Map(), ver: new Map(), rnd: new Map(), src: new Map<string, unknown[]>(), job: new Map() };
  const k = (b: string, i: string) => `${b}::${i}`;
  const repo: IReelRepository = {
    saveVideoSetUnderstanding: async (x) => void m.vsu.set(k(x.businessId, x.videoSetUnderstandingId), x), getVideoSetUnderstanding: async (b, i) => (m.vsu.get(k(b, i)) as never) ?? null,
    saveTranscript: async (x) => void m.tr.set(x.transcriptId, x), getTranscript: async (i) => (m.tr.get(i) as never) ?? null,
    saveOpportunity: async (x) => void m.opp.set(k(x.businessId, x.opportunityId), x), getOpportunity: async (b, i) => (m.opp.get(k(b, i)) as never) ?? null,
    saveAuthorizationSnapshot: async (x) => void m.snap.set(k(x.businessId, x.snapshotId), x), getAuthorizationSnapshot: async (b, i) => (m.snap.get(k(b, i)) as never) ?? null,
    saveAsset: async (x) => void m.asset.set(k(x.businessId, x.assetId), x), getAsset: async (b, i) => (m.asset.get(k(b, i)) as never) ?? null,
    setCurrentVersion: async (a, v) => { for (const [key, as] of m.asset) { const o = as as { assetId: string }; if (o.assetId === a) m.asset.set(key, { ...(as as object), currentVersionId: v }); } },
    saveVersion: async (x) => void m.ver.set(k(x.businessId, x.versionId), x), getVersion: async (b, i) => (m.ver.get(k(b, i)) as never) ?? null,
    saveRender: async (x) => void m.rnd.set(x.versionId, x), getRender: async (v) => (m.rnd.get(v) as never) ?? null,
    recordRevision: async () => undefined, saveSafetyTrace: async () => undefined,
    saveSource: async (b, s) => void m.src.set(k(b, s.uploadSetId), [...(m.src.get(k(b, s.uploadSetId)) ?? []), s]), listSources: async (b, u) => (m.src.get(k(b, u)) as never) ?? [],
    saveJob: async (x) => void m.job.set(k(x.businessId, x.jobId), x), getJob: async (b, i) => (m.job.get(k(b, i)) as never) ?? null,
  };
  const store: IObjectStore = { presignPut: async (key) => ({ url: 'x', method: 'PUT', objectKey: key }), head: async () => ({ exists: true }), getStream: async () => null, getToFile: async () => true, getToBuffer: async () => Buffer.from('x'), put: async () => undefined, delete: async () => undefined };
  const render: IReelRenderPort = { rendererVersion: () => 'f', ffmpegBuild: async () => 'f', probe: async (): Promise<ProbeResult> => ({ durationMs: 6000, width: 1080, height: 1920, fps: 30, codec: 'h264', container: 'mp4', rotationDegrees: 0, hasAudio: true, audioCodec: 'aac' }), sampleFrames: async () => [], render: async (i: ReelRenderInput): Promise<ReelRenderOutput> => ({ mp4: Buffer.from('M'), poster: Buffer.from('P'), widthPx: 1080, heightPx: 1920, durationMs: i.timeline.totalDurationMs, edlHash: edlHash(i.timeline, i.textBlocks), ffmpegBuild: 'f', rendererVersion: 'f', renderParams: {} }) };
  return { repo, store, render };
}
const clip = (sourceRefId: string, x: Partial<ClipObservation> = {}): Omit<ClipObservation, 'observationId' | 'transcriptRef'> => { const c: Record<string, unknown> = { ...obs('x', sourceRefId, x) }; delete c.observationId; delete c.transcriptRef; return c as Omit<ClipObservation, 'observationId' | 'transcriptRef'>; };
class FakeObs implements IVideoObservationModelPort { constructor(private c: Record<string, Partial<ClipObservation>>) {} descriptor() { return { modelId: 'o' }; } async observe(inp: VideoObservationInput[]) { return inp.map((i) => clip(i.sourceRefId, this.c[i.sourceRefId] ?? {})); } }
class PassOpp implements IReelOpportunityModelPort { descriptor() { return { modelId: 'p' }; } async recommend(i: ReelOpportunityInput): Promise<ReelOpportunityDraft> {
  const o = i.videoSet.observations; const ref = (s: string) => o.find((x) => x.sourceRefId === s)!.observationId;
  const hints = i.conceptSeed?.roleHints ?? [];
  const selectedRanges = hints.length ? hints.map((h) => ({ sourceRefId: h.sourceRefId, observationRef: ref(h.sourceRefId), inMs: h.usableWindow?.inMs ?? 200, outMs: h.usableWindow?.outMs ?? 3000, role: h.sequenceRole, audioUse: 'original' as const }))
    : o.slice(0, 3).map((x, n) => ({ sourceRefId: x.sourceRefId, observationRef: x.observationId, inMs: 200, outMs: 3000, role: (['hook', 'build', 'close'] as const)[n]!, audioUse: 'original' as const }));
  return { communicationJob: i.conceptSeed?.communicationJob ?? 'job', narrativeArc: 'arc', ctaDirection: 'book a call', whyFootageSupports: 'gym grocery dish', strategicConnection: 'consistency', nonTransplantabilityTrace: 'these clips', selectedRanges, excludedClips: [], targetDurationMs: 12000, missingMaterial: [], founderLegibleRecommendation: 'x', hookText: 'Keep it simple.', ctaText: 'Book a call.' };
} }
class FakeTr implements ITranscriptionPort { capabilities() { return { languages: 'auto' as const, wordTimestamps: true, confidence: true }; } supports() { return 'yes' as const; } descriptor() { return { providerId: 'f', modelId: 'd' }; } async transcribe(i: { sourceRefId: string }): Promise<ClipTranscript> { return { transcriptId: 't', sourceRefId: i.sourceRefId, detectedLanguage: 'en', segments: [], status: 'no_intelligible_speech', providerId: 'f', modelId: 'd' }; } }
const ctxOf = (refs: string[]): ReelContextView => ({ strategyVersionId: 'sv', language: 'en', goal: 'sustainable fitness coaching', coreBet: 'consistency over extremes', audience: 'busy professionals', positioning: 'sustainable', ctaDirection: 'book a call', licensedPropositions: [{ ref: 'S1', text: 'We coach sustainable routines.', source: 'founder_owned' }], proofFacts: ['60 clients kept a routine 12 months.'], ownedStances: ['Consistency beats intensity.'], sourceRefs: refs.map((r) => ({ sourceRefId: r, objectKey: 'k/' + r, reuseRight: 'founder_uploaded' as const })), voiceLines: ['Keep it simple.'], speakingRole: 'founder', brandContextVersion: 'neutral' });

// fake concept model → a fixed calm 4-shot plan aligned to the fixture clips
const fakeConcept: (i: ConceptPlanInput) => ConceptPlanDraft = (i) => {
  const noTalk = (i.constraints ?? []).some((c) => c.kind === 'no_talking_head');
  const shots = [
    ...(noTalk ? [] : [{ sequenceRole: 'hook' as const, storyJob: 'coach sets it up', subject: 'coach person', visibleAction: 'speaking to camera', framing: 'medium' as const, cameraBehavior: 'static' as const, approxDurationMs: 5000, orientation: 'vertical' as const, audioNeed: 'spoken_line' as const, textSafeSide: 'right' as const, visualEnergyNeed: 'low' as const, required: true, founderFilms: true, completionCriteria: 'coach speaks', whyThisShot: 'trust', alternativesAllowed: false, founderProse: 'Look at the camera and say the line.', matchTokens: ['coach', 'person', 'talking'], spokenLineIntent: 'Consistency beats intensity.' }]),
    { sequenceRole: (noTalk ? 'hook' : 'build') as 'hook' | 'build', storyJob: 'a normal grocery moment', subject: 'shelf', visibleAction: 'reaching for food', framing: 'medium' as const, cameraBehavior: 'slow_move' as const, approxDurationMs: 4000, orientation: 'vertical' as const, audioNeed: 'ambient' as const, textSafeSide: 'none' as const, visualEnergyNeed: 'low' as const, required: true, founderFilms: true, completionCriteria: 'grocery', whyThisShot: 'real week', alternativesAllowed: true, founderProse: 'Film 4 seconds reaching into the fridge.', matchTokens: ['grocery', 'shelf', 'fridge'], spokenLineIntent: null },
    { sequenceRole: 'proof' as const, storyJob: 'simple food prep', subject: 'knife', visibleAction: 'chopping', framing: 'close' as const, cameraBehavior: 'static' as const, approxDurationMs: 4000, orientation: 'vertical' as const, audioNeed: 'ambient' as const, textSafeSide: 'none' as const, visualEnergyNeed: 'low' as const, required: true, founderFilms: true, completionCriteria: 'chopping', whyThisShot: 'proof', alternativesAllowed: true, founderProse: 'Film 4 seconds chopping veg.', matchTokens: ['chopping', 'knife', 'kitchen'], spokenLineIntent: null },
    { sequenceRole: 'close' as const, storyJob: 'the finished dish', subject: 'prepared_dish', visibleAction: 'plating', framing: 'close' as const, cameraBehavior: 'static' as const, approxDurationMs: 3000, orientation: 'vertical' as const, audioNeed: 'none' as const, textSafeSide: 'none' as const, visualEnergyNeed: 'low' as const, required: true, founderFilms: true, completionCriteria: 'dish', whyThisShot: 'payoff', alternativesAllowed: true, founderProse: 'Film 3 seconds of the finished dish.', matchTokens: ['dish', 'plate', 'food'], spokenLineIntent: null },
  ];
  return { communicationJob: 'a calm sustainable day-in-the-life', strategicReason: 'sustainable consistency now', narrativeArc: 'coach → grocery → prep → dish', beats: [], targetDurationMs: 14000, ctaDirection: 'book a call', sufficiencyAssumptions: ['founder can film at home'], nonTransplantabilityTrace: 'sustainable consistency for this coach', estimatedEffort: 'about 3 minutes of filming', generalGuidance: ['Hold the phone upright', 'Keep still', 'Film the action'], shots };
};

function buildShoot(opts: { concept?: (i: ConceptPlanInput) => ConceptPlanDraft; obsClips?: Record<string, Partial<ClipObservation>>; refs?: string[]; judge?: (i: unknown) => Promise<{ newPropositions: unknown[] }> } = {}) {
  const { repo, store, render } = memReel();
  const refs = opts.refs ?? ['cCoach', 'cGro', 'cChop', 'cDish'];
  const reel = new ReelService({ repo, objectStore: store, render, observationModel: new FakeObs(opts.obsClips ?? {}), opportunityModel: new PassOpp(), transcription: new FakeTr(), context: async () => ctxOf(refs), businessName: async () => 'Lean', currentPlan: async () => null, clock: () => NOW, ...(opts.judge ? { judge: { check: opts.judge as never } } : {}) });
  const shootRepo = memShootRepo();
  const shoot = new ReelShootService({ shootRepo, conceptModel: { propose: async (i) => (opts.concept ?? fakeConcept)(i), descriptor: () => ({ modelId: 'c' }) }, reel, reelRepo: repo, context: async () => ctxOf(refs), businessName: async () => 'Lean', currentPlan: async () => null, clock: () => NOW, ...(opts.judge ? { judge: { check: opts.judge as never } } : {}) });
  return { shoot, reel, repo, store, shootRepo, refs };
}
async function seedSources(repo: IReelRepository, store: IObjectStore, refs: string[]) { for (const r of refs) { await store.put('k/' + r, Buffer.from('v'), 'video/mp4'); await repo.saveSource('B', { sourceRefId: r, objectKey: 'k/' + r, reuseRight: 'founder_uploaded', uploadSetId: 'U' }); } }

describe('Slice 7 V2 — service (propose → constrain → match → converge into frozen V1)', () => {
  it('§A/§F proposeConcept → a 4-shot plan; an authorized spoken line survives governance', async () => {
    const { shoot } = buildShoot({ judge: async () => ({ newPropositions: [] }) });
    const r = await shoot.proposeConcept('B');
    expect(r.status).toBe('proposed');
    if (r.status !== 'proposed') return;
    expect(r.plan.shotRequests.length).toBe(4);
    const hook = r.plan.shotRequests.find((s) => s.sequenceRole === 'hook')!;
    expect(hook.audioNeed).toBe('spoken_line');
    expect(hook.exactSpokenLine).toBe('Consistency beats intensity.');   // governed + offered
  });

  it('spoken line that OVER-CLAIMS is degraded to a silent shot before filming (never asks founder to say a claim BB can’t back)', async () => {
    const claimConcept: (i: ConceptPlanInput) => ConceptPlanDraft = (i) => { const d = fakeConcept(i); d.shots[0]!.spokenLineIntent = 'This routine burns fat faster than any program.'; return d; };
    const judge = async (i: unknown) => ({ newPropositions: /burns fat/.test(JSON.stringify(i)) ? [{ clause: 'burns fat', proposition: 'health', reason: 'unlicensed' }] : [] });
    const { shoot } = buildShoot({ concept: claimConcept, judge });
    const r = await shoot.proposeConcept('B');
    if (r.status !== 'proposed') throw new Error('no');
    const hook = r.plan.shotRequests.find((s) => s.sequenceRole === 'hook')!;
    expect(hook.exactSpokenLine).toBeNull();
    expect(hook.audioNeed).toBe('ambient');
  });

  it('§E/§G constraint "no talking on camera" mints plan v2 (no spoken_line shots, supersedes v1) — no questionnaire', async () => {
    const { shoot } = buildShoot({ judge: async () => ({ newPropositions: [] }) });
    const v1 = await shoot.proposeConcept('B');
    if (v1.status !== 'proposed') throw new Error('no');
    const v2 = await shoot.constrain('B', v1.plan.versionId, { kind: 'no_talking_head' });
    if (v2.status !== 'proposed') throw new Error('no');
    expect(v2.plan.versionNumber).toBe(2);
    expect(v2.plan.supersedesVersionId).toBe(v1.plan.versionId);
    expect(v2.plan.shotRequests.some((s) => s.audioNeed === 'spoken_line')).toBe(false);
    expect(v2.concept.reelConceptId).toBe(v1.concept.reelConceptId);   // same concept, execution changed
  });

  it('§F-fix no_talking_head → the plan carries NO founder spoken-line requirement (even a card never gets exactSpokenLine)', async () => {
    // a model that STILL emits a spoken line on a non-filmed card despite the constraint
    const stubbornConcept: (i: ConceptPlanInput) => ConceptPlanDraft = (i) => {
      const d = fakeConcept(i);
      d.shots.push({ sequenceRole: 'close', storyJob: 'stat card', subject: 'text card', visibleAction: 'text', framing: 'medium', cameraBehavior: 'static', approxDurationMs: 3000, orientation: 'vertical', audioNeed: 'spoken_line', textSafeSide: 'none', visualEnergyNeed: 'low', required: true, founderFilms: false, completionCriteria: 'card', whyThisShot: 'proof', alternativesAllowed: true, founderProse: 'A text card. Say the stat.', matchTokens: ['card'], spokenLineIntent: 'We kept 60 clients for a year.' });
      return d;
    };
    const { shoot } = buildShoot({ concept: stubbornConcept, judge: async () => ({ newPropositions: [] }) });
    const v1 = await shoot.proposeConcept('B'); if (v1.status !== 'proposed') throw new Error('no');
    const v2 = await shoot.constrain('B', v1.plan.versionId, { kind: 'no_talking_head' });
    if (v2.status !== 'proposed') throw new Error('no');
    expect(v2.plan.shotRequests.some((s) => s.audioNeed === 'spoken_line')).toBe(false);
    expect(v2.plan.shotRequests.every((s) => s.exactSpokenLine === null)).toBe(true);   // no founder spoken requirement anywhere
  });

  it('§M converge — 4/5 present then add the missing shot → sufficient → frozen V1 asset + ReelShootContext lineage', async () => {
    const obsClips = { cCoach: { subject: 'coach person', activity: 'talking to camera', shot: 'talking_head' as const, speechPresent: true }, cGro: { setting: 'retail', subject: 'shelf', activity: 'reaching grocery fridge' }, cChop: { setting: 'kitchen', subject: 'knife', activity: 'chopping' }, cDish: { subject: 'prepared_dish', activity: 'plating dish', objects: ['plate'] } };
    const { shoot, repo, store } = buildShoot({ obsClips, judge: async () => ({ newPropositions: [] }) });
    const prop = await shoot.proposeConcept('B'); if (prop.status !== 'proposed') throw new Error('no');
    // upload only 3 of 4 (omit the dish) → sufficient_with_gap asking for the dish
    await seedSources(repo, store, ['cCoach', 'cGro', 'cChop']);
    const m1 = await shoot.matchUploads('B', prop.plan.versionId, 'U');
    expect(m1.status).toBe('matched'); if (m1.status !== 'matched') return;
    expect(m1.report.sufficiency).toBe('sufficient_with_gap');
    expect(m1.report.smallestMissing!.founderAsk).toMatch(/dish/i);
    // add the dish → sufficient
    await seedSources(repo, store, ['cDish']);
    const m2 = await shoot.matchUploads('B', prop.plan.versionId, 'U');
    if (m2.status !== 'matched') return;
    expect(m2.report.sufficiency).toBe('sufficient');
    // converge → frozen V1
    const conv = await shoot.converge('B', prop.plan.versionId, { deferRender: true });
    expect(conv.status).toBe('created'); if (conv.status !== 'created') return;
    expect(conv.context.assetId).toBe(conv.assetId);
    expect(conv.context.conceptSeed.communicationJob).toBe(prop.concept.communicationJob);   // agreed concept flowed to V1
    expect(conv.context.conceptSeed.roleHints?.length ?? 0).toBeGreaterThanOrEqual(3);        // matched clips became hints
  });
});
