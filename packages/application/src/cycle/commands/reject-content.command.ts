import type { Command } from '../../shared/command-bus';
import type { ContentPiece } from '@bb/domain';
import type { RejectionReasonCode } from '@bb/shared';

export interface RejectContentCommand extends Command {
  readonly type: 'RejectContent';
  readonly cycleId: string;
  readonly founderId: string;
  readonly contentPiece: ContentPiece;
  readonly reasonCode: RejectionReasonCode;
  readonly hardBoundaryFlag: boolean;
}

export interface RejectContentResult {
  contentPieceId: string;
  reasonCode: RejectionReasonCode;
}
