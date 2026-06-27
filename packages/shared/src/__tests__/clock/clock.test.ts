import { describe, it, expect } from 'vitest';
import { SystemClock, MockClock } from '../../clock/clock';

describe('SystemClock', () => {
  it('now() returns a Date close to current time', () => {
    const before = Date.now();
    const result = new SystemClock().now().getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after + 1);
  });
  it('nowISO() returns a valid ISO string', () => {
    const iso = new SystemClock().nowISO();
    expect(() => new Date(iso)).not.toThrow();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('MockClock', () => {
  it('returns the injected time', () => {
    const clock = new MockClock(new Date('2025-01-06T04:00:00Z'));
    expect(clock.nowISO()).toBe('2025-01-06T04:00:00.000Z');
  });
  it('advance(1000) moves time forward 1 second', () => {
    const clock = new MockClock(new Date('2025-01-06T04:00:00Z'));
    clock.advance(1000);
    expect(clock.nowISO()).toBe('2025-01-06T04:00:01.000Z');
  });
  it('set() replaces time exactly', () => {
    const clock = new MockClock();
    clock.set(new Date('2099-12-31T23:59:59Z'));
    expect(clock.nowISO()).toBe('2099-12-31T23:59:59.000Z');
  });
  it('now() returns a copy, not the internal reference', () => {
    const clock = new MockClock(new Date('2025-01-06T04:00:00Z'));
    clock.now().setFullYear(2000);
    expect(clock.now().getFullYear()).toBe(2025);
  });
});
