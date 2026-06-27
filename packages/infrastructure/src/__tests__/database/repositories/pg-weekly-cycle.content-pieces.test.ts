import { describe, it, expect, vi } from 'vitest';
import { PgWeeklyCycleRepository } from '../../../database/repositories/pg-weekly-cycle.repository';

function makePieceRow(id: string): Record<string, unknown> {
  return {
    id, cycle_id: 'cycle-1', founder_id: 'founder-1', brief_id: 'brief-1',
    piece_type: 'REEL', piece_role: 'Authority',
    content_blob_key: null, content_preview: `{"piece":"${id}"}`,
    approval_status: 'AWAITING_APPROVAL', approval_window_expires_at: null,
    approved_at: null, rejected_at: null, rejection_reason_code: null,
    published_at: null, platform_post_id: null,
  };
}

function makeMockDb(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnThis();
  const where = vi.fn().mockReturnThis();
  const selectAll = vi.fn().mockReturnThis();
  const builder = { selectAll, where, orderBy, execute };
  const selectFrom = vi.fn().mockReturnValue(builder);
  return { db: { selectFrom } as never, selectFrom, where, orderBy };
}

describe('PgWeeklyCycleRepository.findAwaitingApprovalPieces (C3)', () => {
  it('filters by founder_id, cycle_id and AWAITING_APPROVAL, ordered by created_at then id', async () => {
    const { db, selectFrom, where, orderBy } = makeMockDb([makePieceRow('p1'), makePieceRow('p2')]);
    const repo = new PgWeeklyCycleRepository(db);

    const pieces = await repo.findAwaitingApprovalPieces('cycle-1', 'founder-1');

    expect(selectFrom).toHaveBeenCalledWith('cycle.content_pieces');
    expect(where).toHaveBeenCalledWith('founder_id', '=', 'founder-1');
    expect(where).toHaveBeenCalledWith('cycle_id', '=', 'cycle-1');
    expect(where).toHaveBeenCalledWith('approval_status', '=', 'AWAITING_APPROVAL');
    expect(orderBy).toHaveBeenCalledWith('created_at', 'asc');
    expect(orderBy).toHaveBeenCalledWith('id', 'asc');
    expect(pieces).toHaveLength(2);
  });

  it('maps rows into ContentPiece entities', async () => {
    const { db } = makeMockDb([makePieceRow('p1')]);
    const repo = new PgWeeklyCycleRepository(db);
    const [piece] = await repo.findAwaitingApprovalPieces('cycle-1', 'founder-1');
    expect(piece!.id).toBe('p1');
    expect(piece!.cycleId).toBe('cycle-1');
    expect(piece!.pieceType).toBe('REEL');
    expect(piece!.approvalStatus).toBe('AWAITING_APPROVAL');
    expect(piece!.contentPreview).toBe('{"piece":"p1"}');
  });

  it('returns [] when there are no awaiting pieces', async () => {
    const { db } = makeMockDb([]);
    const repo = new PgWeeklyCycleRepository(db);
    expect(await repo.findAwaitingApprovalPieces('cycle-1', 'founder-1')).toEqual([]);
  });
});
