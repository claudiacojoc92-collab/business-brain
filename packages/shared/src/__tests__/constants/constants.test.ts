import { describe, it, expect } from 'vitest';
import * as C from '../../constants/constants';

describe('Critical constants', () => {
  it('RECALIBRATION_COOLDOWN_DAYS is 14 (F017)', () => {
    expect(C.RECALIBRATION_COOLDOWN_DAYS).toBe(14);
  });
  it('VOICE_SIGNATURE_CONFIDENCE_THRESHOLD is 0.60 (F012)', () => {
    expect(C.VOICE_SIGNATURE_CONFIDENCE_THRESHOLD).toBe(0.60);
  });
  it('VOICE_SIGNATURE_OBSERVATION_THRESHOLD is 12 (F012)', () => {
    expect(C.VOICE_SIGNATURE_OBSERVATION_THRESHOLD).toBe(12);
  });
  it('SCHEDULER_TICK_INTERVAL_MS is 30000 (F013)', () => {
    expect(C.SCHEDULER_TICK_INTERVAL_MS).toBe(30_000);
  });
  it('CYCLE_START_HOUR_LOCAL is 3 (F009)', () => {
    expect(C.CYCLE_START_HOUR_LOCAL).toBe(3);
  });
  it('CYCLE_START_MINUTE_LOCAL is 30 (F009)', () => {
    expect(C.CYCLE_START_MINUTE_LOCAL).toBe(30);
  });
  it('INTELLIGENCE_EVENT_INCREASE_MAX_DELTA is 0.20 (F002)', () => {
    expect(C.INTELLIGENCE_EVENT_INCREASE_MAX_DELTA).toBe(0.20);
  });
  it('UNIQUENESS_SCORE_MIN_MAIN is 50', () => {
    expect(C.UNIQUENESS_SCORE_MIN_MAIN).toBe(50);
  });
  it('UNIQUENESS_SCORE_MIN_FALLBACK is 40', () => {
    expect(C.UNIQUENESS_SCORE_MIN_FALLBACK).toBe(40);
  });
});

describe('Queue names', () => {
  it('all queue names start with "bb:"', () => {
    Object.values(C.QUEUES).forEach((name) => {
      expect(name).toMatch(/^bb-/);
    });
  });
  it('there are exactly 7 queues', () => {
    expect(Object.keys(C.QUEUES)).toHaveLength(7);
  });
  it('LLM_PIPELINE queue name is correct', () => {
    expect(C.QUEUES.LLM_PIPELINE).toBe('bb-llm-pipeline');
  });
});
