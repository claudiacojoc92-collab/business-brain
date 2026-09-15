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
  | 'return_summary_shown';  // the anchor for "since you were last here" (server-recorded on each Today visit)

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
  /** true only when there is a previous visit AND something meaningful happened since it. */
  readonly hasChanges: boolean;
  readonly changes: string[];
  readonly strategyMoved: boolean;
  readonly todayChanged: boolean;
  /** the single most relevant "one thing" for Today, if the evaluator named one. */
  readonly oneThing: string | null;
  /** ISO timestamp of the previous visit, or null on a first visit. */
  readonly since: string | null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];

/**
 * Pure aggregation (unit-tested): fold the events since the previous visit into a return summary. `since`
 * null ⇒ first visit ⇒ never reports changes. Newest-relevant "one thing" wins; changes are deduped + capped.
 */
export function summarizeReturn(events: ReturnEvent[], since: string | null): ReturnSummary {
  if (!since) return { hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null };

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
  return { hasChanges, changes: capped, strategyMoved, todayChanged, oneThing, since };
}

/**
 * Read the return summary for a founder's Today visit, then advance the visit anchor. The anchor is the most
 * recent `return_summary_shown` strictly before now; events since it are summarized. Best-effort: any DB
 * error yields an empty (no-changes) summary so Today never fails on telemetry.
 */
export async function readReturnSummary(db: KyselyDB, businessId: string, accountId: string): Promise<ReturnSummary> {
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
    return summarizeReturn(events, since);
  } catch {
    return { hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null };
  }
}
