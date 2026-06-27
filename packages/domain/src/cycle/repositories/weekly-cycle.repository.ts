import type { WeeklyCycle } from '../aggregates/weekly-cycle.aggregate';
import type { ContentPiece } from '../entities/content-piece.entity';
import type { ForwardQuestion } from '../value-objects/forward-question.vo';
import type { CycleSignalRecord } from '@bb/shared';

export interface CycleHistory {
  cycleId: string;
  cycleNumber: number;
  committedAt: Date;
  selectedMode: string | null;
  contentPieceCount: number;
}

export interface PagedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Repository interface for WeeklyCycle.
 * Implementation in packages/infrastructure/.
 * Source: Implementation Spec V1 Section 08.
 */
export interface IWeeklyCycleRepository {
  findById(id: string): Promise<WeeklyCycle | null>;

  /**
   * Find the active cycle for a founder.
   * Active = status IN (COLLECTING, REASONING, CRITIQUE, COMMITTING).
   */
  findActive(founderId: string, tx?: unknown): Promise<WeeklyCycle | null>;

  findByFounderAndNumber(
    founderId: string,
    cycleNumber: number,
  ): Promise<WeeklyCycle | null>;

  /**
   * Returns the cycle's content pieces in AWAITING_APPROVAL, founder-scoped, for the
   * approval read path (C3). content_pieces has no priority column, so results are ordered
   * by created_at then id — the order C2 inserts pieces in (by piece-objective priority).
   * Founder scoping is by explicit founder_id filter (RLS is ENABLE-not-FORCE; the owner
   * connection bypasses it), matching the existing read repositories.
   */
  findAwaitingApprovalPieces(
    cycleId: string,
    founderId: string,
    tx?: unknown,
  ): Promise<ContentPiece[]>;

  /**
   * Loads a single content piece by id, founder-scoped, for the approval path (C4).
   * Returns null if no piece with that id exists for the founder.
   */
  findContentPieceById(
    pieceId: string,
    founderId: string,
    tx?: unknown,
  ): Promise<ContentPiece | null>;

  /**
   * Resolves the founder's current REVIEW cycle: the latest cycle in COMMITTED or
   * FALLBACK_COMMITTED (FAILED and in-flight statuses excluded), ordered committed_at DESC
   * then created_at DESC then id DESC. Returns null when none exists. Founder-scoped.
   * Distinct from findActive (in-flight) — neither is modified.
   */
  findCurrentReviewCycle(founderId: string, tx?: unknown): Promise<WeeklyCycle | null>;

  findHistory(
    founderId: string,
    limit: number,
    cursor?: string,
  ): Promise<PagedResult<WeeklyCycle>>;

  /**
   * Returns minimal projection for attribution lookback.
   * @param days - Number of days to look back from now.
   */
  findPreceding(founderId: string, days: number): Promise<CycleHistory[]>;

  /**
   * Returns the unconsumed forward question for a founder.
   * Returns null if none exists or all are consumed.
   * Used by Context Builder (F011).
   */
  findForwardQuestion(founderId: string): Promise<ForwardQuestion | null>;

  /**
   * Returns the raw signals collected for a cycle.
   * Used by the LLM pipeline Context Builder.
   */
  findSignalsForCycle(cycleId: string): Promise<CycleSignalRecord[]>;

  /**
   * Inserts a Friday signal row into cycle.cycle_signals.
   */
  insertSignal(signal: {
    id:              string;
    cycleId:         string;
    founderId:       string;
    signalType:      string;
    valueText:       string;
    sourceReference: string;
    collectedAt:     Date;
  }, tx?: unknown): Promise<void>;

  save(cycle: WeeklyCycle, tx: unknown): Promise<void>;

  markForwardQuestionConsumed(
    questionId: string,
    cycleId: string,
    tx: unknown,
  ): Promise<void>;
}
