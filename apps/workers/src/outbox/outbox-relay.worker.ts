import type { Logger } from '@bb/infrastructure';
import type { OutboxRelay } from '@bb/infrastructure';
import { SCHEDULER_TICK_INTERVAL_MS } from '@bb/shared';

/**
 * Continuous outbox relay loop.
 * Tick: every 30 seconds (F013).
 * Uses OutboxRelay from infrastructure which implements SELECT FOR UPDATE SKIP LOCKED (F010).
 * Source: Repository Structure V1 Section 08, Corrections Addendum V1 F010/F013.
 */
export class OutboxRelayWorker {
  private running   = false;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly relay:  OutboxRelay,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.running = true;
    this.logger.info(
      { tickIntervalMs: SCHEDULER_TICK_INTERVAL_MS },
      'OutboxRelayWorker started',
    );
    void this.tick();
    this.tickTimer = setInterval(() => { void this.tick(); }, SCHEDULER_TICK_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      await this.relay.relayBatch();
    } catch (err) {
      this.logger.error({ err }, 'Outbox relay batch failed');
    }
  }
}
