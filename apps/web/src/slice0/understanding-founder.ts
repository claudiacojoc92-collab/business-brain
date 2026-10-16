import type { ArcView } from '../api/client';

type Read = NonNullable<NonNullable<ArcView['understanding']>['read']>;
type Structure = NonNullable<Read['structure']>;
type Ask = Read['asks'][number];
type T = (key: string, vars?: Record<string, string>) => string;

/**
 * FOUNDER VIEW (2026-10-16, projection only). Composes the governed signals the api sends (verified mechanisms, the two
 * places a kept hypothesis compares, the synthesis clauses governance kept, each question's tier and dimension) into four
 * short sections, with fixed sentences in the business's language. It never adds a fact: every business-specific word
 * comes from governed state; the fixed sentences only relate them. Uncertainty is said once, where it matters.
 */
export interface FounderView {
  /** What you've built: recognition of the structure, not the menu. */
  readonly built: string;
  /** What stands out: at most two readings, each with its "so what" or its one open fork. */
  readonly standsOut: string[];
  /** Where I'd look first: what BB would establish before advising (from the questions it is about to ask). */
  readonly lookFirst: string;
  /** The rationale shown under a question (a fixed, neutral one for the acquisition question). */
  readonly whyOf: (a: Ask) => string;
}

const PARTS = ['group_timetable', 'one_to_one', 'paid_first_step'] as const;
const LOOK = new Set(['performance', 'acquisition', 'intent', 'retention', 'conversion', 'economics']);

/** "a", "a and b", "a, b and c" in the business's language. */
export function joinList(items: string[], t: T): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('arc.u3.list', { rest: items.slice(0, -1).join(', '), last: items[items.length - 1]! });
}
const firstSentence = (x: string): string => (x.match(/^[^.!?]+[.!?]?/)?.[0] ?? x).trim();

/** null when the api sent no founder signals (an older api or snapshot): the card keeps its earlier layout. */
export function composeFounderView(s: Structure, asks: Ask[], fallbackBuilt: string, t: T): FounderView | null {
  const f = s.founder;
  if (!f || !s.synthesis) return null;
  const places = f.places && f.places.length === 2 ? { a: f.places[0]!, b: f.places[1]! } : null;

  // 1. WHAT YOU'VE BUILT: the parts the verified mechanisms show, where they run, and how clients continue.
  const parts = PARTS.filter((k) => f.mechanisms.includes(k)).map((k) => t(`arc.u3.part.${k}`));
  const where = places ? t('arc.u3.built.places', places) : '';
  const built = parts.length >= 2
    ? [t(f.mechanisms.includes('group_timetable') ? 'arc.u3.built.more' : 'arc.u3.built.combine', { parts: joinList(parts, t), places: where }),
      ...(f.mechanisms.includes('packages') ? [t('arc.u3.built.packages')] : [])].join(' ')
    : fallbackBuilt;

  // 2. WHAT STANDS OUT: the commercial routes (with why they matter), then the places (observation, meaning, one fork).
  const standsOut: string[] = [];
  const clause = f.routes ?? (f.mechanisms.length >= 2 ? `${joinList(f.mechanisms.map((m) => t(`arc.u2.mech.${m}`)), t)}.` : '');
  if (clause) standsOut.push(`${t('arc.u3.routes', { clause })} ${t('arc.u3.routes.why')}`);
  // One clean fact for the places: the team / public-offer gap when the evidence shows it, else the governed facts.
  const placeFacts = f.placeTeam ? [t('arc.u3.places.team', f.placeTeam)] : f.placeFacts ?? [];
  if (places && placeFacts.length) standsOut.push([t('arc.u3.places.lead', places), ...placeFacts, t('arc.u3.places.fork')].join(' '));
  else {
    const h = s.hypotheses.find((x) => x.interpretation.trim());
    if (h) standsOut.push(`${firstSentence(h.interpretation)} ${t('arc.u3.fork')}`);
  }

  // 3. WHERE I'D LOOK FIRST: what the shown questions would establish, in their order.
  const shown = asks.slice(0, 3);
  const looks = [...new Set(shown.flatMap((a) => {
    if (a.tier === 'A' && a.dimension && LOOK.has(a.dimension)) return [t(`arc.u3.look.${a.dimension}`)];
    if (a.tier === 'B') return [places && a.resolves === f.placeHypothesis ? t('arc.u3.look.places', places) : t('arc.u3.look.fork')];
    return [];
  }))];
  const lookFirst = looks.length ? t('arc.u3.look', { list: joinList(looks, t) }) : '';

  // The strategy-critical rationales are BB's own, neutral sentences: they never name or label the business's lines in
  // the model's words (which paths are real vs new bets; which part already carries the business).
  const whyOf = (a: Ask): string => (a.tier === 'A' && (a.dimension === 'acquisition' || a.dimension === 'performance') ? t(`arc.u3.why.${a.dimension}`) : a.why);
  return { built, standsOut: standsOut.slice(0, 2), lookFirst, whyOf };
}
