import type { MemoryLayer } from '@bb/shared';
import type { SignalDirection } from '../entities/pattern.entity';

export interface PatternRecognisedPayload {
  patternId: string;
  founderId: string;
  layer: MemoryLayer;
  domainConcept: string;
  direction: SignalDirection;
  confidence: number;
  observationCount: number;
  description: string;
  recognisedAt: Date;
}

export function buildPatternRecognisedEvent(
  p: PatternRecognisedPayload,
): PatternRecognisedPayload {
  return p;
}
