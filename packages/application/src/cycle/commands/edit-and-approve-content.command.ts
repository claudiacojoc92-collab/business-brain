import type { Command } from '../../shared/command-bus';
import type { ContentPiece } from '@bb/domain';
import type { EditType } from '@bb/shared';

export interface EditAndApproveContentCommand extends Command {
  readonly type: 'EditAndApproveContent';
  readonly cycleId: string;
  readonly founderId: string;
  readonly contentPiece: ContentPiece;
  readonly edits: Array<{
    editId: string;
    editType: EditType;
    originalFragment: string;
    replacementFragment: string;
  }>;
}

export interface EditAndApproveContentResult {
  contentPieceId: string;
  editCount: number;
}
