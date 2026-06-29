import { describe, it, expect, vi } from 'vitest';
import type { IWeeklyCycleRepository } from '@bb/domain';
import { GetCycleHistoryHandler } from '../../../cycle/queries/get-cycle-history.handler';
import type { GetCycleHistoryQuery } from '../../../cycle/queries/get-cycle-history.query';

function cyc(id: string, n: number, isFallback = false) {
  return { id, cycleNumber: n, selectedMode: null, committedAt: new Date('2026-06-28T00:00:00.000Z'), isFallback };
}

function makeRepo(over: Partial<IWeeklyCycleRepository> = {}): IWeeklyCycleRepository {
  return {
    findHistory: vi.fn().mockResolvedValue({ items: [cyc('c3', 3), cyc('c1', 1, true)], nextCursor: null, hasMore: false }),
    countContentPiecesByCycleIds: vi.fn().mockResolvedValue(new Map([['c3', 2]])), // c1 absent → 0
    ...over,
  } as unknown as IWeeklyCycleRepository;
}

const query = {
  type: 'GetCycleHistory', founderId: 'founder-1', limit: 20, correlationId: 'c', traceId: 't',
} as GetCycleHistoryQuery;

describe('GetCycleHistoryHandler — real contentPieceCount', () => {
  it('maps the real per-cycle count from the read model (not the old hardcoded 0)', async () => {
    const dto = await new GetCycleHistoryHandler(makeRepo()).handle(query);
    expect(dto.items.find((i) => i.cycleId === 'c3')!.contentPieceCount).toBe(2);
  });

  it('a cycle with no pieces reports 0 honestly', async () => {
    const dto = await new GetCycleHistoryHandler(makeRepo()).handle(query);
    expect(dto.items.find((i) => i.cycleId === 'c1')!.contentPieceCount).toBe(0);
  });

  it('is founder-scoped: counts queried with the founderId + the history cycle ids', async () => {
    const repo = makeRepo();
    await new GetCycleHistoryHandler(repo).handle(query);
    expect(repo.countContentPiecesByCycleIds).toHaveBeenCalledWith('founder-1', ['c3', 'c1']);
  });

  it('does not change the other history fields', async () => {
    const dto = await new GetCycleHistoryHandler(makeRepo()).handle(query);
    const c1 = dto.items.find((i) => i.cycleId === 'c1')!;
    expect(c1.cycleNumber).toBe(1);
    expect(c1.isFallback).toBe(true);
    expect(c1.selectedMode).toBeNull();
  });
});
