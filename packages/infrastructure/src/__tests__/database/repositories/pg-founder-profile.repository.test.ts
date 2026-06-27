import { describe, it, expect, vi } from 'vitest';
import { PgFounderProfileRepository } from '../../../database/repositories/pg-founder-profile.repository';
import { FounderProfile } from '@bb/domain';

const NOW = new Date('2025-01-06T04:00:00Z');

function makeFounderRow(overrides: Record<string, unknown> = {}) {
  return {
    id:                          'f-01',
    email:                       'test@example.com',
    name:                        'Test Founder',
    business_name:               'Test Business',
    timezone:                    'UTC',
    status:                      'ACTIVE',
    notification_channel:        'EMAIL',
    auto_approve_on_window_close:true,
    approval_window_hours:       72,
    registered_at:               NOW.toISOString(),
    activated_at:                NOW.toISOString(),
    paused_at:                   null,
    deleted_at:                  null,
    ...overrides,
  };
}

function makeMockDb(row: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeChain = (result: unknown): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.selectAll        = vi.fn(() => chain);
    chain.select           = vi.fn(() => chain);
    chain.where            = vi.fn(() => chain);
    chain.orderBy          = vi.fn(() => chain);
    chain.forUpdate        = vi.fn(() => chain);
    chain.executeTakeFirst = vi.fn().mockResolvedValue(result);
    chain.execute          = vi.fn().mockResolvedValue([]);
    return chain;
  };

  const selectFrom = vi.fn((table: string) =>
    table === 'founder.founders' ? makeChain(row) : makeChain(undefined),
  );

  return { selectFrom } as unknown as ReturnType<
    typeof import('../../../database/client').createKyselyClient
  >;
}

describe('PgFounderProfileRepository', () => {
  describe('findById', () => {
    it('returns null when no row found', async () => {
      const db = makeMockDb(undefined);
      const repo = new PgFounderProfileRepository(db);
      const result = await repo.findById('missing');
      expect(result).toBeNull();
    });

    it('returns FounderProfile when row exists', async () => {
      const db = makeMockDb(makeFounderRow());
      const repo = new PgFounderProfileRepository(db);
      const result = await repo.findById('f-01');
      expect(result).toBeInstanceOf(FounderProfile);
      expect(result?.id).toBe('f-01');
      expect(result?.status).toBe('ACTIVE');
    });

    it('maps autoApproveOnWindowClose correctly (F004)', async () => {
      const db = makeMockDb(makeFounderRow({ auto_approve_on_window_close: false }));
      const repo = new PgFounderProfileRepository(db);
      const result = await repo.findById('f-01');
      expect(result?.autoApproveOnWindowClose).toBe(false);
    });
  });

  describe('findByIdForUpdate', () => {
    it('throws NotFoundError when row not found', async () => {
      const db = makeMockDb(undefined);
      const repo = new PgFounderProfileRepository(db);
      await expect(
        repo.findByIdForUpdate('missing', db),
      ).rejects.toMatchObject({ code: 'FOUNDER_NOT_FOUND' });
    });

    it('returns FounderProfile when row exists', async () => {
      const db = makeMockDb(makeFounderRow());
      const repo = new PgFounderProfileRepository(db);
      const result = await repo.findByIdForUpdate('f-01', db);
      expect(result).toBeInstanceOf(FounderProfile);
    });
  });
});
