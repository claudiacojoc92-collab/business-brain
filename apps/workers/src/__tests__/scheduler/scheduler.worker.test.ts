import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerWorker } from '../../scheduler/scheduler.worker';
import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';
import { SCHEDULER_TICK_INTERVAL_MS } from '@bb/shared';

function makeLogger(): Logger {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeDb(): KyselyDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectFrom = vi.fn().mockReturnValue({
    select:          vi.fn().mockReturnThis(),
    executeTakeFirst:vi.fn().mockResolvedValue({ acquired: false }),
  });
  return { selectFrom } as unknown as KyselyDB;
}

function makeRedis(): RedisClient {
  return {} as unknown as RedisClient;
}

describe('SchedulerWorker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('constructs with all 9 jobs', () => {
    const scheduler = new SchedulerWorker(makeDb(), makeRedis(), makeLogger());
    // Access private jobs array via type assertion for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jobs = (scheduler as any).jobs as { name: string }[];
    expect(jobs).toHaveLength(9);
  });

  it('SCHEDULER_TICK_INTERVAL_MS is 30000 (F013)', () => {
    expect(SCHEDULER_TICK_INTERVAL_MS).toBe(30_000);
  });

  it('start() sets running to true', () => {
    const scheduler = new SchedulerWorker(makeDb(), makeRedis(), makeLogger());
    scheduler.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((scheduler as any).running).toBe(true);
    scheduler.stop();
  });

  it('stop() sets running to false and clears timer', () => {
    const scheduler = new SchedulerWorker(makeDb(), makeRedis(), makeLogger());
    scheduler.start();
    scheduler.stop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((scheduler as any).running).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((scheduler as any).tickTimer).toBeNull();
  });
});
