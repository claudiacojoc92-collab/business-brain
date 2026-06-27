import type { Query } from '../../shared/query-bus';
import type { ApprovalStatus } from '@bb/shared';
import type { ContentPieceType } from '@bb/domain';

export interface GetContentForApprovalQuery extends Query {
  readonly type: 'GetContentForApproval';
  readonly founderId: string;
  readonly cycleId: string;
}

export interface ContentForApprovalDTO {
  contentPieceId: string;
  cycleId: string;
  pieceType: ContentPieceType;
  pieceRole: string;
  contentPreview: string | null;
  approvalStatus: ApprovalStatus;
  approvalWindowExpiresAt: Date | null;
}
