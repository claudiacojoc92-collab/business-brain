/**
 * Slice 7 V2 — ReelShootService ("Tell me what to film"). Upstream of the FROZEN V1 reel engine.
 *   proposeConcept → ShootingPlan (founder sees 4–6 exact shots) → [founder films + uploads] →
 *   matchUploads (frozen observe + deterministic matching → fulfillment + smallest missing) →
 *   converge (buildConceptSeed → FROZEN recommend/accept/render → real MP4) + ReelShootContext lineage.
 * It adds NO claim authority, NO EDL/renderer/rights/safety of its own — those remain entirely in frozen V1.
 */
import { generateId } from '@bb/shared';
import type { PropositionJudge } from '../voice/proposition-safety';
import { deriveEditingEnergy } from '../reel/reel';
import { spokenClaimIsUnauthorized } from '../reel/reel-safety';
import type { ReelService } from '../reel/reel.service';
import type { IReelRepository, ReelContextView, ReelAuthorizationSnapshot, EditingEnergy, VideoSetUnderstanding } from '../reel/contracts';
import type {
  IReelShootRepository, IConceptPlanModelPort, ReelConcept, ShootingPlanVersion, FulfillmentReport,
  ExecutionConstraint, ConceptPlanDraft, ReelShootContext, ShotFulfillment,
} from './contracts';
import { assembleConcept, assemblePlanVersion, buildConceptSeed } from './plan';
import { assembleReport } from './matching';

export interface ReelShootDeps {
  readonly shootRepo: IReelShootRepository;
  readonly conceptModel: IConceptPlanModelPort;
  readonly reel: ReelService;                    // FROZEN engine (observe/recommend/accept/render)
  readonly reelRepo: IReelRepository;            // FROZEN repo (VSU, sources, transcripts)
  readonly context: (businessId: string) => Promise<ReelContextView | null>;
  readonly businessName: (businessId: string) => Promise<string>;
  readonly currentPlan: (businessId: string) => Promise<{ planVersionId: string; actionId: string | null } | null>;
  readonly judge?: { check?: PropositionJudge; contract?: () => { modelId: string; promptHash: string } };
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

export type ProposeResult = { status: 'proposed'; concept: ReelConcept; plan: ShootingPlanVersion } | { status: 'no_strategy' };
export type MatchResult = { status: 'matched'; report: FulfillmentReport } | { status: 'not_found' } | { status: 'no_clips' };
export type ConvergeResult =
  | { status: 'created'; assetId: string; opportunityId: string; context: ReelShootContext }
  | { status: 'insufficient'; report: FulfillmentReport }
  | { status: 'not_found' } | { status: 'blocked'; reason: string };

export class ReelShootService {
  constructor(private readonly deps: ReelShootDeps) {}
  private now(): string { return this.deps.clock ? this.deps.clock() : new Date(2026, 0, 1).toISOString(); }

  private snapshotFrom(businessId: string, ctx: ReelContextView): ReelAuthorizationSnapshot {
    const judge = this.deps.judge?.contract?.();
    return {
      snapshotId: generateId(), businessId, createHandoffId: null, strategyVersionId: ctx.strategyVersionId, language: ctx.language || 'en',
      speakingRole: ctx.speakingRole, audienceUseContext: ctx.audience, licensedPropositions: ctx.licensedPropositions, proofFacts: ctx.proofFacts,
      ctaFunction: ctx.ctaDirection, ownedStances: ctx.ownedStances, sourceRefIds: ctx.sourceRefs.map((s) => s.sourceRefId),
      modelId: judge?.modelId ?? null, safetyContractHash: judge?.promptHash ?? null, producedAt: this.now(),
    };
  }

  /** PROPOSE — decide the reel worth making next + the shooting plan. Governs any exact spoken line BEFORE filming. */
  async proposeConcept(businessId: string, opts: { constraints?: ExecutionConstraint[]; avoidConcept?: string; uiLanguage?: string } = {}): Promise<ProposeResult> {
    const ctx = await this.deps.context(businessId);
    if (!ctx) return { status: 'no_strategy' };
    const businessName = await this.deps.businessName(businessId).catch(() => 'your business');
    const plan = await this.deps.currentPlan(businessId).catch(() => null);
    const editingEnergy: EditingEnergy = deriveEditingEnergy([ctx.goal, ctx.coreBet, ctx.positioning].join(' '));
    const uiLanguage = opts.uiLanguage ?? ctx.language ?? 'en';

    const rawDraft = await this.deps.conceptModel.propose({
      context: ctx, businessName, uiLanguage, editingEnergy, plan,
      ...(opts.constraints ? { constraints: opts.constraints } : {}), ...(opts.avoidConcept ? { avoidConcept: opts.avoidConcept } : {}),
    });
    const draft = applyExecutionConstraints(rawDraft, opts.constraints ?? []);
    const adjusted = await this.governSpokenLines(businessId, ctx, draft);

    const concept = assembleConcept({
      businessId, draft: adjusted.draft, strategyVersionId: ctx.strategyVersionId, planVersionId: plan?.planVersionId ?? null, actionId: plan?.actionId ?? null,
      editingEnergy, authorizationBasis: ctx.licensedPropositions, speakingRole: ctx.speakingRole, contentLanguage: ctx.language || 'en',
      brandContextVersion: ctx.brandContextVersion, modelId: this.deps.conceptModel.descriptor?.().modelId ?? null, now: this.now(),
    });
    const planVersion = assemblePlanVersion({
      concept, draft: adjusted.draft, uiLanguage, constraints: opts.constraints ?? [], spokenLines: adjusted.spokenLines,
      modelId: this.deps.conceptModel.descriptor?.().modelId ?? null, now: this.now(),
    });
    await this.deps.shootRepo.saveConcept(concept);
    await this.deps.shootRepo.savePlanVersion(planVersion);
    this.deps.log?.({ type: 'reel_shoot_concept', detail: `${planVersion.shotRequests.length} shots | ${editingEnergy}` });
    return { status: 'proposed', concept, plan: planVersion };
  }

  /** CONSTRAIN — a founder execution constraint mints an immutable ShootingPlanVersion N+1 from the SAME concept. */
  async constrain(businessId: string, planVersionId: string, constraint: ExecutionConstraint, uiLanguage?: string): Promise<ProposeResult> {
    const prior = await this.deps.shootRepo.getPlanVersion(businessId, planVersionId);
    if (!prior) return { status: 'no_strategy' };
    const concept = await this.deps.shootRepo.getConcept(businessId, prior.reelConceptId);
    const ctx = await this.deps.context(businessId);
    if (!concept || !ctx) return { status: 'no_strategy' };
    const businessName = await this.deps.businessName(businessId).catch(() => 'your business');
    const plan = await this.deps.currentPlan(businessId).catch(() => null);
    const constraints = [...prior.constraintsApplied, constraint];
    const draft = applyExecutionConstraints(await this.deps.conceptModel.propose({
      context: ctx, businessName, uiLanguage: uiLanguage ?? prior.uiLanguage, editingEnergy: concept.editingEnergy, plan, constraints,
    }), constraints);
    const adjusted = await this.governSpokenLines(businessId, ctx, draft);
    const next = assemblePlanVersion({
      concept, draft: adjusted.draft, uiLanguage: uiLanguage ?? prior.uiLanguage, constraints, spokenLines: adjusted.spokenLines,
      modelId: this.deps.conceptModel.descriptor?.().modelId ?? null, now: this.now(), prior,
    });
    await this.deps.shootRepo.savePlanVersion(next);
    this.deps.log?.({ type: 'reel_shoot_constrained', detail: `${constraint.kind} → v${next.versionNumber} (${next.shotRequests.length} shots)` });
    return { status: 'proposed', concept, plan: next };
  }

  /** Govern each requested exact spoken line BEFORE the founder records it. An ungoverned line degrades to a silent
   *  (ambient) shot — BB never asks the founder to speak a claim it has not authorized. Authority stays frozen. */
  private async governSpokenLines(businessId: string, ctx: ReelContextView, draft: ConceptPlanDraft): Promise<{ draft: ConceptPlanDraft; spokenLines: Record<string, { line: string; naturalVariationAllowed: boolean } | null> }> {
    const spokenLines: Record<string, { line: string; naturalVariationAllowed: boolean } | null> = {};
    const snapshot = this.snapshotFrom(businessId, ctx);
    const shots = await Promise.all(draft.shots.map(async (s, i) => {
      if (s.audioNeed !== 'spoken_line' || !s.spokenLineIntent) { spokenLines[String(i)] = null; return s; }
      const unauthorized = await spokenClaimIsUnauthorized(s.spokenLineIntent, snapshot, draft.communicationJob, this.deps.judge?.check);
      if (unauthorized) {
        this.deps.log?.({ type: 'reel_shoot_line_degraded', detail: s.spokenLineIntent.slice(0, 60) });
        spokenLines[String(i)] = null;
        return { ...s, audioNeed: 'ambient' as const, founderProse: s.founderProse.replace(/\s*Say[^.]*\.?/i, '').trim() };
      }
      spokenLines[String(i)] = { line: s.spokenLineIntent, naturalVariationAllowed: true };
      return s;
    }));
    return { draft: { ...draft, shots }, spokenLines };
  }

  /** MATCH — reuse the FROZEN VideoSetUnderstanding on the uploads, then deterministically match to the plan.
   *  Refines spoken-line shots by comparing the transcript to the governed line (authoritative safety stays at accept). */
  async matchUploads(businessId: string, planVersionId: string, uploadSetId: string): Promise<MatchResult> {
    const plan = await this.deps.shootRepo.getPlanVersion(businessId, planVersionId);
    if (!plan) return { status: 'not_found' };
    const concept = await this.deps.shootRepo.getConcept(businessId, plan.reelConceptId);
    if (!concept) return { status: 'not_found' };
    const ob = await this.deps.reel.observeUploadSet(businessId, uploadSetId);
    if (ob.status !== 'observed') return { status: 'no_clips' };
    const vsu = ob.understanding;
    let report = assembleReport(plan, vsu, concept.editingEnergy, this.now());
    report = await this.refineSpokenLines(plan, vsu, report);
    await this.deps.shootRepo.saveFulfillmentReport({ ...report, businessId });
    this.deps.log?.({ type: 'reel_shoot_fulfillment', detail: `${report.sufficiency}${report.smallestMissing ? ' | missing 1' : ''}` });
    return { status: 'matched', report };
  }

  private async refineSpokenLines(plan: ShootingPlanVersion, vsu: VideoSetUnderstanding, report: FulfillmentReport): Promise<FulfillmentReport> {
    const byId = new Map(plan.shotRequests.map((s) => [s.shotId, s]));
    const fulfillments: ShotFulfillment[] = await Promise.all(report.fulfillments.map(async (f) => {
      const shot = byId.get(f.shotId);
      if (!shot || shot.audioNeed !== 'spoken_line' || !shot.exactSpokenLine || !f.observationRef || f.status === 'missing') return f;
      const obs = vsu.observations.find((o) => o.observationId === f.observationRef);
      const transcript = obs?.transcriptRef ? await this.deps.reelRepo.getTranscript(obs.transcriptRef) : null;
      const said = transcript?.status === 'transcribed' ? transcript.segments.map((s) => s.text).join(' ') : '';
      if (!said) return { ...f, status: 'partial', missingReason: 'I couldn’t hear the line clearly — re-record this one', matchReasons: [...f.matchReasons, 'no intelligible speech'] };
      const sim = lineSimilarity(said, shot.exactSpokenLine);
      if (sim < 0.4) return { ...f, status: 'partial', missingReason: 'what you said is quite different from the line — I’ll re-check it for safety', matchReasons: [...f.matchReasons, 'transcript differs from governed line'] };
      return { ...f, matchReasons: [...f.matchReasons, 'spoken line matches'] };
    }));
    return { ...report, fulfillments };
  }

  /** CONVERGE — once sufficient, hand the agreed concept (as a seed) + matched clips to FROZEN V1. */
  async converge(businessId: string, planVersionId: string, opts?: { deferRender?: boolean }): Promise<ConvergeResult> {
    const plan = await this.deps.shootRepo.getPlanVersion(businessId, planVersionId);
    if (!plan) return { status: 'not_found' };
    const concept = await this.deps.shootRepo.getConcept(businessId, plan.reelConceptId);
    const report = await this.deps.shootRepo.getFulfillmentReport(businessId, planVersionId);
    if (!concept || !report) return { status: 'not_found' };
    if (report.sufficiency === 'insufficient') return { status: 'insufficient', report };

    const seed = buildConceptSeed(concept, plan, report);
    const rec = await this.deps.reel.recommend(businessId, report.videoSetUnderstandingId, undefined, null, seed);
    if (rec.status !== 'recommended') return { status: 'blocked', reason: rec.status };
    if (rec.opportunity.sufficiency === 'insufficient') return { status: 'blocked', reason: 'v1_insufficient' };
    const acc = await this.deps.reel.accept(businessId, rec.opportunity.opportunityId);
    if (acc.status !== 'accepted') return { status: 'blocked', reason: acc.status === 'fail_closed' ? acc.reason : acc.status };
    if (!opts?.deferRender) await this.deps.reel.render(businessId, acc.version.versionId);

    const substitutions = report.fulfillments.filter((f) => f.substitutedFromShotId).map((f) => ({ shotId: f.shotId, fromShotId: f.substitutedFromShotId!, sourceRefId: f.matchedSourceRefId! }));
    const context: ReelShootContext = {
      reelShootContextId: generateId(), businessId, reelConceptId: concept.reelConceptId, shootingPlanVersionId: plan.versionId,
      videoSetUnderstandingId: report.videoSetUnderstandingId, fulfillments: report.fulfillments, substitutions, conceptSeed: seed,
      opportunityId: rec.opportunity.opportunityId, assetId: acc.asset.assetId, producedAt: this.now(),
    };
    await this.deps.shootRepo.saveShootContext(context);
    this.deps.log?.({ type: 'reel_shoot_converged', detail: `asset ${acc.asset.assetId}` });
    return { status: 'created', assetId: acc.asset.assetId, opportunityId: rec.opportunity.opportunityId, context };
  }
}

/** Deterministically enforce execution constraints the model may honor imperfectly. When the founder won't talk on
 *  camera, NO shot may carry a founder spoken-line requirement — a non-filmed card may still carry governed on-screen
 *  copy at accept, but never an exactSpokenLine. Narrow: only touches audio requirements, not the narrative. */
function applyExecutionConstraints(draft: ConceptPlanDraft, constraints: ExecutionConstraint[]): ConceptPlanDraft {
  if (!constraints.some((c) => c.kind === 'no_talking_head')) return draft;
  const shots = draft.shots.map((s) => (s.audioNeed === 'spoken_line'
    ? { ...s, audioNeed: (s.founderFilms ? 'ambient' : 'none') as ConceptPlanDraft['shots'][number]['audioNeed'], spokenLineIntent: null }
    : s));
  return { ...draft, shots };
}

/** Cheap deterministic content-word overlap for a governed-line sanity check (frozen accept is the real authority). */
function lineSimilarity(a: string, b: string): number {
  const w = (s: string) => new Set((s.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []));
  const A = w(a), B = w(b); if (!B.size) return 1;
  let n = 0; for (const x of B) if (A.has(x)) n++;
  return n / B.size;
}
