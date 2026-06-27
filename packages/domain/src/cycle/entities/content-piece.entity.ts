import { Entity } from '../../shared/entity';
import type { ApprovalStatus } from '@bb/shared';

export type ContentPieceType = 'REEL' | 'CAROUSEL';

export interface ContentPieceProps {
  id: string;
  cycleId: string;
  founderId: string;
  briefId: string;
  pieceType: ContentPieceType;
  pieceRole: string;
  contentBlobKey: string | null;
  contentPreview: string | null;
  approvalStatus: ApprovalStatus;
  approvalWindowExpiresAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReasonCode: string | null;
  publishedAt: Date | null;
  platformPostId: string | null;
}

/**
 * A single piece of generated content within a weekly cycle.
 * Source: Domain Architecture V1 Chapter 03, Database Design V1 Section 05.
 */
export class ContentPiece extends Entity {
  cycleId: string;
  founderId: string;
  briefId: string;
  pieceType: ContentPieceType;
  pieceRole: string;
  contentBlobKey: string | null;
  contentPreview: string | null;
  approvalStatus: ApprovalStatus;
  approvalWindowExpiresAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReasonCode: string | null;
  publishedAt: Date | null;
  platformPostId: string | null;

  constructor(props: ContentPieceProps) {
    super(props.id);
    this.cycleId                 = props.cycleId;
    this.founderId               = props.founderId;
    this.briefId                 = props.briefId;
    this.pieceType               = props.pieceType;
    this.pieceRole               = props.pieceRole;
    this.contentBlobKey          = props.contentBlobKey;
    this.contentPreview          = props.contentPreview;
    this.approvalStatus          = props.approvalStatus;
    this.approvalWindowExpiresAt = props.approvalWindowExpiresAt;
    this.approvedAt              = props.approvedAt;
    this.rejectedAt              = props.rejectedAt;
    this.rejectionReasonCode     = props.rejectionReasonCode;
    this.publishedAt             = props.publishedAt;
    this.platformPostId          = props.platformPostId;
  }

  isAwaitingApproval(): boolean {
    return this.approvalStatus === 'AWAITING_APPROVAL';
  }

  isDecided(): boolean {
    return (
      this.approvalStatus === 'APPROVED' ||
      this.approvalStatus === 'APPROVED_WITH_EDITS' ||
      this.approvalStatus === 'REJECTED' ||
      this.approvalStatus === 'AUTO_APPROVED'
    );
  }
}
