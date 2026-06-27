import type { RejectionReasonCode } from '@bb/shared';

export interface ContentRejectedPayload {
  contentPieceId: string;
  cycleId: string;
  founderId: string;
  reasonCode: RejectionReasonCode;
  hardBoundaryFlag: boolean;
  rejectedAt: Date;
}

export function buildContentRejectedEvent(
  p: ContentRejectedPayload,
): ContentRejectedPayload {
  return p;
}
