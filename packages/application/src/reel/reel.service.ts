/**
 * Slice 7 — ReelService (Vertical 1: "Use my clips"). Orchestrates the shared reel engine:
 *   observe (probe + vision + transcribe talking-heads) → ONE strategy-specific ReelOpportunity (exact ranges) →
 *   accept (govern copy + spoken claims via the FROZEN kernel → immutable EDL + authorization snapshot + asset
 *   version) → render (real ffmpeg MP4 + poster) → one targeted revision (swap opening) → export.
 * Adds NO claim authority; media moves pixels, it never manufactures truth.
 */
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { generateId } from '@bb/shared';
import type { PropositionJudge } from '../voice/proposition-safety';
import type {
  IReelRepository, IReelRenderPort, IObjectStore, IVideoObservationModelPort, IReelOpportunityModelPort, ITranscriptionPort,
  ReelContextView, VideoSetUnderstanding, ClipObservation, ReelOpportunity, ReelAuthorizationSnapshot,
  ReelAsset, ReelAssetVersion, ReelRenderVersion, ReelTextBlock, SelectedClipRange, ReelLanguageConfig,
  ReelSafetyTrace, ReelSpokenClaimTrace, ReelJob, ReelJobStage, MissingShot, EditingEnergy,
} from './contracts';
import {
  setSignal, hashOf, observedTokens, filterRenderableRanges, validateSelectionRefs, assessNonTransplantable,
  assessSufficiency, targetDuration, buildTimeline, edlHash, disposeSpokenClaim, isLoadBearingRange, spokenTextOf,
  deriveEditingEnergy, assessEditorialFit, leadWith, CALMER_SHOT_GAP,
} from './reel';
import { governReelCopy, spokenClaimIsUnauthorized } from './reel-safety';

export interface ReelDeps {
  readonly repo: IReelRepository;
  readonly observationModel: IVideoObservationModelPort;
  readonly opportunityModel: IReelOpportunityModelPort;
  readonly transcription: ITranscriptionPort;
  readonly render: IReelRenderPort;
  readonly objectStore: IObjectStore;
  readonly context: (businessId: string) => Promise<ReelContextView | null>;
  readonly businessName: (businessId: string) => Promise<string>;
  readonly currentPlan: (businessId: string) => Promise<{ planVersionId: string; actionId: string | null } | null>;
  readonly createHandoff?: (businessId: string, opportunity: ReelOpportunity, ctx: ReelContextView) => Promise<{ createHandoffId: string } | null>;
  readonly judge?: { check?: PropositionJudge; contract?: () => { modelId: string; promptHash: string } };
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

const MAX_ANGLE_ATTEMPTS = 2;
const CANVAS = { width: 1080, height: 1920, fps: 30 };

export type ObserveResult = { status: 'observed'; understanding: VideoSetUnderstanding } | { status: 'no_clips' };
export type RecommendResult = { status: 'recommended'; opportunity: ReelOpportunity } | { status: 'no_strategy' } | { status: 'not_found' };
export type AcceptResult = { status: 'accepted'; asset: ReelAsset; version: ReelAssetVersion } | { status: 'insufficient' } | { status: 'not_found' } | { status: 'fail_closed'; reason: string };
export type RenderResult = { status: 'rendered'; render: ReelRenderVersion } | { status: 'not_found' } | { status: 'render_failed'; reason: string };
export type ReviseResult = { status: 'revised'; version: ReelAssetVersion; render: ReelRenderVersion | null } | { status: 'not_found' } | { status: 'no_alternative' } | { status: 'fail_closed'; reason: string };

export class ReelService {
  constructor(private readonly deps: ReelDeps) {}
  private now(): string { return this.deps.clock ? this.deps.clock() : new Date(2026, 0, 1).toISOString(); }

  private async setStage(job: ReelJob | null, stage: ReelJobStage, patch: Partial<ReelJob> = {}): Promise<void> {
    if (!job) return;
    await this.deps.repo.saveJob({ ...job, ...patch, stage, updatedAt: this.now() });
    this.deps.log?.({ type: 'reel_stage', detail: stage });
  }

  /** OBSERVE — download each renderable clip, ffprobe, sample frames, run vision (literal facts), transcribe
   * talking-heads. Persists an immutable VideoSetUnderstanding. No business truth is produced here. */
  async observeUploadSet(businessId: string, uploadSetId: string, job: ReelJob | null = null): Promise<ObserveResult> {
    const sources = await this.deps.repo.listSources(businessId, uploadSetId);
    if (!sources.length) return { status: 'no_clips' };
    const dir = mkdtempSync(join(tmpdir(), 'reel-obs-'));
    try {
      const files: Record<string, string> = {};
      const probes: Record<string, Awaited<ReturnType<IReelRenderPort['probe']>>> = {};
      await this.setStage(job, 'probing');
      for (const s of sources) {
        const dest = join(dir, `${s.sourceRefId}.bin`);
        const ok = await this.deps.objectStore.getToFile(s.objectKey, dest);
        if (!ok) continue;
        files[s.sourceRefId] = dest;
        probes[s.sourceRefId] = await this.deps.render.probe(dest);
      }
      await this.setStage(job, 'observing');
      const obsInput = sources.filter((s) => files[s.sourceRefId]).map((s) => ({ sourceRefId: s.sourceRefId, probe: probes[s.sourceRefId]!, frames: [] as { atMs: number; png: Buffer }[] }));
      // sample up to 3 frames per clip at 15%/50%/85%
      for (const c of obsInput) {
        const d = probes[c.sourceRefId]!.durationMs;
        c.frames = await this.deps.render.sampleFrames(files[c.sourceRefId]!, [d * 0.15, d * 0.5, d * 0.85].map((x) => Math.round(x)));
      }
      const raw = await this.deps.observationModel.observe(obsInput);
      const observations: ClipObservation[] = raw.map((o) => ({ ...o, observationId: generateId(), transcriptRef: null }));

      // transcribe talking-heads with speech (capability-driven; degrades honestly)
      await this.setStage(job, 'transcribing');
      for (const o of observations) {
        if (o.shot !== 'talking_head' || !o.speechPresent || !o.hasAudio) continue;
        const audio = join(dir, `${o.sourceRefId}.audio`);
        try {
          const t = await this.deps.transcription.transcribe({ sourceRefId: o.sourceRefId, audioPath: files[o.sourceRefId]! });
          if (t.status === 'transcribed') { await this.deps.repo.saveTranscript(t); (o as { transcriptRef: string | null }).transcriptRef = t.transcriptId; }
        } catch (e) { this.deps.log?.({ type: 'reel_transcribe_failed', detail: String(e) }); }
        void audio;
      }

      const core = { businessId, uploadSetId, observations, setSignal: setSignal(observations) };
      const understanding: VideoSetUnderstanding = {
        videoSetUnderstandingId: generateId(), ...core,
        modelId: this.deps.observationModel.descriptor?.().modelId ?? null, contentHash: hashOf(core), producedAt: this.now(),
      };
      await this.deps.repo.saveVideoSetUnderstanding(understanding);
      await this.setStage(job, 'understanding_ready', { videoSetUnderstandingId: understanding.videoSetUnderstandingId });
      return { status: 'observed', understanding };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** RECOMMEND — one strategy-specific, non-transplantable reel opportunity with EXACT ranges + sufficiency. */
  async recommend(businessId: string, videoSetUnderstandingId: string, avoid?: string, job: ReelJob | null = null): Promise<RecommendResult> {
    const vs = await this.deps.repo.getVideoSetUnderstanding(businessId, videoSetUnderstandingId);
    if (!vs) return { status: 'not_found' };
    const ctx0 = await this.deps.context(businessId);
    if (!ctx0) return { status: 'no_strategy' };
    const sources = ctx0.sourceRefs.length ? ctx0.sourceRefs : await this.deps.repo.listSources(businessId, vs.uploadSetId);
    const ctx = { ...ctx0, sourceRefs: sources };
    const businessName = await this.deps.businessName(businessId).catch(() => 'your business');
    const plan = await this.deps.currentPlan(businessId).catch(() => null);
    const strategyTokens = new Set([...tok(ctx.goal), ...tok(ctx.coreBet), ...tok(ctx.audience)]);
    const observed = observedTokens(vs);
    const hasClaimBasis = ctx.licensedPropositions.length > 0 || ctx.proofFacts.length > 0;
    // treatment intent for THIS strategy (founder-invisible) — the opener's visual energy is matched against it
    const editingEnergy: EditingEnergy = deriveEditingEnergy([ctx.goal, ctx.coreBet, ctx.positioning].join(' '));

    let ntReason = '';
    let avoidNext = avoid;
    for (let attempt = 0; attempt < MAX_ANGLE_ATTEMPTS; attempt++) {
      const draft = await this.deps.opportunityModel.recommend({
        videoSet: vs, goal: ctx.goal, coreBet: ctx.coreBet, audience: ctx.audience, positioning: ctx.positioning,
        ctaDirection: ctx.ctaDirection, businessName, voiceLines: ctx.voiceLines, language: ctx.language || 'en', editingEnergy,
        ...(avoidNext || attempt > 0 ? { avoid: avoidNext ?? 'the previous generic angle; be specific to these clips and this strategy' } : {}),
      });
      const nt = assessNonTransplantable(draft, businessName, strategyTokens, observed);
      ntReason = nt.reason;
      if (!nt.ok) { this.deps.log?.({ type: 'reel_opportunity_transplantable', detail: nt.reason }); continue; }

      const refCheck = validateSelectionRefs(draft.selectedRanges, vs);
      const refClean = refCheck.ok ? draft.selectedRanges : draft.selectedRanges.filter((r) => vs.observations.some((o) => o.observationId === r.observationRef && o.sourceRefId === r.sourceRefId));
      const { kept, dropped } = filterRenderableRanges(refClean, ctx.sourceRefs, vs.observations);

      // ── editorial-fit gate: the opener's VISUAL ENERGY must not contradict the concept's treatment ──
      let ranges = kept;
      const extraMissing: MissingShot[] = [];
      const fit = assessEditorialFit(kept, vs.observations, editingEnergy);
      if (fit.verdict === 'conflict_has_alternative' && attempt < MAX_ANGLE_ATTEMPTS - 1) {
        // give the model one chance to produce a coherent, energy-matched concept (opener + prose together)
        avoidNext = `opening on the highest-motion / most intense clip. This is a ${editingEnergy} treatment: lead with a calmer clip and keep any intense clip for a later supporting beat.`;
        this.deps.log?.({ type: 'reel_editorial_fit', detail: 'reprompt: calm concept must not open on high-energy footage' });
        continue;
      }
      if (fit.verdict === 'conflict_has_alternative') {
        ranges = leadWith(kept, fit.calmerLeadRef!);   // deterministic backstop — demote the intense opener
        this.deps.log?.({ type: 'reel_editorial_fit', detail: 'backstop: demoted intense opener; calmer clip leads' });
      } else if (fit.verdict === 'conflict_no_alternative') {
        extraMissing.push(CALMER_SHOT_GAP);            // honest ask — never fabricate calmness
        this.deps.log?.({ type: 'reel_editorial_fit', detail: 'requested a calmer shot (all footage is high energy)' });
      } else if (fit.verdict === 'understrength_has_alternative') {
        ranges = leadWith(kept, fit.energeticLeadRef!);// energetic concept leads with the strongest-energy clip
        this.deps.log?.({ type: 'reel_editorial_fit', detail: 'energetic concept leads with high-energy clip' });
      }

      const missingMaterial = [...draft.missingMaterial, ...extraMissing];
      const sufficiency = assessSufficiency(ranges, hasClaimBasis, missingMaterial);
      const origin = plan?.actionId ? 'plan_action' as const : 'strategic_opportunity' as const;
      const opportunity: ReelOpportunity = {
        opportunityId: generateId(), businessId, videoSetUnderstandingId, origin,
        strategyVersionId: ctx.strategyVersionId, planVersionId: plan?.planVersionId ?? null, actionId: plan?.actionId ?? null,
        communicationJob: draft.communicationJob, narrativeArc: draft.narrativeArc, ctaDirection: draft.ctaDirection ?? ctx.ctaDirection,
        whyFootageSupports: draft.whyFootageSupports, strategicConnection: draft.strategicConnection, nonTransplantabilityTrace: draft.nonTransplantabilityTrace,
        selectedRanges: ranges, excludedClips: [...dropped, ...draft.excludedClips], targetDurationMs: targetDuration(ranges, draft.targetDurationMs),
        sufficiency, missingMaterial, founderLegibleRecommendation: draft.founderLegibleRecommendation,
        alternativeAvailable: true, language: ctx.language || 'en', editingEnergy, proposedHook: draft.hookText, proposedCta: draft.ctaText,
        modelId: this.deps.opportunityModel.descriptor?.().modelId ?? null, producedAt: this.now(),
      };
      await this.deps.repo.saveOpportunity(opportunity);
      await this.setStage(job, 'opportunity_ready', { opportunityId: opportunity.opportunityId });
      this.deps.log?.({ type: 'reel_opportunity', detail: `${sufficiency} | ${kept.length} ranges` });
      return { status: 'recommended', opportunity };
    }
    const blocked: ReelOpportunity = {
      opportunityId: generateId(), businessId, videoSetUnderstandingId, origin: 'strategic_opportunity',
      strategyVersionId: ctx.strategyVersionId, planVersionId: plan?.planVersionId ?? null, actionId: plan?.actionId ?? null,
      communicationJob: '', narrativeArc: '', ctaDirection: ctx.ctaDirection, whyFootageSupports: '', strategicConnection: '',
      nonTransplantabilityTrace: ntReason, selectedRanges: [], excludedClips: [], targetDurationMs: 0, sufficiency: 'insufficient',
      missingMaterial: [], founderLegibleRecommendation: 'These clips don’t support a specific reel for your strategy yet.',
      alternativeAvailable: false, language: ctx.language || 'en', editingEnergy, proposedHook: '', proposedCta: null,
      modelId: this.deps.opportunityModel.descriptor?.().modelId ?? null, producedAt: this.now(),
    };
    await this.deps.repo.saveOpportunity(blocked);
    return { status: 'recommended', opportunity: blocked };
  }

  async alternative(businessId: string, opportunityId: string): Promise<RecommendResult> {
    const prior = await this.deps.repo.getOpportunity(businessId, opportunityId);
    if (!prior) return { status: 'not_found' };
    return this.recommend(businessId, prior.videoSetUnderstandingId, prior.communicationJob || 'the previous angle');
  }

  /** ACCEPT — govern copy + spoken claims → immutable EDL + authorization snapshot + ReelAssetVersion. */
  async accept(businessId: string, opportunityId: string): Promise<AcceptResult> {
    const opp = await this.deps.repo.getOpportunity(businessId, opportunityId);
    if (!opp) return { status: 'not_found' };
    if (opp.sufficiency === 'insufficient') return { status: 'insufficient' };
    const vs = await this.deps.repo.getVideoSetUnderstanding(businessId, opp.videoSetUnderstandingId);
    if (!vs) return { status: 'not_found' };
    const ctx0 = await this.deps.context(businessId);
    if (!ctx0) return { status: 'fail_closed', reason: 'no strategy at accept time' };
    const sources = ctx0.sourceRefs.length ? ctx0.sourceRefs : await this.deps.repo.listSources(businessId, vs.uploadSetId);
    const ctx = { ...ctx0, sourceRefs: sources };

    const snapshot = this.buildSnapshot(businessId, opp, ctx);
    const spokenTraces: ReelSpokenClaimTrace[] = [];

    // spoken-claim disposition per talking-head range (using a clip ≠ broadcasting its claim)
    const ranges: SelectedClipRange[] = [...opp.selectedRanges];
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      const o = vs.observations.find((x) => x.observationId === r.observationRef);
      if (!o || o.shot !== 'talking_head' || !o.transcriptRef) continue;
      const transcript = await this.deps.repo.getTranscript(o.transcriptRef);
      const spoken = spokenTextOf(r, transcript);
      if (!spoken) continue;
      const unauthorized = await spokenClaimIsUnauthorized(spoken, snapshot, opp.communicationJob, this.deps.judge?.check);
      const loadBearing = isLoadBearingRange(r, ranges);
      const disp = disposeSpokenClaim({ hasUnauthorizedClaim: unauthorized, loadBearing });
      spokenTraces.push({ sourceRefId: r.sourceRefId, clause: spoken.slice(0, 120), disposition: disp });
      if (disp === 'load_bearing_blocked') {
        await this.persistSafetyTrace(businessId, generateId(), null, snapshot, [], spokenTraces, 'fail_closed');
        this.deps.log?.({ type: 'reel_fail_closed', detail: 'load-bearing unsupported spoken claim' });
        return { status: 'fail_closed', reason: 'A load-bearing spoken line makes a claim your material doesn’t support.' };
      }
      if (disp === 'incidental_use_muted') ranges[i] = { ...r, audioUse: 'muted' };  // keep the visual, drop the claim
    }

    // governed on-screen copy (hook + CTA); fall back to an authorized proposition if the proposed hook over-claims
    let textBlocks = this.buildTextBlocks(opp, ctx);
    let findings = await governReelCopy(textBlocks, snapshot, opp.communicationJob, this.deps.judge?.check);
    if (findings.length) {
      const fallbackHook = ctx.proofFacts[0] ?? ctx.licensedPropositions.find((p) => p.source !== 'strategy_decision')?.text ?? ctx.ownedStances[0] ?? '';
      if (fallbackHook) {
        textBlocks = textBlocks.map((b) => (b.role === 'hook' ? { ...b, text: fallbackHook } : b));
        findings = await governReelCopy(textBlocks, snapshot, opp.communicationJob, this.deps.judge?.check);
      }
    }
    if (findings.length) {
      const assetId = generateId();
      await this.persistSafetyTrace(businessId, assetId, null, snapshot, findings, spokenTraces, 'fail_closed');
      this.deps.log?.({ type: 'reel_fail_closed', detail: `copy: ${findings.length} unauthorized` });
      return { status: 'fail_closed', reason: 'The on-screen copy asserted something your material doesn’t license.' };
    }

    await this.deps.repo.saveAuthorizationSnapshot(snapshot);
    const timeline = buildTimeline(ranges, textBlocks, CANVAS);
    const hash = edlHash(timeline, textBlocks);
    const assetId = generateId();
    const transcriptRefs = [...new Set(vs.observations.map((o) => o.transcriptRef).filter((x): x is string => Boolean(x)))];
    const version = this.composeVersion(assetId, businessId, 1, opp, ctx, snapshot, timeline, textBlocks, hash, transcriptRefs);
    const asset: ReelAsset = { assetId, businessId, createHandoffId: snapshot.createHandoffId, strategyVersionId: ctx.strategyVersionId, currentVersionId: version.versionId, createdAt: this.now() };
    await this.deps.repo.saveVersion(version);
    await this.deps.repo.saveAsset(asset);
    await this.persistSafetyTrace(businessId, assetId, version.versionId, snapshot, [], spokenTraces, 'persisted');
    this.deps.log?.({ type: 'reel_accepted', detail: `edl ${hash.slice(0, 12)} · ${timeline.segments.length} segs` });
    return { status: 'accepted', asset, version };
  }

  /** RENDER — real MP4 + poster from the immutable EDL; persist a RenderVersion (idempotent by edlHash). */
  async render(businessId: string, versionId: string, job: ReelJob | null = null): Promise<RenderResult> {
    const version = await this.deps.repo.getVersion(businessId, versionId);
    if (!version) return { status: 'not_found' };
    const existing = await this.deps.repo.getRender(versionId);
    if (existing && existing.edlHash === version.edlHash) return { status: 'rendered', render: existing };
    await this.setStage(job, 'rendering');
    const dir = mkdtempSync(join(tmpdir(), 'reel-render-'));
    try {
      const sourceFiles: Record<string, string> = {};
      for (const s of version.sourceManifest) {
        if (!version.timeline.segments.some((seg) => seg.sourceRefId === s.sourceRefId)) continue;
        const dest = join(dir, `${s.sourceRefId}.bin`);
        if (await this.deps.objectStore.getToFile(s.objectKey, dest)) sourceFiles[s.sourceRefId] = dest;
      }
      const out = await this.deps.render.render({ timeline: version.timeline, textBlocks: version.textBlocks, sourceFiles });
      const mp4Key = `reel/${businessId}/${version.versionId}/reel.mp4`;
      const posterKey = `reel/${businessId}/${version.versionId}/poster.jpg`;
      await this.deps.objectStore.put(mp4Key, out.mp4, 'video/mp4');
      await this.deps.objectStore.put(posterKey, out.poster, 'image/jpeg');
      const rv: ReelRenderVersion = {
        renderId: generateId(), versionId: version.versionId, rendererVersion: out.rendererVersion, ffmpegBuild: out.ffmpegBuild,
        edlHash: version.edlHash, renderParams: out.renderParams, mp4Key, posterKey, widthPx: out.widthPx, heightPx: out.heightPx,
        durationMs: out.durationMs, gateValid: out.widthPx === 1080 && out.heightPx === 1920 && out.durationMs > 0, producedAt: this.now(),
      };
      await this.deps.repo.saveRender(rv);
      await this.setStage(job, 'ready');
      this.deps.log?.({ type: 'reel_rendered', detail: `${out.durationMs}ms ${out.widthPx}x${out.heightPx}` });
      return { status: 'rendered', render: rv };
    } catch (e) {
      await this.setStage(job, 'failed', { failureReason: String(e) });
      this.deps.log?.({ type: 'reel_render_failed', detail: String(e) });
      return { status: 'render_failed', reason: String(e) };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** REVISION — "use a different opening clip": swap segment 0's source/range, preserve every other segment's
   * identity + the authorization, mint ReelAssetVersion N+1, re-render. V1 stays immutable. */
  async reviseOpening(businessId: string, assetId: string, newOpening: { sourceRefId: string; observationRef: string; inMs: number; outMs: number } | null, opts?: { deferRender?: boolean }): Promise<ReviseResult> {
    const asset = await this.deps.repo.getAsset(businessId, assetId);
    if (!asset) return { status: 'not_found' };
    const cur = await this.deps.repo.getVersion(businessId, asset.currentVersionId);
    if (!cur) return { status: 'not_found' };
    const snapshot = await this.deps.repo.getAuthorizationSnapshot(businessId, cur.authorizationSnapshotId);
    if (!snapshot) return { status: 'not_found' };
    const vs = await this.deps.repo.getVideoSetUnderstanding(businessId, cur.videoSetUnderstandingId);
    const opp = await this.deps.repo.getOpportunity(businessId, cur.opportunityId);
    if (!vs || !opp) return { status: 'not_found' };

    // choose the new opening: the founder's pick, else the next-best eligible unused range (a 'build' range)
    let pick = newOpening;
    if (!pick) {
      const usedKeys = new Set(cur.timeline.segments.map((s) => `${s.sourceRefId}:${s.inMs}`));
      const candidate = opp.selectedRanges.find((r) => r.role !== 'hook' && !usedKeys.has(`${r.sourceRefId}:${r.inMs}`))
        ?? opp.selectedRanges.find((r) => `${r.sourceRefId}:${r.inMs}` !== `${cur.timeline.segments[0]!.sourceRefId}:${cur.timeline.segments[0]!.inMs}`);
      if (!candidate) return { status: 'no_alternative' };
      pick = { sourceRefId: candidate.sourceRefId, observationRef: candidate.observationRef, inMs: candidate.inMs, outMs: candidate.outMs };
    }
    const check = validateSelectionRefs([{ ...pick, role: 'hook', audioUse: 'original' }], vs);
    if (!check.ok) return { status: 'fail_closed', reason: check.error ?? 'invalid opening' };
    const src = cur.sourceManifest.find((s) => s.sourceRefId === pick!.sourceRefId);
    if (!src) return { status: 'fail_closed', reason: 'opening source not in manifest' };

    // rebuild ranges: new opener as hook, old opener demoted to build; every other range preserved.
    const oldHead = cur.timeline.segments[0]!;
    const rest = cur.timeline.segments.slice(1).map((s): SelectedClipRange => ({ sourceRefId: s.sourceRefId, observationRef: refOf(vs, s.sourceRefId, s.inMs), inMs: s.inMs, outMs: s.outMs, role: s.role, audioUse: s.audioUse }));
    const demoted: SelectedClipRange = { sourceRefId: oldHead.sourceRefId, observationRef: refOf(vs, oldHead.sourceRefId, oldHead.inMs), inMs: oldHead.inMs, outMs: oldHead.outMs, role: 'build', audioUse: oldHead.audioUse };
    const newRanges: SelectedClipRange[] = [{ ...pick, role: 'hook', audioUse: 'original' }, demoted, ...rest.filter((r) => !(r.sourceRefId === oldHead.sourceRefId && r.inMs === oldHead.inMs))];

    const timeline = buildTimeline(newRanges, cur.textBlocks, CANVAS);
    const hash = edlHash(timeline, cur.textBlocks);
    const version = this.composeVersion(assetId, businessId, cur.versionNumber + 1, opp, this.ctxFromVersion(cur), snapshot, timeline, cur.textBlocks, hash, cur.transcriptRefs);
    await this.deps.repo.saveVersion(version);
    await this.deps.repo.setCurrentVersion(assetId, version.versionId);
    await this.deps.repo.recordRevision({ assetId, fromVersionId: cur.versionId, toVersionId: version.versionId, scope: 'swap_opening', at: this.now() });
    if (opts?.deferRender) return { status: 'revised', version, render: null }; // render enqueued by the caller (async worker)
    const r = await this.render(businessId, version.versionId);
    if (r.status !== 'rendered') return { status: 'fail_closed', reason: 'revised render failed' };
    return { status: 'revised', version, render: r.render };
  }

  // ── helpers ──
  private buildSnapshot(businessId: string, opp: ReelOpportunity, ctx: ReelContextView): ReelAuthorizationSnapshot {
    const judge = this.deps.judge?.contract?.();
    return {
      snapshotId: generateId(), businessId, createHandoffId: null, strategyVersionId: ctx.strategyVersionId,
      language: ctx.language || 'en', speakingRole: ctx.speakingRole, audienceUseContext: ctx.audience,
      licensedPropositions: ctx.licensedPropositions, proofFacts: ctx.proofFacts, ctaFunction: opp.ctaDirection ?? ctx.ctaDirection,
      ownedStances: ctx.ownedStances, sourceRefIds: ctx.sourceRefs.map((s) => s.sourceRefId),
      modelId: judge?.modelId ?? null, safetyContractHash: judge?.promptHash ?? null, producedAt: this.now(),
    };
  }
  private buildTextBlocks(opp: ReelOpportunity, ctx: ReelContextView): ReelTextBlock[] {
    const blocks: ReelTextBlock[] = [];
    if (opp.proposedHook.trim()) blocks.push({ blockId: generateId(), role: 'hook', text: opp.proposedHook.trim(), language: opp.language, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: null } });
    if (opp.proposedCta && opp.proposedCta.trim()) blocks.push({ blockId: generateId(), role: 'cta', text: opp.proposedCta.trim(), language: opp.language, authorizedFrom: { propositionRef: null, sourceRefId: null, ctaFunction: opp.ctaDirection ?? ctx.ctaDirection } });
    return blocks;
  }
  private composeVersion(assetId: string, businessId: string, n: number, opp: ReelOpportunity, ctx: ReelContextView, snapshot: ReelAuthorizationSnapshot, timeline: ReturnType<typeof buildTimeline>, textBlocks: ReelTextBlock[], hash: string, transcriptRefs: string[]): ReelAssetVersion {
    const language: ReelLanguageConfig = { uiLanguage: ctx.language || 'en', contentLanguage: opp.language, captionLanguage: null };
    const base = {
      versionId: generateId(), assetId, versionNumber: n, businessId, opportunityId: opp.opportunityId, videoSetUnderstandingId: opp.videoSetUnderstandingId,
      authorizationSnapshotId: snapshot.snapshotId, strategyVersionId: ctx.strategyVersionId, planVersionId: opp.planVersionId, createHandoffId: snapshot.createHandoffId,
      language, voiceContextHash: ctx.voiceLines.length ? createHash('sha256').update(ctx.voiceLines.join('\n')).digest('hex').slice(0, 16) : null,
      brandContextVersion: ctx.brandContextVersion, timeline, textBlocks, sourceManifest: ctx.sourceRefs, transcriptRefs, edlHash: hash, producedAt: this.now(),
    };
    return { ...base, contentHash: createHash('sha256').update(JSON.stringify(base), 'utf8').digest('hex') };
  }
  private ctxFromVersion(v: ReelAssetVersion): ReelContextView {
    return { strategyVersionId: v.strategyVersionId, language: v.language.contentLanguage, goal: '', coreBet: '', audience: '', positioning: '', ctaDirection: '', licensedPropositions: [], proofFacts: [], ownedStances: [], sourceRefs: v.sourceManifest, voiceLines: [], speakingRole: '', brandContextVersion: v.brandContextVersion };
  }
  private async persistSafetyTrace(businessId: string, assetId: string, versionId: string | null, snapshot: ReelAuthorizationSnapshot, copyFindings: { blockId: string; clause: string }[], spokenClaimTraces: ReelSpokenClaimTrace[], disposition: ReelSafetyTrace['disposition']): Promise<void> {
    const trace: ReelSafetyTrace = { traceId: generateId(), businessId, assetId, versionId, authorizationSnapshotId: snapshot.snapshotId, propositionContractHash: snapshot.safetyContractHash, copyFindings, spokenClaimTraces, disposition, producedAt: this.now() };
    try { await this.deps.repo.saveSafetyTrace(trace); } catch (e) { this.deps.log?.({ type: 'reel_trace_persist_failed', detail: String(e) }); }
  }

  async getAsset(businessId: string, assetId: string): Promise<{ asset: ReelAsset; version: ReelAssetVersion; render: ReelRenderVersion | null } | null> {
    const asset = await this.deps.repo.getAsset(businessId, assetId);
    if (!asset) return null;
    const version = await this.deps.repo.getVersion(businessId, asset.currentVersionId);
    if (!version) return null;
    const render = await this.deps.repo.getRender(version.versionId);
    return { asset, version, render };
  }
  async exportBytes(businessId: string, versionId: string): Promise<Buffer | null> {
    const rv = await this.deps.repo.getRender(versionId);
    if (!rv || !rv.gateValid) return null;
    return this.deps.objectStore.getToBuffer(rv.mp4Key);
  }
}

const tok = (s: string): string[] => (s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []);
function refOf(vs: VideoSetUnderstanding, sourceRefId: string, _inMs: number): string {
  return vs.observations.find((o) => o.sourceRefId === sourceRefId)?.observationId ?? '';
}
