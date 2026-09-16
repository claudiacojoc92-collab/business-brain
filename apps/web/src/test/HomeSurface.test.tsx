import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { HomeBriefing } from '../api/client';

// Surface Correction Block 1 — the strategist home: one message, three actions, an always-present input,
// no tabs, and the "Talk to BB" escape hatch (AppShell home mode).
const navigate = vi.fn();
const openTalk = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k), locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate };
});
// AppShell mock reflects the `home` prop so we can assert tab-free home mode + escape hatch usage.
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children, home }: { children: React.ReactNode; home?: boolean }) => <div data-home={home ? 'yes' : 'no'}>{children}</div> }));
vi.mock('../slice0/TalkDrawer', () => ({ useTalk: () => ({ open: openTalk, close: vi.fn(), isOpen: false }) }));
vi.mock('../api/client', () => ({ getHomeBriefing: vi.fn(), learnBusiness: vi.fn() }));

import * as api from '../api/client';
import { HomePage } from '../slice0/HomePage';

const briefing: HomeBriefing = {
  phase: 'briefing',
  context: { name: 'Body Move', day: 3, bet: 'the referral channel' },
  lines: [
    { key: 'home.line.bet', vars: { bet: 'the referral channel' } },
    { key: 'home.line.today', vars: { move: 'Draft the clinic list' } },
    { key: 'home.line.canDraft' },
    { key: 'home.line.ask' },
  ],
  actions: [
    { kind: 'do', labelKey: 'home.act.draft', to: '/create' },
    { kind: 'talk', labelKey: 'home.act.talk', to: null },
    { kind: 'why', labelKey: 'home.act.why', to: '/today' },
  ],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('HomePage — the strategist home surface', () => {
  it('renders the context line, the message, three actions, and an always-present input — tab-free', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue(briefing);
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText(/home\.line\.bet/)).toBeInTheDocument());
    // context line composed with the founder-locale weekday + day/bet
    expect(screen.getByText(/Body Move ·/)).toBeInTheDocument();
    expect(screen.getByText(/home\.ctx\.day:3,the referral channel/)).toBeInTheDocument();
    // message lines
    expect(screen.getByText(/home\.line\.today:Draft the clinic list/)).toBeInTheDocument();
    expect(screen.getByText('home.line.ask')).toBeInTheDocument();
    // three actions, first is the "do"
    expect(screen.getByText('home.act.draft →')).toBeInTheDocument();
    expect(screen.getByText('home.act.talk')).toBeInTheDocument();
    expect(screen.getByText('home.act.why')).toBeInTheDocument();
    // always-present input
    expect(screen.getByPlaceholderText('home.input.ph')).toBeInTheDocument();
    // tab-free home mode
    expect(document.querySelector('[data-home="yes"]')).toBeTruthy();
  });

  it('the "do" action navigates to the surface behind it', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue(briefing);
    render(<HomePage />);
    fireEvent.click(await screen.findByText('home.act.draft →'));
    expect(navigate).toHaveBeenCalledWith('/b/b1/create');
  });

  it('submitting the input engages the strategist (opens Talk)', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue(briefing);
    render(<HomePage />);
    const input = await screen.findByPlaceholderText('home.input.ph');
    fireEvent.change(input, { target: { value: 'The 5-clinic data was test data.' } });
    fireEvent.click(screen.getByText('home.input.send'));
    expect(openTalk).toHaveBeenCalled();
  });

  it('first-open empty phase: headline + warmth line + connectors (website primary) + demoted words path + input', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue({ phase: 'empty', context: { name: 'Body Move', day: null, bet: null }, lines: [], actions: [] });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText('home.empty.lead')).toBeInTheDocument());
    expect(screen.getByText('home.empty.sub')).toBeInTheDocument();                       // "anything helps"
    // connectors, website first with a real field
    expect(screen.getByText('home.empty.website')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('home.empty.website.ph')).toBeInTheDocument();
    expect(screen.getByText('home.empty.ig')).toBeInTheDocument();
    expect(screen.getByText('home.empty.google')).toBeInTheDocument();
    // demoted words fallback, and the general input still present
    expect(screen.getByText('home.empty.words')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('home.input.ph')).toBeInTheDocument();
  });

  it('BUG 2: the wiring note is hidden by default and appears per-connector when one is tapped', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue({ phase: 'empty', context: { name: 'Body Move', day: null, bet: null }, lines: [], actions: [] });
    render(<HomePage />);
    await screen.findByText('home.empty.ig');
    expect(screen.queryByText('home.empty.wiring')).toBeNull();                              // hidden by default
    fireEvent.click(screen.getByText('home.empty.ig'));
    expect(screen.getAllByText('home.empty.wiring')).toHaveLength(1);                        // exactly one, under the tapped one
  });

  it('BUG 1: a real read (synced) bridges into the arc', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue({ phase: 'empty', context: { name: 'Body Move', day: null, bet: null }, lines: [], actions: [] });
    vi.mocked(api.learnBusiness).mockResolvedValue({ state: 'synced', pagesRead: 10, discovered: [], aha: { status: 'produced', findings: [] } } as never);
    render(<HomePage />);
    const field = await screen.findByPlaceholderText('home.empty.website.ph');
    fireEvent.change(field, { target: { value: 'www.bodymovestudio.ro' } });
    fireEvent.click(screen.getByText('home.empty.website.add'));
    await waitFor(() => expect(api.learnBusiness).toHaveBeenCalledWith('b1', 'www.bodymovestudio.ro'));
    expect(await screen.findByText('home.empty.bridge')).toBeInTheDocument();
  });

  it('BUG 1: a graceful failure surfaces the ENGINE\'s real reason, not a generic retry, and does NOT bridge', async () => {
    vi.mocked(api.getHomeBriefing).mockResolvedValue({ phase: 'empty', context: { name: 'Body Move', day: null, bet: null }, lines: [], actions: [] });
    vi.mocked(api.learnBusiness).mockResolvedValue({ state: 'failed', pagesRead: 0, error: 'I couldn’t reach that URL (getaddrinfo ENOTFOUND).', discovered: [], aha: { status: 'insufficient', findings: [] } } as never);
    render(<HomePage />);
    const field = await screen.findByPlaceholderText('home.empty.website.ph');
    fireEvent.change(field, { target: { value: 'not-a-real-site.invalid' } });               // an unreachable URL
    fireEvent.click(screen.getByText('home.empty.website.add'));
    expect(await screen.findByText(/couldn’t reach that URL/)).toBeInTheDocument();          // the real reason
    expect(screen.queryByText('home.empty.bridge')).toBeNull();                              // never a false success
  });
});
