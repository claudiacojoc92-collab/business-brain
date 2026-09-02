import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { VoiceSample } from '../api/client';

vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => () => {}, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), getVoice: vi.fn(), startVoiceCalibration: vi.fn(),
  reactToSample: vi.fn(), editSample: vi.fn(), getVoiceProjection: vi.fn(),
}));

import * as api from '../api/client';
import { VoicePage } from '../slice0/VoicePage';

const reel = (hook: string): VoiceSample => ({ id: 's1', sessionId: 'sess', subject: 'brand', language: 'en', market: null, channel: 'reel', speakingRole: 'brand_institutional', objective: 'proof', content: { hook, beats: ['a concrete point'], cta: 'Reply if useful' }, status: 'pending', createdAt: 't' });
const reel2 = (hook: string): VoiceSample => ({ ...reel(hook), id: 's2' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'thoughtbot' } as never);
  vi.mocked(api.getVoice).mockResolvedValue({ state: 'none' } as never);
  vi.mocked(api.startVoiceCalibration).mockResolvedValue({ sessionId: 'sess', samples: [reel('One thing I keep seeing with small teams')], calibrated: false } as never);
  vi.mocked(api.reactToSample).mockResolvedValue({ target: 'wording', sample: reel2('A calmer, more grounded opening line'), note: 'reject' } as never);
  vi.mocked(api.getVoiceProjection).mockResolvedValue({ calibrated: true, lines: ['You prefer concrete points over hype.'] } as never);
});
afterEach(cleanup);

describe('VoicePage', () => {
  it('starts calibration and renders a strategy-conditioned sample (no Plan/Assets surfaces)', async () => {
    render(<VoicePage />);
    expect(await screen.findByText('One thing I keep seeing with small teams')).toBeInTheDocument();
    expect(api.startVoiceCalibration).toHaveBeenCalledWith('b1');
    expect(screen.queryByText(/30-day|first month plan|render|carousel image|reel video|publish/i)).toBeNull();
  });

  it('a natural reaction replaces the sample with an improved one', async () => {
    render(<VoicePage />);
    await screen.findByText('One thing I keep seeing with small teams');
    fireEvent.change(screen.getByPlaceholderText('voice.react.placeholder'), { target: { value: 'too salesy' } });
    fireEvent.click(screen.getByText('voice.react.send'));
    await waitFor(() => expect(api.reactToSample).toHaveBeenCalledWith('b1', 's1', 'too salesy'));
    expect(await screen.findByText('A calmer, more grounded opening line')).toBeInTheDocument();
  });

  it('shows "What I\'ve learned about your voice" after feedback', async () => {
    render(<VoicePage />);
    await screen.findByText('One thing I keep seeing with small teams');
    fireEvent.change(screen.getByPlaceholderText('voice.react.placeholder'), { target: { value: 'too direct' } });
    fireEvent.click(screen.getByText('voice.react.send'));
    expect(await screen.findByText('You prefer concrete points over hype.')).toBeInTheDocument();
  });
});
