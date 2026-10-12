import type { GovernedUnderstanding } from '../bi/index';
import type { ArcContainerItem } from './contracts';
import { isHeldGoal } from '../conversation/goal-candidate';

/**
 * Moment 9 — "What I know" must reflect the conversation, not only the site read (operator, 2026-10-12: "Still
 * unknown" listed the network state and the first buyer, both answered). The container now shows three lanes:
 *   - what BB observed (offer, positioning, audience: the site read),
 *   - what the founder TOLD BB (the goal, answered questions, constraints): provenance 'declared', founder's terms,
 *   - what is still unknown: only the questions nothing the founder said answers.
 * Which questions are answered is a model judgement (word overlap could not separate "answered" from "same topic"
 * on real data); `guardAnswers` keeps an answer only when its content words come from what the founder said.
 */
export interface FounderSaid { readonly kind: string; readonly statement: string; readonly status: string; readonly sourceTurnId?: string | null }
export interface ContainerAnswer { readonly index: number; readonly answer: string }
export interface ContainerAnswersInput { readonly language: string; readonly questions: string[]; readonly founderSaid: string[] }
export interface IContainerAnswerModel {
  /** Which questions the founder's own words already answer, each with a one-line answer in the founder's terms.
   * Null on failure (the container then shows every question as unknown, as before). */
  answered(input: ContainerAnswersInput): Promise<ContainerAnswer[] | null>;
}

const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'what', 'when', 'your', 'they', 'their', 'there', 'which', 'will',
  'would', 'about', 'into', 'than', 'then', 'them', 'were', 'been', 'being', 'also', 'only', 'just', 'like', 'more', 'most',
  'some', 'such', 'very', 'does', 'doing', 'done', 'each', 'other', 'over', 'under', 'still', 'already', 'today', 'told']);
const contentWords = (s: string): string[] =>
  ((s ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/u, ''));

/** Anti-fabrication: an answer survives only if most of its content words appear in what the founder said. */
export function guardAnswers(raw: ContainerAnswer[] | null | undefined, questions: readonly string[], said: readonly string[]): ContainerAnswer[] {
  if (!Array.isArray(raw)) return [];
  const corpus = new Set(said.flatMap(contentWords));
  const seen = new Set<number>();
  const out: ContainerAnswer[] = [];
  for (const a of raw) {
    const i = Number(a?.index);
    const answer = typeof a?.answer === 'string' ? a.answer.trim() : '';
    if (!Number.isInteger(i) || i < 0 || i >= questions.length || seen.has(i) || !answer) continue;
    const w = contentWords(answer);
    if (w.length === 0 || w.filter((x) => corpus.has(x)).length / w.length < 0.6) continue;
    seen.add(i); out.push({ index: i, answer });
  }
  return out;
}

/** The fingerprint of what the answers were judged on: new questions or anything new the founder said → re-judge. */
export const containerKey = (questions: readonly string[], said: readonly string[]): string =>
  `${questions.length}:${questions.join('|').length}:${said.length}:${said.join('|').length}`;

const clean = (xs?: (string | null | undefined)[]): string[] => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);

export function projectContainer(u: GovernedUnderstanding | null, said: readonly FounderSaid[], questions: readonly string[], answered: readonly ContainerAnswer[]): ArcContainerItem[] {
  const items: ArcContainerItem[] = [];
  // What BB observed.
  if (u?.offer?.summary?.trim()) items.push({ labelKey: 'arc.container.lbl.offer', statement: u.offer.summary.trim(), provenance: 'observed' });
  if (u?.positioning?.summary?.trim()) items.push({ labelKey: 'arc.container.lbl.positioning', statement: u.positioning.summary.trim(), provenance: clean(u.positioning.evidenceBacked).length ? 'observed' : 'inferred' });
  const aud = clean(u?.audience?.addressed);
  if (aud.length) items.push({ labelKey: 'arc.container.lbl.audience', statement: aud.join(', '), provenance: 'observed' });
  // What the founder told BB.
  const active = said.filter((s) => s.status === 'active');
  const goal = [...active].reverse().find((s) => isHeldGoal(s));
  if (goal) items.push({ labelKey: 'arc.container.lbl.goal', statement: goal.statement.trim(), provenance: 'declared' });
  for (const a of answered) items.push({ labelKey: 'arc.container.lbl.told', statement: a.answer, provenance: 'declared' });
  for (const c of active.filter((s) => s.kind === 'constraint').slice(0, 2)) items.push({ labelKey: 'arc.container.lbl.constraint', statement: c.statement.trim(), provenance: 'declared' });
  // What is still unknown: only what nothing the founder said answers.
  const done = new Set(answered.map((a) => a.index));
  questions.forEach((q, i) => { if (!done.has(i)) items.push({ labelKey: 'arc.container.lbl.unknown', statement: q, provenance: 'unknown' }); });
  return items;
}
