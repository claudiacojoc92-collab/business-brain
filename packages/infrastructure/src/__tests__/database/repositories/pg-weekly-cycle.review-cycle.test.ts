import { describe, it, expect, vi } from 'vitest';
import { PgWeeklyCycleRepository } from '../../../database/repositories/pg-weekly-cycle.repository';

function makeRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cycle-1', founder_id: 'founder-1', cycle_number: 3, status: 'COMMITTED',
    scheduled_for: '2026-06-20T00:00:00.000Z', content_deliver_by: '2026-06-21T00:00:00.000Z',
    campaign_id: null, campaign_phase_index: null, selected_mode: 'AUTHORITY',
    started_at: null, reasoning_started_at: null, committed_at: '2026-06-27T10:00:00.000Z',
    failed_at: null, failure_reason: null, critique_outcome: null, critique_return_count: 0, is_fallback: false,
    ...over,
  };
}

function makeMockDb(row: unknown) {
  const executeTakeFirst = vi.fn().mockResolvedValue(row);
  const limit = vi.fn().mockReturnThis();
  const orderBy = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const selectAll = vi.fn().mockReturnThis();
  const builder = { selectAll, where, orderBy, limit, executeTakeFirst };
  const selectFrom = vi.fn().mockReturnValue(builder);
  return { db: { selectFrom } as never, selectFrom, where, orderBy, limit };
}

describe('PgWeeklyCycleRepository.findCurrentReviewCycle', () => {
  it('filters to reviewable statuses, founder-scoped, deterministically ordered, limit 1', async () => {
    const { db, selectFrom, where, orderBy, limit } = makeMockDb(makeRow());
    const cycle = await new PgWeeklyCycleRepository(db).findCurrentReviewCycle('founder-1');

    expect(selectFrom).toHaveBeenCalledWith('cycle.weekly_cycles');
    expect(where).toHaveBeenCalledWith('founder_id', '=', 'founder-1');
    // COMMITTED + FALLBACK_COMMITTED eligible; FAILED and in-flight excluded by construction
    expect(where).toHaveBeenCalledWith('status', 'in', ['COMMITTED', 'FALLBACK_COMMITTED']);
    expect(orderBy).toHaveBeenCalledWith('committed_at', 'desc');
    expect(orderBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(orderBy).toHaveBeenCalledWith('id', 'desc');
    expect(limit).toHaveBeenCalledWith(1);
    expect(cycle?.id).toBe('cycle-1');
  });

  it('maps a FALLBACK_COMMITTED row too', async () => {
    const { db } = makeMockDb(makeRow({ id: 'cycle-fb', status: 'FALLBACK_COMMITTED', is_fallback: true }));
    const cycle = await new PgWeeklyCycleRepository(db).findCurrentReviewCycle('founder-1');
    expect(cycle?.id).toBe('cycle-fb');
    expect(cycle?.status).toBe('FALLBACK_COMMITTED');
  });

  it('returns null when no reviewable cycle exists', async () => {
    const { db } = makeMockDb(undefined);
    expect(await new PgWeeklyCycleRepository(db).findCurrentReviewCycle('founder-1')).toBeNull();
  });
});
