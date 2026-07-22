/**
 * Bounded, deterministic relevant-context selection + a minimal, truthful staleness model. Given the founder's current
 * message and their current founder-governed Understanding items (+ revalidation history), this selects the SMALLEST
 * SUFFICIENT set of items that materially affect the reading — never a wholesale dump — and derives, per item, whether it
 * "may need checking" and why. No model, no clock-based expiry: staleness is derived from real signals (the current message
 * implies change, the item is an unresolved condition, or it is a time-sensitive load-bearing fact not yet revalidated).
 *
 * Distinctions preserved: old / stale / contradicted / unknown / superseded are NOT the same. Superseded items never reach
 * here (they aren't current). "May need checking" (staleness) is never "wrong".
 */
import type { UnderstandingItem } from './pg-understanding-item.repository';
import type { StalenessReason, TruthLabel } from './clarity-result';

export interface SelectedContextItem {
  id: string;
  statement: string;
  truthLabel: TruthLabel;
  originSummary: string;
  lastConfirmedAt: string | null;
  possibleStalenessReason: StalenessReason;
  needsRevalidation: boolean;
}
export interface RevalidationFact { understandingItemId: string; outcome: 'confirmed' | 'unsure'; createdAt: string }

export const MAX_CONTEXT_ITEMS = 5;

const STOP = new Set(['this', 'that', 'with', 'from', 'have', 'your', 'about', 'what', 'when', 'which', 'their', 'them', 'they', 'will', 'would', 'should', 'could', 'been', 'because', 'more', 'need', 'know', 'really', 'answer', 'currently', 'current']);
const tokens = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((t) => !STOP.has(t)));
// Time-sensitive / current-operating-condition terms — an item mentioning one is worth re-checking if it's load-bearing.
const TIME_SENSITIVE = /\b(budget|capacity|revenue|traffic|conversion|convert|converts|headcount|price|pricing|team|staff|hire|hiring|hired|spend|volume|churn|runway|cash|bottleneck|constraint|customers?|leads?|inquir)/i;
// The founder's message implies a condition may have changed.
const CHANGE_CUES = /\b(no longer|not anymore|has changed|have changed|used to|since|now that|now we|now i|already|hired|increased|decreased|dropped|grew|added|we now|we hired|fixed|resolved|solved|improved)\b/i;

function originSummaryOf(item: UnderstandingItem): string {
  if (item.origin === 'founder_correction') return 'You corrected this earlier.';
  if (item.origin === 'clarity_acceptance') return 'You accepted this from an earlier clarity conversation.';
  return 'From your understanding.';
}

/** A shared significant, time-sensitive token between the message and the item — the basis for a likely contradiction. */
function sharedTimeSensitiveToken(itemStatement: string, message: string): boolean {
  const msg = tokens(message); const it = tokens(itemStatement);
  for (const t of it) if (msg.has(t) && TIME_SENSITIVE.test(t)) return true;
  return false;
}

function deriveStaleness(item: UnderstandingItem, message: string, confirmed: boolean): { reason: StalenessReason; needs: boolean } {
  if (sharedTimeSensitiveToken(item.statement, message) && CHANGE_CUES.test(message)) return { reason: 'contradicted', needs: true };
  if (item.truthLabel === 'unconfirmed_or_disagree') return { reason: 'unresolved', needs: true }; // an unresolved condition is load-bearing
  if (TIME_SENSITIVE.test(item.statement)) return { reason: 'time_sensitive', needs: !confirmed };  // not clock-based: unresolved until revalidated
  return { reason: null, needs: false };
}

function relevanceScore(item: UnderstandingItem, message: string): number {
  const msg = tokens(message); const it = tokens(item.statement);
  let shared = 0; for (const t of it) if (msg.has(t)) shared++;
  let score = Math.min(shared, 3);
  if (item.truthLabel === 'unconfirmed_or_disagree') score += 2; // an unresolved constraint materially bounds the reading
  if (TIME_SENSITIVE.test(item.statement) && TIME_SENSITIVE.test(message)) score += 1; // shared domain (e.g. ads/budget/conversion)
  return score;
}

/**
 * Select the bounded relevant context. Items scoring 0 and not needing revalidation are excluded (irrelevant background).
 * Contradicted + unresolved items are always material. Sorted by score desc, capped at MAX_CONTEXT_ITEMS. Deterministic
 * (stable tiebreak by createdAt then id). `items` MUST already be the CURRENT effective set (superseded excluded upstream).
 */
export function selectRelevantContext(items: UnderstandingItem[], message: string, revalidations: RevalidationFact[], max = MAX_CONTEXT_ITEMS): SelectedContextItem[] {
  const confirmedAt = new Map<string, string>();     // latest 'confirmed' revalidation per item
  const anyConfirmed = new Set<string>();
  for (const r of revalidations) {
    if (r.outcome === 'confirmed') { anyConfirmed.add(r.understandingItemId); const cur = confirmedAt.get(r.understandingItemId); if (!cur || r.createdAt > cur) confirmedAt.set(r.understandingItemId, r.createdAt); }
  }
  const scored = items.map((item) => {
    const confirmed = anyConfirmed.has(item.id);
    const { reason, needs } = deriveStaleness(item, message, confirmed);
    const score = relevanceScore(item, message) + (reason === 'contradicted' ? 3 : 0);
    return { item, score, reason, needs, lastConfirmedAt: confirmedAt.get(item.id) ?? item.createdAt };
  }).filter((x) => x.score > 0 || x.needs);
  scored.sort((a, b) => b.score - a.score || a.item.createdAt.localeCompare(b.item.createdAt) || a.item.id.localeCompare(b.item.id));
  return scored.slice(0, max).map((x) => ({
    id: x.item.id, statement: x.item.statement, truthLabel: x.item.truthLabel, originSummary: originSummaryOf(x.item),
    lastConfirmedAt: x.lastConfirmedAt, possibleStalenessReason: x.reason, needsRevalidation: x.needs,
  }));
}
