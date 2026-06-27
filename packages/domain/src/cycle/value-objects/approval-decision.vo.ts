import { ValueObject } from '../../shared/value-object';
import type { RejectionReasonCode } from '@bb/shared';

export type ApprovalActionType = 'APPROVED' | 'APPROVED_WITH_EDITS' | 'REJECTED' | 'AUTO_APPROVED';

export interface ApprovalDecisionProps {
  contentPieceId: string;
  cycleId: string;
  founderId: string;
  action: ApprovalActionType;
  editDistance: number;
  rejectionReasonCode?: RejectionReasonCode;
  decidedAt: Date;
}

/**
 * Immutable record of a content approval decision.
 * Source: Domain Architecture V1 Chapter 03, Database Design V1 Section 05.
 */
export class ApprovalDecision extends ValueObject {
  readonly contentPieceId: string;
  readonly cycleId: string;
  readonly founderId: string;
  readonly action: ApprovalActionType;
  readonly editDistance: number;
  readonly rejectionReasonCode?: RejectionReasonCode;
  readonly decidedAt: Date;

  constructor(props: ApprovalDecisionProps) {
    super();
    this.contentPieceId      = props.contentPieceId;
    this.cycleId             = props.cycleId;
    this.founderId           = props.founderId;
    this.action              = props.action;
    this.editDistance        = props.editDistance;
    this.rejectionReasonCode = props.rejectionReasonCode;
    this.decidedAt           = props.decidedAt;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      contentPieceId: this.contentPieceId,
      action:         this.action,
      editDistance:   this.editDistance,
      decidedAt:      this.decidedAt.toISOString(),
    };
  }
}
