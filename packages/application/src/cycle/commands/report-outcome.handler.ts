import { ok, type Result } from '@bb/shared';
import { OutcomeReport } from '@bb/domain';
import type { CommandHandler } from '../../shared/command-bus';
import type { ITransactionManager } from '../../shared/transaction-manager';
import type { IEventStore } from '../../shared/event-store';
import type { IOutcomeReportRepository } from '@bb/domain';
import type { DomainError } from '@bb/shared';
import type { ReportOutcomeCommand, ReportOutcomeResult } from './report-outcome.command';

export class ReportOutcomeHandler
  implements CommandHandler<ReportOutcomeCommand, ReportOutcomeResult, DomainError>
{
  constructor(
    private readonly outcomeRepo: IOutcomeReportRepository,
    private readonly eventStore: IEventStore,
    private readonly txManager: ITransactionManager,
  ) {}

  async handle(cmd: ReportOutcomeCommand): Promise<Result<ReportOutcomeResult, DomainError>> {
    const now = new Date();

    return this.txManager.run(async (tx) => {
      const report = new OutcomeReport({
        id:                    cmd.outcomeId,
        founderId:             cmd.founderId,
        outcomeType:           cmd.outcomeType,
        description:           cmd.description,
        isImplicit:            cmd.isImplicit,
        attributionStatus:     'REPORTED',
        attributionConfidence: null,
        precedingCycleIds:     [],
        precedingModes:        [],
        confirmedAt:           null,
        reportedAt:            now,
      });

      await this.outcomeRepo.save(report, tx);

      return ok({ outcomeId: report.id, outcomeType: report.outcomeType });
    });
  }
}
