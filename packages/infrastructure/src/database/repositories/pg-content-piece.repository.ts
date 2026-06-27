import type { KyselyDB } from '../client';
import type { ContentPiece } from '@bb/domain';

/**
 * Writes generated content pieces to cycle.content_pieces.
 *
 * insertMany runs inside the caller's transaction so the piece rows commit
 * atomically with the app.consumed_events idempotency insert (CEL D3).
 * Source: Database Design V1 Section 05, Content Execution Layer Spec V1.1.
 */
export class PgContentPieceRepository {
  constructor(private readonly db: KyselyDB) {}

  async insertMany(pieces: ContentPiece[], tx: unknown): Promise<void> {
    if (pieces.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (tx ?? this.db) as any;
    const rows = pieces.map((p) => ({
      id:                         p.id,
      cycle_id:                   p.cycleId,
      founder_id:                 p.founderId,
      brief_id:                   p.briefId,
      piece_type:                 p.pieceType,
      piece_role:                 p.pieceRole,
      content_blob_key:           p.contentBlobKey,
      content_preview:            p.contentPreview,
      approval_status:            p.approvalStatus,
      approval_window_expires_at: p.approvalWindowExpiresAt?.toISOString() ?? null,
      approved_at:                p.approvedAt?.toISOString() ?? null,
      rejected_at:                p.rejectedAt?.toISOString() ?? null,
      rejection_reason_code:      p.rejectionReasonCode,
      published_at:               p.publishedAt?.toISOString() ?? null,
      platform_post_id:           p.platformPostId,
    }));
    await db.insertInto('cycle.content_pieces').values(rows).execute();
  }
}
