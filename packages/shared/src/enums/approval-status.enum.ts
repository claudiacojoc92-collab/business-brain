/** Content piece approval states. Maps to bb_types.approval_status. */
export const ApprovalStatus = {
  AWAITING_APPROVAL:  'AWAITING_APPROVAL',
  APPROVED:           'APPROVED',
  APPROVED_WITH_EDITS:'APPROVED_WITH_EDITS',
  REJECTED:           'REJECTED',
  AUTO_APPROVED:      'AUTO_APPROVED',
} as const;
export type ApprovalStatus = typeof ApprovalStatus[keyof typeof ApprovalStatus];
