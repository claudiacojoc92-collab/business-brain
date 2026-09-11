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
  | 'create_started'
  | 'asset_generated'
  | 'asset_revision_requested'
  | 'asset_exported'
  | 'strategy_to_asset_completed'
  | 'asset_generation_insufficient_material'
  | 'talk_opened'
  | 'talk_turn_submitted';

// Client-emittable events only (server-authoritative milestones are never accepted from the browser, so a
// founder can't fake "I adopted a strategy / exported an asset / completed the loop").
const CLIENT_EMITTABLE = new Set<FounderEventType>([
  'onboarding_url_submitted', 'first_understanding_viewed', 'first_value_reached',
  'understanding_expanded', 'evidence_source_opened', 'correction_held_viewed', 'today_viewed',
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
