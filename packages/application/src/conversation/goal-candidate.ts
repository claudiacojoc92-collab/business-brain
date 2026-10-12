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

/**
 * A GOAL is an outcome the founder wants to reach, not a condition, a status or a definition (operator, 2026-10-12:
 * "The bank's security team must be able to run an end-to-end verification … that is the definition of passing the
 * testnet milestone" was offered as the goal; the founder's goal was "Signed pilot with the bank in 60 days").
 * Condition / status phrasing disqualifies; an outcome needs an outcome word or a result-with-a-horizon.
 */
const CONDITION = /\b(must be able to|needs? to be|has to be|have to be|is the definition of|definition of (?:passing|success|done)|requires?|is (?:manual|partial|missing|not ready|in development)|currently|right now|today|trebuie să|trebuie sa|e nevoie|deve (?:poter|essere)|bisogna)\b/i;
// A business RESULT: what the business gets (a signed pilot, customers, revenue, a deal, members).
const BUSINESS_RESULT = /\b(pilots?|clients?|customers?|members?|memberships?|patients?|students?|users?|subscribers?|buyers?|revenue|sales|contracts?|deals?|orders?|bookings?|partners?|clien[țt]\w*|vânzări|vanzari|venit\w*|contract\w*|pacien[țt]i|ricavi|vendite|clienti|pazienti)\b/i;
// A result verb with a horizon also counts ("Fill the clinic by spring"), unless the thing reached is a MILESTONE.
const RESULT_VERB = /\b(sign(?:ed)?|close[ds]?|win|won|land(?:ed)?|reach|get|grow|double|triple|launch(?:ed)?|hit|book(?:ed)?|sell|sold|fill|increase|attract|bring in|convert|recruit|hire|open|raise|cut|reduce|semna\w*|crește|creste|aumenta\w*|riempi\w*)\b/i;
const RESULT_HORIZON = /\b(?:(?:in|within|by|în|entro)\s+(?:the next\s+)?\d+\s*(?:days?|weeks?|months?|zile|săptămâni|saptamani|luni|giorni|settimane|mesi)|by (?:the end of |end of )?(?:spring|summer|autumn|fall|winter|january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|year end|the year))\b/i;
// A technical / delivery MILESTONE is a step on the way, not the goal ("pass the bank's test", "testnet ready").
const MILESTONE = /\b(test(?:s|ed|ing)?|testnet|runnable|run (?:it|solo|unassisted)|reproduce|proof|setup|set up|onboarding|documentation|docs?|runbook|ready for|audit|integration|milestone)\b/i;
export function isOutcomeGoal(s: string): boolean {
  const t = (s ?? '').trim();
  if (!t || CONDITION.test(t)) return false;
  if (BUSINESS_RESULT.test(t)) return true;
  return RESULT_VERB.test(t) && RESULT_HORIZON.test(t) && !MILESTONE.test(t);
}

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
    if (score < 3 || !isOutcomeGoal(it.statement)) continue; // a condition or a status is never offered as the goal
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

/**
 * The HELD goal: a goal row the founder confirmed (written directly, no source turn) or, when the turn classifier
 * filed it, only if it is an outcome. The classifier also files milestones and conditions as kind='goal' (QuFi:
 * "pass the bank security team test"); those never count as the goal anywhere: not in the confirm, the strategy, or
 * the container. No held goal ⇒ the cap's assumed-goal path, flagged on the strategy card.
 */
export function isHeldGoal(s: { kind: string; statement: string; sourceTurnId?: string | null }): boolean {
  return s.kind === 'goal' && Boolean((s.statement ?? '').trim()) && (s.sourceTurnId === null || isOutcomeGoal(s.statement));
}
