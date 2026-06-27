import { describe, it, expect, vi } from 'vitest';
import { WeeklyCycleSchedulerJob } from '../../scheduler/jobs/weekly-cycle-scheduler.job';
import {
  CYCLE_START_HOUR_LOCAL,
  CYCLE_START_MINUTE_LOCAL,
} from '@bb/shared';
import type { KyselyDB, RedisClient, Logger } from '@bb/infrastructure';

function makeLogger(): Logger {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeDb(): KyselyDB {
  const selectFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    where:  vi.fn().mockReturnThis(),
    execute:vi.fn().mockResolvedValue([]),
  });
  return { selectFrom } as unknown as KyselyDB;
}

function makeRedis(): RedisClient {
  return {} as unknown as RedisClient;
}

describe('WeeklyCycleSchedulerJob', () => {
  it('CYCLE_START_HOUR_LOCAL is 3 (F009: 03:30 local)', () => {
    expect(CYCLE_START_HOUR_LOCAL).toBe(3);
  });

  it('CYCLE_START_MINUTE_LOCAL is 30 (F009)', () => {
    expect(CYCLE_START_MINUTE_LOCAL).toBe(30);
  });

  it('does not schedule on non-Monday (UTC day !== 1)', async () => {
    // Mock a Tuesday
    vi.setSystemTime(new Date('2025-01-07T03:30:00Z')); // Tuesday
    const db     = makeDb();
    const logger = makeLogger();
    await WeeklyCycleSchedulerJob.run(db, makeRedis(), logger);
    expect(db.selectFrom).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('queries active founders on Monday', async () => {
    // Mock a Monday
    vi.setSystemTime(new Date('2025-01-06T03:30:00Z')); // Monday UTC
    const db     = makeDb();
    const logger = makeLogger();
    await WeeklyCycleSchedulerJob.run(db, makeRedis(), logger);
    expect(db.selectFrom).toHaveBeenCalledWith('founder.founders');
    vi.useRealTimers();
  });
});
