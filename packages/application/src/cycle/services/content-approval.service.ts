import type { IWeeklyCycleRepository } from '@bb/domain';
import type { IEventStore } from '../../shared/event-store';
import type { ITransactionManager } from '../../shared/transaction-manager';

/**
 * Application service for content approval window management.
 * Used by the scheduler worker to auto-approve on window close (F004).
 * Source: Repository Structure V1 Section 05, Corrections Addendum V1 F004.
 */
export class ContentApprovalService {
  constructor(
    private readonly cycleRepo: IWeeklyCycleRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  /**
   * Returns whether a founder has content awaiting approval.
   * Used by the approval window reminder scheduler job.
   */
  async hasContentAwaitingApproval(founderId: string): Promise<boolean> {
    const cycle = await this.cycleRepo.findActive(founderId);
    return cycle !== null && cycle.isTerminal();
  }
}
