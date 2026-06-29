import type { KyselyDB } from '../client';
import type { IWeeklyCycleRepository, CycleHistory, PagedResult } from '@bb/domain';
import { WeeklyCycle, ContentPiece } from '@bb/domain';
import type { ForwardQuestion } from '@bb/domain';
import type { CycleSignalRecord } from '@bb/shared';

/**
 * PostgreSQL implementation of IWeeklyCycleRepository.
 * Source: Implementation Spec V1 Section 08, Database Design V1 Section 05.
 */
export class PgWeeklyCycleRepository implements IWeeklyCycleRepository {
  constructor(private readonly db: KyselyDB) {}

  async findSignalsForCycle(cycleId: string): Promise<CycleSignalRecord[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('cycle.cycle_signals')
      .select(['id', 'signal_type', 'value_text', 'collected_at'])
      .where('cycle_id', '=', cycleId)
      .execute();
    return rows.map((r) => ({
      signalId:    r.id,
      signalType:  r.signal_type,
      value:       r.value_text ?? '',
      collectedAt: new Date(r.collected_at).toISOString(),
    }));
  }

  async insertSignal(signal: {
    id:              string;
    cycleId:         string;
    founderId:       string;
    signalType:      string;
    valueText:       string;
    sourceReference: string;
    collectedAt:     Date;
  }, tx?: unknown): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    await db
      .insertInto('cycle.cycle_signals')
      .values({
        id:               signal.id,
        cycle_id:         signal.cycleId,
        founder_id:       signal.founderId,
        signal_type:      signal.signalType,
        value_text:       signal.valueText,
        source_reference: signal.sourceReference,
        collected_at:     signal.collectedAt.toISOString(),
      })
      .execute();
  }

  async findById(id: string): Promise<WeeklyCycle | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('cycle.weekly_cycles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return null;
    return this.toDomain(row);
  }

  async findAwaitingApprovalPieces(
    cycleId: string,
    founderId: string,
    tx?: unknown,
  ): Promise<ContentPiece[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    // Explicit founder_id filter (RLS is ENABLE-not-FORCE; owner connection bypasses it).
    // Ordered by created_at then id — the order C2 inserts pieces in (by objective priority);
    // content_pieces has no priority column.
    const rows: unknown[] = await db
      .selectFrom('cycle.content_pieces')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('cycle_id', '=', cycleId)
      .where('approval_status', '=', 'AWAITING_APPROVAL')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((r) => this.contentPieceToDomain(r));
  }

  async findContentPiecesByCycle(
    cycleId: string,
    founderId: string,
    approvalStatus: string,
    tx?: unknown,
  ): Promise<ContentPiece[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    // Same shape/order as findAwaitingApprovalPieces; only the status filter is parameterised
    // (caller whitelists it). Founder-scoped (RLS is ENABLE-not-FORCE; scope explicitly).
    const rows: unknown[] = await db
      .selectFrom('cycle.content_pieces')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('cycle_id', '=', cycleId)
      .where('approval_status', '=', approvalStatus)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map((r) => this.contentPieceToDomain(r));
  }

  async countContentPiecesByCycleIds(founderId: string, cycleIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (cycleIds.length === 0) return counts;
    // Single founder-scoped query; tallied in the read model (cycle-history piece volume is small).
    // No N+1, no schema change, no WeeklyCycle aggregate involvement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = this.db as any;
    const rows: { cycle_id: string }[] = await db
      .selectFrom('cycle.content_pieces')
      .select('cycle_id')
      .where('founder_id', '=', founderId)
      .where('cycle_id', 'in', cycleIds)
      .execute();
    for (const r of rows) counts.set(r.cycle_id, (counts.get(r.cycle_id) ?? 0) + 1);
    return counts;
  }

  async findContentPieceById(
    pieceId: string,
    founderId: string,
    tx?: unknown,
  ): Promise<ContentPiece | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    // Founder-scoped (id + founder_id); RLS is ENABLE-not-FORCE so scope explicitly.
    const row = await db
      .selectFrom('cycle.content_pieces')
      .selectAll()
      .where('id', '=', pieceId)
      .where('founder_id', '=', founderId)
      .executeTakeFirst();
    return row ? this.contentPieceToDomain(row) : null;
  }

  async updateContentPieceDecision(piece: ContentPiece, tx: unknown): Promise<void> {
    // content_pieces is a directly-written read model; persist the approval decision the
    // aggregate set on the piece (status + decision timestamps/reason) within the command tx.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    await db
      .updateTable('cycle.content_pieces')
      .set({
        approval_status:       piece.approvalStatus,
        approved_at:           piece.approvedAt?.toISOString() ?? null,
        rejected_at:           piece.rejectedAt?.toISOString() ?? null,
        rejection_reason_code: piece.rejectionReasonCode,
      })
      .where('id', '=', piece.id)
      .execute();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private contentPieceToDomain(row: any): ContentPiece {
    return new ContentPiece({
      id:                      row.id,
      cycleId:                 row.cycle_id,
      founderId:               row.founder_id,
      briefId:                 row.brief_id,
      pieceType:               row.piece_type,
      pieceRole:               row.piece_role,
      contentBlobKey:          row.content_blob_key ?? null,
      contentPreview:          row.content_preview ?? null,
      approvalStatus:          row.approval_status,
      approvalWindowExpiresAt: row.approval_window_expires_at ? new Date(row.approval_window_expires_at) : null,
      approvedAt:              row.approved_at ? new Date(row.approved_at) : null,
      rejectedAt:              row.rejected_at ? new Date(row.rejected_at) : null,
      rejectionReasonCode:     row.rejection_reason_code ?? null,
      publishedAt:             row.published_at ? new Date(row.published_at) : null,
      platformPostId:          row.platform_post_id ?? null,
    });
  }

  async findCurrentReviewCycle(founderId: string, tx?: unknown): Promise<WeeklyCycle | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    // Latest reviewable cycle (post-commit), founder-scoped. FAILED + in-flight excluded.
    // Deterministic order: committed_at, then created_at, then id (all DESC).
    const row = await db
      .selectFrom('cycle.weekly_cycles')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', 'in', ['COMMITTED', 'FALLBACK_COMMITTED'])
      .orderBy('committed_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return this.toDomain(row);
  }

  async findActive(founderId: string, tx?: unknown): Promise<WeeklyCycle | null> {
    const db = (tx ?? this.db) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const row = await db
      .selectFrom('cycle.weekly_cycles')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', 'in', ['COLLECTING', 'REASONING', 'CRITIQUE', 'COMMITTING'])
      .executeTakeFirst();
    if (!row) return null;
    return this.toDomain(row);
  }

  async findByFounderAndNumber(
    founderId: string,
    cycleNumber: number,
  ): Promise<WeeklyCycle | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (this.db as any)
      .selectFrom('cycle.weekly_cycles')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('cycle_number', '=', cycleNumber)
      .executeTakeFirst();
    if (!row) return null;
    return this.toDomain(row);
  }

  async findHistory(
    founderId: string,
    limit: number,
    cursor?: string,
  ): Promise<PagedResult<WeeklyCycle>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (this.db as any)
      .selectFrom('cycle.weekly_cycles')
      .selectAll()
      .where('founder_id', '=', founderId)
      .where('status', 'in', ['COMMITTED', 'FALLBACK_COMMITTED', 'FAILED'])
      .orderBy('committed_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);

    if (cursor) {
      const decoded = this.decodeCursor(cursor);
      if (decoded) {
        query = query.where('committed_at', '<', decoded.committedAt);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await query.execute();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => this.toDomain(r));

    return {
      items,
      nextCursor: hasMore ? this.encodeCursor(rows[limit - 1]) : null,
      hasMore,
    };
  }

  async findPreceding(founderId: string, days: number): Promise<CycleHistory[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await (this.db as any)
      .selectFrom('cycle.weekly_cycles')
      .select(['id', 'cycle_number', 'committed_at', 'selected_mode'])
      .where('founder_id', '=', founderId)
      .where('committed_at', '>=', since.toISOString())
      .where('status', 'in', ['COMMITTED', 'FALLBACK_COMMITTED'])
      .orderBy('committed_at', 'desc')
      .execute();

    return rows.map((r) => ({
      cycleId:          r.id,
      cycleNumber:      r.cycle_number,
      committedAt:      new Date(r.committed_at),
      selectedMode:     r.selected_mode,
      contentPieceCount:0,
    }));
  }

  async findForwardQuestion(_founderId: string): Promise<ForwardQuestion | null> {
    // Forward questions are stored in cycle.forward_questions
    // Returns null if none unconsumed — full implementation in DB milestone
    return null;
  }

  async save(cycle: WeeklyCycle, tx: unknown): Promise<void> {
    const row = this.toPersistence(cycle);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)
      .insertInto('cycle.weekly_cycles')
      .values(row)
      .onConflict((oc: any) => oc.column('id').doUpdateSet(row)) // eslint-disable-line @typescript-eslint/no-explicit-any
      .execute();
  }

  async markForwardQuestionConsumed(
    _questionId: string,
    _cycleId: string,
    _tx: unknown,
  ): Promise<void> {
    // Implemented in DB milestone when forward_questions table is migrated
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toDomain(row: any): WeeklyCycle {
    return WeeklyCycle.reconstitute({
      id:                 row.id,
      founderId:          row.founder_id,
      cycleNumber:        row.cycle_number,
      status:             row.status,
      scheduledFor:       new Date(row.scheduled_for),
      contentDeliverBy:   new Date(row.content_deliver_by),
      campaignId:         row.campaign_id ?? null,
      campaignPhaseIndex: row.campaign_phase_index ?? null,
      selectedMode:       row.selected_mode ?? null,
      startedAt:          row.started_at ? new Date(row.started_at) : null,
      reasoningStartedAt: row.reasoning_started_at ? new Date(row.reasoning_started_at) : null,
      committedAt:        row.committed_at ? new Date(row.committed_at) : null,
      failedAt:           row.failed_at ? new Date(row.failed_at) : null,
      failureReason:      row.failure_reason ?? null,
      critiqueOutcome:    row.critique_outcome ?? null,
      critiqueReturnCount:row.critique_return_count ?? 0,
      isFallback:         row.is_fallback ?? false,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toPersistence(cycle: WeeklyCycle): Record<string, any> {
    return {
      id:                   cycle.id,
      founder_id:           cycle.founderId,
      cycle_number:         cycle.cycleNumber,
      status:               cycle.status,
      scheduled_for:        cycle.scheduledFor.toISOString(),
      content_deliver_by:   cycle.contentDeliverBy.toISOString(),
      campaign_id:          cycle.campaignId,
      campaign_phase_index: cycle.campaignPhaseIndex,
      selected_mode:        cycle.selectedMode,
      started_at:           cycle.startedAt?.toISOString() ?? null,
      reasoning_started_at: cycle.reasoningStartedAt?.toISOString() ?? null,
      committed_at:         cycle.committedAt?.toISOString() ?? null,
      failed_at:            cycle.failedAt?.toISOString() ?? null,
      failure_reason:       cycle.failureReason,
      critique_outcome:     cycle.critiqueOutcome,
      critique_return_count:cycle.critiqueReturnCount,
      is_fallback:          cycle.isFallback,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encodeCursor(row: any): string {
    return Buffer.from(
      JSON.stringify({ committedAt: row.committed_at, id: row.id }),
    ).toString('base64');
  }

  private decodeCursor(cursor: string): { committedAt: string; id: string } | null {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }
}
