import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import type { KyselyDB } from '@bb/infrastructure';
import type { CorrectionReflection } from '@bb/application';

/**
 * M7 founder-test observability. A thin, fire-and-forget recorder for FOUNDER-BEHAVIOR events into
 * app.founder_event. Telemetry must NEVER break or slow a founder request: every write is best-effort and
 * swallows its own errors. Metadata is bounded and non-sensitive — no page dumps, PII, secrets, or prompts.
 */

export type FounderEventType =
  | 'session_started'
  | 'onboarding_url_submitted'
  | 'source_material_submitted'
  | 'source_instagram_interest'
  | 'first_understanding_viewed'
  | 'first_value_reached'
  | 'understanding_expanded'
  | 'evidence_source_opened'
  | 'correction_submitted'
  | 'correction_held_viewed'
  | 'strategy_proposed'
  | 'strategy_adopted'
  | 'strategy_responded'
  | 'today_viewed'
  | 'action_marked_done'
  | 'action_deferred'
  | 'blocker_material_confirmed'
  | 'blocker_constraint_recorded'
  | 'blocker_decision_made'
  | 'create_started'
  | 'asset_generated'
  | 'asset_revision_requested'
  | 'asset_exported'
  | 'strategy_to_asset_completed'
  | 'asset_generation_insufficient_material'
  | 'asset_needs_evidence'
  | 'talk_opened'
  | 'talk_turn_submitted'
  | 'baseline_reopened'
  | 'goal_confirmed'         // founder confirmed a reflected-back (or cold-asked) goal → written directly as kind='goal'
  // Attribution by asking (V081) — the weekly reach prompt on Today. These are the dedup/cadence flags; the
  // answer CONTENT lives in workspace.reach_report, never here (founder_event stays bounded behavior telemetry).
  | 'weekly_prompt_answered'  // the founder gave this week's reach answer (resets the prompt until next week)
  | 'weekly_prompt_dismissed' // the founder skipped this week (suppresses the prompt until next week)
  // Living State — impact evaluator + return loop.
  | 'impact_evaluated'       // a new reality was assessed against the held strategy (carries the verdict)
  | 'outcome_reported'       // a founder reported an outcome of their work
  | 'return_summary_shown'   // the anchor for "since you were last here" (server-recorded on each Today visit)
  | 'mirror_viewed'          // the founder opened the mirror (three lanes + contrast)
  | 'mirror_corrected'       // the founder corrected a lane, and the mirror recomputed
  // Day One arc — durable phase markers (no new table; the arc's moment is derived from these + engine state).
  | 'arc_source_added'       // Moment 1: a source the founder added (url in metadata) — the durable pour-in list
  | 'arc_pour_in_done'       // Moment 1 → 2: the founder clicked "Done adding — start"
  | 'arc_understanding_confirmed' // Moment 3 → 4: the founder confirmed what BB understood
  | 'arc_correction_reflected' // Moment 3: the substantive reply to the LATEST correction (persisted so it survives refresh)
  | 'arc_mirror_built'       // Moment 5: the mirror contrast (persisted so it's stable across refresh, no re-generation)
  | 'arc_mirror_seen'        // Moment 5 → 6: the founder answered the mirror
  | 'arc_email_saved'        // Moment 8: the current email draft (subject+body in metadata)
  | 'arc_email_exported'     // Moment 8 → 9: the founder exported the email
  | 'arc_container_seen';    // Moment 9 → done: the founder saw (or dismissed) the container

// Client-emittable events only (server-authoritative milestones are never accepted from the browser, so a
// founder can't fake "I adopted a strategy / exported an asset / completed the loop").
const CLIENT_EMITTABLE = new Set<FounderEventType>([
  'onboarding_url_submitted', 'first_understanding_viewed', 'first_value_reached',
  'understanding_expanded', 'evidence_source_opened', 'correction_held_viewed', 'today_viewed',
  // Instagram-first DEMAND signal (a founder who has no website but uses Instagram). It records interest so we
  // can later size the connector; it NEVER connects Instagram or exchanges a token.
  'source_instagram_interest',
]);
export const isClientEmittable = (t: string): t is FounderEventType => CLIENT_EMITTABLE.has(t as FounderEventType);

export interface FounderEventInput {
  readonly accountId: string;
  readonly businessId?: string | null;
  readonly eventType: FounderEventType;
  readonly surface?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export function recordFounderEvent(db: KyselyDB, ev: FounderEventInput): void {
  let meta = '{}';
  try { meta = JSON.stringify(ev.metadata ?? {}).slice(0, 2000); } catch { meta = '{}'; }
  void sql`
    INSERT INTO app.founder_event (id, account_id, business_id, event_type, surface, occurred_at, metadata)
    VALUES (${generateId()}, ${ev.accountId}, ${ev.businessId ?? null}, ${ev.eventType},
            ${ev.surface ?? null}, now(), ${meta}::jsonb)
  `.execute(db).catch(() => { /* swallow — telemetry is never allowed to affect the founder */ });
}

// ── Return loop: "since you were last here" ─────────────────────────────────────────────────────────────
// The FIRST reader this write-only telemetry has ever had. It aggregates the events since the founder's
// previous Today visit into a compact, plain-language summary — no activity feed, no new state model.

export interface ReturnEvent {
  readonly eventType: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface ReturnSummary {
  /** whether to render the block at all: a prior visit exists AND the gap is a real absence (not same-session). */
  readonly show: boolean;
  /** true when the block has real content; false ⇒ a calm "nothing moved" after a genuine absence. */
  readonly hasChanges: boolean;
  readonly changes: string[];
  readonly strategyMoved: boolean;
  readonly todayChanged: boolean;
  /** the single most relevant "one thing" for Today, if the evaluator named one. */
  readonly oneThing: string | null;
  /** ISO timestamp of the previous visit, or null on a first visit. */
  readonly since: string | null;
  /** whole hours since the previous visit, or null on a first visit. */
  readonly awayHours: number | null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];

// A gap below this is treated as the SAME working session (a refresh / a return minutes later) → no block.
// Above it is a real absence worth summarizing. (>24h absences, the acceptance case, clear it comfortably.)
const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Pure aggregation (unit-tested): fold the events since the previous visit into a return summary.
 * - No prior visit (since null) ⇒ never show (first ever visit).
 * - Gap < SESSION_GAP_MS ⇒ same session ⇒ never show (no "since you were last here" on a quick return).
 * - A real absence ⇒ show; if events happened, summarize them (deduped + capped, freshest one-thing wins);
 *   if nothing happened, show calmly (hasChanges=false) — never invent activity.
 */
export function summarizeReturn(events: ReturnEvent[], since: string | null, nowIso: string): ReturnSummary {
  const empty = { show: false, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null };
  if (!since) return { ...empty, since: null, awayHours: null };
  const awayMs = Math.max(0, new Date(nowIso).getTime() - new Date(since).getTime());
  const awayHours = Math.floor(awayMs / 3_600_000);
  if (awayMs < SESSION_GAP_MS) return { ...empty, since, awayHours }; // same session — suppress

  const changes: string[] = [];
  let strategyMoved = false;
  let todayChanged = false;
  let oneThing: string | null = null;
  let doneCount = 0;

  // ascending order assumed; the LAST evaluator move with a newMove is the freshest "one thing".
  for (const ev of events) {
    const m = ev.metadata ?? {};
    if (ev.eventType === 'impact_evaluated') {
      for (const c of asStrings(m['whatChanged'])) if (!changes.includes(c)) changes.push(c);
      const verdict = String(m['verdict'] ?? '');
      if (verdict === 'REVISE' || verdict === 'RECONSIDER') strategyMoved = true;
      if (m['todayChanges'] === true) todayChanged = true;
      const nm = typeof m['newMove'] === 'string' ? m['newMove'].trim() : '';
      if (nm) oneThing = nm;
    } else if (ev.eventType === 'strategy_adopted') {
      strategyMoved = true;
    } else if (ev.eventType === 'action_marked_done') {
      doneCount += 1;
    }
  }
  if (doneCount > 0) changes.push(doneCount === 1 ? 'You completed a move.' : `You completed ${doneCount} moves.`);

  const capped = changes.slice(0, 4);
  const hasChanges = capped.length > 0 || strategyMoved || todayChanged;
  return { show: true, hasChanges, changes: capped, strategyMoved, todayChanged, oneThing, since, awayHours };
}

// ── "Today updated because …" — the same-session reason line on Today (distinct from the return block) ──

export type TodayNote =
  | { readonly kind: 'strategy_adopted'; readonly version: number }
  | { readonly kind: 'impact'; readonly reason: string }
  | null;

const TODAY_NOTE_WINDOW_MS = 24 * 3_600_000;

/**
 * Pure (unit-tested): the most recent Today-changing event within the window becomes the "Today updated
 * because" note — a strategy adoption (→ "strategy vN adopted") or a TUNE/impact with a real Today change.
 * Events must be ascending; the last qualifying one wins.
 */
export function summarizeTodayNote(events: ReturnEvent[], nowIso: string): TodayNote {
  const now = new Date(nowIso).getTime();
  let note: TodayNote = null;
  for (const ev of events) {
    if (now - new Date(ev.occurredAt).getTime() > TODAY_NOTE_WINDOW_MS) continue;
    const m = ev.metadata ?? {};
    if (ev.eventType === 'strategy_adopted') {
      const v = Number(m['version']);
      if (Number.isFinite(v) && v > 0) note = { kind: 'strategy_adopted', version: v };
    } else if (ev.eventType === 'impact_evaluated' && m['todayChanges'] === true) {
      const reason = String(m['todayReason'] ?? '').trim();
      if (reason) note = { kind: 'impact', reason };
    }
  }
  return note;
}

/**
 * Read the return summary for a founder's Today visit, then advance the visit anchor. The anchor is the most
 * recent `return_summary_shown` strictly before now; events since it are summarized. Best-effort: any DB
 * error yields an empty (no-changes) summary so Today never fails on telemetry.
 */
export async function readReturnSummary(db: KyselyDB, businessId: string, accountId: string): Promise<ReturnSummary> {
  const nowIso = new Date().toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anchorRow: any = await sql`
      SELECT occurred_at FROM app.founder_event
      WHERE business_id = ${businessId} AND account_id = ${accountId} AND event_type = 'return_summary_shown'
      ORDER BY occurred_at DESC LIMIT 1
    `.execute(db);
    const since: string | null = anchorRow?.rows?.[0]?.occurred_at ? new Date(anchorRow.rows[0].occurred_at).toISOString() : null;

    let events: ReturnEvent[] = [];
    if (since) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any = await sql`
        SELECT event_type, metadata, occurred_at FROM app.founder_event
        WHERE business_id = ${businessId} AND account_id = ${accountId}
          AND occurred_at > ${since}
          AND event_type IN ('impact_evaluated', 'strategy_adopted', 'action_marked_done', 'baseline_reopened')
        ORDER BY occurred_at ASC LIMIT 100
      `.execute(db);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events = (rows?.rows ?? []).map((r: any) => ({
        eventType: String(r.event_type),
        metadata: (typeof r.metadata === 'object' && r.metadata) ? r.metadata : {},
        occurredAt: new Date(r.occurred_at).toISOString(),
      }));
    }
    return summarizeReturn(events, since, nowIso);
  } catch {
    return { show: false, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null, awayHours: null };
  }
}

/**
 * The founder's most recent cycle-close outcome text (from the `outcome_reported` event metadata). Month two's
 * next plan reads this to advance from what actually happened. Best-effort: any error yields '' (the planner
 * still advances from the prior plan's completed/deferred work, just without the founder's own words).
 */
export async function readLatestOutcomeText(db: KyselyDB, businessId: string, accountId: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await sql`
      SELECT metadata FROM app.founder_event
      WHERE business_id = ${businessId} AND account_id = ${accountId} AND event_type = 'outcome_reported'
      ORDER BY occurred_at DESC LIMIT 1
    `.execute(db);
    const md = rows?.rows?.[0]?.metadata;
    const text = (md && typeof md === 'object' && typeof md.text === 'string') ? md.text : '';
    return text.trim();
  } catch {
    return '';
  }
}

// ── Day One arc: durable phase flags + the email draft, read back from founder_event ──

export interface ArcFlags {
  readonly pourInDone: boolean;
  readonly understandingConfirmed: boolean;
  readonly mirrorSeen: boolean;
  readonly emailExported: boolean;
  readonly containerSeen: boolean;
}

const has = async (db: KyselyDB, businessId: string, accountId: string, type: string): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT 1 FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type=${type} LIMIT 1`.execute(db);
    return (r?.rows?.length ?? 0) > 0;
  } catch { return false; }
};

/** Read the arc's durable phase markers for this founder+business. Missing table / error → all false. */
export async function readArcFlags(db: KyselyDB, businessId: string, accountId: string): Promise<ArcFlags> {
  const [pourInDone, understandingConfirmed, mirrorSeen, emailExported, containerSeen] = await Promise.all([
    has(db, businessId, accountId, 'arc_pour_in_done'),
    has(db, businessId, accountId, 'arc_understanding_confirmed'),
    has(db, businessId, accountId, 'arc_mirror_seen'),
    has(db, businessId, accountId, 'arc_email_exported'),
    has(db, businessId, accountId, 'arc_container_seen'),
  ]);
  return { pourInDone, understandingConfirmed, mirrorSeen, emailExported, containerSeen };
}

/** The durable pour-in source list — every url the founder added, in order, deduped. */
export type ArcSourceType = 'website' | 'link' | 'pdf' | 'docx' | 'text' | 'instagram';
export interface ArcSourceRow { readonly url: string; readonly type: ArcSourceType; readonly detail?: string }

const ARC_SOURCE_TYPES: ReadonlySet<string> = new Set(['website', 'link', 'pdf', 'docx', 'text', 'instagram']);

/** The durable pour-in list: every source the founder has added, with its type (default 'website' for legacy rows). */
/**
 * One row per source, in the order sources were FIRST added, but showing the LATEST read of each: re-adding a
 * source (e.g. Instagram after the 12→50 post change) must update its "N posts read" line, not keep the first.
 * `rows` are arc_source_added events oldest-first.
 */
export function foldArcSourceEvents(rows: readonly { metadata?: unknown }[]): ArcSourceRow[] {
  const out: ArcSourceRow[] = [];
  const at = new Map<string, number>();
  for (const row of rows) {
    const meta = (row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
    const u = String(meta['url'] ?? '').trim();
    if (!u) continue;
    const t = String(meta['type'] ?? '').trim();
    const detail = String(meta['detail'] ?? '').trim();
    const item: ArcSourceRow = { url: u, type: (ARC_SOURCE_TYPES.has(t) ? t : 'website') as ArcSourceType, ...(detail ? { detail } : {}) };
    const i = at.get(u);
    if (i === undefined) { at.set(u, out.length); out.push(item); } else out[i] = item;
  }
  return out;
}

export async function readArcSources(db: KyselyDB, businessId: string, accountId: string): Promise<ArcSourceRow[]> {
  try {
    // The NEWEST 50 events (re-adds must never fall off the end), replayed oldest-first below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata, occurred_at FROM (SELECT metadata, occurred_at FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type='arc_source_added' ORDER BY occurred_at DESC LIMIT 50) latest ORDER BY occurred_at ASC`.execute(db);
    return foldArcSourceEvents(r?.rows ?? []);
  } catch { return []; }
}

// ── Moment 3 correction reflection — persisted so the substantive reply + question survive a refresh ──
const CAP = 700; // per field; keeps the whole JSON under recordFounderEvent's ~2000-char metadata cap
const clip = (s: unknown): string => String(s ?? '').slice(0, CAP);

/** Persist the LATEST correction reflection (the reply the founder sees at Moment 3), so a reload re-shows it. */
export function recordArcCorrectionReflection(db: KyselyDB, accountId: string, businessId: string, r: CorrectionReflection): void {
  recordFounderEvent(db, {
    accountId, businessId, eventType: 'arc_correction_reflected', surface: 'arc',
    metadata: { reflection: clip(r.reflection), changes: clip(r.changes), holds: clip(r.holds), ask: clip(r.ask) },
  });
}

/** The most recent correction reflection for this business (null if the founder hasn't corrected yet). */
export async function readArcCorrectionReflection(db: KyselyDB, businessId: string, accountId: string): Promise<CorrectionReflection | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type='arc_correction_reflected' ORDER BY occurred_at DESC LIMIT 1`.execute(db);
    const meta = r?.rows?.[0]?.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const reflection = String(meta.reflection ?? '').trim();
    if (!reflection) return null;
    return { reflection, changes: String(meta.changes ?? '').trim(), holds: String(meta.holds ?? '').trim(), ask: String(meta.ask ?? '').trim() };
  } catch { return null; }
}

/** Persist the mirror contrast (Moment 5) so it is STABLE across refresh and never re-generated on every view. */
export function recordArcMirror(db: KyselyDB, accountId: string, businessId: string, m: { founderWords: string; against: string; tension: string }): void {
  recordFounderEvent(db, {
    accountId, businessId, eventType: 'arc_mirror_built', surface: 'arc',
    metadata: { founderWords: clip(m.founderWords), against: clip(m.against), tension: clip(m.tension) },
  });
}

/** The most recent persisted mirror contrast (null if none built yet). */
export async function readArcMirror(db: KyselyDB, businessId: string, accountId: string): Promise<{ founderWords: string; against: string; tension: string } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type='arc_mirror_built' ORDER BY occurred_at DESC LIMIT 1`.execute(db);
    const meta = r?.rows?.[0]?.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const founderWords = String(meta.founderWords ?? '').trim();
    const against = String(meta.against ?? '').trim();
    const tension = String(meta.tension ?? '').trim();
    return founderWords && against && tension ? { founderWords, against, tension } : null;
  } catch { return null; }
}

/** The latest saved email draft (Moment 8), from the most recent `arc_email_saved` event's metadata. */
export async function readArcEmail(db: KyselyDB, businessId: string, accountId: string): Promise<{ subject: string; body: string } | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type='arc_email_saved' ORDER BY occurred_at DESC LIMIT 1`.execute(db);
    const m = r?.rows?.[0]?.metadata;
    if (m && typeof m === 'object' && typeof m.subject === 'string' && typeof m.body === 'string') return { subject: m.subject, body: m.body };
    return null;
  } catch { return null; }
}

/** Read the "Today updated because …" note — the most recent Today-changing event within the last 24h. */
export async function readTodayNote(db: KyselyDB, businessId: string, accountId: string): Promise<TodayNote> {
  const nowIso = new Date().toISOString();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any = await sql`
      SELECT event_type, metadata, occurred_at FROM app.founder_event
      WHERE business_id = ${businessId} AND account_id = ${accountId}
        AND event_type IN ('strategy_adopted', 'impact_evaluated')
        AND occurred_at > ${new Date(Date.now() - TODAY_NOTE_WINDOW_MS).toISOString()}
      ORDER BY occurred_at ASC LIMIT 50
    `.execute(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: ReturnEvent[] = (rows?.rows ?? []).map((r: any) => ({
      eventType: String(r.event_type),
      metadata: (typeof r.metadata === 'object' && r.metadata) ? r.metadata : {},
      occurredAt: new Date(r.occurred_at).toISOString(),
    }));
    return summarizeTodayNote(events, nowIso);
  } catch {
    return null;
  }
}

// ── Attribution by asking (V081): the weekly reach prompt's cadence + the published-work window ─────────────
// The prompt is a skippable weekly question on Today. It never nags twice in a week: answering OR skipping
// records a founder_event scoped to the current ISO week, and the prompt is gated on neither having happened
// this week. The FIRST time it appears (the founder has never answered), it also teaches the door-question —
// without that, the founder has nothing to report and the feature collects nothing. Reflective-only.

/** The current ISO week window [start, end): Monday 00:00 UTC through the next Monday (exclusive). */
export function isoWeekWindow(nowIso: string): { start: string; end: string } {
  const d = new Date(nowIso);
  const dowMon0 = (d.getUTCDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dowMon0));
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface WeeklyReachPrompt {
  /** whether to show the prompt this week (not yet answered or skipped). */
  readonly show: boolean;
  /** true until the founder has EVER answered — then the prompt teaches the door-question. */
  readonly firstTime: boolean;
  /** ISO date (Mon) of the window this week's answer would cover. */
  readonly weekStart: string;
  /** ISO date (exclusive) one week later. */
  readonly weekEnd: string;
}

/** Decide whether the weekly reach prompt shows, and whether to teach the door-question. Best-effort: any
 *  error yields show=false (Today never fails on this). */
export async function readWeeklyReachPrompt(
  db: KyselyDB, businessId: string, accountId: string, nowIso: string = new Date().toISOString(),
): Promise<WeeklyReachPrompt> {
  const { start, end } = isoWeekWindow(nowIso);
  const weekStart = start.slice(0, 10);
  const weekEnd = end.slice(0, 10);
  try {
    const sinceStart = async (type: string): Promise<boolean> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await sql`SELECT 1 FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type=${type} AND occurred_at >= ${start} LIMIT 1`.execute(db);
      return (r?.rows?.length ?? 0) > 0;
    };
    const [answeredThisWeek, skippedThisWeek, everAnswered] = await Promise.all([
      sinceStart('weekly_prompt_answered'),
      sinceStart('weekly_prompt_dismissed'),
      has(db, businessId, accountId, 'weekly_prompt_answered'),
    ]);
    return { show: !(answeredThisWeek || skippedThisWeek), firstTime: !everAnswered, weekStart, weekEnd };
  } catch {
    return { show: false, firstTime: false, weekStart, weekEnd };
  }
}

/** The work BB published in a window (founder_event refs) — the durable link between a reach answer and what
 *  was published that week. Reflective breadcrumb only; never a causal claim. Best-effort → [] on error. */
export async function readPublishedRefsInWindow(
  db: KyselyDB, businessId: string, accountId: string, startIso: string, endIso: string,
): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`
      SELECT id, event_type FROM app.founder_event
      WHERE business_id=${businessId} AND account_id=${accountId}
        AND event_type IN ('create_started', 'asset_generated', 'asset_exported', 'strategy_to_asset_completed')
        AND occurred_at >= ${startIso} AND occurred_at < ${endIso}
      ORDER BY occurred_at ASC LIMIT 20
    `.execute(db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (r?.rows ?? []).map((row: any) => `${String(row.event_type)}:${String(row.id)}`);
  } catch {
    return [];
  }
}
