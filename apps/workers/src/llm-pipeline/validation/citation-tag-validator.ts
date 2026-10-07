/**
 * Validates that Evaluator output (S06) uses proper citation tags.
 * Each scored hypothesis must carry a citation_tag.
 * Source: Corrections Addendum V1 F015.
 */
export function validateCitationTags(
  evaluationOutput: Record<string, unknown>,
): { valid: boolean; missingCitations: string[] } {
  const missing: string[] = [];

  const scoredHypotheses = evaluationOutput['scored_hypotheses'];
  if (!Array.isArray(scoredHypotheses)) {
    return { valid: false, missingCitations: ['scored_hypotheses is not an array'] };
  }

  for (const hypothesis of scoredHypotheses) {
    if (typeof hypothesis !== 'object' || hypothesis === null) continue;
    const h = hypothesis as Record<string, unknown>;
    if (!h['citation_tag'] || typeof h['citation_tag'] !== 'string') {
      missing.push(String(h['hypothesis_id'] ?? 'unknown'));
    }
  }

  return { valid: missing.length === 0, missingCitations: missing };
}
