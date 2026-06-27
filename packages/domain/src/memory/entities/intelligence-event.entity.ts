import { Entity } from '../../shared/entity';
import type { MemoryLayer } from '@bb/shared';

export type IntelligenceEventType =
  | 'OBSERVATIONAL'
  | 'INFERENTIAL'
  | 'CONFIDENCE'
  | 'BEHAVIOURAL'
  | 'OUTCOME';

export type QuarantineStatus = 'APPLIED' | 'QUARANTINED' | 'RELEASED';

export interface IntelligenceEventProps {
  id: string;
  founderId: string;
  cycleId: string | null;
  layer: MemoryLayer;
  eventType: IntelligenceEventType;
  content: Record<string, unknown>;
  confidence: number;
  reasoning: string | null;
  confidenceDirection: 'INCREASE' | 'DECREASE' | null;
  confidenceDelta: number | null;
  sourceSignalIds: string[];
  replacesPatternId: string | null;
  quarantineStatus: QuarantineStatus;
  emittedAt: Date;
  appliedAt: Date | null;
}

/**
 * An individual intelligence update event. Append-only — never mutated.
 * Source: Domain Architecture V1 Chapter 04, Database Design V1 Section 06.
 */
export class IntelligenceEvent extends Entity {
  readonly founderId: string;
  readonly cycleId: string | null;
  readonly layer: MemoryLayer;
  readonly eventType: IntelligenceEventType;
  readonly content: Record<string, unknown>;
  readonly confidence: number;
  readonly reasoning: string | null;
  readonly confidenceDirection: 'INCREASE' | 'DECREASE' | null;
  readonly confidenceDelta: number | null;
  readonly sourceSignalIds: readonly string[];
  readonly replacesPatternId: string | null;
  readonly quarantineStatus: QuarantineStatus;
  readonly emittedAt: Date;
  readonly appliedAt: Date | null;

  constructor(props: IntelligenceEventProps) {
    super(props.id);
    this.founderId          = props.founderId;
    this.cycleId            = props.cycleId;
    this.layer              = props.layer;
    this.eventType          = props.eventType;
    this.content            = props.content;
    this.confidence         = props.confidence;
    this.reasoning          = props.reasoning;
    this.confidenceDirection = props.confidenceDirection;
    this.confidenceDelta    = props.confidenceDelta;
    this.sourceSignalIds    = Object.freeze([...props.sourceSignalIds]);
    this.replacesPatternId  = props.replacesPatternId;
    this.quarantineStatus   = props.quarantineStatus;
    this.emittedAt          = props.emittedAt;
    this.appliedAt          = props.appliedAt;
  }

  isQuarantined(): boolean {
    return this.quarantineStatus === 'QUARANTINED';
  }

  isApplied(): boolean {
    return this.quarantineStatus === 'APPLIED' && this.appliedAt !== null;
  }
}
