/**
 * Clarity context retrieval — reads the founder's CONFIRMED Business Understanding and maps each conclusion to a
 * founder-facing truth label, plus their goals/constraints/resources. This is what Business Brain is allowed to draw on in a
 * clarity audit (rule 7: never invent beyond what is known). It reads only; it changes nothing.
 */
import type { ClarityContext } from './clarity-model';
import type { TruthLabel } from './clarity-result';
import type { Understanding, Conclusion } from './understanding';
import { PgUnderstandingRepository } from './pg-understanding.repository';
import { PgFounderStrategicContextRepository } from './pg-founder-strategic-context.repository';
import { PgUnderstandingItemRepository } from './pg-understanding-item.repository';
import { resolveEffectiveStrategicContext } from './effective-strategic-context.resolver';

/** Map a confirmed conclusion to the founder-facing truth label (no technical jargon leaves this layer). */
export function labelOfConclusion(c: Conclusion): TruthLabel {
  if (c.confirmationState === 'corrected' || c.founderCorrection) return 'you_corrected_this';
  if (c.confirmationState === 'rejected') return 'unconfirmed_or_disagree';
  if (c.epistemicStatus === 'OBSERVED') return 'observed_from_material';
  if (c.epistemicStatus === 'NEEDS_MORE_EVIDENCE' || c.epistemicStatus === 'HYPOTHESIS') return 'unconfirmed_or_disagree';
  return 'my_reading'; // SYNTHESIZED_FROM_OBSERVED and the rest are Business Brain readings, not asserted fact
}

/** The founder-visible statement for a conclusion — a founder correction, when present, replaces the inference. */
function statementOf(c: Conclusion): string {
  return c.founderCorrection && c.founderCorrection.trim().length > 0 ? c.founderCorrection.trim() : c.statement;
}

export interface ClarityContextDeps {
  understanding: PgUnderstandingRepository;
  strategicContext: PgFounderStrategicContextRepository;
  understandingItems: PgUnderstandingItemRepository;
}

/** Assemble the confirmed context for a clarity audit — synthesized conclusions PLUS current founder-governed items (accepted
 *  clarity changes + corrections), so a later sensemaking session starts from the accumulated understanding, not from zero.
 *  Empty-but-valid when the founder has no Understanding yet. */
export async function assembleClarityContext(founderId: string, deps: ClarityContextDeps, asOf: Date = new Date()): Promise<ClarityContext> {
  const u: Understanding | null = await deps.understanding.latest(founderId);
  const synthesized = u
    ? u.conclusions
        .filter((c) => c.confirmationState !== 'rejected' && c.type !== 'missing_information')
        .map((c) => ({ statement: statementOf(c), label: labelOfConclusion(c) }))
    : [];
  // Current founder-governed items are first-class context — this is how continuity happens across sessions.
  const founderItems = (await deps.understandingItems.listCurrent(founderId)).map((i) => ({ statement: i.statement, label: i.truthLabel }));
  const conclusions = [...synthesized, ...founderItems];
  const unknowns = u ? u.conclusions.filter((c) => c.epistemicStatus === 'NEEDS_MORE_EVIDENCE' || c.type === 'missing_information').map((c) => statementOf(c)) : [];

  const items = await deps.strategicContext.listActive(founderId);
  const eff = resolveEffectiveStrategicContext(items, asOf);
  const say = (arr: { statement: string }[]) => arr.map((x) => x.statement);
  return {
    conclusions,
    unknowns,
    goals: say(eff.goals),
    constraints: say(eff.constraints),
    resources: say(eff.resources),
  };
}
