import type { Contact, CumulativeEvidence, FollowUp, Outcome, OutcomeType, Touch } from './contracts';

/**
 * Cumulative evidence, deterministically. The evaluator never judges "three clinics said no" in isolation: it reads
 * these counts across ALL logged outreach for the business. Pure: same rows in, same numbers out.
 */
const DAY_MS = 86_400_000;
const POSITIVE: readonly OutcomeType[] = ['MATERIAL_REQUESTED', 'FOLLOW_UP_REQUESTED', 'MEETING_REQUESTED', 'REFERRAL_RECEIVED', 'CONVERTED'];
const OUTBOUND_REACH = new Set(['SENT', 'VISITED', 'FOLLOW_UP']);

export function cumulativeEvidence(
  rows: { contacts: Contact[]; touches: Touch[]; outcomes: Outcome[]; followUps: FollowUp[] }, now: Date,
): CumulativeEvidence {
  const inc = <K extends string>(m: Partial<Record<K, number>>, k: K): void => { m[k] = (m[k] ?? 0) + 1; };
  const byStatus: CumulativeEvidence['byStatus'] = {};
  for (const c of rows.contacts) inc(byStatus, c.status);
  const touches: CumulativeEvidence['touches'] = {};
  for (const t of rows.touches) inc(touches, t.type);
  const outcomes: CumulativeEvidence['outcomes'] = {};
  for (const o of rows.outcomes) inc(outcomes, o.outcomeType);

  const reached = new Set(rows.touches.filter((t) => t.direction === 'OUTBOUND' && OUTBOUND_REACH.has(t.type)).map((t) => t.contactId));
  const responded = new Set(rows.outcomes.filter((o) => o.outcomeType !== 'NO_RESPONSE').map((o) => o.contactId));
  for (const t of rows.touches) if (t.direction === 'INBOUND') responded.add(t.contactId);
  const positive = new Set(rows.outcomes.filter((o) => POSITIVE.includes(o.outcomeType)).map((o) => o.contactId));
  const times = rows.touches.map((t) => Date.parse(t.occurredAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const today = now.toISOString().slice(0, 10);
  const open = rows.followUps.filter((f) => f.status === 'OPEN');
  const respondedReached = [...responded].filter((id) => reached.has(id)).length;
  const positiveReached = [...positive].filter((id) => reached.has(id)).length;

  return {
    contacts: rows.contacts.length,
    contacted: reached.size,
    byStatus, touches, outcomes,
    responded: respondedReached,
    positive: positiveReached,
    responseRate: reached.size ? respondedReached / reached.size : null,
    positiveRate: reached.size ? positiveReached / reached.size : null,
    referrals: (outcomes.REFERRAL_RECEIVED ?? 0) + (outcomes.CONVERTED ?? 0),
    firstTouchAt: times.length ? new Date(times[0]!).toISOString() : null,
    lastTouchAt: times.length ? new Date(times[times.length - 1]!).toISOString() : null,
    daysSinceFirstTouch: times.length ? Math.floor((now.getTime() - times[0]!) / DAY_MS) : null,
    openFollowUps: open.length,
    overdueFollowUps: open.filter((f) => f.dueOn < today).length,
  };
}

/** The evidence as plain statements (for the model and for strategy regeneration). Facts only, no interpretation. */
export function evidenceStatements(ev: CumulativeEvidence): string[] {
  if (!ev.contacts) return [];
  const pct = (r: number | null): string => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
  const o = ev.outcomes;
  return [
    `${ev.contacts} target contacts; ${ev.contacted} reached so far${ev.daysSinceFirstTouch !== null ? ` over ${ev.daysSinceFirstTouch} days` : ''}.`,
    `Outcomes: ${o.NOT_INTERESTED ?? 0} not interested, ${o.NO_RESPONSE ?? 0} no response, ${o.MATERIAL_REQUESTED ?? 0} asked for material, `
      + `${o.FOLLOW_UP_REQUESTED ?? 0} asked for a follow-up, ${o.MEETING_REQUESTED ?? 0} asked to meet, ${ev.referrals} referrals.`,
    `Response rate ${pct(ev.responseRate)}; interested ${pct(ev.positiveRate)} of contacts reached.`,
    `${ev.openFollowUps} follow-ups open (${ev.overdueFollowUps} overdue).`,
  ];
}

// ── Reconsider conditions as checks over the counts ──

/** What can be COUNTED across all logged outreach (a number of contacts, never a rate). */
export type CountMetric =
  | 'contacts_reached' | 'responded' | 'positive' | 'referrals'
  | 'not_interested' | 'no_response' | 'material_requested' | 'meetings';
/** What a ratio is taken over: contacts reached so far, or every target contact. */
export type RatioBase = 'contacts_reached' | 'contacts';
export type Comparator = '<' | '<=' | '>' | '>=';

/**
 * One of the strategy's OWN reconsider conditions, structured with its quantity semantics kept explicit:
 *   - absolute_count: "more than 5 clinics say no" → not_interested > 5 (an integer count)
 *   - ratio: "more than half of the clinics contacted refuse" → not_interested / contacts_reached > 0.5
 *   - all / any: a combined condition ("fewer than 2 referrals AND more than 10 clinics reached")
 * A time window ("within 8 weeks") or a sample ("after 10 clinics") is part of each leaf: `withinDays` / `minContacts`.
 * `measurable: false` when it cannot be read off the counts ("if the founder's capacity changes"). Every threshold comes
 * from the condition's own words, never a global default.
 */
export interface ConditionCheck {
  readonly condition: string;
  readonly measurable: boolean;
  readonly kind: 'absolute_count' | 'ratio' | 'all' | 'any' | null;
  /** The count (absolute_count) or the ratio's numerator. */
  readonly metric: CountMetric | null;
  /** ratio only. */
  readonly denominator: RatioBase | null;
  readonly comparator: Comparator | null;
  /** absolute_count: a whole number of contacts; ratio: a fraction in (0, 1]. */
  readonly threshold: number | null;
  /** Only when the condition itself names a sample ("after 10 clinics"). */
  readonly minContacts: number | null;
  /** Only when the condition itself names a window ("within 6 weeks"). */
  readonly withinDays: number | null;
  /** all / any only. */
  readonly parts: readonly ConditionCheck[];
}

export type ConditionState = 'met' | 'not_met' | 'not_yet_measurable' | 'not_measurable';
export interface ConditionEvaluation { readonly condition: string; readonly state: ConditionState; readonly observed: number | null; readonly detail: string }

export const COUNT_METRICS: readonly CountMetric[] = ['contacts_reached', 'responded', 'positive', 'referrals', 'not_interested', 'no_response', 'material_requested', 'meetings'];

function count(metric: CountMetric, ev: CumulativeEvidence): number {
  switch (metric) {
    case 'contacts_reached': return ev.contacted;
    case 'responded': return ev.responded;
    case 'positive': return ev.positive;
    case 'referrals': return ev.referrals;
    case 'not_interested': return ev.outcomes.NOT_INTERESTED ?? 0;
    case 'no_response': return ev.outcomes.NO_RESPONSE ?? 0;
    case 'material_requested': return ev.outcomes.MATERIAL_REQUESTED ?? 0;
    case 'meetings': return ev.outcomes.MEETING_REQUESTED ?? 0;
  }
}

const compare = (a: number, c: Comparator, b: number): boolean => (c === '<' ? a < b : c === '<=' ? a <= b : c === '>' ? a > b : a >= b);
const pct = (r: number): string => `${Math.round(r * 1000) / 10}%`;

/**
 * Deterministic: is the condition materially met by the cumulative counts? A shortfall ("fewer than 2 referrals within 6
 * weeks") can only be met once its own window / sample has elapsed; an exceedance ("more than 5 clinics say no") is met as
 * soon as the count crosses it, inside its own window. A ratio is computed as numerator / denominator, never compared as
 * a bare count.
 */
export function evaluateCondition(check: ConditionCheck, ev: CumulativeEvidence): ConditionEvaluation {
  const base = { condition: check.condition };
  if (!check.measurable) return { ...base, state: 'not_measurable', observed: null, detail: 'cannot be read off logged outreach' };
  if (check.kind === 'all' || check.kind === 'any') {
    const parts = check.parts.map((p) => evaluateCondition(p, ev));
    const states = parts.map((p) => p.state);
    const detail = parts.map((p) => `[${p.state}: ${p.detail}]`).join(check.kind === 'all' ? ' AND ' : ' OR ');
    const state: ConditionState = check.kind === 'all'
      ? (states.includes('not_met') ? 'not_met' : states.every((x) => x === 'met') ? 'met' : 'not_yet_measurable')
      : (states.includes('met') ? 'met' : states.every((x) => x === 'not_met') ? 'not_met' : 'not_yet_measurable');
    return { ...base, state, observed: null, detail };
  }
  if (!check.metric || !check.comparator || check.threshold === null || (check.kind === 'ratio' && !check.denominator)) {
    return { ...base, state: 'not_measurable', observed: null, detail: 'cannot be read off logged outreach' };
  }
  const shortfall = check.comparator === '<' || check.comparator === '<=';
  if (shortfall) {
    if (check.minContacts !== null && ev.contacted < check.minContacts) {
      return { ...base, state: 'not_yet_measurable', observed: null, detail: `${ev.contacted} of ${check.minContacts} contacts reached` };
    }
    if (check.withinDays !== null && (ev.daysSinceFirstTouch ?? 0) < check.withinDays) {
      return { ...base, state: 'not_yet_measurable', observed: null, detail: `${ev.daysSinceFirstTouch ?? 0} of ${check.withinDays} days elapsed` };
    }
  } else if (check.withinDays !== null && ev.daysSinceFirstTouch !== null && ev.daysSinceFirstTouch > check.withinDays) {
    // An exceedance only counts inside its own window.
    return { ...base, state: 'not_met', observed: null, detail: `window of ${check.withinDays} days has passed` };
  }
  const num = count(check.metric, ev);
  if (check.kind === 'ratio') {
    const den = check.denominator === 'contacts' ? ev.contacts : ev.contacted;
    if (!den) return { ...base, state: 'not_yet_measurable', observed: null, detail: `no ${check.denominator === 'contacts' ? 'contacts' : 'contacts reached'} yet` };
    const ratio = num / den;
    const met = compare(ratio, check.comparator, check.threshold);
    return { ...base, state: met ? 'met' : 'not_met', observed: ratio, detail: `${check.metric} / ${check.denominator} = ${num}/${den} = ${pct(ratio)} (condition: ${check.comparator} ${pct(check.threshold)})` };
  }
  const met = compare(num, check.comparator, check.threshold);
  return { ...base, state: met ? 'met' : 'not_met', observed: num, detail: `${check.metric} = ${num} (condition: ${check.comparator} ${check.threshold})` };
}

const UNMEASURABLE = (condition: string): ConditionCheck => ({ condition, measurable: false, kind: null, metric: null, denominator: null, comparator: null, threshold: null, minContacts: null, withinDays: null, parts: [] });
/** Older shape: a rate metric means a ratio over contacts reached. */
const LEGACY_RATE: Record<string, CountMetric> = { response_rate: 'responded', positive_rate: 'positive' };

function leaf(c: Record<string, unknown>, condition: string, depth: number): ConditionCheck {
  const nonNeg = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const kindRaw = String(c['kind'] ?? '');
  if ((kindRaw === 'all' || kindRaw === 'any') && depth === 0) {
    const parts = Array.isArray(c['parts']) ? (c['parts'] as unknown[]).map((p) => leaf((p ?? {}) as Record<string, unknown>, condition, 1)) : [];
    return parts.length >= 2 && parts.every((p) => p.measurable)
      ? { ...UNMEASURABLE(condition), measurable: true, kind: kindRaw, parts }
      : UNMEASURABLE(condition);
  }
  // A part of a combined condition is measurable unless it says otherwise.
  if (c['measurable'] !== true && !(depth > 0 && c['measurable'] === undefined)) return UNMEASURABLE(condition);
  const metricRaw = String(c['metric'] ?? '');
  const legacy = LEGACY_RATE[metricRaw];
  const metric = legacy ?? (COUNT_METRICS.includes(metricRaw as CountMetric) ? (metricRaw as CountMetric) : null);
  const kind = legacy ? 'ratio' : kindRaw === 'ratio' ? 'ratio' : kindRaw === 'absolute_count' || kindRaw === '' ? 'absolute_count' : null;
  const comparator = ['<', '<=', '>', '>='].includes(c['comparator'] as string) ? (c['comparator'] as Comparator) : null;
  let threshold = nonNeg(c['threshold']);
  const denominator: RatioBase | null = kind === 'ratio' ? (c['denominator'] === 'contacts' ? 'contacts' : 'contacts_reached') : null;
  if (kind === 'ratio' && threshold !== null && threshold > 1) threshold = threshold / 100; // "50" → 0.5
  // Quantity semantics must survive: a count threshold is a whole number of contacts ("more than half" is never `count > 0.5`),
  // a ratio threshold is a fraction. Anything else is a mis-structuring → unmeasurable (fail safe: it cannot fire RECONSIDER).
  const valid = kind !== null && metric !== null && comparator !== null && threshold !== null
    && (kind === 'ratio' ? threshold > 0 && threshold <= 1 && metric !== 'contacts_reached' : Number.isInteger(threshold));
  if (!valid) return UNMEASURABLE(condition);
  return { condition, measurable: true, kind, metric, denominator, comparator, threshold, minContacts: nonNeg(c['minContacts']), withinDays: nonNeg(c['withinDays']), parts: [] };
}

/** Shape-check a model's structuring of the conditions: only the strategy's own conditions, valid fields, else unmeasurable. */
export function checkConditionChecks(raw: unknown, conditions: readonly string[]): ConditionCheck[] {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { checks?: unknown } | null)?.checks) ? (raw as { checks: unknown[] }).checks : [];
  return conditions.map((condition) => {
    const c = list.find((x) => typeof (x as { condition?: unknown })?.condition === 'string' && (x as { condition: string }).condition.trim() === condition.trim()) as Record<string, unknown> | undefined;
    return c ? leaf(c, condition, 0) : UNMEASURABLE(condition);
  });
}
