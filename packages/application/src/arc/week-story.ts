import type { PlanVersion } from '../plan/index';
import type { StrategyVersionRecord } from '../strategy/index';
import { claimTermsIn, firstSentence } from '../bi/index';
import { withoutQuestions } from '../conversation/index';
import { spoken } from './spoken-voice';
import type { ArcWeekStory, WeekStoryInput } from './contracts';

/**
 * Moment 6 as a strategist's chapter (operator, 2026-10-12): the SAME plan, re-told — the week is its first three
 * actions (Today is the first), set against the month's priorities. The model only re-voices; this
 * file decides what survives. Every field is checked against what the plan + strategy already hold:
 *   - statements only (question sentences dropped),
 *   - no number the source doesn't contain (no invented dates, counts or results),
 *   - no claim term (trust, unique, competitor…) the source doesn't already use,
 *   - no generic chatbot opener ("Good. We're doing this."),
 *   - short (also keeps the persisted story under the founder_event metadata cap).
 * A field that fails falls back to the plan's own wording for that slot, so the page never loses structure.
 */

const CAP = { context: 120, statement: 110, whyNow: 200, title: 70, fallbackTitle: 120, why: 150, move: 150, detail: 240, done: 170 } as const;
const MAX_CHAPTERS = 3;

const GENERIC_OPENER = /^\s*(good|great|okay|ok|alright|perfect|excellent|let's go|here's the week|bun|bine|perfect|perfetto|ottimo|bene)\b[\s.!,:-]/i;

/**
 * Consultant phrasing a founder would never say out loud (operator, 2026-10-12: "validated perimeter", "credibility
 * moves committees"). Found ⇒ the story gets ONE repair pass naming the phrases (ArcService). Kept short and
 * phrase-level so ordinary words are never caught; the prompt carries the full founder-human voice rules.
 */
const JARGON: RegExp[] = [
  /\bperimeters?\b/i, /\bstakeholders?\b/i, /\bleverag(e|es|ed|ing)\b/i, /\bdeliverables?\b/i, /\balignment\b/i,
  /\bsynerg/i, /\boptimi[sz]/i, /\bstreamlin/i, /\bactionable\b/i, /\bvalue proposition\b/i, /\bgo-to-market\b/i,
  /\bde-?risk/i, /\bbandwidth\b/i, /\bholistic\b/i, /\bcredentialing\b/i, /\bprocurement-ready\b/i, /\bcritical path\b/i,
  /\bpipeline re-?activation\b/i, /\bvalidated (scope|perimeter|milestone)\b/i, /\bdiscrete (gaps?|steps?|items?)\b/i,
  /\bwork order\b/i,
  // things doing what only people do: "credibility moves committees", "the report unlocks procurement"
  /\b(credibility|validation|report|name|proof|audit)\s+(moves?|unlocks?|drives?)\s+(the\s+|a\s+)?(committees?|procurement|banks?|buyers?)\b/i,
];
export function jargonIn(text: string): string[] {
  const out: string[] = [];
  for (const re of JARGON) { const m = (text ?? '').match(re); if (m) out.push(m[0]); }
  return out;
}
/** Every consultant phrase in a model story (all fields), for the one repair pass. */
export function storyJargon(raw: Partial<Omit<ArcWeekStory, 'planVersionId'>> | null | undefined): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const texts = [raw.context, raw.statement, raw.whyNow, raw.doneLooksLike, raw.today?.move, raw.today?.detail,
    ...(Array.isArray(raw.chapters) ? raw.chapters.flatMap((c) => [c?.title, c?.why]) : [])];
  return [...new Set(texts.flatMap((t) => (typeof t === 'string' ? jargonIn(t) : [])))];
}

/** Shorten to the cap: the first sentence if that fits, else a word-boundary cut with an ellipsis. */
export function fit(s: string, cap: number): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= cap) return t;
  const one = firstSentence(t);
  if (one.length <= cap) return one;
  const cut = t.slice(0, cap - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > cap * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:—–-]+$/, '')}…`;
}

const numbersIn = (s: string): string[] => (s.match(/\d+(?:[.,]\d+)?/g) ?? []);

/** The plan + strategy text the story may draw on — the licence for its numbers and claim terms. */
export function sourceText(i: WeekStoryInput): string {
  return ['Week 1', i.goal, i.horizon, i.bet, i.monthDirection, ...i.priorities.flatMap((p) => [p.title, p.why]),
    ...i.moves.flatMap((m) => [m.what, m.why]), ...(i.today ? [i.today.done] : [])].join('\n');
}

/** One model field → the surviving text, or '' when it fails a gate (the caller falls back). */
export function admit(raw: unknown, cap: number, source: string, opts: { opener?: boolean } = {}): string {
  const t = spoken(withoutQuestions(typeof raw === 'string' ? raw : '')).trim();
  if (!t) return '';
  if (opts.opener && GENERIC_OPENER.test(t)) return '';
  const src = source.toLowerCase();
  if (numbersIn(t).some((n) => !src.includes(n))) return '';
  const licensed = new Set(claimTermsIn(source));
  // A word family the source already uses is licensed too ("credible" when the plan says "credibility").
  const stemLicensed = (term: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${term.slice(0, Math.max(5, term.length - 3)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(src);
  if (claimTermsIn(t).some((term) => !licensed.has(term) && !stemLicensed(term))) return '';
  return fit(t, cap);
}

/** The plan's own wording in the story's shape — used when the model is off, fails, or a field fails a gate. */
export function fallbackStory(i: WeekStoryInput, planVersionId: string): ArcWeekStory {
  return {
    planVersionId,
    context: '',
    statement: fit(firstSentence(i.monthDirection), CAP.statement),
    whyNow: fit(firstSentence(i.priorities[0]?.why ?? i.bet), CAP.whyNow),
    // The plan's own action text is longer than a re-told title; a looser cap avoids cutting it mid-thought.
    chapters: i.moves.slice(0, MAX_CHAPTERS).map((m) => ({ title: fit(firstSentence(m.what), CAP.fallbackTitle), why: fit(firstSentence(m.why), CAP.why) })),
    today: { move: fit(firstSentence(i.today?.what ?? ''), CAP.move), detail: fit(firstSentence(i.today?.why ?? ''), CAP.detail) },
    doneLooksLike: fit(i.today?.done ?? '', CAP.done),
  };
}

export function guardWeekStory(raw: Partial<Omit<ArcWeekStory, 'planVersionId'>> | null | undefined, i: WeekStoryInput, planVersionId: string): ArcWeekStory {
  const fb = fallbackStory(i, planVersionId);
  if (!raw || typeof raw !== 'object') return fb;
  const src = sourceText(i);
  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  return {
    planVersionId,
    context: admit(raw.context, CAP.context, src, { opener: true }),
    statement: admit(raw.statement, CAP.statement, src, { opener: true }) || fb.statement,
    whyNow: admit(raw.whyNow, CAP.whyNow, src, { opener: true }) || fb.whyNow,
    // One chapter per plan move, in plan order: the model can re-title a beat, never add, drop or reorder one.
    chapters: fb.chapters.map((f, n) => {
      const c = rawChapters[n] as { title?: unknown; why?: unknown } | undefined;
      return { title: admit(c?.title, CAP.title, src) || f.title, why: admit(c?.why, CAP.why, src) || f.why };
    }),
    today: {
      move: admit(raw.today?.move, CAP.move, src) || fb.today.move,
      detail: admit(raw.today?.detail, CAP.detail, src) || fb.today.detail,
    },
    doneLooksLike: admit(raw.doneLooksLike, CAP.done, src) || fb.doneLooksLike,
  };
}

/** The story's input from the plan proposal + the adopted strategy (same data the week/today view already used). */
export function weekStoryInput(plan: PlanVersion, strategy: StrategyVersionRecord | null, businessName: string, language: string): WeekStoryInput {
  const priorities = (plan.priorities ?? []).slice().sort((a, b) => a.order - b.order);
  const actions = priorities.flatMap((p) => p.actions);
  const firstAction = actions[0] ?? null;
  const core = strategy?.bundle.core;
  return {
    businessName, language,
    goal: (core?.goal ?? '').trim(),
    horizon: (core?.horizon ?? '').trim(),
    bet: (core?.coreBet?.priority ?? '').trim(),
    monthDirection: (plan.monthDirection ?? '').trim(),
    priorities: priorities.map((p) => ({ title: p.title.trim(), why: (p.why ?? '').trim() })).filter((p) => p.title),
    // The week = the plan's first actions in order (the focus priority's steps, then the next priority's), not the
    // month-level priorities. Today is the first of them.
    moves: actions.slice(0, MAX_CHAPTERS).map((a) => ({ what: a.what.trim(), why: (a.why ?? '').trim() })).filter((m) => m.what),
    today: firstAction ? { what: firstAction.what.trim(), why: (firstAction.why ?? '').trim(), done: (firstAction.doneDefinition ?? '').trim() } : null,
  };
}
