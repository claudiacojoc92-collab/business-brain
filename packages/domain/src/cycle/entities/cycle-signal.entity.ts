import { Entity } from '../../shared/entity';
import type { SignalType } from '@bb/shared';

export type SignalDirection = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

export interface CycleSignalProps {
  id: string;
  cycleId: string;
  founderId: string;
  signalType: SignalType;
  typedConcept: string | null;
  direction: SignalDirection | null;
  valueNumeric: number | null;
  valueText: string | null;
  significanceScore: number | null;
  sourceReference: string;
  collectedAt: Date;
}

/**
 * An individual signal collected during the COLLECTING phase of a weekly cycle.
 * Immutable after creation.
 * Source: Database Design V1 Section 05.
 */
export class CycleSignal extends Entity {
  readonly cycleId: string;
  readonly founderId: string;
  readonly signalType: SignalType;
  readonly typedConcept: string | null;
  readonly direction: SignalDirection | null;
  readonly valueNumeric: number | null;
  readonly valueText: string | null;
  readonly significanceScore: number | null;
  readonly sourceReference: string;
  readonly collectedAt: Date;

  constructor(props: CycleSignalProps) {
    super(props.id);
    this.cycleId          = props.cycleId;
    this.founderId        = props.founderId;
    this.signalType       = props.signalType;
    this.typedConcept     = props.typedConcept;
    this.direction        = props.direction;
    this.valueNumeric     = props.valueNumeric;
    this.valueText        = props.valueText;
    this.significanceScore = props.significanceScore;
    this.sourceReference  = props.sourceReference;
    this.collectedAt      = props.collectedAt;
  }
}
