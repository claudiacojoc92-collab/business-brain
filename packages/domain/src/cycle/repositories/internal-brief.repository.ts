import type { InternalBrief } from '../entities/internal-brief.entity';

/**
 * Read-back repository for the committed Internal Brief (cycle.internal_briefs).
 * Implementation lives in packages/infrastructure/.
 *
 * The write side is PgInternalBriefProjection (CommitBrief path). This port is
 * the read side so the Content Execution Layer (and C1) can load the full brief
 * — including piece_objectives[] — by cycle id or brief id.
 * Source: Database Design V1 Section 05, Content Execution Layer Spec V1.1.
 */
export interface IInternalBriefRepository {
  /** Return the committed brief for a cycle, or null if none exists. */
  findByCycleId(cycleId: string, tx?: unknown): Promise<InternalBrief | null>;

  /** Return the committed brief by its brief id, or null if none exists. */
  findByBriefId(briefId: string, tx?: unknown): Promise<InternalBrief | null>;
}
