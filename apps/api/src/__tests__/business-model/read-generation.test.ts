import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeFragment, type EvidenceFragment } from '@bb/domain';
import type { MultiSourceResult } from '../../business-model/recompute';
import type { StoredRead } from '../../business-model/pg-business-read.repository';

/**
 * S1-T4 C1 — generation orchestration invariants. NO live LLM: recomputeFromSources is MOCKED (the ONLY
 * engine entry); assembleRead is the REAL engine-free composer, wrapped in a spy to count calls. Proves the
 * pipeline order + call counts (recompute ONCE → assemble ONCE → save ONCE, nothing else), the eligibility
 * gate (zero observed → no engine call, no persist), fail-closed validation (no partial persist), S4 empty,
 * and that sparse-but-grounded Reads persist honestly.
 */
vi.mock('../../business-model/recompute', () => ({ recomputeFromSources: vi.fn() }));
vi.mock('../../business-model/read-assembler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../business-model/read-assembler')>();
  return { ...actual, assembleRead: vi.fn(actual.assembleRead) };
});

import { recomputeFromSources } from '../../business-model/recompute';
import { assembleRead } from '../../business-model/read-assembler';
import { generateBusinessRead } from '../../business-model/read-generation.service';

const NOW = new Date('2026-07-11T00:00:00Z');
const FID = 'founder-A';
const cannedResult = (): MultiSourceResult => ({ model: {} as never, persisted: 1, deduped: 0, rejected: [], observedCount: 1, enginePages: ['https://a.example'], ceilingRejected: [] });

// A grounded fixture: observed website + upload, declared direction, an inferred contradiction (Gap).
function richFragments(founderId = FID): EvidenceFragment[] {
  const obsWeb = makeFragment({ founderId, source: 'website', sourceUrl: 'https://a.example', confidenceKind: 'observed', visibility: 'public', payload: { text: 'Calm software for everyone.' }, occurredAt: new Date('2026-06-01T00:00:00Z') });
  const obsUp = makeFragment({ founderId, source: 'upload', sourceUrl: 'upload://d1', confidenceKind: 'observed', visibility: 'private', payload: { text: 'Internally we target enterprise.', sourceDocument: { filename: 'plan.pdf' } } });
  const dec = makeFragment({ founderId, source: 'founder', sourceUrl: 'conversation://declared/direction', confidenceKind: 'declared', visibility: 'public', payload: { field: 'direction', label: 'Direction', text: 'We are enterprise-first.' } });
  const inf = makeFragment({ founderId, source: 'business-model', confidenceKind: 'inferred', visibility: 'private', payload: { category: 'contradictions', statement: 'Declared enterprise vs calm-for-everyone diverge.' }, derivedFrom: [dec.id, obsWeb.id] });
  return [obsWeb, obsUp, dec, inf];
}

// A fake repo set; each test tunes findObserved / findByFounder. reads.save/findById echo a StoredRead.
function harness(observed: EvidenceFragment[], all: EvidenceFragment[]) {
  const saved: StoredRead[] = [];
  const evidence = { findObserved: vi.fn(async () => observed), findByFounder: vi.fn(async () => all) };
  const recRepo = { load: vi.fn(async () => []) };
  const reads = {
    save: vi.fn(async (read: never) => { const s: StoredRead = { readId: 'rid-1', founderId: FID, schemaVersion: 1, createdAt: NOW, contentHash: 'h', read: read as never }; saved.push(s); return { readId: s.readId, createdAt: s.createdAt }; }),
    findById: vi.fn(async () => saved[0] ?? null),
  };
  return { evidence, recRepo, reads, saved };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (h: ReturnType<typeof harness>) => generateBusinessRead({ founderId: FID, evidence: h.evidence as any, reads: h.reads as any, recRepo: h.recRepo as any, anthropicApiKey: 'k', now: NOW });

beforeEach(() => { vi.mocked(recomputeFromSources).mockReset().mockResolvedValue(cannedResult()); vi.mocked(assembleRead).mockClear(); });

describe('generateBusinessRead — pipeline invariants', () => {
  it('happy path: recompute ONCE → reload → assemble ONCE → save ONCE; returns the stored snapshot', async () => {
    const frags = richFragments();
    const h = harness([frags[0]!, frags[1]!], frags);
    const outcome = await run(h);
    expect(recomputeFromSources).toHaveBeenCalledTimes(1);           // the ONE sanctioned engine call
    expect(assembleRead).toHaveBeenCalledTimes(1);                    // composed once, engine-free
    expect(h.reads.save).toHaveBeenCalledTimes(1);                    // persisted once (last action)
    expect(h.evidence.findByFounder).toHaveBeenCalledTimes(1);       // reloaded after recompute
    expect(outcome.status).toBe('generated');
    if (outcome.status === 'generated') expect(outcome.stored.readId).toBe('rid-1');
  });

  it('recompute is the ONLY engine entry — no second recompute, assemble called exactly once', async () => {
    const frags = richFragments();
    await run(harness([frags[0]!], frags));
    expect(recomputeFromSources).toHaveBeenCalledTimes(1);
    expect(assembleRead).toHaveBeenCalledTimes(1);
  });

  it('zero observed → insufficient_evidence: NO engine call, NO persist', async () => {
    const h = harness([], []); // findObserved → []
    const outcome = await run(h);
    expect(outcome.status).toBe('insufficient_evidence');
    expect(recomputeFromSources).not.toHaveBeenCalled();
    expect(h.reads.save).not.toHaveBeenCalled();
    if (outcome.status === 'insufficient_evidence') { expect(outcome.reason).toBeTruthy(); expect(outcome.whatToDo).toBeTruthy(); }
  });

  it('validation failure → THROWS, NO persist (no partial snapshot)', async () => {
    const frags = richFragments();
    const h = harness([frags[0]!], frags);
    // force a malformed Read (empty sections → section-order invalid)
    vi.mocked(assembleRead).mockReturnValueOnce({ founderId: FID, sections: [], assembledAt: NOW.toISOString() } as never);
    await expect(run(h)).rejects.toThrow(/section order/i);
    expect(h.reads.save).not.toHaveBeenCalled();
  });

  it('generated Read has S4 (bets) empty and the fixed 6-section order', async () => {
    const frags = richFragments();
    const h = harness([frags[0]!, frags[1]!], frags);
    await run(h);
    const readArg = vi.mocked(h.reads.save).mock.calls[0]![0] as never as { sections: { id: string; empty: boolean; claims?: unknown[] }[] };
    expect(readArg.sections.map((s) => s.id)).toEqual(['what_i_read', 'what_i_observe', 'gaps', 'bets', 'my_read', 'cannot_see']);
    const bets = readArg.sections.find((s) => s.id === 'bets')!;
    expect(bets.empty).toBe(true);
    expect(bets.claims).toEqual([]);
  });

  it('sparse-but-grounded (observed present, no Gaps/recs) still persists honestly', async () => {
    // one observed website fragment, no declared/inferred → S1+S2 present, S3/S5 empty, S6 limits
    const obs = makeFragment({ founderId: FID, source: 'website', sourceUrl: 'https://a.example', confidenceKind: 'observed', visibility: 'public', payload: { text: 'We build things.' } });
    const h = harness([obs], [obs]);
    const outcome = await run(h);
    expect(outcome.status).toBe('generated');
    expect(h.reads.save).toHaveBeenCalledTimes(1);
  });

  it('receipts-missing (observed with empty text) → S2 drops it but Read still persists (S1 manifest present)', async () => {
    const blank = makeFragment({ founderId: FID, source: 'website', sourceUrl: 'https://a.example', confidenceKind: 'observed', visibility: 'public', payload: { text: '' } });
    const h = harness([blank], [blank]);
    const outcome = await run(h);
    expect(outcome.status).toBe('generated'); // sparse, not an error
    const readArg = vi.mocked(h.reads.save).mock.calls[0]![0] as never as { sections: { id: string; empty: boolean }[] };
    expect(readArg.sections.find((s) => s.id === 'what_i_observe')!.empty).toBe(true);  // no receipt → dropped
    expect(readArg.sections.find((s) => s.id === 'what_i_read')!.empty).toBe(false);    // manifest still counts it
  });

  it('deterministic pre-persist metadata — the assembled Read stamps the injected now', async () => {
    const frags = richFragments();
    const h = harness([frags[0]!], frags);
    await run(h);
    const readArg = vi.mocked(h.reads.save).mock.calls[0]![0] as never as { assembledAt: string };
    expect(readArg.assembledAt).toBe(NOW.toISOString());
  });
});
