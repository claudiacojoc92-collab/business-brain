import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import type { KyselyDB } from '@bb/infrastructure';

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
  | 'talk_opened'
  | 'talk_turn_submitted'
  | 'baseline_reopened'
  // Living State — impact evaluator + return loop.
  | 'impact_evaluated'       // a new reality was assessed against the held strategy (carries the verdict)
  | 'outcome_reported'       // a founder reported an outcome of their work
  | 'return_summary_shown'   // the anchor for "since you were last here" (server-recorded on each Today visit)
  | 'mirror_viewed'          // the founder opened the mirror (three lanes + contrast)
  | 'mirror_corrected'       // the founder corrected a lane, and the mirror recomputed
  // Day One arc — durable phase markers (no new table; the arc's moment is derived from these + engine state).
  | 'arc_source_added'       // Moment 1: a source the founder added (url in metadata) — the durable pour-in list
  | 'arc_pour_in_done'       // Moment 1 → 2: the founder clicked "Done adding — start"
  | 'arc_reading_done'       // Moment 2 → 3: the founder gave their few words while BB read
  | 'arc_understanding_confirmed' // Moment 3 → 4: the founder confirmed what BB understood
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

// ── Day One arc: durable phase flags + the email draft, read back from founder_event ──

export interface ArcFlags {
  readonly pourInDone: boolean;
  readonly readingDone: boolean;
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
  const [pourInDone, readingDone, understandingConfirmed, mirrorSeen, emailExported, containerSeen] = await Promise.all([
    has(db, businessId, accountId, 'arc_pour_in_done'),
    has(db, businessId, accountId, 'arc_reading_done'),
    has(db, businessId, accountId, 'arc_understanding_confirmed'),
    has(db, businessId, accountId, 'arc_mirror_seen'),
    has(db, businessId, accountId, 'arc_email_exported'),
    has(db, businessId, accountId, 'arc_container_seen'),
  ]);
  return { pourInDone, readingDone, understandingConfirmed, mirrorSeen, emailExported, containerSeen };
}

/** The durable pour-in source list — every url the founder added, in order, deduped. */
export async function readArcSources(db: KyselyDB, businessId: string, accountId: string): Promise<string[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata, occurred_at FROM app.founder_event WHERE business_id=${businessId} AND account_id=${accountId} AND event_type='arc_source_added' ORDER BY occurred_at ASC LIMIT 50`.execute(db);
    const urls: string[] = [];
    for (const row of (r?.rows ?? [])) {
      const u = row?.metadata && typeof row.metadata === 'object' ? String(row.metadata.url ?? '').trim() : '';
      if (u && !urls.includes(u)) urls.push(u);
    }
    return urls;
  } catch { return []; }
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
