/**
 * Slice 6.1 — PhotoLedService. Orchestrates the SECOND create path: observe a founder photo set (literal media
 * facts) → recommend ONE strategy-specific, non-transplantable carousel opportunity (with sufficiency) →
 * ["show me another angle"] → on accept, emit the FROZEN normal CreateHandoff + an immutable
 * PhotoLedCarouselContext (media + provenance only). It creates NO claim authority. Downstream generation is the
 * frozen Slice-6 engine, which resolves the media plan additively.
 */
import { generateId } from '@bb/shared';
import type { CarouselContextView } from '../carousel/contracts';
import type {
  IObservationModelPort, IOpportunityModelPort, IPhotoLedRepository, PhotoSetUnderstanding, MediaObservation,
  CarouselOpportunity, PhotoLedCarouselContext, PhotoLedOrigin,
} from './contracts';
import { setSignal, observedTokens, hashOf, filterRenderable, validateObservationRefs, assessNonTransplantable, assessSufficiency } from './photoled';

export interface PhotoLedHandoffInput {
  readonly businessId: string;
  readonly opportunity: CarouselOpportunity;
  readonly ctx: CarouselContextView;
}
export interface PhotoLedDeps {
  readonly observationModel: IObservationModelPort;
  readonly opportunityModel: IOpportunityModelPort;
  readonly repo: IPhotoLedRepository;
  readonly context: (businessId: string) => Promise<CarouselContextView | null>;
  readonly businessName: (businessId: string) => Promise<string>;
  readonly currentPlan: (businessId: string) => Promise<{ planVersionId: string; actionId: string | null } | null>;
  /** Emit the FROZEN normal CreateHandoff for an accepted opportunity; returns its id (persisted upstream). */
  readonly emitHandoff: (input: PhotoLedHandoffInput) => Promise<{ createHandoffId: string }>;
  readonly clock?: () => string;
  readonly log?: (e: { type: string; detail?: string }) => void;
}

export type ObserveResult = { status: 'observed'; photoSet: PhotoSetUnderstanding } | { status: 'no_images' };
export type RecommendResult = { status: 'recommended'; opportunity: CarouselOpportunity } | { status: 'no_strategy' } | { status: 'not_found' };
export type AcceptResult = { status: 'accepted'; createHandoffId: string } | { status: 'insufficient' } | { status: 'not_found' } | { status: 'invalid'; reason: string };

const MAX_ANGLE_ATTEMPTS = 2;

export class PhotoLedService {
  constructor(private readonly deps: PhotoLedDeps) {}
  private now(): string { return this.deps.clock ? this.deps.clock() : new Date(2026, 0, 1).toISOString(); }

  /** Observe a founder photo set → immutable PhotoSetUnderstanding (literal media facts; no business truth). */
  async observePhotoSet(businessId: string, images: { sourceRefId: string; bytes: Buffer; mime?: string }[]): Promise<ObserveResult> {
    if (!images.length) return { status: 'no_images' };
    const raw = await this.deps.observationModel.observe(images);
    const observations: MediaObservation[] = raw.map((o) => ({ ...o, observationId: generateId() }));
    const core = { businessId, observations, setSignal: setSignal(observations) };
    const photoSet: PhotoSetUnderstanding = {
      photoSetUnderstandingId: generateId(), ...core,
      modelId: this.deps.observationModel.descriptor?.().modelId ?? null, contentHash: hashOf(core), producedAt: this.now(),
    };
    await this.deps.repo.savePhotoSetUnderstanding(photoSet);
    this.deps.log?.({ type: 'photoset_observed', detail: photoSet.setSignal });
    return { status: 'observed', photoSet };
  }

  /** Recommend ONE strategy-specific, non-transplantable opportunity (with sufficiency). `avoid` differs an angle. */
  async recommend(businessId: string, photoSetUnderstandingId: string, avoid?: string): Promise<RecommendResult> {
    const photoSet = await this.deps.repo.getPhotoSetUnderstanding(businessId, photoSetUnderstandingId);
    if (!photoSet) return { status: 'not_found' };
    const ctx = await this.deps.context(businessId);
    if (!ctx) return { status: 'no_strategy' };
    const businessName = await this.deps.businessName(businessId).catch(() => 'your business');
    const plan = await this.deps.currentPlan(businessId).catch(() => null);
    const strategyTokens = tokensOf([ctx.goal, ctx.coreBet, ctx.audience].join(' '));
    const observed = observedTokens(photoSet);
    const hasClaimBasis = ctx.licensedPropositions.length > 0 || ctx.proofFacts.length > 0;

    let nonTransplantReason = '';
    for (let attempt = 0; attempt < MAX_ANGLE_ATTEMPTS; attempt++) {
      const draft = await this.deps.opportunityModel.recommend({
        photoSet, goal: ctx.goal, coreBet: ctx.coreBet, audience: ctx.audience, positioning: '',
        ctaDirection: ctx.ctaDirection, businessName, voiceLines: ctx.voiceLines, language: ctx.language || 'en',
        ...(avoid || attempt > 0 ? { avoid: avoid ?? 'the previous generic angle; be specific to these photos and this strategy' } : {}),
      });
      const nt = assessNonTransplantable(draft, businessName, strategyTokens, observed);
      nonTransplantReason = nt.reason;
      if (!nt.ok) { this.deps.log?.({ type: 'opportunity_transplantable', detail: nt.reason }); continue; }

      const { kept, dropped } = filterRenderable(draft.selectedMedia, ctx.sourceRefs);
      const refCheck = validateObservationRefs(kept, photoSet);
      const validKept = refCheck.ok ? kept : kept.filter((k) => k.observationRefs.every((r) => photoSet.observations.some((o) => o.observationId === r && o.sourceRefId === k.sourceRefId)));
      const suff = assessSufficiency(validKept, photoSet, hasClaimBasis, draft.missingMaterial);
      const origin: PhotoLedOrigin = plan?.actionId ? 'plan_action' : 'strategic_opportunity';
      const opportunity: CarouselOpportunity = {
        opportunityId: generateId(), businessId, photoSetUnderstandingId,
        origin, strategyVersionId: ctx.strategyVersionId, planVersionId: plan?.planVersionId ?? null, actionId: plan?.actionId ?? null,
        communicationJob: draft.communicationJob, ctaDirection: draft.ctaDirection ?? ctx.ctaDirection,
        whyPhotosSupport: draft.whyPhotosSupport, strategicConnection: draft.strategicConnection,
        nonTransplantabilityTrace: draft.nonTransplantabilityTrace, proposedConceptFamily: draft.proposedConceptFamily,
        usableMediaSubset: validKept, excludedMedia: [...dropped, ...draft.excludedMedia],
        sufficiency: suff.verdict, missingMaterial: draft.missingMaterial,
        founderLegibleRecommendation: draft.founderLegibleRecommendation, alternativeAvailable: true,
        modelId: this.deps.opportunityModel.descriptor?.().modelId ?? null, producedAt: this.now(),
      };
      await this.deps.repo.saveOpportunity(opportunity);
      this.deps.log?.({ type: 'opportunity_recommended', detail: `${suff.verdict} | ${draft.proposedConceptFamily}` });
      return { status: 'recommended', opportunity };
    }
    // no specific angle after bounded attempts → honest insufficient-quality opportunity (never a generic rec)
    const blocked: CarouselOpportunity = {
      opportunityId: generateId(), businessId, photoSetUnderstandingId, origin: 'strategic_opportunity',
      strategyVersionId: ctx.strategyVersionId, planVersionId: plan?.planVersionId ?? null, actionId: plan?.actionId ?? null,
      communicationJob: '', ctaDirection: ctx.ctaDirection, whyPhotosSupport: '', strategicConnection: '',
      nonTransplantabilityTrace: nonTransplantReason, proposedConceptFamily: '', usableMediaSubset: [], excludedMedia: [],
      sufficiency: 'insufficient', missingMaterial: [], founderLegibleRecommendation: 'These photos don’t support a specific angle for your strategy yet.',
      alternativeAvailable: false, modelId: this.deps.opportunityModel.descriptor?.().modelId ?? null, producedAt: this.now(),
    };
    await this.deps.repo.saveOpportunity(blocked);
    return { status: 'recommended', opportunity: blocked };
  }

  /** "Show me another angle" — a materially different opportunity from the same photo set. */
  async alternative(businessId: string, opportunityId: string): Promise<RecommendResult> {
    const prior = await this.deps.repo.getOpportunity(businessId, opportunityId);
    if (!prior) return { status: 'not_found' };
    return this.recommend(businessId, prior.photoSetUnderstandingId, prior.communicationJob || 'the previous angle');
  }

  /** Accept → emit the FROZEN CreateHandoff + immutable PhotoLedCarouselContext (1:1 on handoff). */
  async accept(businessId: string, opportunityId: string): Promise<AcceptResult> {
    const opportunity = await this.deps.repo.getOpportunity(businessId, opportunityId);
    if (!opportunity) return { status: 'not_found' };
    if (opportunity.sufficiency === 'insufficient') return { status: 'insufficient' };
    const photoSet = await this.deps.repo.getPhotoSetUnderstanding(businessId, opportunity.photoSetUnderstandingId);
    if (!photoSet) return { status: 'not_found' };
    // §5 STRICT persist-time validation — unknown / wrong-set / wrong-source observation ref ⇒ reject.
    const refCheck = validateObservationRefs(opportunity.usableMediaSubset, photoSet);
    if (!refCheck.ok) { this.deps.log?.({ type: 'photoled_invalid_refs', detail: refCheck.error }); return { status: 'invalid', reason: refCheck.error! }; }

    const ctx = await this.deps.context(businessId);
    if (!ctx) return { status: 'invalid', reason: 'no strategy at accept time' };
    const { createHandoffId } = await this.deps.emitHandoff({ businessId, opportunity, ctx });

    const core = {
      businessId, createHandoffId, opportunityId, photoSetUnderstandingId: opportunity.photoSetUnderstandingId,
      origin: opportunity.origin,
      strategyTrace: { strategyVersionId: opportunity.strategyVersionId, planVersionId: opportunity.planVersionId, actionId: opportunity.actionId },
      selectedMedia: opportunity.usableMediaSubset, excludedMedia: opportunity.excludedMedia,
    };
    const context: PhotoLedCarouselContext = { photoLedContextId: generateId(), ...core, producedAt: this.now(), contentHash: hashOf(core) };
    await this.deps.repo.savePhotoLedContext(context); // MUST enforce 1:1 on createHandoffId
    this.deps.log?.({ type: 'photoled_context_persisted', detail: `${context.selectedMedia.length} media, origin ${context.origin}` });
    return { status: 'accepted', createHandoffId };
  }
}

const tokensOf = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []));
