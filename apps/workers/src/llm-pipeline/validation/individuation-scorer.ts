import { INDIVIDUATION_ELEMENTS_MIN } from '@bb/shared';

/**
 * Scores how individualised a brief is to this specific founder.
 * A brief must reference at least INDIVIDUATION_ELEMENTS_MIN (3)
 * founder-specific elements to pass.
 * Source: Prompt Registry V1.
 */
export function scoreIndividuation(brief: Record<string, unknown>): number {
  const elements = [
    brief['conviction_angle'],
    brief['belief_target_primary'],
    brief['audience_segment'],
    brief['voice_parameters'],
    brief['offer_constraints'],
  ];

  const presentElements = elements.filter((e) => {
    if (e === null || e === undefined) return false;
    if (typeof e === 'string') return e.trim().length > 0;
    if (Array.isArray(e)) return e.length > 0;
    return true;
  });

  const score = Math.round((presentElements.length / elements.length) * 100);
  return score;
}

export function isIndividuationAcceptable(score: number): boolean {
  const normalised = Math.round(score * elements / 100);
  return normalised >= INDIVIDUATION_ELEMENTS_MIN;
}

const elements = 5; // total elements checked above — kept in sync
