/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ArcService } from '../../arc/arc.service';

// LONG OPERATIONS, ONE AT A TIME (2026-10-17): a concurrent request joins the running operation, and the arc reports
// it as running so the GET can answer "pending" instead of starting a second model run.
describe('ArcService — in-flight long operations', () => {
  it('joins a running operation instead of starting it again, and reports it until it ends', async () => {
    const arc = new ArcService({} as any);
    let calls = 0;
    let release!: (v: string) => void;
    const run = () => { calls += 1; return new Promise<string>((r) => { release = r; }); };
    expect(arc.running('B')).toBeNull();
    const a = arc.track('B', 'strategy', run);
    const b = arc.track('B', 'strategy', run);
    expect(calls).toBe(1);
    expect(arc.running('B')).toBe('strategy');
    expect(arc.running('OTHER')).toBeNull();
    release('done');
    expect(await a).toBe('done');
    expect(await b).toBe('done');
    expect(arc.running('B')).toBeNull();
  });
  it('a failed operation is released too, so a retry can start it again', async () => {
    const arc = new ArcService({} as any);
    await expect(arc.track('B', 'pour_in', () => Promise.reject(new Error('model down')))).rejects.toThrow('model down');
    expect(arc.running('B')).toBeNull();
    expect(await arc.track('B', 'pour_in', async () => 'ok')).toBe('ok');
  });
});
