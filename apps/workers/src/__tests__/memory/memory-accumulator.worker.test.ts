import { describe, it, expect, vi } from 'vitest';
import { MemoryAccumulatorWorker } from '../../memory/memory-accumulator.worker';
import type { RedisClient, KyselyDB, Logger } from '@bb/infrastructure';

function makeLogger(): Logger {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeRedis(): RedisClient {
  return {} as unknown as RedisClient;
}

function makeDb(): KyselyDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectFrom = vi.fn().mockReturnValue({
    selectAll: vi.fn().mockReturnThis(),
    where:     vi.fn().mockReturnThis(),
    execute:   vi.fn().mockResolvedValue([]),
  });
  return { selectFrom } as unknown as KyselyDB;
}

describe('MemoryAccumulatorWorker', () => {
  it('constructs without error', () => {
    const worker = new MemoryAccumulatorWorker(makeRedis(), makeDb(), makeLogger());
    expect(worker).toBeDefined();
  });

  it('has a start() and close() method', () => {
    const worker = new MemoryAccumulatorWorker(makeRedis(), makeDb(), makeLogger());
    expect(typeof worker.start).toBe('function');
    expect(typeof worker.close).toBe('function');
  });
});
