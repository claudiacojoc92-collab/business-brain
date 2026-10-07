import { describe, it, expect } from 'vitest';
import { runS01SignalTyper } from '../../../llm-pipeline/stages/s01-signal-typer';
import { createInitialContext } from '../../../llm-pipeline/pipeline-context';
import type { RawSignal } from '../../../llm-pipeline/pipeline-context';

const BASE = createInitialContext({
  cycleId:      'cycle-01',
  founderId:    'founder-01',
  cycleNumber:  1,
  correlationId:'corr-01',
  traceId:      'trace-01',
});

const RAW_SIGNALS: RawSignal[] = [
  { signalId: 's1', signalType: 'PLATFORM',    value: '350 reach', collectedAt: '2025-01-06T00:00:00Z' },
  { signalId: 's2', signalType: 'OUTCOME',     value: '1 DM',      collectedAt: '2025-01-06T00:00:00Z' },
  { signalId: 's3', signalType: 'BEHAVIOURAL', value: 'posted 3x', collectedAt: '2025-01-06T00:00:00Z' },
  { signalId: 's4', signalType: 'TEMPORAL',    value: 'Monday',    collectedAt: '2025-01-06T00:00:00Z' },
];

describe('S01 Signal Typer', () => {
  it('types all raw signals', async () => {
    const ctx    = { ...BASE, rawSignals: RAW_SIGNALS };
    const result = await runS01SignalTyper(ctx);
    expect(result.typedSignals).toHaveLength(4);
  });

  it('assigns typed concepts based on signal type', async () => {
    const ctx    = { ...BASE, rawSignals: RAW_SIGNALS };
    const result = await runS01SignalTyper(ctx);
    const platform = result.typedSignals.find((s) => s.signalType === 'PLATFORM');
    expect(platform?.typedConcept).toBe('engagement_level');
    const outcome  = result.typedSignals.find((s) => s.signalType === 'OUTCOME');
    expect(outcome?.typedConcept).toBe('business_result');
  });

  it('assigns higher significance to OUTCOME signals', async () => {
    const ctx    = { ...BASE, rawSignals: RAW_SIGNALS };
    const result = await runS01SignalTyper(ctx);
    const outcome  = result.typedSignals.find((s) => s.signalType === 'OUTCOME');
    const platform = result.typedSignals.find((s) => s.signalType === 'PLATFORM');
    expect((outcome?.significanceScore ?? 0) > (platform?.significanceScore ?? 0)).toBe(true);
  });

  it('returns empty typed signals for empty raw signals', async () => {
    const result = await runS01SignalTyper(BASE);
    expect(result.typedSignals).toHaveLength(0);
  });

  it('preserves all raw signal fields', async () => {
    const ctx    = { ...BASE, rawSignals: [RAW_SIGNALS[0]!] };
    const result = await runS01SignalTyper(ctx);
    expect(result.typedSignals[0]?.signalId).toBe('s1');
    expect(result.typedSignals[0]?.value).toBe('350 reach');
  });
});
