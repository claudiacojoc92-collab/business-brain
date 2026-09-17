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
  arcConfirmUnderstanding: vi.fn(), arcCorrectUnderstanding: vi.fn(), arcMirrorSeen: vi.fn(), arcAdoptStrategy: vi.fn(), arcChallengeStrategy: vi.fn(),
  arcAdoptWeekDay: vi.fn(), arcGenerateEmail: vi.fn(), arcSaveEmail: vi.fn(), arcExportEmail: vi.fn(), arcContainerSeen: vi.fn(),
}));

import * as api from '../api/client';
import { ArcSurface } from '../slice0/ArcSurface';

const v = (over: Partial<ArcView>): ArcView => ({ moment: 'pour_in', businessName: 'Body Move', ...over } as ArcView);
const noTabs = () => { expect(document.querySelector('.s0-nav')).toBeNull(); expect(document.querySelector('.s0-tabbar')).toBeNull(); };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ArcSurface — one surface, nine moments', () => {
  it('Moment 1: each added source shows prominently IN its connector card (url + confirmation), survives refresh; Done; no tabs', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'www.bodymovestudio.ro', type: 'website', detail: '10 pages read' }, { url: 'brochure.pdf', type: 'pdf', detail: '4 pages read' }] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // The added source (url) is shown, with a prominent per-card confirmation — not a tiny row below.
    expect(await screen.findByText('www.bodymovestudio.ro')).toBeInTheDocument();
    expect(screen.getByText('brochure.pdf')).toBeInTheDocument();
    expect(screen.getByText(/10 pages read/)).toBeInTheDocument();                 // confirmation detail, in-card
    expect(screen.getByText(/4 pages read/)).toBeInTheDocument();
    expect(screen.getByText('home.empty.done')).toBeInTheDocument();               // Done adding present (sources are in)
    noTabs();
  });

  it('Moment 1: exactly three real connectors — website, paste-a-link, upload; Instagram is HIDDEN; no NEXT/stubs', async () => {
    // Post-decision: Instagram is hidden until after MVP validation. The pour-in shows ONLY the three working,
    // no-OAuth connectors — each a real affordance, no "Next" pill, no "coming soon", no Instagram entry point.
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('home.empty.website')).toBeInTheDocument();
    expect(screen.getByText('home.empty.link')).toBeInTheDocument();
    expect(screen.getByText('home.empty.upload')).toBeInTheDocument();
    expect(screen.queryByText('home.empty.ig')).toBeNull();                          // Instagram hidden entirely
    expect(screen.queryByText('home.empty.ig.connect')).toBeNull();
    expect(screen.queryByText('home.empty.ig.add')).toBeNull();
    expect(screen.queryByText('home.empty.soon')).toBeNull();                        // no "Next" pill anywhere
    expect(screen.queryByText('home.empty.wiring')).toBeNull();                      // no "coming soon" note
    expect(screen.queryByText('home.empty.google')).toBeNull();                      // unbuilt connectors hidden, not stubbed
  });

  it('Moment 1: selecting several files uploads each as its own source (multi-file, one action)', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [] }));
    vi.mocked(api.arcAddFile).mockResolvedValue({ state: 'synced' });
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    await screen.findByText('home.empty.upload');
    const input = document.getElementById('s0-pourin-file') as HTMLInputElement;
    const f1 = new File(['brochure text'], 'brochure.pdf', { type: 'application/pdf' });
    const f2 = new File(['offer text'], 'offer.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    fireEvent.change(input, { target: { files: [f1, f2] } });
    await waitFor(() => expect(api.arcAddFile).toHaveBeenCalledTimes(2)); // one request per file, from one selection
    expect(api.arcAddFile).toHaveBeenCalledWith('b1', f1);
    expect(api.arcAddFile).toHaveBeenCalledWith('b1', f2);
  });

  it('Moment 2: reading asks for a few words', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'reading', turns: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.reading')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('arc.reading.ph')).toBeInTheDocument();
  });

  it('Moment 2: the bridge input keeps focus across keystrokes — the SAME node persists (no remount) [regression]', async () => {
    // Regression guard for the focus-loss bug: the input components must be hoisted OUT of ArcSurface, or each
    // keystroke (setText → re-render) remounts the <textarea>, replacing the DOM node and dropping focus.
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'reading', turns: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const ta = await screen.findByPlaceholderText('arc.reading.ph') as HTMLTextAreaElement;
    ta.focus();
    expect(document.activeElement).toBe(ta);
    fireEvent.change(ta, { target: { value: 'H' } });
    expect(screen.getByPlaceholderText('arc.reading.ph')).toBe(ta);   // identical DOM node — not remounted
    expect(document.activeElement).toBe(ta);                          // focus retained after the first keystroke
    fireEvent.change(ta, { target: { value: 'He' } });
    fireEvent.change(ta, { target: { value: 'Hel' } });
    const still = screen.getByPlaceholderText('arc.reading.ph') as HTMLTextAreaElement;
    expect(still).toBe(ta);                                            // still the same node after several keystrokes
    expect(still.value).toBe('Hel');
    expect(document.activeElement).toBe(ta);
  });

  it('Moment 3: understanding is DIAGNOSTIC — tensions, confident vs inferring, unanswered; NO strategy yet', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: {
      does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led',
      tensions: ['Six categories shown equally, but kinetotherapy is far more detailed'],
      confident: ['Referrals drive members'], inferring: ['Aimed at athletes, not just patients'],
      unanswered: ['What do customers actually value most?'],
    } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/Physio memberships/)).toBeInTheDocument();
    expect(screen.getByText('arc.understanding.tensions')).toBeInTheDocument();     // the diagnostic section is present
    expect(screen.getByText('Six categories shown equally, but kinetotherapy is far more detailed')).toBeInTheDocument();
    expect(screen.getByText('Referrals drive members')).toBeInTheDocument();        // confident (from evidence)
    expect(screen.getByText('Aimed at athletes, not just patients')).toBeInTheDocument(); // inferring (from pattern)
    expect(screen.getByText('What do customers actually value most?')).toBeInTheDocument(); // unanswered
    expect(screen.getByText('arc.understanding.confirm →')).toBeInTheDocument();
    expect(screen.queryByText('arc.strategy.adopt →')).toBeNull();                 // no strategy before Moment 3/4
  });

  it('Moment 3: a correction gets a SUBSTANTIVE grounded reply (reflection/changes/holds/ask), not "✓ Got it"', async () => {
    const u = { does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led', tensions: [], confident: [], inferring: [], unanswered: [] };
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: u }));
    vi.mocked(api.arcCorrectUnderstanding).mockResolvedValue(v({
      moment: 'understanding', understanding: u,
      correctionReflection: {
        reflection: 'Noted — Schroth Therapy is more central than the site suggests.',
        changes: 'That changes what I think you should lead with.',
        holds: 'It doesn’t change the referral direction — that holds.',
        ask: 'What else should I know that the site can’t show?',
      },
    }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const ta = await screen.findByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'Schroth Therapy is central.' } });
    fireEvent.click(screen.getByText('arc.send'));
    await waitFor(() => expect(api.arcCorrectUnderstanding).toHaveBeenCalledWith('b1', 'Schroth Therapy is central.'));
    expect(api.arcConversation).not.toHaveBeenCalled();                                   // not via the conversation engine
    expect(await screen.findByText(/Schroth Therapy is more central/)).toBeInTheDocument(); // substantive reflection
    expect(screen.getByText(/what I think you should lead with/)).toBeInTheDocument();     // what changes
    expect(screen.getByText(/referral direction — that holds/)).toBeInTheDocument();       // what holds
    expect(screen.getByText(/What else should I know/)).toBeInTheDocument();               // the ask
    expect(screen.queryByText('arc.noted')).toBeNull();                                    // NOT the tiny generic ack
    expect((screen.getByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement).value).toBe(''); // field cleared
  });

  it('a send that fails surfaces an error and KEEPS the founder\'s text — never a silent no-op [regression]', async () => {
    const u = { does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led', tensions: [], confident: [], inferring: [], unanswered: [] };
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: u }));
    vi.mocked(api.arcCorrectUnderstanding).mockRejectedValue(new Error('boom'));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const ta = await screen.findByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'my correction' } });
    fireEvent.click(screen.getByText('arc.send'));
    expect(await screen.findByText('arc.senderror')).toBeInTheDocument();     // error surfaced, not swallowed
    expect((screen.getByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement).value).toBe('my correction'); // text kept
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

  it('Moment 8: the email body keeps focus across keystrokes (EmailMoment is module-level) [regression]', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'email', email: { subject: 'About Body Move', body: 'Hi there,' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const body = await screen.findByDisplayValue('Hi there,') as HTMLTextAreaElement;
    body.focus();
    expect(document.activeElement).toBe(body);
    fireEvent.change(body, { target: { value: 'Hi there, Ana' } });
    const still = screen.getByDisplayValue('Hi there, Ana') as HTMLTextAreaElement;
    expect(still).toBe(body);                       // same node — not remounted
    expect(document.activeElement).toBe(body);      // focus retained
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
