/**
 * Temporal-evidence extraction — THE new observed shape (spec §4). Prior sources emit PROSE;
 * Calendar emits TIME/STRUCTURE. This module turns real timed events into TIME-ALLOCATION PATTERNS
 * and renders them as MEASURED PROSE carried by `observed` evidence — so the FROZEN engine can read
 * and cite them exactly like any other observed source, WITHOUT the engine changing to reason over a
 * non-prose shape. The pattern (percentages, hours, counts) is the evidence; the calendar is not.
 *
 * HONESTY (fail closed):
 *   - No events in the window → NO fragments. Never a fabricated pattern.
 *   - Every number is MEASURED from real events; a category with zero events emits no line.
 *   - Evidence is `observed`, source `google-calendar`, `calendar://` provenance (opaque, never
 *     dereferenced), visibility private — through the UNCHANGED honesty gate (makeFragment).
 *
 * EPISTEMIC CEILING (spec §4): this is evidence of HOW TIME WAS SPENT (observed behavior), NOT of
 * what the business IS. The prose says "42% of scheduled time went to sales & client meetings" — a
 * behavior fact — never "sales is the strategy". The engine's marketContext ceiling (enforced in
 * recompute) additionally forbids laundering any of this into an external-reality claim.
 *
 * Event titles are read ONLY to bucket time into categories; they are NEVER re-emitted verbatim as
 * evidence (privacy: patterns, not surveillance). Reversible defaults (window, buckets, wording).
 */
import { makeFragment, type EvidenceFragment } from '@bb/domain';

export const CALENDAR_SOURCE = 'google-calendar';

export interface TimedEvent { summary: string | null; start: Date; end: Date }

/** Time-allocation buckets — a reasonable default heuristic (reversible, tunable). */
interface Bucket { cat: string; label: string; kw: RegExp }
const BUCKETS: Bucket[] = [
  { cat: 'sales',    label: 'Sales & client',      kw: /\b(sales|client|customer|prospect|demo|deal|pipeline|discovery|renewal|account|revenue|lead)\b/i },
  { cat: 'product',  label: 'Product & deep work', kw: /\b(product|design|eng|engineering|build|dev|develop|deep[- ]?work|focus|roadmap|spec|sprint|backlog|bug|research)\b/i },
  { cat: 'internal', label: 'Internal & team',     kw: /\b(standup|stand[- ]?up|sync|1:1|one[- ]?on[- ]?one|team|weekly|staff|all[- ]?hands|retro|planning|check[- ]?in|review)\b/i },
  { cat: 'ops',      label: 'Ops & admin',         kw: /\b(ops|admin|finance|legal|hr|invoice|budget|hiring|recruit|interview|payroll|compliance|board|investor)\b/i },
];
const OTHER: Bucket = { cat: 'other', label: 'Other & unlabeled', kw: /.^/ };

function bucketOf(summary: string | null): Bucket {
  const s = summary ?? '';
  for (const b of BUCKETS) if (b.kw.test(s)) return b;
  return OTHER;
}

export interface CategoryAllocation { cat: string; label: string; events: number; hours: number; pct: number }
export interface Allocation {
  windowDays: number;
  totalEvents: number;
  totalHours: number;
  categories: CategoryAllocation[]; // only non-empty categories, descending by hours
}

const hoursBetween = (a: Date, b: Date): number => Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Measure the allocation from real events. Pure; no rounding lies (percent from raw hours). */
export function summarizeAllocation(events: TimedEvent[], windowDays: number): Allocation {
  const byCat = new Map<string, CategoryAllocation>();
  let totalHours = 0;
  for (const e of events) {
    const h = hoursBetween(e.start, e.end);
    if (h <= 0) continue;
    totalHours += h;
    const b = bucketOf(e.summary);
    const cur = byCat.get(b.cat) ?? { cat: b.cat, label: b.label, events: 0, hours: 0, pct: 0 };
    cur.events += 1; cur.hours += h;
    byCat.set(b.cat, cur);
  }
  const categories = [...byCat.values()]
    .map((c) => ({ ...c, hours: round1(c.hours), pct: totalHours > 0 ? Math.round((c.hours / totalHours) * 100) : 0 }))
    .sort((a, b) => b.hours - a.hours);
  return { windowDays, totalEvents: events.filter((e) => hoursBetween(e.start, e.end) > 0).length, totalHours: round1(totalHours), categories };
}

/** One verbatim category line — shared by the unit summary AND its block, so engine quotes resolve. */
function categoryLine(c: CategoryAllocation, totalHours: number): string {
  return `${c.label}: ${c.pct}% of scheduled time (${c.hours} of ${totalHours} hours) across ${c.events} ${c.events === 1 ? 'event' : 'events'}.`;
}

/** Opaque, resolvable provenance key used as source_url. Never dereferenced/fetched. */
export function calendarUri(windowDays: number): string {
  return `calendar://last-${windowDays}d/allocation`;
}

export interface BuildOpts { windowDays: number; occurredAt?: Date | null }

/**
 * Build temporal `observed` evidence: ONE unit fragment whose text is the measured allocation prose
 * (what the engine reads + cites), plus one block per category (what quotes resolve to). Fail closed:
 * empty in → empty out. All through the UNCHANGED honesty gate (observed requires the calendar:// URI).
 */
export function buildCalendarEvidence(founderId: string, events: TimedEvent[], opts: BuildOpts): EvidenceFragment[] {
  const alloc = summarizeAllocation(events, opts.windowDays);
  if (alloc.totalEvents === 0 || alloc.categories.length === 0) return []; // no pattern → no evidence (fail closed)

  const uri = calendarUri(opts.windowDays);
  const lines = alloc.categories.map((c) => categoryLine(c, alloc.totalHours));
  const summary =
    `Over the last ${alloc.windowDays} days your calendar shows ${alloc.totalEvents} scheduled ` +
    `${alloc.totalEvents === 1 ? 'event' : 'events'} totalling ${alloc.totalHours} hours. ` +
    `Here is how that time was allocated:\n${lines.join('\n')}`;

  const occurredAt = opts.occurredAt ?? null;
  const common = {
    founderId, source: CALENDAR_SOURCE, platform: null, sourceUrl: uri,
    confidenceKind: 'observed' as const, visibility: 'private' as const, occurredAt,
  };

  const fragments: EvidenceFragment[] = [];
  // UNIT — the measured allocation prose the engine reads (behavior register).
  fragments.push(makeFragment({ ...common, payload: {
    text: summary,
    kind: 'calendar-allocation',
    window: { days: alloc.windowDays },
    allocation: alloc, // structured mirror of the prose (diagnostic; never the cited text)
  } }));
  // BLOCKS — one verbatim category line each, so an engine quote resolves to the most specific block.
  for (const c of alloc.categories) {
    fragments.push(makeFragment({ ...common, payload: {
      kind: 'block', text: categoryLine(c, alloc.totalHours), category: c.cat, blockType: 'calendar-category',
    } }));
  }
  return fragments;
}
