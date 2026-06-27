import { describe, it, expect } from 'vitest';
import { MemorySnapshot } from '../../../memory/value-objects/memory-snapshot.vo';

describe('MemorySnapshot.isStale', () => {
  it('returns false when snapshot is fresh', () => {
    const builtAt = new Date('2025-01-06T04:00:00Z');
    const now     = new Date('2025-01-06T04:04:00Z'); // 4 minutes later
    const snap = new MemorySnapshot({
      founderId: 'f-01', snapshotJson: {}, estimatedTokens: null,
      builtFromCycleId: null, builtAt,
    });
    expect(snap.isStale(5, now)).toBe(false);
  });

  it('returns true when snapshot exceeds threshold (F018)', () => {
    const builtAt = new Date('2025-01-06T04:00:00Z');
    const now     = new Date('2025-01-06T04:06:00Z'); // 6 minutes later
    const snap = new MemorySnapshot({
      founderId: 'f-01', snapshotJson: {}, estimatedTokens: null,
      builtFromCycleId: null, builtAt,
    });
    expect(snap.isStale(5, now)).toBe(true);
  });

  it('returns false at exactly the threshold boundary', () => {
    const builtAt = new Date('2025-01-06T04:00:00Z');
    const now     = new Date('2025-01-06T04:05:00Z'); // exactly 5 minutes
    const snap = new MemorySnapshot({
      founderId: 'f-01', snapshotJson: {}, estimatedTokens: null,
      builtFromCycleId: null, builtAt,
    });
    expect(snap.isStale(5, now)).toBe(false);
  });
});
