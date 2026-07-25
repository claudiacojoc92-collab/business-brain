import type { KyselyDB } from '../client';
import type { RawCapture, RawCaptureRepository, SubjectRef } from '@bb/domain';
import { businessRefKey } from '@bb/domain';

/**
 * Append-only RawCapture store (understanding.raw_capture). Business-scoped (business_ref, id).
 * Identical content-addressed ids dedupe (idempotent no-op); a DIFFERENT payload under the same id
 * fails loudly (content-addressing makes this impossible unless something is wrong — belt-and-suspenders).
 */
export class PgRawCaptureRepository implements RawCaptureRepository {
  constructor(private readonly db: KyselyDB) {}

  async appendMany(businessRef: SubjectRef, captures: readonly RawCapture[]): Promise<void> {
    if (captures.length === 0) return;
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    for (const c of captures) {
      const existing = await db
        .selectFrom('understanding.raw_capture')
        .select(['captured_payload'])
        .where('business_ref', '=', brk)
        .where('id', '=', c.id)
        .executeTakeFirst();
      if (existing) {
        const stored = typeof existing.captured_payload === 'string'
          ? existing.captured_payload
          : JSON.stringify(existing.captured_payload);
        if (stored !== JSON.stringify(c.capturedPayload)) {
          throw new Error(`raw_capture content conflict for id ${c.id} (business ${brk})`);
        }
        continue;
      }
      await db
        .insertInto('understanding.raw_capture')
        .values({
          business_ref: brk,
          id: c.id,
          source: c.source,
          external_id: c.externalId,
          captured_payload: JSON.stringify(c.capturedPayload),
          captured_at: c.capturedAt,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .onConflict((oc: any) => oc.columns(['business_ref', 'id']).doNothing())
        .execute();
    }
  }

  async getByIds(businessRef: SubjectRef, ids: readonly string[]): Promise<readonly RawCapture[]> {
    if (ids.length === 0) return [];
    const brk = businessRefKey(businessRef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await (this.db as any)
      .selectFrom('understanding.raw_capture')
      .selectAll()
      .where('business_ref', '=', brk)
      .where('id', 'in', [...ids])
      .execute()) as unknown[];
    return rows.map((r) => toDomain(r));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDomain(row: any): RawCapture {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    capturedPayload: typeof row.captured_payload === 'string' ? JSON.parse(row.captured_payload) : row.captured_payload,
    capturedAt: typeof row.captured_at === 'string' ? row.captured_at : new Date(row.captured_at).toISOString(),
  };
}
