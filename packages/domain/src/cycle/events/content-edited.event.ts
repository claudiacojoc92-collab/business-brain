import type { EditType } from '@bb/shared';

export interface ContentEditedPayload {
  editId: string;
  contentPieceId: string;
  cycleId: string;
  founderId: string;
  editType: EditType;
  originalFragment: string;
  replacementFragment: string;
  editedAt: Date;
}

export function buildContentEditedEvent(
  p: ContentEditedPayload,
): ContentEditedPayload {
  return p;
}
