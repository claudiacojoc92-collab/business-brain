import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// The voice→create seam: an approved reel/carousel concept exposes "Create this", and a carousel concept
// mints a strategy-traced handoff via createFromConcept then navigates into the real carousel flow.

const navigate = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/errors', () => ({ isNotFound: () => false, LoadError: () => <div>load error</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), getVoice: vi.fn(), startVoiceCalibration: vi.fn(),
  reactToSample: vi.fn(), editSample: vi.fn(), getVoiceProjection: vi.fn(), createFromConcept: vi.fn(),
}));

import * as api from '../api/client';
import { VoicePage } from '../slice0/VoicePage';

const sample = (channel: string, id: string) => ({
  id, sessionId: 's1', subject: 'brand', language: 'en', market: null, channel, speakingRole: 'brand_institutional',
  objective: `a ${channel} on the client-outcome proof`, content: { hook: 'Proof beats promises', beats: ['b1', 'b2'], cta: 'See it' }, status: 'pending', createdAt: 't',
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.getVoice).mockResolvedValue({ state: 'active', sessionId: 's1', calibrated: false, samples: [sample('reel', 'r1'), sample('carousel', 'c1')], projection: { calibrated: false, lines: [] } } as never);
  vi.mocked(api.createFromConcept).mockResolvedValue({ state: 'ready_for_create', createHandoffId: 'h9', format: 'carousel' } as never);
});
afterEach(cleanup);

describe('VoicePage — approved concept → Create', () => {
  it('shows "Create this" on both createable (reel + carousel) concepts', async () => {
    render(<VoicePage />);
    await waitFor(() => expect(screen.getAllByText(/voice\.createthis/).length).toBe(2));
  });

  it('a carousel concept mints a strategy-traced handoff and routes into the carousel flow', async () => {
    render(<VoicePage />);
    const buttons = await screen.findAllByText(/voice\.createthis/);
    // the second card is the carousel concept
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(api.createFromConcept).toHaveBeenCalledWith('b1', expect.objectContaining({ objective: expect.stringContaining('carousel'), format: 'carousel' })));
    expect(navigate).toHaveBeenCalledWith('/b/b1/create/h9');
  });

  it('a reel concept routes into the real Reel flow (no fake preview)', async () => {
    render(<VoicePage />);
    const buttons = await screen.findAllByText(/voice\.createthis/);
    fireEvent.click(buttons[0]!); // reel card
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/b/b1/reel/shoot'));
    expect(api.createFromConcept).not.toHaveBeenCalled(); // reel doesn't use a carousel handoff
  });
});
