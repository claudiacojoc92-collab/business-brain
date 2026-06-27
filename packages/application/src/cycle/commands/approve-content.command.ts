import type { Command } from '../../shared/command-bus';
import type { ContentPiece } from '@bb/domain';

export interface ApproveContentCommand extends Command {
  readonly type: 'ApproveContent';
  readonly cycleId: string;
  readonly founderId: string;
  readonly contentPiece: ContentPiece;
  readonly approvalType: 'ZERO_EDIT' | 'AUTO_APPROVED';
}

export interface ApproveContentResult {
  contentPieceId: string;
  approvalType: string;
}
