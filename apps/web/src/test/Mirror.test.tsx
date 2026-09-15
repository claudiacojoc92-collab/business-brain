import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { MirrorView as MirrorData } from '../api/client';

// THE MIRROR — three lanes + contrast with BOTH sides cited + correction. Non-accusatory, calm, honest.
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('../api/client', () => ({ getMirror: vi.fn(), correctMirror: vi.fn() }));

import * as api from '../api/client';
import { MirrorView } from '../slice0/MirrorView';

const withContrast: MirrorData = {
  observed: [{ label: 'Your positioning', statement: 'Six service categories promoted equally', provenance: 'observed' }],
  business: [{ label: 'Your goal', statement: 'Grow the medical/recovery side', provenance: 'declared' }],
  self: [{ label: 'In your words', statement: 'I avoid direct sales conversations', provenance: 'declared' }],
  contrasts: [{
    founderWords: 'You said the medical/recovery side is your priority',
    founderLane: 'business',
    against: 'Your website promotes six service categories equally',
    againstLane: 'observed',
    tension: 'You named a priority your site doesn’t yet reflect.',
  }],
  hasSelf: true,
};
const noContrast: MirrorData = { ...withContrast, contrasts: [] };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('MirrorView', () => {
  it('renders three lanes and a contrast that cites BOTH sides + a calm tension', async () => {
    vi.mocked(api.getMirror).mockResolvedValue(withContrast as never);
    render(<MirrorView businessId="b1" onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('mirror.contrast.k')).toBeInTheDocument());
    // both cited sides + the tension are present
    expect(screen.getByText(/medical\/recovery side is your priority/)).toBeInTheDocument();       // founder's words
    expect(screen.getByText(/promotes six service categories equally/)).toBeInTheDocument();        // observed evidence
    expect(screen.getByText(/priority your site doesn’t yet reflect/)).toBeInTheDocument();          // the calm tension
    // both lane tags shown (the two sides are labelled, not accusatory)
    expect(screen.getByText('mirror.tag.business')).toBeInTheDocument();
    expect(screen.getByText('mirror.tag.observed')).toBeInTheDocument();
  });

  it('an empty contrast is calm and honest — never fabricated', async () => {
    vi.mocked(api.getMirror).mockResolvedValue(noContrast as never);
    render(<MirrorView businessId="b1" onConfirm={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('mirror.contrast.none')).toBeInTheDocument());
    expect(screen.queryByText('mirror.correct.open')).toBeNull();
  });

  it('correcting a contrast persists via correctMirror and recomputes the mirror', async () => {
    vi.mocked(api.getMirror).mockResolvedValue(withContrast as never);
    vi.mocked(api.correctMirror).mockResolvedValue(noContrast as never);
    render(<MirrorView businessId="b1" onConfirm={vi.fn()} />);
    fireEvent.click(await screen.findByText('mirror.correct.open'));
    fireEvent.change(screen.getByPlaceholderText('mirror.correct.ph'), { target: { value: 'The recovery side IS front and center on the new homepage.' } });
    fireEvent.click(screen.getByText('mirror.correct.save'));
    await waitFor(() => expect(api.correctMirror).toHaveBeenCalledWith('b1', 'mirror:business', 'The recovery side IS front and center on the new homepage.'));
    // after correction the contrast is gone → the calm empty state shows (mirror recomputed)
    expect(await screen.findByText('mirror.contrast.none')).toBeInTheDocument();
  });
});
