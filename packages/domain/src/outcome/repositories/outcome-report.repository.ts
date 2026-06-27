import type { OutcomeReport } from '../entities/outcome-report.entity';

/**
 * Repository interface for OutcomeReport.
 * Implementation in packages/infrastructure/.
 */
export interface IOutcomeReportRepository {
  findById(id: string): Promise<OutcomeReport | null>;
  findByFounder(
    founderId: string,
    limit: number,
    cursor?: string,
  ): Promise<OutcomeReport[]>;
  findPendingAttribution(founderId: string): Promise<OutcomeReport[]>;
  save(report: OutcomeReport, tx?: unknown): Promise<void>;
}
