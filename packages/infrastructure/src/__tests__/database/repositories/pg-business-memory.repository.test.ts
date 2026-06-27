import { describe, it, expect, vi } from 'vitest';
import { PgBusinessMemoryRepository } from '../../../database/repositories/pg-business-memory.repository';
import { MemoryLayerVO } from '@bb/domain';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeMockDb(rows: unknown[] = [], singleRow: unknown = undefined) {
  const execute = vi.fn().mockResolvedValue(rows);
  const executeTakeFirst = vi.fn().mockResolvedValue(singleRow);
  const where = vi.fn().mockReturnThis();
  const selectAll = vi.fn().mockReturnThis();
  const selectFrom = vi.fn().mockReturnValue({
    selectAll,
    where,
    execute,
    executeTakeFirst,
  });
  return { selectFrom } as unknown as ReturnType<typeof import('../../../database/client').createKyselyClient>;
}

describe('PgBusinessMemoryRepository', () => {
  it('findAllLayers returns empty array when no rows', async () => {
    const db = makeMockDb([]);
    const repo = new PgBusinessMemoryRepository(db);
    const result = await repo.findAllLayers('f-01');
    expect(result).toEqual([]);
  });

  it('findAllLayers maps rows to MemoryLayerVO', async () => {
    const db = makeMockDb([{
      founder_id:      'f-01',
      layer:           'APPROVAL_INTELLIGENCE',
      payload:         '{}',
      confidence:      0.6,
      data_points:     10,
      last_updated_at: NOW.toISOString(),
      last_cycle_id:   null,
    }]);
    const repo = new PgBusinessMemoryRepository(db);
    const result = await repo.findAllLayers('f-01');
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(MemoryLayerVO);
    expect(result[0]?.layer).toBe('APPROVAL_INTELLIGENCE');
    expect(result[0]?.confidence).toBe(0.6);
  });

  it('findSnapshot returns null (Redis not yet wired)', async () => {
    const db = makeMockDb();
    const repo = new PgBusinessMemoryRepository(db);
    const result = await repo.findSnapshot('f-01');
    expect(result).toBeNull();
  });

  it('does not expose updateIntelligenceEvent method', () => {
    const db = makeMockDb();
    const repo = new PgBusinessMemoryRepository(db);
    // CRITICAL: append-only — no update method
    expect((repo as unknown as Record<string, unknown>)['updateIntelligenceEvent']).toBeUndefined();
  });
});
