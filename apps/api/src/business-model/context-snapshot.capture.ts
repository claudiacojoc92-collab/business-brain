/**
 * Wave 4 — Strategic Learning Consumption Gate (ADR-014). Captures the current canonical Effective Business Understanding
 * + Effective Founder Strategic Context into the frozen assembler-shaped payload a ContextSnapshot stores. Native context
 * comes from the live assembler; promoted learning revisions (ADR-013) are merged in DISTINCTLY (BU → conclusions of type
 * `promoted_learning`; FSC → `founderContext.promotedLearnings`) with full provenance. This is an explicit founder-driven
 * read; it mutates nothing and calls no model.
 */
import { assembleStrategicContext, type AssemblerDeps } from './strategic-context.assembler';
import type { PgLearningPromotionRepository } from './pg-learning-promotion.repository';
import type { PgStrategicLearningRepository } from './pg-strategic-learning.repository';
import { deriveLifecycleStatus } from './strategic-learning';
import type { FrozenBusinessUnderstanding, FrozenFounderContext, FrozenPublicPositioning, FrozenPromotedLearning, SnapshotProvenance } from './context-snapshot';

export interface CaptureDeps {
  assembler: AssemblerDeps;
  promotionRepo: PgLearningPromotionRepository;
  learningRepo: PgStrategicLearningRepository;
}

/** Assemble the live native context, merge the effective promoted learnings, and return the frozen payload + provenance. */
export async function captureEffectiveContext(founderId: string, deps: CaptureDeps): Promise<{ businessUnderstanding: FrozenBusinessUnderstanding; founderStrategicContext: FrozenFounderContext; publicPositioningContext: FrozenPublicPositioning; provenance: SnapshotProvenance }> {
  // BU + founderContext are question-independent; a neutral placeholder question is fine for a capture.
  const live = await assembleStrategicContext(founderId, '(context snapshot capture)', 'GENERAL_30_DAY_PRIORITY', deps.assembler);

  const bu: FrozenBusinessUnderstanding = { ...live.businessUnderstanding, conclusions: [...live.businessUnderstanding.conclusions] };
  const provBU: SnapshotProvenance['businessUnderstanding'] = bu.conclusions.map((c) => ({ conclusionId: c.id, sourceType: 'NATIVE_BUSINESS_UNDERSTANDING' as const }));

  // Effective promoted BU learnings → distinct conclusions (type `promoted_learning`), pinned to the EXACT revision.
  for (const e of await deps.promotionRepo.getEffective(founderId, 'BUSINESS_UNDERSTANDING')) {
    const rev = await deps.learningRepo.getRevisionById(founderId, e.learningRevisionId);
    if (!rev) continue;
    const id = `promoted-${e.id}`;
    bu.conclusions.push({ id, type: 'promoted_learning', statement: rev.revisedUnderstanding, epistemicStatus: rev.confidence, group: 'promoted_learning', evidenceCount: 0 });
    provBU.push({ conclusionId: id, sourceType: 'PROMOTED_LEARNING', learningRevisionId: e.learningRevisionId, learningRevisionNumber: e.revisionNumber, promotionEventId: e.id });
  }

  const nativeFsc = [...live.founderContext.goals, ...live.founderContext.constraints, ...live.founderContext.resources, ...live.founderContext.strategicPreferences, ...live.founderContext.decisionHorizons];
  const provFSC: SnapshotProvenance['founderStrategicContext'] = nativeFsc.map((i) => ({ itemId: i.id, sourceType: 'NATIVE_FOUNDER_STRATEGIC_CONTEXT' as const }));

  // Effective promoted FSC learnings → founderContext.promotedLearnings (distinct from native), pinned to the EXACT revision.
  const promotedLearnings: FrozenPromotedLearning[] = [];
  for (const e of await deps.promotionRepo.getEffective(founderId, 'FOUNDER_STRATEGIC_CONTEXT')) {
    const rev = await deps.learningRepo.getRevisionById(founderId, e.learningRevisionId);
    if (!rev) continue;
    promotedLearnings.push({ promotionEventId: e.id, logicalLearningId: e.logicalLearningId, learningRevisionId: e.learningRevisionId, learningRevisionNumber: e.revisionNumber, statement: rev.revisedUnderstanding, scope: e.scope, rationale: e.rationale, epistemicStatus: rev.confidence, lifecycleStatusAtSnapshot: deriveLifecycleStatus(rev.lifecycleAction) });
    provFSC.push({ itemId: e.id, sourceType: 'PROMOTED_LEARNING', learningRevisionId: e.learningRevisionId, learningRevisionNumber: e.revisionNumber, promotionEventId: e.id });
  }

  const fsc: FrozenFounderContext = { ...live.founderContext, promotedLearnings };
  // Freeze public-positioning/market context verbatim (R4) — the strategist must never read it live for a bound generation.
  const ppc: FrozenPublicPositioning = live.publicPositioningContext;
  const provPP: SnapshotProvenance['publicPositioning'] = ppc.provenance.map((p) => ({ findingId: p.findingId, reviewId: p.reviewId, adapter: p.adapter, model: p.model, promptVersion: p.promptVersion }));
  return { businessUnderstanding: bu, founderStrategicContext: fsc, publicPositioningContext: ppc, provenance: { businessUnderstanding: provBU, founderStrategicContext: provFSC, publicPositioning: provPP } };
}
