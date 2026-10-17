import { tidyPunctuation } from './punctuation';
import type { ArcView } from '../api/client';

type Read = NonNullable<NonNullable<ArcView['understanding']>['read']>;
type Structure = NonNullable<Read['structure']>;
type Ask = Read['asks'][number];
type T = (key: string, vars?: Record<string, string>) => string;

/**
 * FIRST READ (2026-10-16, projection only). The initial screen gives a point of view and the questions, nothing more:
 * the deeper read comes after the founder answers (the updated mirror). Composed from the governed signals the api
 * sends (verified mechanisms, the routes clause, the two places a kept hypothesis compares, each question's tier and
 * dimension) with fixed sentences in the business's language. It never adds a fact.
 */
export interface FounderView {
  /** My first read: the strongest structural relationship, then what BB needs to know (≤ 3 sentences). */
  readonly firstRead: string;
  /** What I think matters (the top strategic theses): ≤ 2, each a short headline + a concise interpretation. */
  readonly matters: { readonly headline: string; readonly body: string }[];
  /** True when the first read came from the founder-facing synthesis call (vs the deterministic projection). */
  readonly composed: boolean;
  /** One thing I'm watching: the fork the B question settles, not yet treated as strategy (≤ 2 sentences), or ''. */
  readonly watching: string;
  /** The rationale shown under a question (fixed, neutral ones for the strategy-critical questions). */
  readonly whyOf: (a: Ask) => string;
}

/** "a", "a and b", "a, b and c" in the business's language. */
export function joinList(items: string[], t: T): string {
  if (items.length <= 1) return items[0] ?? '';
  return t('arc.u3.list', { rest: items.slice(0, -1).join(', '), last: items[items.length - 1]! });
}
const firstSentence = (x: string): string => (x.match(/^[^.!?]+[.!?]?/)?.[0] ?? x).trim();
const capital = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);

type Composed = { myRead: string; matters: { headline: string; body: string }[] };

/** null when the api sent no founder signals (an older api or snapshot): the card keeps its earlier layout. */
export function composeFounderView(s: Structure, asks: Ask[], fallback: string, t: T, composed?: Composed | null): FounderView | null {
  const f = s.founder;
  // The founder-facing understanding from the theses needs no deterministic signals (it also serves older snapshots).
  if (!composed?.myRead && !composed?.matters.length && (!f || !s.synthesis)) return null;
  const neutralWhy = (a: Ask): string | null => (a.tier === 'A' && (a.dimension === 'acquisition' || a.dimension === 'performance') ? t(`arc.u3.why.${a.dimension}`) : null);
  // The founder-facing understanding from the top strategic theses (governed upstream) leads when present; its three
  // questions and their rationales are already the asks.
  const det = f && s.synthesis ? deterministic(s, f, asks, fallback, t) : null;
  if (composed?.myRead || composed?.matters.length) {
    // An empty composed read (every sentence failed its checks) falls back to the deterministic one, never a blank card.
    return { firstRead: tidyPunctuation(composed.myRead || det?.firstRead || ''), matters: composed.matters.map((m) => ({ headline: tidyPunctuation(m.headline), body: tidyPunctuation(m.body) })), watching: '', composed: true, whyOf: (a) => a.why || neutralWhy(a) || '' };
  }
  return det;
}

function deterministic(s: Structure, f: NonNullable<Structure['founder']>, asks: Ask[], fallback: string, t: T): FounderView {
  const has = (k: (typeof f.mechanisms)[number]) => f.mechanisms.includes(k);
  const places = f.places && f.places.length === 2 ? { a: f.places[0]!, b: f.places[1]! } : null;

  // 1. MY FIRST READ — one brand, several commercial paths (when the verified mechanisms show it), then what BB needs.
  const split = has('group_timetable') && (has('paid_first_step') || has('one_to_one'));
  const how = f.routes ? capital(f.routes)
    : has('group_timetable') && has('paid_first_step') ? t('arc.u5.read.mech', { packages: has('packages') ? t('arc.u5.read.mech.packages') : '' })
      : split ? t('arc.u5.read.mech2') : '';
  const needs = [...new Set(asks.slice(0, 3).filter((a) => a.tier === 'A' && a.dimension).flatMap((a) => {
    const d = a.dimension!;
    if (d === 'performance' || d === 'acquisition') return [t(`arc.u5.need.${d}${split ? '.split' : ''}`)];
    return d === 'intent' ? [t('arc.u5.need.intent')] : [];
  }))];
  const need = needs.length ? t('arc.u5.read.need', { list: joinList(needs, t) }) : '';
  // Without a commercial split, the synthesis's first sentence leads, unless it is the places fork (shown below);
  // never the offer catalogue. `fallback` only stands in when nothing else is left to say.
  const synthLead = firstSentence(s.synthesis);
  const lead = split ? [t('arc.u5.read.split'), how]
    : [places && [places.a, places.b].every((p) => synthLead.includes(p)) ? '' : synthLead];
  if (!lead.filter(Boolean).length && !need) lead.push(fallback);
  const firstRead = [...lead, need].filter(Boolean).join(' ');

  // 2. ONE THING I'M WATCHING — only the fork a B question will settle; stated, not yet strategy.
  const b = asks.slice(0, 3).find((a) => a.tier === 'B' && a.resolves !== undefined);
  let watching = '';
  if (b && places && b.resolves === f.placeHypothesis) {
    const fact = f.placeTeam ? t('arc.u3.places.team', f.placeTeam) : f.placeFacts?.[0] ?? '';
    if (fact) watching = `${fact} ${t('arc.u5.watch.fork')}`;
  } else if (b) {
    const h = typeof b.resolves === 'number' ? s.hypotheses[b.resolves] : undefined;
    if (h?.interpretation.trim()) watching = `${firstSentence(h.interpretation)} ${t('arc.u5.watch.forkGeneric')}`;
  }

  // BB's own neutral rationales (never the model's labels for the lines): the strategy-critical questions, and the
  // locations fork (deliberate or only operational).
  const placesFork = (a: Ask) => a.tier === 'B' && places !== null && a.resolves === f.placeHypothesis;
  const whyOf = (a: Ask): string => (a.tier === 'A' && (a.dimension === 'acquisition' || a.dimension === 'performance') ? t(`arc.u3.why.${a.dimension}`)
    : placesFork(a) ? t('arc.u5.why.places') : a.why);
  return { firstRead, matters: [], composed: false, watching, whyOf };
}
