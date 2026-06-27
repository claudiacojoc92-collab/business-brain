import { ValueObject } from '../../shared/value-object';
import type { MemoryLayer } from '@bb/shared';

export interface MemoryLayerProps {
  founderId: string;
  layer: MemoryLayer;
  payload: Record<string, unknown>;
  confidence: number;
  dataPoints: number;
  lastUpdatedAt: Date;
  lastCycleId: string | null;
}

/**
 * Current state of one of the 9 Business Memory layers.
 * The history lives in intelligence_events. This is the current snapshot.
 * Source: Domain Architecture V1 Chapter 04, Database Design V1 Section 06.
 */
export class MemoryLayerVO extends ValueObject {
  readonly founderId: string;
  readonly layer: MemoryLayer;
  readonly payload: Record<string, unknown>;
  readonly confidence: number;
  readonly dataPoints: number;
  readonly lastUpdatedAt: Date;
  readonly lastCycleId: string | null;

  constructor(props: MemoryLayerProps) {
    super();
    if (props.confidence < 0 || props.confidence > 1) {
      throw new Error('MemoryLayer.confidence must be between 0 and 1.');
    }
    this.founderId     = props.founderId;
    this.layer         = props.layer;
    this.payload       = props.payload;
    this.confidence    = props.confidence;
    this.dataPoints    = props.dataPoints;
    this.lastUpdatedAt = props.lastUpdatedAt;
    this.lastCycleId   = props.lastCycleId;
  }

  protected getEqualityProperties(): Record<string, unknown> {
    return {
      founderId: this.founderId,
      layer:     this.layer,
      confidence:this.confidence,
      dataPoints:this.dataPoints,
    };
  }
}
