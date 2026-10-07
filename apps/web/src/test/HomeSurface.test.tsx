import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { HomeBriefing } from '../api/client';

// The home delegates to the ArcSurface while the Day One arc is in progress; once the arc is `done`, it
// becomes the standing strategist briefing (message + three actions + always-present input, tab-free).
const navigate = vi.fn();
const openTalk = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k), locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children, home }: { children: React.ReactNode; home?: boolean }) => <div data-home={home ? 'yes' : 'no'}>{children}</div> }));
vi.mock('../slice0/TalkDrawer', () => ({ useTalk: () => ({ open: openTalk, close: vi.fn(), isOpen: false }) }));
vi.mock('../slice0/ArcSurface', () => ({ ArcSurface: () => <div data-arc="yes">arc</div> }));
vi.mock('../api/client', () => ({ getArc: vi.fn(), getHomeBriefing: vi.fn() }));

import * as api from '../api/client';
import { HomePage } from '../slice0/HomePage';

const briefing: HomeBriefing = {
  phase: 'briefing',
  context: { name: 'Body Move', day: 3, bet: 'the referral channel' },
  lines: [{ key: 'home.line.bet', vars: { bet: 'the referral channel' } }, { key: 'home.line.ask' }],
  actions: [{ kind: 'do', labelKey: 'home.act.draft', to: '/create' }, { kind: 'talk', labelKey: 'home.act.talk', to: null }, { kind: 'why', labelKey: 'home.act.why', to: '/today' }],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('HomePage — arc delegation + standing briefing', () => {
  it('while the arc is in progress, the surface IS the arc (no briefing)', async () => {
    vi.mocked(api.getArc).mockResolvedValue({ moment: 'pour_in', businessName: 'Body Move', sources: [] } as never);
    render(<HomePage />);
    await waitFor(() => expect(document.querySelector('[data-arc="yes"]')).toBeTruthy());
    expect(api.getHomeBriefing).not.toHaveBeenCalled();       // arc owns the surface; briefing not fetched
  });

  it('once the arc is done, the standing briefing renders — message, three actions, tab-free, input', async () => {
    vi.mocked(api.getArc).mockResolvedValue({ moment: 'done', businessName: 'Body Move' } as never);
    vi.mocked(api.getHomeBriefing).mockResolvedValue(briefing);
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText(/home\.line\.bet/)).toBeInTheDocument());
    expect(screen.getByText('home.act.draft →')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('home.input.ph')).toBeInTheDocument();
    expect(document.querySelector('[data-home="yes"]')).toBeTruthy();
  });

  it('the done-briefing do-action navigates to the surface behind it', async () => {
    vi.mocked(api.getArc).mockResolvedValue({ moment: 'done', businessName: 'Body Move' } as never);
    vi.mocked(api.getHomeBriefing).mockResolvedValue(briefing);
    render(<HomePage />);
    fireEvent.click(await screen.findByText('home.act.draft →'));
    expect(navigate).toHaveBeenCalledWith('/b/b1/create');
  });
});
