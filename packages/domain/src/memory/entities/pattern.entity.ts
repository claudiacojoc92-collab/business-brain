import { Entity } from '../../shared/entity';
import type { MemoryLayer } from '@bb/shared';

/** Direction of a recognised pattern. Defined locally to keep Memory context
 *  decoupled from the Cycle context. Mirrors cycle/entities/cycle-signal.entity.ts. */
export type SignalDirection = 'IMPROVING' | 'STABLE' | 'DECLINING' | 'UNKNOWN';

export type PatternStatus = 'ACTIVE' | 'WEAK' | 'SUPERSEDED';

export interface PatternProps {
  id: string;
  founderId: string;
  layer: MemoryLayer;
  domainConcept: string;
  direction: SignalDirection;
  status: PatternStatus;
  confidence: number;
  observationCount: number;
  description: string;
  supportingEventIds: string[];
  supersededById: string | null;
  createdAt: Date;
  lastUpdatedAt: Date;
}

/**
 * A recognised recurring pattern in Business Memory.
 * Never deleted — superseded patterns retain their history.
 * Source: Domain Architecture V1 Chapter 04, Database Design V1 Section 06.
 */
export class Pattern extends Entity {
  readonly founderId: string;
  readonly layer: MemoryLayer;
  readonly domainConcept: string;
  readonly direction: SignalDirection;
  status: PatternStatus;
  confidence: number;
  readonly observationCount: number;
  readonly description: string;
  readonly supportingEventIds: readonly string[];
  supersededById: string | null;
  readonly createdAt: Date;
  lastUpdatedAt: Date;

  constructor(props: PatternProps) {
    super(props.id);
    this.founderId         = props.founderId;
    this.layer             = props.layer;
    this.domainConcept     = props.domainConcept;
    this.direction         = props.direction;
    this.status            = props.status;
    this.confidence        = props.confidence;
    this.observationCount  = props.observationCount;
    this.description       = props.description;
    this.supportingEventIds = Object.freeze([...props.supportingEventIds]);
    this.supersededById    = props.supersededById;
    this.createdAt         = props.createdAt;
    this.lastUpdatedAt     = props.lastUpdatedAt;
  }

  isActive(): boolean { return this.status === 'ACTIVE'; }
  isWeak(): boolean   { return this.status === 'WEAK'; }
}
