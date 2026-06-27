import { validateLLMOutput } from '../llm-pipeline/validation/universal-validators';
import { detectPiiPlaceholders } from '../llm-pipeline/validation/pii-detector';
import { ContentPieceOutputSchema, type ContentPieceOutput } from './content-schemas';

/**
 * Content Execution Layer validators (CEL Spec V1.1 §8).
 *
 * Pure, deterministic functions. They classify a generated piece; they do NOT
 * retry, persist, or orchestrate (that is Phase D / the worker). Parse + schema
 * reuse the canonical `validateLLMOutput`; PII reuse the canonical
 * `detectPiiPlaceholders` — neither is duplicated here.
 *
 * Severity ladder:
 *   FAIL_NO_RETRY — reject the piece outright (no regeneration).
 *   REGENERATE    — retry within the job budget (Phase D enforces the budget).
 *   PASS          — clean.
 */

export type CtaStyle = 'NONE' | 'SOFT' | 'INVITATION' | 'DIRECT';

export type ContentValiditySeverity = 'PASS' | 'REGENERATE' | 'FAIL_NO_RETRY';

export interface ContentValidationIssue {
  rule: string;
  severity: Exclude<ContentValiditySeverity, 'PASS'>;
  detail: string;
}

export interface ContentValidationOutcome {
  severity: ContentValiditySeverity;
  issues: ContentValidationIssue[];
  piece: ContentPieceOutput | null;
}

export interface ContentValidationContext {
  /** hard_blocks ∪ voice_boundaries — any match is a hard, no-retry failure. */
  neverList: string[];
  /** Brief cta_style; drives the CTA-consistency rule. */
  ctaStyle: CtaStyle;
  /** audience_language.avoid_phrases — a match is REGENERATE (hard only if it is
   *  also a NEVER-list entry, which the NEVER-list rule already catches). */
  audienceAvoidPhrases: string[];
}

/** Every founder-visible string in a piece (used by the text-scanning rules). */
export function collectPieceStrings(piece: ContentPieceOutput): string[] {
  const out: string[] = [piece.caption, piece.belief_target_ref];
  if (piece.cta) out.push(piece.cta);
  if (piece.format === 'REEL') {
    out.push(piece.hook, piece.script, ...piece.talking_points);
  } else {
    for (const slide of piece.slides) out.push(slide.role, slide.copy);
  }
  return out.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/** NEVER-list: any output string containing a blocked phrase fails WITHOUT retry. */
export function checkNeverList(piece: ContentPieceOutput, neverList: string[]): ContentValidationIssue[] {
  const strings = collectPieceStrings(piece);
  const issues: ContentValidationIssue[] = [];
  for (const blocked of neverList) {
    const needle = blocked.trim().toLowerCase();
    if (!needle) continue;
    if (strings.some((s) => s.toLowerCase().includes(needle))) {
      issues.push({
        rule: 'NEVER_LIST',
        severity: 'FAIL_NO_RETRY',
        detail: `Output contains forbidden phrase: "${blocked}"`,
      });
    }
  }
  return issues;
}

/** CTA consistency: cta is non-empty IFF cta_style !== NONE (both directions). */
export function checkCtaConsistency(piece: ContentPieceOutput, ctaStyle: CtaStyle): ContentValidationIssue[] {
  const hasCta = typeof piece.cta === 'string' && piece.cta.trim().length > 0;
  if (ctaStyle === 'NONE' && hasCta) {
    return [{ rule: 'CTA_CONSISTENCY', severity: 'REGENERATE', detail: 'cta_style is NONE but a cta was produced' }];
  }
  if (ctaStyle !== 'NONE' && !hasCta) {
    return [{ rule: 'CTA_CONSISTENCY', severity: 'REGENERATE', detail: `cta_style is ${ctaStyle} but cta is null/empty` }];
  }
  return [];
}

/** PII: pseudonymisation placeholder tokens must not appear (the brief is real data). */
export function checkPiiPlaceholders(piece: ContentPieceOutput): ContentValidationIssue[] {
  const found = collectPieceStrings(piece).flatMap((s) => detectPiiPlaceholders(s));
  if (found.length === 0) return [];
  return [{
    rule: 'PII_PLACEHOLDER',
    severity: 'REGENERATE',
    detail: `Placeholder tokens in output: ${[...new Set(found)].join(', ')}`,
  }];
}

/** Audience-language avoidance: using an avoid phrase is REGENERATE (warn/regenerate, bounded). */
export function checkAudienceAvoidance(piece: ContentPieceOutput, avoidPhrases: string[]): ContentValidationIssue[] {
  const strings = collectPieceStrings(piece);
  const issues: ContentValidationIssue[] = [];
  for (const phrase of avoidPhrases) {
    const needle = phrase.trim().toLowerCase();
    if (!needle) continue;
    if (strings.some((s) => s.toLowerCase().includes(needle))) {
      issues.push({
        rule: 'AUDIENCE_AVOID',
        severity: 'REGENERATE',
        detail: `Output uses an avoid phrase: "${phrase}"`,
      });
    }
  }
  return issues;
}

/**
 * Job-level completeness: the produced piece set must equal piece_objectives.
 * Pure function provided here; it is WIRED AND EXERCISED IN PHASE D (the worker
 * orchestrates the per-objective loop and the job budget), not in this phase.
 */
export function checkPieceSetCompleteness(
  producedPieceIds: string[],
  expectedPieceIds: string[],
): ContentValidationIssue[] {
  const missing = expectedPieceIds.filter((id) => !producedPieceIds.includes(id));
  if (missing.length === 0) return [];
  return [{ rule: 'COMPLETENESS', severity: 'REGENERATE', detail: `Missing pieces: ${missing.join(', ')}` }];
}

/**
 * Validate one raw model output for a single piece. Parse + schema via the
 * canonical validateLLMOutput; then the deterministic content rules.
 * Returns the highest severity across all issues.
 */
export async function validateContentOutput(
  rawOutput: string,
  ctx: ContentValidationContext,
): Promise<ContentValidationOutcome> {
  const parsed = await validateLLMOutput(rawOutput, ContentPieceOutputSchema);
  if (parsed.isErr) {
    return {
      severity: 'REGENERATE',
      issues: [{ rule: 'SCHEMA', severity: 'REGENERATE', detail: parsed.error.message }],
      piece: null,
    };
  }

  const piece = parsed.value;
  const issues: ContentValidationIssue[] = [
    ...checkNeverList(piece, ctx.neverList),
    ...checkPiiPlaceholders(piece),
    ...checkCtaConsistency(piece, ctx.ctaStyle),
    ...checkAudienceAvoidance(piece, ctx.audienceAvoidPhrases),
  ];

  const severity: ContentValiditySeverity = issues.some((i) => i.severity === 'FAIL_NO_RETRY')
    ? 'FAIL_NO_RETRY'
    : issues.some((i) => i.severity === 'REGENERATE')
      ? 'REGENERATE'
      : 'PASS';

  return { severity, issues, piece };
}
