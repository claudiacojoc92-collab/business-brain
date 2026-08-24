/**
 * Slice 7 V2 — deterministic shoot-plan assembly (no LLM, no side effects): concept/plan construction, hashing,
 * content-hash lineage, and the conceptSeed builder that hands intent (not truth) to the frozen V1 recommend().
 */
import { createHash } from 'node:crypto';
import { generateId } from '@bb/shared';
import { MIN_REEL_MS, MAX_REEL_MS } from '../reel/reel';
import type { SegmentRole } from '../reel/contracts';
import type {
  ReelConcept, ShootingPlanVersion, ShotRequest, ConceptPlanDraft, ExecutionConstraint,
  FulfillmentReport, ConceptSeed, ConceptRoleHint,
} from './contracts';

const sha = (o: unknown): string => createHash('sha256').update(JSON.stringify(o), 'utf8').digest('hex');
export const ROLE_ORDER: Record<SegmentRole, number> = { hook: 0, build: 1, proof: 2, detail: 3, close: 4 };
export const clampDuration = (ms: number): number => Math.max(MIN_REEL_MS, Math.min(MAX_REEL_MS, ms || MIN_REEL_MS));

/** Assemble the immutable, footage-free ReelConcept from a strategy-conditioned draft. */
export function assembleConcept(input: {
  businessId: string; draft: ConceptPlanDraft; strategyVersionId: string; planVersionId: string | null; actionId: string | null;
  editingEnergy: ReelConcept['editingEnergy']; authorizationBasis: ReelConcept['authorizationBasis']; speakingRole: string;
  contentLanguage: string; brandContextVersion: string; modelId: string | null; now: string;
}): ReelConcept {
  const origin: ReelConcept['origin'] = input.actionId ? 'plan_action' : 'strategic_opportunity';
  const core = {
    businessId: input.businessId, origin, strategyVersionId: input.strategyVersionId, planVersionId: input.planVersionId, actionId: input.actionId,
    communicationJob: input.draft.communicationJob, strategicReason: input.draft.strategicReason, narrativeArc: input.draft.narrativeArc,
    beats: input.draft.beats, targetDurationMs: clampDuration(input.draft.targetDurationMs), editingEnergy: input.editingEnergy,
    authorizationBasis: input.authorizationBasis, speakingRole: input.speakingRole, ctaDirection: input.draft.ctaDirection,
    contentLanguage: input.contentLanguage, brandContextVersion: input.brandContextVersion,
    sufficiencyAssumptions: input.draft.sufficiencyAssumptions, nonTransplantabilityTrace: input.draft.nonTransplantabilityTrace,
  };
  return { reelConceptId: generateId(), ...core, modelId: input.modelId, producedAt: input.now, contentHash: sha(core) };
}

/** Assemble an immutable ShootingPlanVersion (N or N+1) from a concept + a draft's shots. Governed spoken lines are
 *  injected by the service; here we only structure + hash. Shots are ordered by narrative role. */
export function assemblePlanVersion(input: {
  concept: ReelConcept; draft: ConceptPlanDraft; uiLanguage: string; constraints: ExecutionConstraint[];
  spokenLines: Record<string, { line: string; naturalVariationAllowed: boolean } | null>; // by draft shot order index
  modelId: string | null; now: string; prior?: ShootingPlanVersion | null;
}): ShootingPlanVersion {
  const shotRequests: ShotRequest[] = input.draft.shots
    .map((s, i): ShotRequest => {
      const gov = input.spokenLines[String(i)] ?? null;
      return {
        shotId: generateId(), sequenceRole: s.sequenceRole, storyJob: s.storyJob, subject: s.subject, visibleAction: s.visibleAction,
        framing: s.framing, cameraBehavior: s.cameraBehavior, approxDurationMs: s.approxDurationMs, orientation: 'vertical',
        audioNeed: s.audioNeed, exactSpokenLine: gov ? gov.line : null, naturalVariationAllowed: gov ? gov.naturalVariationAllowed : false,
        textSafeSide: s.textSafeSide, visualEnergyNeed: s.visualEnergyNeed ?? null, required: s.required, founderFilms: s.founderFilms !== false,
        completionCriteria: s.completionCriteria, whyThisShot: s.whyThisShot, alternativesAllowed: s.alternativesAllowed,
        founderProse: s.founderProse, matchTokens: s.matchTokens,
      };
    })
    .sort((a, b) => ROLE_ORDER[a.sequenceRole] - ROLE_ORDER[b.sequenceRole]);
  const shootingPlanId = input.prior?.shootingPlanId ?? generateId();
  const versionNumber = (input.prior?.versionNumber ?? 0) + 1;
  const core = {
    shootingPlanId, reelConceptId: input.concept.reelConceptId, businessId: input.concept.businessId,
    supersedesVersionId: input.prior?.versionId ?? null, shotRequests, estimatedEffort: input.draft.estimatedEffort,
    generalGuidance: input.draft.generalGuidance, constraintsApplied: input.constraints, uiLanguage: input.uiLanguage,
  };
  return { versionId: generateId(), versionNumber, ...core, modelId: input.modelId, producedAt: input.now, contentHash: sha({ ...core, versionNumber }) };
}

/** Required beats that a concept depends on (used to reason about coverage after matching). */
export function requiredRoles(plan: ShootingPlanVersion): SegmentRole[] {
  return plan.shotRequests.filter((s) => s.required).map((s) => s.sequenceRole);
}

/** Build the conceptSeed handed to frozen V1 recommend(). INTENT + roleHints only — never claims. The window is a
 *  hint; V1 still picks the exact in/out. Only satisfied/substituted beats contribute hints. */
export function buildConceptSeed(concept: ReelConcept, plan: ShootingPlanVersion, report: FulfillmentReport): ConceptSeed {
  const byShot = new Map(report.fulfillments.map((f) => [f.shotId, f]));
  const roleHints: ConceptRoleHint[] = [];
  for (const shot of plan.shotRequests) {
    const f = byShot.get(shot.shotId);
    if (!f || (f.status !== 'satisfied' && f.status !== 'partial') || !f.matchedSourceRefId) continue;
    roleHints.push({
      sequenceRole: shot.sequenceRole, sourceRefId: f.matchedSourceRefId,
      ...(f.matchedRange ? { usableWindow: { inMs: f.matchedRange.inMs, outMs: f.matchedRange.outMs } } : {}),
    });
  }
  return {
    communicationJob: concept.communicationJob, narrativeArc: concept.narrativeArc, editingEnergy: concept.editingEnergy,
    targetDurationMs: concept.targetDurationMs, ctaDirection: concept.ctaDirection, roleHints,
  };
}

export const hashOf = sha;
