import { describe, it, expect } from 'vitest';
import type { ITransactionManager, Transaction } from '../../shared/transaction-manager';

// Minimal in-memory TransactionManager for structural testing
class TestTransactionManager implements ITransactionManager {
  private committed = false;
  private rolledBack = false;

  async run<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    try {
      const result = await work({} as Transaction);
      this.committed = true;
      return result;
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }

  wasCommitted(): boolean { return this.committed; }
  wasRolledBack(): boolean { return this.rolledBack; }
}

describe('TransactionManager structural contract', () => {
  it('commits when work function succeeds', async () => {
    const txMgr = new TestTransactionManager();
    const result = await txMgr.run(async (_tx) => 'success');
    expect(result).toBe('success');
    expect(txMgr.wasCommitted()).toBe(true);
    expect(txMgr.wasRolledBack()).toBe(false);
  });

  it('rolls back when work function throws', async () => {
    const txMgr = new TestTransactionManager();
    await expect(
      txMgr.run(async (_tx) => { throw new Error('db error'); }),
    ).rejects.toThrow('db error');
    expect(txMgr.wasCommitted()).toBe(false);
    expect(txMgr.wasRolledBack()).toBe(true);
  });

  it('passes a transaction object to the work function', async () => {
    const txMgr = new TestTransactionManager();
    let receivedTx: Transaction = null;
    await txMgr.run(async (tx) => { receivedTx = tx; });
    expect(receivedTx).not.toBeNull();
  });
});
