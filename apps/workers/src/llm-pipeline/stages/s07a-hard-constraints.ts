import type { PipelineContext } from '../pipeline-context';

/**
 * S07a — Hard Constraints
 * Deterministic. No LLM call.
 * Derives hard blocks from founder configuration.
 * A hard constraint is an absolute prohibition — violation causes cycle failure.
 * Source: Prompt Registry V1 Stage 07a.
 */
export async function runS07aHardConstraints(
  context: PipelineContext,
): Promise<PipelineContext> {
  const hardConstraints: string[] = [];

  const founder = context.founderSnapshot;
  if (!founder) return { ...context, hardConstraints };

  // Conversion mode blocked if offer unavailable
  if (founder.offer.availability === 'FULL' || founder.offer.availability === 'IN_DEVELOPMENT') {
    hardConstraints.push('NO_CONVERSION_MODE');
  }

  // No capacity available
  if (founder.offer.availability === 'WAITLISTED') {
    hardConstraints.push('SOFT_CONVERSION_LIMIT');
  }

  // Avoid phrases from audience fingerprint
  if (founder.audience.avoidPhrases.length > 0) {
    hardConstraints.push(
      `AVOID_PHRASES:${founder.audience.avoidPhrases.join(',')}`,
    );
  }

  return { ...context, hardConstraints };
}
