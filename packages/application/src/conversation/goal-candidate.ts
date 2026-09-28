/**
 * Reflect-back goal selection (deterministic — NO model). When the strategy engine reports "no founder goal
 * captured" but the founder already stated a priority that the turn classifier mis-filed as a `decision` /
 * `intention`, we surface the strongest goal-shaped statement VERBATIM for the founder to confirm. This never
 * re-runs the classifier that mis-tagged it — confirmation writes `kind='goal'` directly.
 *
 * Scoring favours the founder's OWN words that carry a priority and, above all, a trade-off (the "X, not Y"
 * shape that maps to coreBet.priority + deprioritized). Multilingual (en/ro/it); a statement only matches its
 * own language's markers, so scoring is language-safe.
 */
import type { FounderStateItem } from './contracts';

export interface GoalCandidate {
  readonly stateId: string;
  readonly kind: string;        // the mis-filed kind it came from (decision | intention) — for telemetry
  readonly statement: string;   // VERBATIM, in the language it was captured in — never translated
  readonly score: number;
  readonly hasTradeoff: boolean;
}

// priority / focus language (+2)
const PRIORITY = /\b(priorit\w*|principal\w*|main|primary|focus|obiectiv\w*|scop\w*|goal|target|țint\w*|tint\w*|obiettivo|priorità|priorita)\b/i;
// trade-off — the deprioritized half; strongest signal (+3). "nu"/"not"/"non" + explicit "instead/rather than".
const TRADEOFF = /\b(nu|not|non|instead of|rather than|în loc|in loc|decât|decat|mai degrabă|mai degraba|invece di|piuttosto che)\b/i;
// time horizon (+1)
const HORIZON = /\b(luni|months?|trimestr\w*|quarters?|years?|următoarele|urmatoarele|coming months|next months|next few months|prossimi mesi|mesi)\b/i;

function scoreStatement(s: string): { score: number; hasTradeoff: boolean } {
  const t = (s ?? '').toLowerCase();
  const hasTradeoff = TRADEOFF.test(t);
  let score = 0;
  if (hasTradeoff) score += 3;
  if (PRIORITY.test(t)) score += 2;
  if (HORIZON.test(t)) score += 1;
  return { score, hasTradeoff };
}

/** The strongest goal-shaped `decision`/`intention` the founder already stated, or null to ask cold. Requires
 * ≥3 — a trade-off (3), OR priority + a forward horizon (2+1). A bare priority marker alone (2) is usually a
 * descriptive business fact ("PT is the main revenue line"), not a forward goal, so it does NOT qualify and we
 * ask cold instead. Ties break to trade-off, then to the longer (more complete) statement so an edited/short
 * fragment never displaces the full "X, not Y" sentence. */
export function selectGoalCandidate(items: FounderStateItem[]): GoalCandidate | null {
  const pool = items.filter(
    (i) => i.status === 'active' && (i.kind === 'decision' || i.kind === 'intention') && (i.statement ?? '').trim().length > 0,
  );
  let best: GoalCandidate | null = null;
  for (const it of pool) {
    const { score, hasTradeoff } = scoreStatement(it.statement);
    if (score < 3) continue;
    const cand: GoalCandidate = { stateId: it.id, kind: it.kind, statement: it.statement.trim(), score, hasTradeoff };
    const better =
      !best ||
      cand.score > best.score ||
      (cand.score === best.score && cand.hasTradeoff && !best.hasTradeoff) ||
      (cand.score === best.score && cand.hasTradeoff === best.hasTradeoff && cand.statement.length > best.statement.length);
    if (better) best = cand;
  }
  return best;
}
