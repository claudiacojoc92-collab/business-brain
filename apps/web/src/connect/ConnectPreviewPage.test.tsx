import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectPreviewPage } from './ConnectPreviewPage';

/**
 * S0-T5 — the reflection pass-through leak is closed on the RENDERED DOM. Inferred lines carry the internal
 * category enum in `label`; the page must render the founder vocabulary ("Gap" for tensions, "Inferred
 * read" for the positive/forward categories) — never a raw enum — while observed lines keep their
 * descriptive labels. Drives the demo through its timed phases with fake timers.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ConnectPreviewPage — reflection vocabulary', () => {
  it('maps inferred category enums to founder labels and never leaks a raw enum', async () => {
    render(<ConnectPreviewPage />);
    // start the basecamp (synced) demo case
    fireEvent.click(screen.getByText(/basecamp · basecamp\.com/));
    // advance through reading → beat1 → deepening → beat2 → ended
    await act(async () => { vi.advanceTimersByTime(13000); });

    const text = document.body.textContent ?? '';
    // tensions → "Gap"; the positive inferred category → "Inferred read" (NOT "Gap")
    expect(screen.getAllByText('Gap').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Inferred read')).toBeInTheDocument();
    // observed beat-1 labels keep their descriptive form
    expect(text).toContain('Positioning');
    expect(text).toContain('Offer');
    // the raw internal enums NEVER reach the founder
    for (const enumVal of ['contradictions', 'blindSpots', 'hiddenStrengths', 'hiddenWeaknesses', 'positioningOpportunities']) {
      expect(text, `no raw enum ${enumVal}`).not.toContain(enumVal);
    }
    // the observed/inferred distinction is preserved (both beats render)
    expect(text).toContain('what I can already see'); // beat-1 lead (observed)
    expect(text).toContain('starting to see underneath'); // beat-2 kicker (inferred)
  });
});
