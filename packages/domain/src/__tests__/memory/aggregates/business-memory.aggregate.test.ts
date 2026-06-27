import { describe, it, expect } from 'vitest';
import { BusinessMemory } from '../../../memory/aggregates/business-memory.aggregate';
import { MemoryLayerVO } from '../../../memory/value-objects/memory-layer.vo';
import { IntelligenceEvent } from '../../../memory/entities/intelligence-event.entity';
import { generateId } from '@bb/shared';

const NOW   = new Date('2025-01-06T04:00:00Z');
const CORR  = 'corr-01';
const TRACE = 'trace-01';

function makeLayer(layer = 'APPROVAL_INTELLIGENCE', confidence = 0.5): MemoryLayerVO {
  return new MemoryLayerVO({
    founderId:     'f-01',
    layer:         layer as never,
    payload:       {},
    confidence,
    dataPoints:    10,
    lastUpdatedAt: NOW,
    lastCycleId:   null,
  });
}

function makeIE(): IntelligenceEvent {
  return new IntelligenceEvent({
    id:                  generateId(),
    founderId:           'f-01',
    cycleId:             'c-01',
    layer:               'APPROVAL_INTELLIGENCE',
    eventType:           'OBSERVATIONAL',
    content:             {},
    confidence:          0.6,
    reasoning:           null,
    confidenceDirection: null,
    confidenceDelta:     null,
    sourceSignalIds:     [],
    replacesPatternId:   null,
    quarantineStatus:    'APPLIED',
    emittedAt:           NOW,
    appliedAt:           NOW,
  });
}

describe('BusinessMemory.initialise', () => {
  it('creates memory with no layers', () => {
    const mem = BusinessMemory.initialise('f-01');
    expect(mem.founderId).toBe('f-01');
    expect(mem.layers).toHaveLength(0);
    expect(mem.compositeConfidence()).toBe(0);
  });
});

describe('BusinessMemory.applyIntelligenceEvent', () => {
  it('adds a new layer and emits MemoryLayerUpdated', () => {
    const mem = BusinessMemory.initialise('f-01');
    const ie  = makeIE();
    const updatedLayer = makeLayer('APPROVAL_INTELLIGENCE', 0.6);
    const result = mem.applyIntelligenceEvent({
      event: ie, updatedLayer, correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(result.isOk).toBe(true);
    expect(mem.layers).toHaveLength(1);
    const events = mem.pullEvents();
    expect(events[0]?.event_type).toBe('memory.BusinessMemory.MemoryLayerUpdated');
  });

  it('replaces existing layer on subsequent update', () => {
    const mem = BusinessMemory.initialise('f-01');
    const ie  = makeIE();
    mem.applyIntelligenceEvent({
      event: ie, updatedLayer: makeLayer('APPROVAL_INTELLIGENCE', 0.5),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    mem.pullEvents();
    mem.applyIntelligenceEvent({
      event: ie, updatedLayer: makeLayer('APPROVAL_INTELLIGENCE', 0.7),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    expect(mem.layers).toHaveLength(1);
    expect(mem.layers[0]?.confidence).toBe(0.7);
  });

  it('quarantines INFERENTIAL events during recalibration', () => {
    const mem = BusinessMemory.initialise('f-01');
    mem.enterRecalibratingMode();
    const ie = new IntelligenceEvent({
      id: generateId(), founderId: 'f-01', cycleId: 'c-01',
      layer: 'APPROVAL_INTELLIGENCE', eventType: 'INFERENTIAL',
      content: {}, confidence: 0.6, reasoning: 'test',
      confidenceDirection: null, confidenceDelta: null,
      sourceSignalIds: [], replacesPatternId: null,
      quarantineStatus: 'APPLIED', emittedAt: NOW, appliedAt: NOW,
    });
    mem.applyIntelligenceEvent({
      event: ie, updatedLayer: makeLayer(),
      correlationId: CORR, traceId: TRACE, now: NOW,
    });
    // No layer added, no events emitted
    expect(mem.layers).toHaveLength(0);
    expect(mem.pullEvents()).toHaveLength(0);
  });
});

describe('BusinessMemory.compositeConfidence', () => {
  it('returns average confidence across layers', () => {
    const mem = BusinessMemory.reconstitute({
      founderId:       'f-01',
      layers:          [makeLayer('APPROVAL_INTELLIGENCE', 0.6), makeLayer('EDIT_PATTERN_INTELLIGENCE' as never, 0.8)],
      voiceSignature:  null,
      snapshot:        null,
      isRecalibrating: false,
    });
    expect(mem.compositeConfidence()).toBeCloseTo(0.7);
  });
});
