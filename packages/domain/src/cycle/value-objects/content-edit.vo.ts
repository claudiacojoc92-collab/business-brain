import { ValueObject } from '../../shared/value-object';
import type { EditType } from '@bb/shared';

export interface ContentEditProps {
  editId: string;
  contentPieceId: string;
  cycleId: string;
  founderId: string;
  editType: EditType;
  originalFragment: string;
  replacementFragment: string;
  editPosition?: number;
  editedAt: Date;
}

/**
 * Immutable record of a single edit made to a content piece.
 * Feeds Business Memory Layer 2 (Edit Pattern Intelligence).
 * Source: Database Design V1 Section 05.
 */
export class ContentEdit extends ValueObject {
  readonly editId: string;
  readonly contentPieceId: string;
  readonly cycleId: string;
  readonly founderId: string;
  readonly editType: EditType;
  readonly originalFragment: string;
  readonly replacementFragment: string;
  readonly editPosition?: number;
  readonly editedAt: Date;

  constructor(props: ContentEditProps) {
    super();
    this.editId             = props.editId;
    this.contentPieceId     = props.contentPieceId;
    this.cycleId            = props.cycleId;
    this.founderId          = props.founderId;
    this.editType           = props.editType;
    this.originalFragment   = props.originalFragment;
    this.replacementFragment = props.replacementFragment;
    this.editPosition       = props.editPosition;
    this.editedAt           = props.editedAt;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      editId:          this.editId,
      editType:        this.editType,
      originalFragment:this.originalFragment,
    };
  }
}
