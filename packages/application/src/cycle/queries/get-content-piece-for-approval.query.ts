import type { Query } from '../../shared/query-bus';

/**
 * Loads a single persisted content_piece by id for the approval path (C4).
 * Founder-scoped; returns the domain ContentPiece the existing Approve/Edit/Reject
 * commands consume (replacing the former placeholder).
 */
export interface GetContentPieceForApprovalQuery extends Query {
  readonly type: 'GetContentPieceForApproval';
  readonly founderId: string;
  readonly contentPieceId: string;
}
