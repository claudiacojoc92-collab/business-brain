import { describe, it, expect, vi } from 'vitest';
import type { IWeeklyCycleRepository, WeeklyCycle } from '@bb/domain';
import { GetCurrentReviewCycleHandler } from '../../../cycle/queries/get-current-review-cycle.handler';
import type { GetCurrentReviewCycleQuery } from '../../../cycle/queries/get-current-review-cycle.query';

const query = {
  type: 'GetCurrentReviewCycle', founderId: 'founder-1', correlationId: 'c', traceId: 't',
} as GetCurrentReviewCycleQuery;

function makeRepo(result: unknown): IWeeklyCycleRepository {
  return { findCurrentReviewCycle: vi.fn().mockResolvedValue(result) } as unknown as IWeeklyCycleRepository;
}

describe('GetCurrentReviewCycleHandler', () => {
  it('passes the founder through and returns the resolved cycle', async () => {
    const cycle = { id: 'cycle-1' } as unknown as WeeklyCycle;
    const repo = makeRepo(cycle);
    const result = await new GetCurrentReviewCycleHandler(repo).handle(query);
    expect(result).toBe(cycle);
    expect(repo.findCurrentReviewCycle).toHaveBeenCalledWith('founder-1');
  });

  it('returns null when no reviewable cycle exists', async () => {
    const result = await new GetCurrentReviewCycleHandler(makeRepo(null)).handle(query);
    expect(result).toBeNull();
  });
});
