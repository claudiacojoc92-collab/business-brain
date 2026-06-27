import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutboxRelayWorker } from '../../outbox/outbox-relay.worker';
import type { OutboxRelay, Logger } from '@bb/infrastructure';
import { SCHEDULER_TICK_INTERVAL_MS } from '@bb/shared';

function makeLogger(): Logger {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makeRelay(shouldThrow = false): OutboxRelay {
  return {
    relayBatch: shouldThrow
      ? vi.fn().mockRejectedValue(new Error('relay failed'))
      : vi.fn().mockResolvedValue(undefined),
  } as unknown as OutboxRelay;
}

describe('OutboxRelayWorker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('start() sets running to true', () => {
    const worker = new OutboxRelayWorker(makeRelay(), makeLogger());
    worker.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((worker as any).running).toBe(true);
    worker.stop();
  });

  it('stop() clears the timer and sets running to false', () => {
    const worker = new OutboxRelayWorker(makeRelay(), makeLogger());
    worker.start();
    worker.stop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((worker as any).running).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((worker as any).tickTimer).toBeNull();
  });

  it('logs error without crashing when relay batch fails', async () => {
    const logger = makeLogger();
    const worker = new OutboxRelayWorker(makeRelay(true), logger);
    worker.start();
    await vi.advanceTimersByTimeAsync(SCHEDULER_TICK_INTERVAL_MS);
    expect(logger.error).toHaveBeenCalled();
    worker.stop();
  });
});
