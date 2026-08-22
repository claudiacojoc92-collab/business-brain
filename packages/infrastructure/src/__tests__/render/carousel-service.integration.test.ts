/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { ResvgCarouselRenderer } from '../../render/resvg-carousel.renderer';
import { CarouselService } from '@bb/application';
import type {
  ICarouselModelPort, ICarouselRepository, IBlobStore, CarouselContextView,
  CarouselCopyDraft, Concept, CarouselAssetVersion, CarouselAsset, RenderVersion, AssetAuthorizationSnapshot as Snap,
} from '@bb/application';
import type { CreateHandoff } from '@bb/application';

// ── fakes ──
function memRepo() {
  const versions: CarouselAssetVersion[] = []; const assets: CarouselAsset[] = []; const renders: RenderVersion[] = []; const snaps: Snap[] = []; const revs: any[] = []; const traces: any[] = [];
  const repo: ICarouselRepository = {
    saveVersion: async (v) => { versions.push(v); },
    getVersion: async (b, id) => versions.find((v) => v.businessId === b && v.versionId === id) ?? null,
    saveAsset: async (a) => { assets.push(a); },
    getAsset: async (b, id) => assets.find((a) => a.businessId === b && a.assetId === id) ?? null,
    getAssetByHandoff: async (b, h) => assets.find((a) => a.businessId === b && a.createHandoffId === h) ?? null,
    setCurrentVersion: async (assetId, versionId) => { const a = assets.findIndex((x) => x.assetId === assetId); if (a >= 0) assets[a] = { ...assets[a]!, currentVersionId: versionId }; },
    saveAuthorizationSnapshot: async (s) => { snaps.push(s); },
    getAuthorizationSnapshot: async (b, id) => snaps.find((s) => s.businessId === b && s.snapshotId === id) ?? null,
    saveSafetyTrace: async (t) => { traces.push(t); },
    saveMedia: async () => { /* pool unused in these tests */ },
    listMedia: async () => [],
    saveBrand: async () => { /* brand unused in these tests */ },
    getBrand: async () => null,
    saveRender: async (r) => { renders.push(r); },
    getRender: async (vid) => [...renders].reverse().find((r) => r.versionId === vid) ?? null,
    recordRevision: async (e) => { revs.push(e); },
  };
  return { repo, versions, assets, renders, revs, traces };
}

/** Deterministic stand-in for the frozen Layer-3 judge: flags outcome/capability/market clauses not
 * entailed by licensed material (a faithful paraphrase of a licensed proof fact passes). */
const OUTCOME_FLAGS = [/guarantee/, /double (your|their)/, /\btriple/, /every client/, /\bmost (seed|founders|clients)/, /we can (cut|save|grow|double)/, /\d+%\s+conversion/];
const fakeJudge = {
  contract: () => ({ modelId: 'judge-test', promptHash: 'jph' }),
  check: async ({ content }: any) => {
    const text = [content.hook, ...(content.beats ?? []), content.caption, content.cta].filter(Boolean).join(' \n ');
    const newPropositions: { clause: string; proposition: string; reason: string }[] = [];
    for (const clause of text.split(/[.!?\n]+/).map((s: string) => s.trim()).filter(Boolean)) {
      if (OUTCOME_FLAGS.some((r) => r.test(clause.toLowerCase()))) newPropositions.push({ clause, proposition: 'unlicensed outcome/capability/market claim', reason: 'not entailed by licensed material' });
    }
    return { newPropositions };
  },
};
function memBlob() {
  const store = new Map<string, Buffer>();
  const blob: IBlobStore = {
    put: async (k, b) => { store.set(k, b); },
    get: async (k) => store.get(k) ?? null,
    putZip: async (k, files) => { const z = new JSZip(); for (const f of files) z.file(f.name, f.bytes); store.set(k, await z.generateAsync({ type: 'nodebuffer' }) as Buffer); },
  };
  return { blob, store };
}

const HANDOFF: CreateHandoff = {
  createHandoffId: 'ch1', actionId: 'a1', planVersionId: 'pv1', strategyVersionId: 'sv1', founderGoalTrace: 'land 3 fractional-CFO retainers',
  strategicBetTrace: 'win trust with the documented client outcome', executionObjective: 'publish the case study as a carousel',
  communicationJob: 'turn the burn-reduction case study into a trust-building carousel', authorizedAudienceUseContext: 'seed-stage SaaS founders who just raised',
  channel: 'linkedin', requestedAssetFormat: null, ctaDirection: 'book a 20-minute diagnostic call', requiredSourceMaterial: ['a case study'], knownGapsBlockers: [], relevantConstraints: [], producedAt: 't',
};
const CTX: CarouselContextView = {
  strategyVersionId: 'sv1', language: 'en', goal: 'land 3 fractional-CFO retainers', coreBet: 'documented outcomes over credentials',
  audience: 'seed-stage SaaS founders who just raised', ctaDirection: 'book a 20-minute diagnostic call',
  licensedPropositions: [{ ref: 'P1', text: 'we help seed-stage SaaS founders get finance clarity through a diagnostic call', source: 'strategy_decision' }],
  proofFacts: ['a documented case study where a SaaS client cut burn 30%'],
  sourceRefs: [], brand: { brandContextVersion: 'bc1', mode: 'restrained_default' }, voiceLines: ['plain, concrete, no hype'], speakingRole: 'the founder',
};

// deterministic fake model: grounded, proof cited documentarily, tied to the strategy context
const fakeModel = (over: Partial<CarouselCopyDraft> = {}): ICarouselModelPort => ({
  chooseConcept: async (): Promise<Concept> => ({ conceptId: 'c1', rationale: 'lead with the documented outcome', communicationLogic: 'proof of a real burn-reduction outcome earns the diagnostic call for seed-stage SaaS founders', slideOutline: ['hook', 'proof', 'cta'], materialFeasibility: 'the documented case study grounds the proof slide', internalFamily: 'proof_breakdown' }),
  draftCopy: async (): Promise<CarouselCopyDraft> => ({
    communicationJob: HANDOFF.communicationJob!, language: 'en',
    hook: 'The seed-stage SaaS founder who got finance clarity',
    orderedSlideCopy: [
      { slideKey: 's1', role: 'hook', headline: 'The SaaS founder who got finance clarity after raising' },
      { slideKey: 's2', role: 'proof', headline: 'What the case study documents', body: 'A SaaS client cut burn 30% after getting finance clarity through the diagnostic call.' },
      { slideKey: 's3', role: 'cta', headline: 'Want the same clarity?' },
    ],
    cta: 'Book a 20-minute diagnostic call', propositionBindings: [
      { blockRef: 's2:body', propositionRef: 'P1', sourceRefId: null, ctaFunction: null },
    ], ...over,
  }),
  reviewAntiTemplate: async () => ({ generic: false, reason: 'anchored to the documented SaaS burn-reduction case study' }),
  descriptor: () => ({ modelId: 'test', copyContractHash: 'h' }),
});

function svc(model: ICarouselModelPort) {
  const repo = memRepo(); const blob = memBlob();
  const service = new CarouselService({
    repo: repo.repo, model, render: new ResvgCarouselRenderer(), blob: blob.blob, judge: fakeJudge,
    handoff: async () => HANDOFF, context: async () => CTX, businessName: async () => 'Marbury & Vale', clock: () => '2026-08-13T00:00:00.000Z',
  });
  return { service, repo, blob };
}
const pngHash = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 16);

describe('Slice 6 — carousel service (generate → gates → export → scoped revision)', () => {
  it('generates a governed, structurally-valid carousel and persists render + PNGs', async () => {
    const { service, repo, blob } = svc(fakeModel());
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('created');
    if (res.status !== 'created') return;
    expect(res.version.slides).toHaveLength(3);
    expect(res.render.gateReport.valid).toBe(true);
    expect(res.render.slideImages).toHaveLength(3);
    for (const si of res.render.slideImages) expect(await blob.blob.get(si.blobKey)).not.toBeNull();
    expect(repo.assets[0]!.currentVersionId).toBe(res.version.versionId);
  });

  it('exports an ordered ZIP that opens with the correct slides at 1080×1350', async () => {
    const { service, blob } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const exp = await service.export('B', gen.version.versionId);
    expect('zipKey' in exp && exp.slideCount).toBe(3);
    if (!('zipKey' in exp)) return;
    const zipBytes = await blob.blob.get(exp.zipKey);
    const zip = await JSZip.loadAsync(zipBytes!);
    expect(Object.keys(zip.files).sort()).toEqual(['slide-01.png', 'slide-02.png', 'slide-03.png']);
    const png = await zip.file('slide-01.png')!.async('nodebuffer');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('copy-only revision mints a new version and leaves unrelated slides byte-identical', async () => {
    const { service, repo, blob } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const before = gen.render.slideImages.map((si) => si.blobKey);
    const beforeHashes = await Promise.all(before.map(async (k) => pngHash((await blob.blob.get(k))!)));
    const rev = await service.revise('B', gen.asset.assetId, { kind: 'slide', slideId: gen.version.slides[1]!.slideId, request: 'shorten' }, { body: 'The case study documents a client who cut burn 30%.' });
    expect(rev.status).toBe('revised'); if (rev.status !== 'revised') return;
    expect(rev.version.versionNumber).toBe(2);
    // slide 1 & 3 unchanged structurally AND in the render
    expect(JSON.stringify(rev.version.slides[0])).toBe(JSON.stringify(gen.version.slides[0]));
    expect(JSON.stringify(rev.version.slides[2])).toBe(JSON.stringify(gen.version.slides[2]));
    const afterHashes = await Promise.all(rev.render.slideImages.map(async (si) => pngHash((await blob.blob.get(si.blobKey))!)));
    expect(afterHashes[0]).toBe(beforeHashes[0]); // hook render unchanged
    expect(afterHashes[2]).toBe(beforeHashes[2]); // cta render unchanged
    expect(afterHashes[1]).not.toBe(beforeHashes[1]); // revised proof slide changed
    expect(repo.revs).toHaveLength(1);
  });

  it('a revision whose copy cannot fit is rejected honestly (no silent shrink/unlock)', async () => {
    const { service } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const rev = await service.revise('B', gen.asset.assetId, { kind: 'slide', slideId: gen.version.slides[0]!.slideId, request: 'expand' }, { headline: 'X'.repeat(400) });
    expect(rev.status).toBe('revision_rejected');
    if (rev.status === 'revision_rejected') expect(rev.findings.some((f) => f.code === 'text_overflow' || f.code === 'below_min_font')).toBe(true);
  });

  it('an unsupported requested format returns unavailable (no silent substitution)', async () => {
    const repo = memRepo(); const blob = memBlob();
    const service = new CarouselService({ repo: repo.repo, model: fakeModel(), render: new ResvgCarouselRenderer(), blob: blob.blob, handoff: async () => ({ ...HANDOFF, requestedAssetFormat: 'reel_video' }), context: async () => CTX, businessName: async () => 'X', clock: () => 't' });
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('unavailable_format');
  });

  it('fails closed when copy asserts an unlicensed claim (reuses frozen proposition safety)', async () => {
    const bad = fakeModel({ orderedSlideCopy: [
      { slideKey: 's1', role: 'hook', headline: 'We guarantee we will double your revenue' },
      { slideKey: 's2', role: 'proof', headline: 'Proof', body: 'Every client triples their leads, guaranteed.' },
      { slideKey: 's3', role: 'cta', headline: 'Book a call' },
    ] });
    const { service, repo } = svc(bad);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('insufficient'); // unlicensed claims → repair → fail closed
    // the governing decision is recorded as a fail-closed trace (no persisted version)
    const t = repo.traces.at(-1);
    expect(t?.disposition).toBe('fail_closed');
    expect(t?.versionId).toBeNull();
    expect(t?.fullAssetFindings.length + t?.semanticBlockFindings.length).toBeGreaterThan(0);
  });

  it('“try a different angle” mints version N+1 with a genuinely different concept, preserving lineage', async () => {
    const model: ICarouselModelPort = {
      ...fakeModel(),
      chooseConcept: async (input) => ((input.repairReasons ?? []).some((r) => r.includes('different_angle'))
        ? { conceptId: 'c2', rationale: 'name the hidden cost first', communicationLogic: 'name the hidden cost of no finance leadership after raising, then position the diagnostic as the fix', slideOutline: ['hook', 'reframe', 'cta'], materialFeasibility: 'strategy-grounded reframe', internalFamily: 'problem_reframe' }
        : { conceptId: 'c1', rationale: 'lead with the documented outcome', communicationLogic: 'proof of a real burn-reduction outcome earns the diagnostic call', slideOutline: ['hook', 'proof', 'cta'], materialFeasibility: 'the documented case study grounds the proof slide', internalFamily: 'proof_breakdown' }),
      draftCopy: async (input) => (input.concept.internalFamily === 'problem_reframe'
        ? { communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'Raised, then flew blind on burn', orderedSlideCopy: [{ slideKey: 's1', role: 'hook', headline: 'Raised, then flew blind on burn' }, { slideKey: 's2', role: 'reframe', headline: 'The real problem', body: 'Without finance leadership, burn decisions get made late.' }, { slideKey: 's3', role: 'cta', headline: 'Get finance clarity' }], cta: 'Book a 20-minute diagnostic call', propositionBindings: [] }
        : { communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'The SaaS founder who got finance clarity', orderedSlideCopy: [{ slideKey: 's1', role: 'hook', headline: 'The SaaS founder who got finance clarity after raising' }, { slideKey: 's2', role: 'proof', headline: 'What the case study documents', body: 'A SaaS client cut burn 30% after getting finance clarity through the diagnostic call.' }, { slideKey: 's3', role: 'cta', headline: 'Want the same clarity?' }], cta: 'Book a 20-minute diagnostic call', propositionBindings: [{ blockRef: 's2:body', propositionRef: 'P1', sourceRefId: null, ctaFunction: null }] }),
    };
    // material that genuinely supports a proof_breakdown (a result + ≥2 decomposition facts) so §1 does not downgrade
    const angleCtx: CarouselContextView = { ...CTX, licensedPropositions: [
      { ref: 'P1', text: 'we help seed-stage SaaS founders get finance clarity through a diagnostic call', source: 'strategy_decision' },
      { ref: 'B1', text: 'we rebuilt the client’s runway model', source: 'business_evidence' },
      { ref: 'B2', text: 'we renegotiated three vendor contracts for the client', source: 'business_evidence' },
    ] };
    const repo = memRepo(); const blob = memBlob();
    const service = new CarouselService({ repo: repo.repo, model, render: new ResvgCarouselRenderer(), blob: blob.blob, judge: fakeJudge, handoff: async () => HANDOFF, context: async () => angleCtx, businessName: async () => 'X', clock: () => '2026-08-13T00:00:00.000Z' });
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    expect(gen.version.concept.internalFamily).toBe('proof_breakdown');
    const angle = await service.tryDifferentAngle('B', gen.asset.assetId);
    expect(angle.status).toBe('revised'); if (angle.status !== 'revised') return;
    expect(angle.version.versionNumber).toBe(2);
    expect(angle.version.concept.internalFamily).toBe('problem_reframe');
    expect(angle.version.concept.communicationLogic).not.toBe(gen.version.concept.communicationLogic);
    // version N is NOT overwritten, and lineage is recorded
    expect(repo.versions.find((v) => v.versionId === gen.version.versionId)).toBeTruthy();
    expect(repo.revs.some((r) => r.scope.kind === 'concept' && r.fromVersionId === gen.version.versionId && r.toVersionId === angle.version.versionId)).toBe(true);
  });

  it('renders a founder-uploaded source image into a real MediaSlot (Option A); reference_only never renders', async () => {
    const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const IMG_SRC = { sourceRefId: 'img1', sourceType: 'uploaded_image' as const, provenance: 'founder upload', reuseRight: 'founder_uploaded' as const, mediaRef: 'media/img1.png' };
    const REF_SRC = { sourceRefId: 'ref1', sourceType: 'website' as const, provenance: 'a competitor site', reuseRight: 'reference_only' as const, mediaRef: 'media/ref1.png' };
    const ctx: CarouselContextView = { ...CTX, sourceRefs: [IMG_SRC, REF_SRC] };
    const model: ICarouselModelPort = {
      ...fakeModel(),
      draftCopy: async (): Promise<CarouselCopyDraft> => ({
        communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'The SaaS founder who got finance clarity',
        orderedSlideCopy: [
          { slideKey: 's1', role: 'hook', headline: 'The SaaS founder who got finance clarity after raising' },
          { slideKey: 's2', role: 'proof', headline: 'What the case study documents', body: 'A SaaS client cut burn 30% after getting finance clarity through the diagnostic call.' },
          { slideKey: 's3', role: 'cta', headline: 'Want the same clarity?' },
        ],
        cta: 'Book a 20-minute diagnostic call',
        propositionBindings: [
          { blockRef: 's1:headline', propositionRef: null, sourceRefId: 'img1', ctaFunction: null }, // eligible media → renders
          { blockRef: 's2:body', propositionRef: 'P1', sourceRefId: 'ref1', ctaFunction: null },      // reference_only → must NOT render
        ],
      }),
    };
    const repo = memRepo(); const blob = memBlob();
    await blob.blob.put('media/img1.png', PNG_1x1); await blob.blob.put('media/ref1.png', PNG_1x1);
    const service = new CarouselService({ repo: repo.repo, model, render: new ResvgCarouselRenderer(), blob: blob.blob, judge: fakeJudge, handoff: async () => HANDOFF, context: async () => ctx, businessName: async () => 'X', clock: () => '2026-08-13T00:00:00.000Z' });
    const gen = await service.generate('B', 'ch1');
    expect(gen.status).toBe('created'); if (gen.status !== 'created') return;
    // eligible source → a real image MediaSlot; reference_only → NONE
    expect(gen.version.slides[0]!.mediaSlots.some((m) => m.kind === 'image' && m.sourceRefId === 'img1')).toBe(true);
    expect(gen.version.slides[1]!.mediaSlots).toHaveLength(0);
    // rendered cleanly (gates pass with the image drawn) and exports
    expect(gen.render.gateReport.valid).toBe(true);
    const exp = await service.export('B', gen.version.versionId);
    expect('zipKey' in exp).toBe(true);
  });

  it('assigns coherent role-based composition (hook / proof / cta read distinctly)', async () => {
    const { service } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const fam = (role: string) => gen.version.slides.find((s) => s.semanticRole === role)?.layoutFamily;
    expect(fam('hook')).toBeTruthy();
    expect(fam('cta')).toBe('cta_close');
    // hook and cta must not read as the same composition
    expect(fam('hook')).not.toBe(fam('cta'));
    // all slides belong to ONE coherent visual system
    expect(gen.version.visualSystem.visualSystemRef).toMatch(/canonical-default/);
  });

  it('"keep the copy, change the design" (visual_only) preserves copy/sources exactly, mints N+1, keeps N', async () => {
    // MVP: the base template is frozen (no visual variation yet), so this proves the revision LINEAGE holds —
    // copy/sources/authorization are byte-identical and Version N is never overwritten.
    const { service, repo } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const copyBefore = gen.version.slides.map((s) => JSON.stringify(s.textBlocks));
    const rev = await service.revise('B', gen.asset.assetId, { kind: 'visual_only', request: 'make it feel different' }, {});
    expect(rev.status).toBe('revised'); if (rev.status !== 'revised') return;
    expect(rev.version.versionNumber).toBe(2);
    expect(rev.version.slides.map((s) => JSON.stringify(s.textBlocks))).toEqual(copyBefore);
    expect(rev.version.slides.map((s) => s.sourceRefIds.join(','))).toEqual(gen.version.slides.map((s) => s.sourceRefIds.join(',')));
    expect(rev.version.authorizationSnapshotId).toBe(gen.version.authorizationSnapshotId);
    expect(repo.versions.find((v) => v.versionId === gen.version.versionId)).toBeTruthy(); // Version N intact
  });

  it('constrained realization fallback rescues a valid concept whose NORMAL drafts keep over-claiming', async () => {
    // NORMAL drafting always injects an unlicensed guarantee → every normal attempt fail-closes. The bounded
    // constrained fallback realizes the SAME concept faithfully from the authorized meaning → clean + persisted.
    const model: ICarouselModelPort = {
      ...fakeModel({ orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'We guarantee we will double your revenue' },
        { slideKey: 's2', role: 'proof', headline: 'Proof', body: 'Every client triples their leads, guaranteed.' },
        { slideKey: 's3', role: 'cta', headline: 'Book a call' },
      ] }),
      realizeConstrained: async (): Promise<CarouselCopyDraft> => ({
        communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'A note on finance clarity after raising',
        orderedSlideCopy: [
          { slideKey: 's1', role: 'hook', headline: 'After the raise' },
          { slideKey: 's2', role: 'proof', headline: 'What the case study documents', body: 'A SaaS client cut burn 30% after a diagnostic call.' },
          { slideKey: 's3', role: 'cta', headline: 'Ready to look at your numbers?' },
        ],
        cta: 'Book a 20-minute diagnostic call', propositionBindings: [
          { blockRef: 's2:headline', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null },
          { blockRef: 's2:body', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null },
        ],
      }),
    };
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('created'); if (res.status !== 'created') return;
    const t = repo.traces.at(-1);
    expect(t?.disposition).toBe('repaired_persisted');
    expect(t?.generationMode).toBe('constrained_fallback');
    expect(typeof t?.fallbackBindingsHash).toBe('string');
    expect(t?.versionId).toBe(res.version.versionId);
  });

  it('when the constrained fallback ALSO cannot produce safe copy, it fails closed honestly (mode recorded)', async () => {
    const model: ICarouselModelPort = {
      ...fakeModel({ orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'We guarantee we will double your revenue' },
        { slideKey: 's2', role: 'proof', headline: 'Proof', body: 'Every client triples their leads, guaranteed.' },
        { slideKey: 's3', role: 'cta', headline: 'Book a call' },
      ] }),
      // even the constrained realization over-claims → nothing safe may persist
      realizeConstrained: async (): Promise<CarouselCopyDraft> => ({
        communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'x',
        orderedSlideCopy: [
          { slideKey: 's1', role: 'hook', headline: 'We guarantee we will double your revenue' },
          { slideKey: 's2', role: 'proof', headline: 'Proof', body: 'Every client triples their leads, guaranteed.' },
          { slideKey: 's3', role: 'cta', headline: 'Book a call' },
        ],
        cta: 'Book a call', propositionBindings: [],
      }),
    };
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('insufficient');
    const t = repo.traces.at(-1);
    expect(t?.disposition).toBe('fail_closed');
    expect(t?.generationMode).toBe('constrained_fallback');
    expect(t?.versionId).toBeNull();
  });

  it('persists the immutable safety trace of the accepted carousel (governing decision + provenance)', async () => {
    const { service, repo } = svc(fakeModel());
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const t = repo.traces.at(-1);
    expect(t?.disposition).toBe('persisted');
    expect(t?.versionId).toBe(gen.version.versionId);
    expect(t?.authorizationSnapshotId).toBe(gen.version.authorizationSnapshotId);
    expect(t?.judgeModelId).toBe('judge-test');
    expect(typeof t?.propositionContractHash).toBe('string');
  });
});

// ── brand adaptation must NOT regenerate copy: one governed communication, three brands, only render differs ──
describe('Slice 6 — same governed copy under three brands (no LLM copy call; only render differs)', () => {
  function countingModel() {
    const counts = { chooseConcept: 0, draftCopy: 0 };
    const base = fakeModel();
    const model: ICarouselModelPort = { ...base,
      chooseConcept: async (i) => { counts.chooseConcept += 1; return base.chooseConcept(i); },
      draftCopy: async (i) => { counts.draftCopy += 1; return base.draftCopy(i); },
    };
    return { counts, model };
  }
  const HARBOR: any = { brandContextVersion: 'harbor', mode: 'known', constraints: { palette: ['#0e1f2b', '#eaf2f4', '#7fa0ab', '#3fb6a0'], typePreference: 'geometric' } };
  const MARBURY: any = { brandContextVersion: 'marbury', mode: 'known', constraints: { palette: ['#3a2a20', '#f2e9dd', '#b07a4a'], typePreference: 'humanist' } };

  it('renders the SAME copy under neutral / Harbor / Marbury with zero copy generation for the rebrands', async () => {
    const { counts, model } = countingModel();
    const { service, blob } = svc(model);
    const gen = await service.generate('B', 'ch1'); if (gen.status !== 'created') throw new Error('gen failed');
    const afterGen = { ...counts };

    const rbH = await service.renderUnderBrand('B', gen.version.versionId, HARBOR);
    const rbM = await service.renderUnderBrand('B', gen.version.versionId, MARBURY);
    expect(rbH.status).toBe('rendered'); expect(rbM.status).toBe('rendered');
    if (rbH.status !== 'rendered' || rbM.status !== 'rendered') return;

    // NO LLM copy call occurred for the rebrands
    expect(counts.chooseConcept).toBe(afterGen.chooseConcept);
    expect(counts.draftCopy).toBe(afterGen.draftCopy);

    // copy identity: text blocks, meaning bindings, authorization snapshot, concept all IDENTICAL
    const srcSlides = JSON.stringify(gen.version.slides);
    expect(JSON.stringify(rbH.version.slides)).toBe(srcSlides);
    expect(JSON.stringify(rbM.version.slides)).toBe(srcSlides);
    expect(rbH.version.authorizationSnapshotId).toBe(gen.version.authorizationSnapshotId);
    expect(rbM.version.authorizationSnapshotId).toBe(gen.version.authorizationSnapshotId);
    expect(rbH.version.concept).toEqual(gen.version.concept);

    // only the visual/render differs
    const hashOf = async (key: string) => pngHash((await blob.blob.get(key))!);
    const hn = await hashOf(gen.render.slideImages[0]!.blobKey);
    const hh = await hashOf(rbH.render.slideImages[0]!.blobKey);
    const hm = await hashOf(rbM.render.slideImages[0]!.blobKey);
    expect(hh).not.toBe(hm);   // Harbor ≠ Marbury pixels
    expect(hh).not.toBe(hn);   // Harbor ≠ neutral pixels
    expect(rbH.version.visualSystem).not.toEqual(gen.version.visualSystem); // brand tokens changed
  });
});

// ── §2–§10: TARGETED CONSTRAINED REPAIR (one bounded, block-scoped repair after the constrained fallback) ──
describe('Slice 6 — targeted constrained repair (one bounded, block-scoped fix; unrelated blocks byte-identical)', () => {
  const BAD_NORMAL = [ // guarantees a normal-path fail-close so the constrained fallback (then repair) is reached
    { slideKey: 's1', role: 'hook' as const, headline: 'We guarantee we will double your revenue' },
    { slideKey: 's2', role: 'proof' as const, headline: 'Proof', body: 'Every client triples their leads, guaranteed.' },
    { slideKey: 's3', role: 'cta' as const, headline: 'Book a call' },
  ];
  /** A constrained model: normal always over-claims; realize/repair/classify are supplied per test. */
  function crModel(over: { realize: ICarouselModelPort['realizeConstrained']; repair?: ICarouselModelPort['repairConstrained']; classify?: ICarouselModelPort['classifyAntiTemplate'] }): ICarouselModelPort {
    return { ...fakeModel({ orderedSlideCopy: BAD_NORMAL }), realizeConstrained: over.realize, ...(over.repair ? { repairConstrained: over.repair } : {}), ...(over.classify ? { classifyAntiTemplate: over.classify } : {}) };
  }
  const bodyOf = (v: any, role: string) => v.slides.find((s: any) => s.semanticRole === role)?.textBlocks.find((b: any) => b.role === 'body')?.text;
  const headOf = (v: any, role: string) => v.slides.find((s: any) => s.semanticRole === role)?.textBlocks.find((b: any) => b.role === 'headline')?.text;

  it('A. one unsafe block → only that block is rewritten; unrelated blocks stay byte-identical', async () => {
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        { slideKey: 's2', role: 'proof', headline: 'The documented result', body: 'Every client triples their leads, guaranteed.' },
        { slideKey: 's3', role: 'cta', headline: 'Ready to review your numbers?' },
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [
        { blockRef: 's2:headline', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null },
        { blockRef: 's2:body', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null },
      ] }),
      repair: async ({ targets }) => targets.map((t) => ({ slideId: t.slideId, blockId: t.blockId, newText: 'A SaaS client cut burn 30% after the engagement.' })),
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('created'); if (res.status !== 'created') return;
    const tr = repo.traces.at(-1)?.targetedRepair;
    expect(tr?.triggered).toBe(true);
    expect(tr?.result).toBe('persisted');
    expect(tr?.repairs[0]?.gateClass).toBe('safety');
    expect(tr?.repairs[0]?.beforeHash).not.toBe(tr?.repairs[0]?.afterHash);
    // only the proof body changed; hook headline + proof framing headline are untouched
    expect(bodyOf(res.version, 'proof')).toBe('A SaaS client cut burn 30% after the engagement.');
    expect(headOf(res.version, 'hook')).toBe('After the raise');
    expect(headOf(res.version, 'proof')).toBe('The documented result');
  });

  it('B. one overflowing block → only that block is shortened; its meaning refs are preserved', async () => {
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        // real strategy tokens (not "generic") + one unbreakable long token that cannot fit on any line → overflow
        { slideKey: 's2', role: 'proof', headline: 'Seed stage SaaS founders finance burn diagnostic runway ' + 'D'.repeat(240) },
        { slideKey: 's3', role: 'cta', headline: 'Ready to review your numbers?' },
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [{ blockRef: 's2:headline', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null }] }),
      repair: async ({ targets }) => targets.map((t) => ({ slideId: t.slideId, blockId: t.blockId, newText: 'A SaaS client cut burn 30%.' })),
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('created'); if (res.status !== 'created') return;
    const tr = repo.traces.at(-1)?.targetedRepair;
    expect(tr?.result).toBe('persisted');
    expect(tr?.repairs[0]?.gateClass).toBe('overflow');
    expect(tr?.repairs[0]?.meaningUnitRefs).toContain('PF1'); // binding preserved
    expect(headOf(res.version, 'proof')).toBe('A SaaS client cut burn 30%.');
  });

  it('C. a redundant CTA → only the CTA block is changed', async () => {
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        { slideKey: 's2', role: 'proof', body: 'A SaaS client cut burn 30% after the engagement.' },
        { slideKey: 's3', role: 'cta', headline: 'Book a 20-minute diagnostic call' }, // duplicates the CTA line → redundant
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [{ blockRef: 's2:body', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null }] }),
      repair: async ({ targets }) => targets.map((t) => ({ slideId: t.slideId, blockId: t.blockId, newText: 'Book your fractional-CFO diagnostic' })),
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('created'); if (res.status !== 'created') return;
    const tr = repo.traces.at(-1)?.targetedRepair;
    expect(tr?.result).toBe('persisted');
    expect(tr?.repairs.every((r: { gateClass: string }) => r.gateClass === 'closure')).toBe(true);
    expect(bodyOf(res.version, 'proof')).toBe('A SaaS client cut burn 30% after the engagement.'); // body untouched
  });

  it('D. a non-local (binding) failure does NOT invoke targeted repair — honest not_repairable fail-close', async () => {
    let repairCalled = false;
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        { slideKey: 's2', role: 'proof', body: 'A SaaS client cut burn 30% after the engagement.' }, // NO binding → unbound_block
        { slideKey: 's3', role: 'cta', headline: 'Ready to review your numbers?' },
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [] }),
      repair: async ({ targets }) => { repairCalled = true; return targets.map((t) => ({ slideId: t.slideId, blockId: t.blockId, newText: 'x' })); },
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('insufficient');
    expect(repairCalled).toBe(false);
    expect(repo.traces.at(-1)?.targetedRepair?.result).toBe('not_repairable');
    expect(repo.versions).toHaveLength(0);
  });

  it('E. a repair that introduces a new claim is caught by full safety → fail-closed', async () => {
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        { slideKey: 's2', role: 'proof', body: 'Every client triples their leads, guaranteed.' },
        { slideKey: 's3', role: 'cta', headline: 'Ready to review your numbers?' },
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [{ blockRef: 's2:body', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null }] }),
      repair: async ({ targets }) => targets.map((t) => ({ slideId: t.slideId, blockId: t.blockId, newText: 'We will double your revenue, guaranteed.' })), // still unlicensed
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('insufficient');
    expect(repo.traces.at(-1)?.targetedRepair?.result).toBe('fail_closed');
    expect(repo.versions).toHaveLength(0);
  });

  it('F. an unsuccessful repair (no fix produced) fails closed honestly', async () => {
    const model = crModel({
      realize: async () => ({ communicationJob: HANDOFF.communicationJob!, language: 'en', hook: 'After the raise', orderedSlideCopy: [
        { slideKey: 's1', role: 'hook', headline: 'After the raise' },
        { slideKey: 's2', role: 'proof', body: 'Every client triples their leads, guaranteed.' },
        { slideKey: 's3', role: 'cta', headline: 'Ready to review your numbers?' },
      ], cta: 'Book a 20-minute diagnostic call', propositionBindings: [{ blockRef: 's2:body', propositionRef: 'PF1', sourceRefId: null, ctaFunction: null }] }),
      repair: async () => [], // model produced no fix
    });
    const { service, repo } = svc(model);
    const res = await service.generate('B', 'ch1');
    expect(res.status).toBe('insufficient');
    expect(repo.traces.at(-1)?.targetedRepair?.result).toBe('fail_closed');
    expect(repo.versions).toHaveLength(0);
  });
});
