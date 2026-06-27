import { ok, type Result } from '@bb/shared';
import { AggregateRoot } from '../../shared/aggregate-root';
import { PreconditionFailed } from '../../shared/domain-error';
import type { MemoryLayerVO } from '../value-objects/memory-layer.vo';
import type { VoiceSignature } from '../value-objects/voice-signature.vo';
import type { MemorySnapshot } from '../value-objects/memory-snapshot.vo';
import type { IntelligenceEvent } from '../entities/intelligence-event.entity';
import type { Pattern } from '../entities/pattern.entity';
import {
  buildMemoryLayerUpdatedEvent,
  buildPatternRecognisedEvent,
  buildPatternWeakenedEvent,
  buildPatternSupersededEvent,
  buildBusinessEvolutionDetectedEvent,
  buildRecalibrationRecommendedEvent,
} from '../events';
import type { EvolutionType } from '../events/business-evolution-detected.event';

export interface BusinessMemoryProps {
  founderId: string;
  layers: MemoryLayerVO[];
  voiceSignature: VoiceSignature | null;
  snapshot: MemorySnapshot | null;
  isRecalibrating: boolean;
}

/**
 * BusinessMemory aggregate root.
 * Accumulates intelligence from every cycle and drives the LLM pipeline context.
 * Source: Domain Architecture V1 Chapter 04.
 */
export class BusinessMemory extends AggregateRoot {
  founderId: string;
  layers: MemoryLayerVO[];
  voiceSignature: VoiceSignature | null;
  snapshot: MemorySnapshot | null;
  isRecalibrating: boolean;

  private constructor(props: BusinessMemoryProps) {
    super(props.founderId); // aggregate id = founderId (one per founder)
    this.founderId       = props.founderId;
    this.layers          = [...props.layers];
    this.voiceSignature  = props.voiceSignature;
    this.snapshot        = props.snapshot;
    this.isRecalibrating = props.isRecalibrating;
  }

  static reconstitute(props: BusinessMemoryProps): BusinessMemory {
    return new BusinessMemory(props);
  }

  static initialise(founderId: string): BusinessMemory {
    return new BusinessMemory({
      founderId,
      layers:          [],
      voiceSignature:  null,
      snapshot:        null,
      isRecalibrating: false,
    });
  }

  // -----------------------------------------------------------------------
  // ApplyIntelligenceEvent (Stream A or B)
  // -----------------------------------------------------------------------

  applyIntelligenceEvent(params: {
    event: IntelligenceEvent;
    updatedLayer: MemoryLayerVO;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    if (this.isRecalibrating && params.event.eventType === 'INFERENTIAL') {
      // INFERENTIAL events are quarantined during recalibration
      return ok(undefined);
    }
    // Replace the layer in the layers array
    const idx = this.layers.findIndex(
      (l) => l.layer === params.event.layer,
    );
    if (idx >= 0) {
      this.layers[idx] = params.updatedLayer;
    } else {
      this.layers.push(params.updatedLayer);
    }
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.MemoryLayerUpdated',
        buildMemoryLayerUpdatedEvent({
          founderId:     this.founderId,
          layer:         params.event.layer,
          newConfidence: params.updatedLayer.confidence,
          dataPoints:    params.updatedLayer.dataPoints,
          updatedAt:     params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // RecognisePattern
  // -----------------------------------------------------------------------

  recognisePattern(params: {
    pattern: Pattern;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.PatternRecognised',
        buildPatternRecognisedEvent({
          patternId:        params.pattern.id,
          founderId:        this.founderId,
          layer:            params.pattern.layer,
          domainConcept:    params.pattern.domainConcept,
          direction:        params.pattern.direction,
          confidence:       params.pattern.confidence,
          observationCount: params.pattern.observationCount,
          description:      params.pattern.description,
          recognisedAt:     params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // WeakenPattern
  // -----------------------------------------------------------------------

  weakenPattern(params: {
    pattern: Pattern;
    newConfidence: number;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    params.pattern.status     = 'WEAK';
    params.pattern.confidence = params.newConfidence;
    params.pattern.lastUpdatedAt = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.PatternWeakened',
        buildPatternWeakenedEvent({
          patternId:        params.pattern.id,
          founderId:        this.founderId,
          previousConfidence: params.pattern.confidence,
          newConfidence:    params.newConfidence,
          weakenedAt:       params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // SupersedePattern
  // -----------------------------------------------------------------------

  supersedePattern(params: {
    oldPattern: Pattern;
    newPattern: Pattern;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    params.oldPattern.status         = 'SUPERSEDED';
    params.oldPattern.supersededById = params.newPattern.id;
    params.oldPattern.lastUpdatedAt  = params.now;
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.PatternSuperseded',
        buildPatternSupersededEvent({
          oldPatternId:  params.oldPattern.id,
          newPatternId:  params.newPattern.id,
          founderId:     this.founderId,
          supersededAt:  params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // DetectBusinessEvolution
  // -----------------------------------------------------------------------

  detectBusinessEvolution(params: {
    evolutionType: EvolutionType;
    confidence: number;
    evidence: string[];
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.BusinessEvolutionDetected',
        buildBusinessEvolutionDetectedEvent({
          founderId:     this.founderId,
          confidence:    params.confidence,
          evolutionType: params.evolutionType,
          evidence:      params.evidence,
          detectedAt:    params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // RecommendRecalibration
  // -----------------------------------------------------------------------

  recommendRecalibration(params: {
    reason: string;
    suggestedType: string;
    correlationId: string;
    traceId: string;
    now: Date;
  }): Result<void, PreconditionFailed> {
    this.recordEvent(
      this.buildEnvelope(
        'memory.BusinessMemory.RecalibrationRecommended',
        buildRecalibrationRecommendedEvent({
          founderId:     this.founderId,
          reason:        params.reason,
          suggestedType: params.suggestedType,
          emittedAt:     params.now,
        }),
        params.correlationId,
        null,
        params.traceId,
        'memory-service',
      ),
    );
    return ok(undefined);
  }

  // -----------------------------------------------------------------------
  // EnterRecalibratingMode / ExitRecalibratingMode
  // -----------------------------------------------------------------------

  enterRecalibratingMode(): void {
    this.isRecalibrating = true;
  }

  exitRecalibratingMode(): void {
    this.isRecalibrating = false;
  }

  // -----------------------------------------------------------------------
  // Composite memory confidence (average of all layer confidences)
  // -----------------------------------------------------------------------

  compositeConfidence(): number {
    if (this.layers.length === 0) return 0;
    const sum = this.layers.reduce((acc, l) => acc + l.confidence, 0);
    return sum / this.layers.length;
  }
}
