import { Entity } from '../../shared/entity';
import type { OutcomeType } from '@bb/shared';

export type AttributionStatus = 'REPORTED' | 'PENDING' | 'CONFIRMED';

export interface OutcomeReportProps {
  id: string;
  founderId: string;
  outcomeType: OutcomeType;
  description: string | null;
  isImplicit: boolean;
  attributionStatus: AttributionStatus;
  attributionConfidence: number | null;
  precedingCycleIds: string[];
  precedingModes: string[];
  confirmedAt: Date | null;
  reportedAt: Date;
}

/**
 * A reported business outcome.
 * Attribution runs asynchronously — status transitions from REPORTED → PENDING → CONFIRMED.
 * Source: Domain Architecture V1 Chapter 03, Event Contracts V1 Section 13.
 */
export class OutcomeReport extends Entity {
  readonly founderId: string;
  readonly outcomeType: OutcomeType;
  readonly description: string | null;
  readonly isImplicit: boolean;
  attributionStatus: AttributionStatus;
  attributionConfidence: number | null;
  precedingCycleIds: string[];
  precedingModes: string[];
  confirmedAt: Date | null;
  readonly reportedAt: Date;

  constructor(props: OutcomeReportProps) {
    super(props.id);
    this.founderId             = props.founderId;
    this.outcomeType           = props.outcomeType;
    this.description           = props.description;
    this.isImplicit            = props.isImplicit;
    this.attributionStatus     = props.attributionStatus;
    this.attributionConfidence = props.attributionConfidence;
    this.precedingCycleIds     = [...props.precedingCycleIds];
    this.precedingModes        = [...props.precedingModes];
    this.confirmedAt           = props.confirmedAt;
    this.reportedAt            = props.reportedAt;
  }

  confirm(params: {
    confidence: number;
    precedingCycleIds: string[];
    precedingModes: string[];
    confirmedAt: Date;
  }): void {
    this.attributionStatus     = 'CONFIRMED';
    this.attributionConfidence = params.confidence;
    this.precedingCycleIds     = [...params.precedingCycleIds];
    this.precedingModes        = [...params.precedingModes];
    this.confirmedAt           = params.confirmedAt;
  }

  isConfirmed(): boolean {
    return this.attributionStatus === 'CONFIRMED';
  }
}
