export type ContentApprovalType = 'ZERO_EDIT' | 'MINOR_EDIT' | 'AUTO_APPROVED';

export interface ContentApprovedPayload {
  contentPieceId: string;
  cycleId: string;
  founderId: string;
  approvalType: ContentApprovalType;
  editDistance: number;
  approvedAt: Date;
}

export function buildContentApprovedEvent(
  p: ContentApprovedPayload,
): ContentApprovedPayload {
  return p;
}
