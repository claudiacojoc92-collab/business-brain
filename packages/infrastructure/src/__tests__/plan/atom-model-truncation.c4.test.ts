/* eslint-disable @typescript-eslint/no-explicit-any */
// C4 live finding (2026-10-07): on a 38-atom site the atom model's output overflowed its token budget, the JSON was
// cut off, and the old catch returned "no atoms", so the planner was intermittently told BB held nothing. A broken
// response must now THROW (the service then keeps the last good atoms) and never read as an empty business.
import { describe, it, expect, vi } from 'vitest';

const create = vi.fn();
vi.mock('../../llm/anthropic-client', () => ({ createAnthropicClient: () => ({ messages: { create } }) }));

import { AnthropicAtomModel } from '../../business-intelligence/anthropic-atom.model';
import { AtomExtractionService } from '@bb/application';

const UNITS = { units: [{ sourceRef: 'home', sourceUrl: 'https://x.test/', pageType: 'home', text: 'Kinetoterapie. Masaj.' }] };
const text = (t: string, stop = 'end_turn') => ({ stop_reason: stop, content: [{ type: 'text', text: t }] });

describe('atom model — a broken response is loud, never "no atoms"', () => {
  it('throws when the output was cut off at the token limit', async () => {
    create.mockResolvedValueOnce(text('{"atoms":[{"atomClass":"service","value":"Kinet', 'max_tokens'));
    await expect(new AnthropicAtomModel('k').extract(UNITS)).rejects.toThrow('ATOMS_TRUNCATED');
  });

  it('throws on malformed JSON instead of returning an empty list', async () => {
    create.mockResolvedValueOnce(text('{"atoms":[{"atomClass":'));
    await expect(new AnthropicAtomModel('k').extract(UNITS)).rejects.toThrow();
  });

  it('still parses a complete response', async () => {
    create.mockResolvedValueOnce(text('{"atoms":[{"atomClass":"service","value":"Kinetoterapie","sourceRef":"home"}]}'));
    expect((await new AnthropicAtomModel('k').extract(UNITS)).atoms).toHaveLength(1);
  });

  it('the service keeps the last good atoms when the model throws (the planner is not told "nothing held")', async () => {
    const kept = [{ id: 'a1', businessId: 'b', atomClass: 'service', value: 'Kinetoterapie' }] as any;
    const log = vi.fn();
    const svc = new AtomExtractionService({
      links: { listFragmentIds: async () => ['home'] } as any,
      evidence: { findByIds: async () => [{ id: 'home', sourceUrl: 'https://x.test/', payload: { ref: 'home', text: 'Kinetoterapie. Masaj.' } }] } as any,
      model: { extract: async () => { throw new Error('ATOMS_TRUNCATED'); } },
      repo: { latestFingerprint: async () => 'stale', listAtoms: async () => kept, replaceForBusiness: vi.fn() } as any,
      log,
    });
    expect(await svc.facts('b')).toBe(kept);
    expect(log).toHaveBeenCalledWith({ type: 'atoms_extract_threw' });
  });
});
