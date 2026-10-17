import { sql } from 'kysely';
import { generateId } from '@bb/shared';
import type { ThesisRecord } from '@bb/application';
import type { KyselyDB } from '../client';

/**
 * STRATEGIC THESES cache (2026-10-16): one record per understanding snapshot, kept in app.founder_event metadata (no
 * migration, the stored understanding is never rewritten). Read by the arc (the card, the mirror, strategy) and by the
 * conversation (its question agenda is the record's three questions).
 */
export const THESES_EVENT = 'arc_theses_built';

export async function readThesisRecord(db: KyselyDB, businessId: string): Promise<ThesisRecord | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await sql`SELECT metadata FROM app.founder_event WHERE business_id=${businessId} AND event_type=${THESES_EVENT} ORDER BY occurred_at DESC LIMIT 1`.execute(db);
    const meta = r?.rows?.[0]?.metadata;
    if (!meta || typeof meta !== 'object' || typeof meta.snapshotId !== 'string' || !Array.isArray(meta.theses) || !Array.isArray(meta.questions)) return null;
    return meta as ThesisRecord;
  } catch { return null; }
}

/**
 * Never throws: an unsaved record is simply composed again on the next view. Awaited by the arc view (2026-10-17), so
 * the read that composed the record has saved it before it ends: a poll that lands right after never composes again.
 */
export async function recordThesisRecord(db: KyselyDB, accountId: string, businessId: string, record: ThesisRecord): Promise<void> {
  let meta = '';
  try { meta = JSON.stringify(record); } catch { return; }
  if (meta.length > 20000) return;
  await sql`
    INSERT INTO app.founder_event (id, account_id, business_id, event_type, surface, occurred_at, metadata)
    VALUES (${generateId()}, ${accountId}, ${businessId}, ${THESES_EVENT}, 'arc', now(), ${meta}::jsonb)
  `.execute(db).catch(() => undefined);
}
