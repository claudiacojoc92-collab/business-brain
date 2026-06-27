import { UNIQUENESS_SCORE_MIN_MAIN, UNIQUENESS_SCORE_MIN_FALLBACK } from '@bb/shared';

/**
 * Scores the uniqueness of a brief against the founder's historical modes.
 * Score >= UNIQUENESS_SCORE_MIN_MAIN (50): pass for main path.
 * Score >= UNIQUENESS_SCORE_MIN_FALLBACK (40): pass for fallback path.
 * Source: Prompt Registry V1, Implementation Spec V1.
 */
export function scoreUniqueness(params: {
  selectedMode:    string;
  recentModes:     string[];
  cycleNumber:     number;
}): number {
  const { selectedMode, recentModes, cycleNumber } = params;

  if (cycleNumber <= 3) return 75; // Early cycles — no history to compare

  const recentCount = recentModes.filter((m) => m === selectedMode).length;
  const repeatPenalty = Math.min(recentCount * 15, 40);
  const baseScore = 80 - repeatPenalty;

  return Math.max(baseScore, 10);
}

export function isUniquenessAcceptable(
  score: number,
  isFallback = false,
): boolean {
  const threshold = isFallback
    ? UNIQUENESS_SCORE_MIN_FALLBACK
    : UNIQUENESS_SCORE_MIN_MAIN;
  return score >= threshold;
}
