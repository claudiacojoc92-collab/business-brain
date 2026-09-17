import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ArcView } from '../api/client';

// Day One — the arc surface: each moment's message renders; one surface, no tabs/panels; the pour-in
// persists (sources come from the server view = survive refresh); no strategy appears before Moments 3 & 4.
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k), locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../api/client', () => ({
  getArc: vi.fn(), arcAddSource: vi.fn(), arcAddLink: vi.fn(), arcAddInstagram: vi.fn(), arcAddFile: vi.fn(),
  getInstagramConnectUrl: vi.fn(), arcPourInDone: vi.fn(), arcReading: vi.fn(), arcConversation: vi.fn(),
  arcConfirmUnderstanding: vi.fn(), arcMirrorSeen: vi.fn(), arcAdoptStrategy: vi.fn(), arcChallengeStrategy: vi.fn(),
  arcAdoptWeekDay: vi.fn(), arcGenerateEmail: vi.fn(), arcSaveEmail: vi.fn(), arcExportEmail: vi.fn(), arcContainerSeen: vi.fn(),
}));

import * as api from '../api/client';
import { ArcSurface } from '../slice0/ArcSurface';

const v = (over: Partial<ArcView>): ArcView => ({ moment: 'pour_in', businessName: 'Body Move', ...over } as ArcView);
const noTabs = () => { expect(document.querySelector('.s0-nav')).toBeNull(); expect(document.querySelector('.s0-tabbar')).toBeNull(); };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ArcSurface — one surface, nine moments', () => {
  it('Moment 1: pour-in lists persisted typed sources (survives refresh) + Done; no tabs', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'www.bodymovestudio.ro', type: 'website' }, { url: 'brochure.pdf', type: 'pdf' }] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('www.bodymovestudio.ro')).toBeInTheDocument();  // durable source shown
    expect(screen.getByText('brochure.pdf')).toBeInTheDocument();
    expect(screen.getByText('home.empty.type.website')).toBeInTheDocument();       // typed tag
    expect(screen.getByText('home.empty.type.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('home.empty.added')).toHaveLength(2);
    expect(screen.getByText('home.empty.done')).toBeInTheDocument();               // Done adding present (sources are in)
    noTabs();
  });

  it('Moment 1: every connector is a REAL affordance — no NEXT pills, no "coming soon" stubs (regression)', async () => {
    // Regression guard against the amputated pour-in: website, paste-a-link, file upload, and Instagram are all
    // functional; there is NO "Next" pill and NO "wiring up" note; unbuilt connectors (Google) are not shown.
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [], igConnected: false }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('home.empty.website')).toBeInTheDocument();
    expect(screen.getByText('home.empty.link')).toBeInTheDocument();
    expect(screen.getByText('home.empty.upload')).toBeInTheDocument();
    expect(screen.getByText('home.empty.ig.connect')).toBeInTheDocument();          // not connected → connect affordance
    expect(screen.queryByText('home.empty.soon')).toBeNull();                       // no "Next" pill anywhere
    expect(screen.queryByText('home.empty.wiring')).toBeNull();                     // no "coming soon" note
    expect(screen.queryByText('home.empty.google')).toBeNull();                     // unbuilt connector is hidden, not stubbed
  });

  it('Moment 1: once Instagram is connected, the founder can read it in (Add my Instagram)', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [], igConnected: true }));
    vi.mocked(api.arcAddInstagram).mockResolvedValue({ state: 'synced' });
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const add = await screen.findByText('home.empty.ig.add');
    expect(screen.queryByText('home.empty.ig.connect')).toBeNull();
    fireEvent.click(add);
    await waitFor(() => expect(api.arcAddInstagram).toHaveBeenCalledWith('b1'));
  });

  it('Moment 2: reading asks for a few words', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'reading', turns: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.reading')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('arc.reading.ph')).toBeInTheDocument();
  });

  it('Moment 3: understanding speaks what BB saw, with confident + unsure — and NO strategy yet', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: { does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led', confident: ['Referrals drive members'], unsure: ['corporate partnerships?'] } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('Physio memberships')).toBeInTheDocument();
    expect(screen.getByText('Referrals drive members')).toBeInTheDocument();
    expect(screen.getByText('corporate partnerships?')).toBeInTheDocument();
    expect(screen.getByText('arc.understanding.confirm →')).toBeInTheDocument();
    expect(screen.queryByText('arc.strategy.adopt →')).toBeNull();                 // no "See the strategy" before Moment 3/4
  });

  it('Moment 4: conversation shows BB\'s question + input — still no strategy', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'conversation', turns: [{ id: 't1', role: 'bb', content: 'What have you tried and stopped?' }] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('What have you tried and stopped?')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('arc.conversation.ph')).toBeInTheDocument();
    expect(screen.queryByText('arc.strategy.adopt →')).toBeNull();
  });

  it('Moment 5: mirror shows the contrast (both sides cited) + the question', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'mirror', mirror: { founderWords: 'recovery is the priority', against: 'six categories equally', tension: 'a priority your site doesn’t reflect' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/recovery is the priority/)).toBeInTheDocument();
    expect(screen.getByText(/six categories equally/)).toBeInTheDocument();
    expect(screen.getByText('arc.mirror.which')).toBeInTheDocument();
  });

  it('Moment 6: strategy shows the bet + reconsider; Adopt drives the engine', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'strategy', strategy: { bet: 'referrals', over: 'a general campaign', horizon: '6 months', reconsider: ['if fewer than 2 of 8–10 show interest'], proposalId: 'ver1', adoptable: true } }));
    vi.mocked(api.arcAdoptStrategy).mockResolvedValue(v({ moment: 'week_day', weekDay: { week: [], today: null, canCreate: false } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.strategy.bet:referrals,a general campaign')).toBeInTheDocument();
    expect(screen.getByText('if fewer than 2 of 8–10 show interest')).toBeInTheDocument();
    fireEvent.click(screen.getByText('arc.strategy.adopt →'));
    await waitFor(() => expect(api.arcAdoptStrategy).toHaveBeenCalledWith('b1', 'ver1'));
  });

  it('Moment 7: week and day names the week + today', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'week_day', weekDay: { week: ['Build the clinic list', 'First outreach'], today: 'Draft the clinic target list', canCreate: false } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('Build the clinic list')).toBeInTheDocument();
    expect(screen.getByText('Draft the clinic target list')).toBeInTheDocument();
    expect(screen.getByText('arc.week.draft →')).toBeInTheDocument();
  });

  it('Moment 8: email is editable and exportable', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'email', email: { subject: 'About Body Move', body: 'Hi there,' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect((await screen.findByDisplayValue('About Body Move')).tagName).toBe('INPUT');
    expect(screen.getByDisplayValue('Hi there,')).toBeInTheDocument();
    expect(screen.getByText('arc.email.export →')).toBeInTheDocument();
  });

  it('Moment 9: container offers, then reveals read-only items with provenance', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'container', container: { items: [{ label: 'Offer', statement: 'Physio memberships', provenance: 'observed' }, { label: 'Still unknown', statement: 'corporate?', provenance: 'unknown' }] } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    fireEvent.click(await screen.findByText('arc.container.show →'));
    expect(screen.getByText('Physio memberships')).toBeInTheDocument();
    expect(screen.getByText('arc.prov.observed')).toBeInTheDocument();
    expect(screen.getByText('arc.prov.unknown')).toBeInTheDocument();
  });

  it('when the arc is done, it hands off (onDone) rather than rendering a moment', async () => {
    const onDone = vi.fn();
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'done' }));
    render(<ArcSurface businessId="b1" onDone={onDone} />);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
