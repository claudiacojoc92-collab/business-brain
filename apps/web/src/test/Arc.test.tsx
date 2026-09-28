import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { ArcView } from '../api/client';

// Day One — the arc surface: each moment's message renders; one surface, no tabs/panels; the pour-in
// persists (sources come from the server view = survive refresh); no strategy appears before Moments 3 & 4.
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k), locale: 'en' }) }));
// The arc localizes chrome to the CONTENT language via translate(); here we keep it identity (assert keys),
// isLocale stays real. Content-language behavior is covered separately in ArcChromeLanguage.test.tsx.
vi.mock('../i18n/messages', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, translate: (_loc: string, k: string, val?: Record<string, string>) => (val ? `${k}:${Object.values(val).join(',')}` : k) };
});
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../api/client', () => ({
  getArc: vi.fn(), arcAddSource: vi.fn(), arcAddLink: vi.fn(), arcAddInstagram: vi.fn(), arcAddFile: vi.fn(),
  getInstagramConnectUrl: vi.fn(), arcPourInDone: vi.fn(), arcConversation: vi.fn(),
  arcConfirmUnderstanding: vi.fn(), arcCorrectUnderstanding: vi.fn(), arcMirrorSeen: vi.fn(), arcAdoptStrategy: vi.fn(), arcChallengeStrategy: vi.fn(),
  arcAdoptWeekDay: vi.fn(), arcGenerateEmail: vi.fn(), arcSaveEmail: vi.fn(), arcExportEmail: vi.fn(), arcContainerSeen: vi.fn(),
}));

import * as api from '../api/client';
import { ArcSurface } from '../slice0/ArcSurface';

const v = (over: Partial<ArcView>): ArcView => ({ moment: 'pour_in', businessName: 'Body Move', ...over } as ArcView);
const noTabs = () => { expect(document.querySelector('.s0-nav')).toBeNull(); expect(document.querySelector('.s0-tabbar')).toBeNull(); };

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ArcSurface — one surface, eight moments', () => {
  it('Moment 1: each added source shows prominently IN its connector card (url + confirmation), survives refresh; Done; no tabs', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'www.bodymovestudio.ro', type: 'website', detail: '10 pages read' }, { url: 'brochure.pdf', type: 'pdf', detail: '4 pages read' }] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // The added source (url) is shown, with a prominent per-card confirmation — not a tiny row below.
    expect(await screen.findByText('www.bodymovestudio.ro')).toBeInTheDocument();
    expect(screen.getByText('brochure.pdf')).toBeInTheDocument();
    expect(screen.getByText(/10 pages read/)).toBeInTheDocument();                 // confirmation detail, in-card
    expect(screen.getByText(/4 pages read/)).toBeInTheDocument();
    // The closing CTA is now a prominent block: a count line + a full-width action button (not a tiny link).
    expect(screen.getByText('home.empty.done')).toBeInTheDocument();
    expect(screen.getByText('home.empty.ready.many:2')).toBeInTheDocument();        // "You've added 2 sources — …" (n interpolated)
    expect(screen.getByText('home.empty.done').className).toContain('s0-pourin-done');
    expect(screen.getByText('home.empty.done').closest('.s0-pourin-cta')).toBeTruthy();
    noTabs();
  });

  it('Moment 1 CTA: exactly ONE source shows the singular count line; zero sources shows no CTA', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'x.ro', type: 'website' }] }));
    const { unmount } = render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('home.empty.ready.one:1')).toBeInTheDocument();   // singular (n interpolated)
    expect(screen.queryByText(/home\.empty\.ready\.many/)).toBeNull();
    unmount();
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    await screen.findByText('home.empty.website');                                  // pour-in rendered…
    expect(screen.queryByText('home.empty.done')).toBeNull();                        // …but no CTA with zero sources
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

  it('after pour-in there is NO "describe your business" step — the arc goes straight to understanding', async () => {
    // The reading moment is removed: the flow is pour-in → (loading) → understanding, never a founder-input step
    // that asks them to describe the business before BB shows what it read.
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: { does: 'X', serves: 'Y', standsOut: '', tensions: [], confident: [], inferring: [], unanswered: [] } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/arc\.understanding\.title/)).toBeInTheDocument();
    // no reading prompt anywhere
    expect(screen.queryByText('arc.reading')).toBeNull();
    expect(screen.queryByPlaceholderText('arc.reading.ph')).toBeNull();
  });

  it('an input keeps focus across keystrokes — the SAME node persists (no remount) [regression]', async () => {
    // Regression guard for the focus-loss bug: the input components must be hoisted OUT of ArcSurface, or each
    // keystroke (setText → re-render) remounts the <textarea>, dropping focus. Exercised on the understanding
    // correction input (the reading input it used to guard is gone).
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: { does: 'X', serves: 'Y', standsOut: '', tensions: [], confident: [], inferring: [], unanswered: [] } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    const ta = await screen.findByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement;
    ta.focus();
    expect(document.activeElement).toBe(ta);
    fireEvent.change(ta, { target: { value: 'H' } });
    expect(screen.getByPlaceholderText('arc.understanding.ph')).toBe(ta); // identical DOM node — not remounted
    expect(document.activeElement).toBe(ta);
    fireEvent.change(ta, { target: { value: 'He' } });
    fireEvent.change(ta, { target: { value: 'Hel' } });
    const still = screen.getByPlaceholderText('arc.understanding.ph') as HTMLTextAreaElement;
    expect(still).toBe(ta);
    expect(still.value).toBe('Hel');
    expect(document.activeElement).toBe(ta);
  });

  it('Moment 3: understanding is THREE cards — what I read, what stood out (grounded, proof on demand), what I’ll ask; confident/inferring dropped', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: {
      does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led',
      tensions: [{ tension: 'The unfilled field contradicts the expertise message', grounding: 'The site shows "Years of experience: 0+"', sourceRefs: ['Homepage', 'About'] }],
      confident: ['Referrals drive members'], inferring: ['Aimed at athletes, not just patients'],
      unanswered: ['What do customers actually value most?'],
    } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/Physio memberships/)).toBeInTheDocument();
    // card 1 — what I read (proof it read the business)
    expect(screen.getByText('arc.understanding.read')).toBeInTheDocument();
    // card 2 — what stood out: the tension, its grounding line, and the collapsed "why I'm saying this" → sources
    expect(screen.getByText('arc.understanding.stoodout')).toBeInTheDocument();
    expect(screen.getByText('The unfilled field contradicts the expertise message')).toBeInTheDocument();
    expect(screen.getByText('The site shows "Years of experience: 0+"')).toBeInTheDocument();
    expect(screen.getByText('arc.understanding.why')).toBeInTheDocument();          // per-item disclosure present
    expect(screen.getByText('Homepage')).toBeInTheDocument();                       // sourceRefs available on demand
    // card 3 — what I'll ask about (agenda, framed forward)
    expect(screen.getByText('arc.understanding.willask')).toBeInTheDocument();
    expect(screen.getByText('What do customers actually value most?')).toBeInTheDocument();
    // dropped from the arc: confident + inferring are NOT front-and-centre here anymore
    expect(screen.queryByText('Referrals drive members')).toBeNull();
    expect(screen.queryByText('Aimed at athletes, not just patients')).toBeNull();
    expect(screen.queryByText('arc.understanding.confident')).toBeNull();
    expect(screen.queryByText('arc.understanding.inferring')).toBeNull();
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
    // The question is UNMISSABLE: its own labelled ArcQuestion card, visually SEPARATE from the reflection.
    const qCard = screen.getByText('arc.question.label').closest('.s0-arc-question') as HTMLElement;
    expect(qCard).toBeTruthy();
    expect(within(qCard).getByText(/What else should I know/)).toBeInTheDocument();         // the ask lives in the question card
    const reflectionCard = screen.getByText(/Schroth Therapy is more central/).closest('.s0-arc-reflection') as HTMLElement;
    expect(reflectionCard).toBeTruthy();
    expect(within(reflectionCard).queryByText(/What else should I know/)).toBeNull();       // the question is NOT buried in the reflection
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

  it('Moment 3: a persisted correction reflection RE-SHOWS on refresh (the view carries it on load)', async () => {
    // Refresh = a fresh getArc. The backend re-attaches the persisted reflection to the understanding view, so
    // the reflection + its question must render on initial load — not only in the just-submitted response.
    const u = { does: 'Physio memberships', serves: 'post-op patients', standsOut: 'recovery-led', tensions: [], confident: [], inferring: [], unanswered: [] };
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'understanding', understanding: u, correctionReflection: {
      reflection: 'Schroth is your core specialty.', changes: 'lead with Schroth', holds: 'referrals hold', ask: 'Who finds you for Schroth right now?',
    } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('Schroth is your core specialty.')).toBeInTheDocument();     // reflection persists on load
    const q = screen.getByText('Who finds you for Schroth right now?');
    expect(q.closest('.s0-arc-question')).toBeTruthy();                                          // the question persists, in its card
    expect(screen.getByText('arc.question.label')).toBeInTheDocument();
  });

  it('Moment 4: the conversation renders as a VISIBLE THREAD (all turns, no toggle); current question is the ArcQuestion', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'conversation', turns: [
      { id: 't1', role: 'bb', content: 'What have you tried and stopped?' },
      { id: 't2', role: 'founder', content: 'We ran Instagram ads for a month.' },
      { id: 't3', role: 'bb', content: 'What made you stop the ads?' },
    ] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // every exchange is visible top-to-bottom — earlier turns are NOT hidden behind a toggle
    expect(await screen.findByText('What have you tried and stopped?')).toBeInTheDocument(); // earlier bb turn, visible
    expect(screen.getByText('We ran Instagram ads for a month.')).toBeInTheDocument();       // founder turn, visible
    expect(screen.getAllByText('arc.thread.you').length).toBeGreaterThan(0);                 // founder turn labelled "You"
    expect(screen.queryByText('arc.conversation.history')).toBeNull();                       // NO "earlier in our conversation" toggle
    // the CURRENT (last) question is the prominent ArcQuestion; an EARLIER bb turn is a plain message
    expect(screen.getByText('What made you stop the ads?').closest('.s0-arc-question')).toBeTruthy();
    expect(screen.getByText('What have you tried and stopped?').closest('.s0-arc-question')).toBeNull();
    expect(screen.getByText('arc.question.label')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('arc.conversation.ph')).toBeInTheDocument();          // input stays at the bottom
    expect(screen.queryByText('arc.strategy.adopt →')).toBeNull();
  });

  it('Moment 4 opener renders as a SHORT structured pointer (lead + ≤3 bullets + not-sure), invitation alone in the clay card', async () => {
    const opener = JSON.stringify({ __arcOpener: {
      lead: "I've read your sources — here's what stands out before we talk.",
      bullets: ['Medical brochure: purely clinical, for orthopedists', 'Website: two locations, Schroth is the priciest', 'Corporate brochure: a separate B2B channel'],
      notSure: "I'm not sure what blocks the first step to clinics.",
      invitation: 'Am citit sursele — ce lipsește din imagine?',
    } });
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'conversation', turns: [{ id: 't1', role: 'bb', content: opener }] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // lead + bullets render (each bullet an <li>), not a blob
    expect(await screen.findByText(/here's what stands out/i)).toBeInTheDocument();
    expect(screen.getByText(/Medical brochure: purely clinical/i).tagName).toBe('LI');
    expect(screen.getByText(/I'm not sure what blocks/i)).toBeInTheDocument();
    // The closing question is the model's CONTEXTUAL invitation (varies per run), alone in the clay card.
    expect(screen.getByText('Am citit sursele — ce lipsește din imagine?').closest('.s0-arc-question')).toBeTruthy();
    expect(screen.getByText(/Medical brochure: purely clinical/i).closest('.s0-arc-question')).toBeNull();
    expect(screen.getByText('arc.question.label')).toBeInTheDocument();
  });

  it('a per-moment GENERATION failure shows an error + retry, never a blank/broken surface', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'strategy', error: { kind: 'generation' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.error.generation')).toBeInTheDocument();
    expect(screen.getByText('arc.error.retry →')).toBeInTheDocument();
    // it did NOT try to render the (absent) strategy body
    expect(screen.queryByText('arc.strategy.adopt →')).toBeNull();
  });

  it('a pour-in EMPTY error keeps the pour-in card usable and shows the specific message', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'x.ro', type: 'website' }], error: { kind: 'pourin_empty' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.error.pourinEmpty')).toBeInTheDocument();
    expect(screen.getByText('home.empty.website')).toBeInTheDocument(); // the pour-in affordances are still there
  });

  it('initial load shows an animated WORKING state (progress, not a frozen spinner)', async () => {
    vi.mocked(api.getArc).mockReturnValue(new Promise(() => {}) as Promise<ArcView>); // never resolves → stays loading
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.working')).toBeInTheDocument();
    expect(document.querySelector('.s0-arc-working-dots')).toBeTruthy(); // animated dots
  });

  it('a transition shows a MOMENT-AWARE working state while the model runs', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'pour_in', sources: [{ url: 'x.ro', type: 'website' }] }));
    let resolveDone: (v: ArcView) => void = () => {};
    vi.mocked(api.arcPourInDone).mockReturnValue(new Promise<ArcView>((r) => { resolveDone = r; }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    fireEvent.click(await screen.findByText('home.empty.done'));
    // while the pour-in→understanding generation runs, the founder sees a reading-progress state, not a freeze
    expect(await screen.findByText('arc.working.reading')).toBeInTheDocument();
    await act(async () => { resolveDone(v({ moment: 'understanding', understanding: { does: 'X', serves: 'Y', standsOut: '', tensions: [], confident: [], inferring: [], unanswered: [] } })); }); // flush the completion inside act
  });

  it('the working state escalates to "still working…" after ~12s', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getArc).mockReturnValue(new Promise(() => {}) as Promise<ArcView>);
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(screen.getByText('arc.working')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(12000); });
    expect(screen.getByText('arc.working.still')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('Moment 4 with no turns shows a quiet THINKING state, never the old generic placeholder question', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'conversation', turns: [] }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    // the model recap is generated server-side; until it arrives we show a quiet thinking line…
    expect(await screen.findByText('arc.conversation.preparing')).toBeInTheDocument();
    // …never the removed static placeholder, and no input to answer a question that isn't there yet
    expect(screen.queryByText('arc.conversation.opener')).toBeNull();
    expect(screen.queryByText('Tell me where the business is today.')).toBeNull();
    expect(screen.queryByPlaceholderText('arc.conversation.ph')).toBeNull();
  });

  it('Moment 5: mirror shows the contrast (both sides cited) + the question', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'mirror', mirror: { founderWords: 'recovery is the priority', against: 'six categories equally', tension: 'a priority your site doesn’t reflect' } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText(/recovery is the priority/)).toBeInTheDocument();
    expect(screen.getByText(/six categories equally/)).toBeInTheDocument();
    // the mirror question renders via the SAME shared ArcQuestion component (labelled, its own card)
    const mq = screen.getByText('arc.mirror.which');
    expect(mq.closest('.s0-arc-question')).toBeTruthy();
    expect(screen.getByText('arc.question.label')).toBeInTheDocument();
  });

  it('Moment 6: strategy shows the bet + reconsider; Adopt drives the engine', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'strategy', strategy: { bet: 'referrals', over: 'a general campaign', horizon: '6 months', tradeOffs: ['referrals ↔ paid ads · trust converts here'], notNow: ['paid social · no proof yet'], reconsider: ['if fewer than 2 of 8–10 show interest'], proposalId: 'ver1', adoptable: true } }));
    vi.mocked(api.arcAdoptStrategy).mockResolvedValue(v({ moment: 'week_day', weekDay: { week: [], today: null, canCreate: false } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    expect(await screen.findByText('arc.strategy.eyebrow')).toBeInTheDocument();
    expect(screen.getByText('referrals')).toBeInTheDocument();
    expect(screen.getByText('if fewer than 2 of 8–10 show interest')).toBeInTheDocument();
    fireEvent.click(screen.getByText('arc.strategy.adopt →'));
    await waitFor(() => expect(api.arcAdoptStrategy).toHaveBeenCalledWith('b1', 'ver1'));
  });

  it('Moment 6: ONE discuss button (reject collapsed away); clicking it reveals the challenge box', async () => {
    vi.mocked(api.getArc).mockResolvedValue(v({ moment: 'strategy', strategy: { bet: 'referrals', over: 'x', horizon: '6m', tradeOffs: ['a'], notNow: ['b'], reconsider: ['c'], proposalId: 'ver1', adoptable: true } }));
    render(<ArcSurface businessId="b1" onDone={vi.fn()} />);
    await screen.findByText('arc.strategy.eyebrow');
    expect(screen.getByText('arc.strategy.discuss')).toBeInTheDocument();
    expect(screen.queryByText('arc.strategy.notconvinced')).toBeNull();     // the second button was collapsed away
    expect(screen.queryByPlaceholderText('arc.strategy.ph')).toBeNull();
    fireEvent.click(screen.getByText('arc.strategy.discuss'));
    await waitFor(() => expect(screen.getByPlaceholderText('arc.strategy.ph')).toBeInTheDocument());
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
