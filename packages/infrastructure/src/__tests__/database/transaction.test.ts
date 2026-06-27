import { describe, it, expect, vi } from 'vitest';

vi.mock('kysely', async (importOriginal) => {
  const actual = await importOriginal<typeof import('kysely')>();
  return {
    ...actual,
    sql: Object.assign(
      () => ({ execute: () => Promise.resolve({ rows: [] }) }),
      { raw: () => ({ execute: () => Promise.resolve({ rows: [] }) }) },
    ),
  };
});

import { KyselyTransactionManager } from '../../database/transaction';

describe('KyselyTransactionManager', () => {
  it('executes work inside a transaction and returns result', async () => {
    const mockTrx = {};
    const mockExecute = vi.fn().mockImplementation(async (work: (trx: unknown) => Promise<unknown>) => {
      return work(mockTrx);
    });
    const mockDb = {
      transaction: vi.fn().mockReturnValue({ execute: mockExecute }),
    };

    const txMgr = new KyselyTransactionManager(
      mockDb as never,
      'founder-01',
      'founder',
      'trace-01',
    );

    const result = await txMgr.run(async (tx) => {
      expect(tx).toBe(mockTrx);
      return 'success';
    });

    expect(result).toBe('success');
    expect(mockDb.transaction).toHaveBeenCalledOnce();
  });

  it('propagates errors from work function', async () => {
    const mockExecute = vi.fn().mockImplementation(async (work: (trx: unknown) => Promise<unknown>) => {
      return work({});
    });
    const mockDb = {
      transaction: vi.fn().mockReturnValue({ execute: mockExecute }),
    };

    const txMgr = new KyselyTransactionManager(
      mockDb as never,
      'founder-01',
      'founder',
      'trace-01',
    );

    await expect(
      txMgr.run(async () => { throw new Error('db error'); }),
    ).rejects.toThrow('db error');
  });
});
