import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryPreviewPage } from './MemoryPreviewPage';

/**
 * S0-T5 — the what-matters pass-through leak is closed on the RENDERED DOM. The API still returns the raw
 * enum in `category`; the page must render "Gap" (via founderCategory) and the "gap" chrome — never the
 * raw enum, never "tension". (Declared/Calendar share the identical render, so this covers all three.)
 */
const STATE = {
  whatMattersNow: [
    { rank: 1, tensionId: 't1', category: 'contradictions', statement: 'Your pricing and your audience pull apart.', stakes: 'high', declaredFragmentIds: [], observedFragmentIds: [] },
    { rank: 2, tensionId: 't2', category: 'blindSpots', statement: 'A win-back cohort you neither mine nor market.', stakes: 'medium', declaredFragmentIds: [], observedFragmentIds: [] },
    { rank: 3, tensionId: 't3', category: 'hiddenWeaknesses', statement: 'Your stability story filters out growth teams.', stakes: 'medium', declaredFragmentIds: [], observedFragmentIds: [] },
  ],
  followUp: null,
};

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => STATE }) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('MemoryPreviewPage — founder vocabulary', () => {
  it('renders "Gap" for each tension category and never the raw enum or "tension"', async () => {
    render(<MemoryPreviewPage />);
    await waitFor(() => expect(screen.getByText(/Highest-stakes gap/)).toBeInTheDocument());

    const text = document.body.textContent ?? '';
    // the gap chrome + mapped category are present
    expect(text).toMatch(/Highest-stakes gap/);
    expect(text).toMatch(/Gap #2/);
    expect(text).toMatch(/Gap #3/);
    expect(text).toMatch(/These are the gaps between/);
    // the raw internal enums NEVER reach the founder
    for (const enumVal of ['contradictions', 'blindSpots', 'hiddenWeaknesses']) {
      expect(text, `no raw enum ${enumVal}`).not.toContain(enumVal);
    }
    // "tension" is gone from the founder-facing chrome
    expect(text.toLowerCase(), 'no "tension" chrome').not.toContain('tension');
    // the engine's grounded statements still render (nucleus output untouched)
    expect(text).toContain('Your pricing and your audience pull apart.');
  });
});
