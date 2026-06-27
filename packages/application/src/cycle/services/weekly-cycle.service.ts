import type { IWeeklyCycleRepository } from '@bb/domain';
import type { ForwardQuestion } from '@bb/domain';

/**
 * Application service for cycle-related queries used by workers.
 * Source: Repository Structure V1 Section 05.
 */
export class WeeklyCycleService {
  constructor(private readonly cycleRepo: IWeeklyCycleRepository) {}

  async getForwardQuestion(founderId: string): Promise<ForwardQuestion | null> {
    return this.cycleRepo.findForwardQuestion(founderId);
  }

  async getPrecedingCycleIds(founderId: string, days: number): Promise<string[]> {
    const history = await this.cycleRepo.findPreceding(founderId, days);
    return history.map((h) => h.cycleId);
  }
}
