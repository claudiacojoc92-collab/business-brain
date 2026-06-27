import type { KyselyDB } from '../client';
import type { IOutcomeReportRepository } from '@bb/domain';
import { OutcomeReport } from '@bb/domain';

/**
 * PostgreSQL implementation of IOutcomeReportRepository.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 08.
 */
export class PgOutcomeReportRepository implements IOutcomeReportRepository {
  constructor(private readonly db: KyselyDB) {}

  async findById(id: string): Promise<OutcomeReport | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('outcome.outcome_reports')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByFounder(
    founderId: string,
    limit: number,
    _cursor?: string,
  ): Promise<OutcomeReport[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('outcome.outcome_reports')
      .selectAll()
      .where('founder_id', '=', founderId)
      .orderBy('reported_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((r) => this.toDomain(r));
  }

  async findPendingAttribution(founderId: string): Promise<OutcomeReport[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('outcome.outcome_reports')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('attribution_status', '=', 'PENDING')
      .execute();
    return rows.map((r) => this.toDomain(r));
  }

  async save(report: OutcomeReport, tx?: unknown): Promise<void> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = {
      id:                     report.id,
      founder_id:             report.founderId,
      outcome_type:           report.outcomeType,
      description:            report.description,
      is_implicit:            report.isImplicit,
      attribution_status:     report.attributionStatus,
      attribution_confidence: report.attributionConfidence,
      preceding_cycle_ids:    JSON.stringify(report.precedingCycleIds),
      preceding_modes:        JSON.stringify(report.precedingModes),
      confirmed_at:           report.confirmedAt?.toISOString() ?? null,
      reported_at:            report.reportedAt.toISOString(),
    };
    await db
      .insertInto('outcome.outcome_reports')
      .values(row)
      .onConflict((oc: any) => oc.column('id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDomain(row: any): OutcomeReport {
    return new OutcomeReport({
      id:                    row.id,
      founderId:             row.founder_id,
      outcomeType:           row.outcome_type,
      description:           row.description ?? null,
      isImplicit:            row.is_implicit ?? false,
      attributionStatus:     row.attribution_status,
      attributionConfidence: row.attribution_confidence ?? null,
      precedingCycleIds:     (row.preceding_cycle_ids ?? []) as string[],
      precedingModes:        (row.preceding_modes ?? []) as string[],
      confirmedAt:           row.confirmed_at ? new Date(row.confirmed_at) : null,
      reportedAt:            new Date(row.reported_at),
    });
  }
}
