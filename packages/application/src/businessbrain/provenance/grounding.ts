/**
 * Grounding gate (Phase ②). The single LLM call may interpret, but it may not invent facts. This
 * verifies, deterministically, that:
 *   1. every root cause cites at least one REAL deterministic evidence key;
 *   2. every recommendation/action links to a real root cause / recommendation index;
 *   3. NO number appears in the narrative that is not a deterministically-computed value
 *      (metric, evidence value, window count, a structural count, or a window year).
 * A failure means the candidate is discarded as a generation failure — a fabrication is never shown.
 */
import type { DiagnosisNarrative } from '../ports';
import type { GenerationContext } from './model';

export interface GroundingResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

function allowedNumbers(ctx: GenerationContext, n: DiagnosisNarrative): Set<number> {
  const s = new Set<number>();
  const add = (v: unknown): void => { if (typeof v === 'number' && Number.isFinite(v)) s.add(v); };
  const m = ctx.metrics;
  [m.postCount, m.spanDays, m.postsPerWeek, m.withCtaCount, m.withCtaPct, m.withLinkCount, m.withLinkPct,
   m.avgCaptionChars, m.avgHashtags, m.reachAvailableCount, m.avgReach, m.avgLikes, m.avgComments, m.followersCount,
   ctx.window.postCount].forEach(add);
  Object.values(m.mediaTypeCounts).forEach(add);
  Object.values(m.mediaTypePct).forEach(add);
  ctx.evidence.forEach((e) => add(e.value));
  // window years (the narrative may name the date range)
  for (const iso of [ctx.window.from, ctx.window.to]) {
    if (iso) { const y = new Date(iso).getUTCFullYear(); if (Number.isFinite(y)) s.add(y); }
  }
  // structural self-references (counts of what the model itself produced)
  add(n.rootCauses.length); add(n.recommendations.length);
  add(n.executionPlan.length);
  n.executionPlan.forEach((p) => add(p.actions.length));
  return s;
}

const NUMBER_RE = /\d+(?:\.\d+)?/g;

export function checkGrounding(narrative: DiagnosisNarrative, ctx: GenerationContext): GroundingResult {
  const violations: string[] = [];
  const validKeys = new Set(ctx.evidence.map((e) => e.key));

  // 1. root-cause evidence links
  narrative.rootCauses.forEach((rc, i) => {
    const valid = rc.evidenceKeys.filter((k) => validKeys.has(k));
    if (valid.length === 0) violations.push(`root cause ${i} cites no valid evidence key (${JSON.stringify(rc.evidenceKeys)})`);
  });
  // 2. recommendation / action link indexes
  narrative.recommendations.forEach((r, i) => {
    if (r.rootCauseIndexes.length === 0 || r.rootCauseIndexes.some((x) => x < 0 || x >= narrative.rootCauses.length))
      violations.push(`recommendation ${i} has an invalid rootCauseIndexes ${JSON.stringify(r.rootCauseIndexes)}`);
  });
  narrative.executionPlan.forEach((p, pi) => p.actions.forEach((a, ai) => {
    if (a.recommendationIndexes.length === 0 || a.recommendationIndexes.some((x) => x < 0 || x >= narrative.recommendations.length))
      violations.push(`action ${pi}.${ai} has invalid recommendationIndexes ${JSON.stringify(a.recommendationIndexes)}`);
  }));

  // 3. no fabricated numbers anywhere in the narrative prose
  const allowed = allowedNumbers(ctx, narrative);
  const texts: string[] = [
    narrative.businessReality, ...narrative.businessConsequences, narrative.cannotYetKnow,
    ...narrative.rootCauses.map((r) => r.statement),
    ...narrative.recommendations.map((r) => r.statement),
    ...narrative.executionPlan.flatMap((p) => [p.label, ...p.actions.map((a) => a.statement)]),
  ];
  for (const t of texts) {
    for (const tok of t.match(NUMBER_RE) ?? []) {
      const num = Number(tok);
      if (!allowed.has(num)) violations.push(`ungrounded number "${tok}" in: "${t.slice(0, 80)}"`);
    }
  }

  return { ok: violations.length === 0, violations };
}
