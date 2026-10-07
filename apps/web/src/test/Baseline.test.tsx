import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// After the interview, the aha2 phase now shows THE MIRROR (three lanes + contrast). The founder confirms
// (→ Strategy) or corrects a lane inline. Refresh mode still reopens the interview, not the mirror.

const navigate = vi.fn();
let search = '';
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, useSearchParams: () => [new URLSearchParams(search), vi.fn()], Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/errors', () => ({ isNotFound: () => false, LoadError: () => <div>err</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), startConversation: vi.fn(), submitTurn: vi.fn(), getFounderModel: vi.fn(),
  getUnderstanding: vi.fn(), reopenConversation: vi.fn(), updateFounderState: vi.fn(), updateObservation: vi.fn(),
  generateAha2: vi.fn(), getAha2: vi.fn(), getMirror: vi.fn(), correctMirror: vi.fn(), evaluateImpact: vi.fn(),
}));

import * as api from '../api/client';
import { ConversationPage } from '../slice0/ConversationPage';

const emptyModel = { goal: null, horizon: null, constraints: [], preferences: [], decisions: [], intentions: [], challengePermissions: [], resources: [], businessCorrections: [], observations: [] };
const mirror = {
  observed: [{ label: 'Your offer', statement: 'Recovery-focused physiotherapy memberships', provenance: 'observed' }],
  business: [{ label: 'Your goal', statement: 'Grow recurring memberships', provenance: 'declared' }],
  self: [{ label: 'In your words', statement: 'I avoid direct sales conversations', provenance: 'declared' }],
  contrasts: [], hasSelf: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  search = '';
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.startConversation).mockResolvedValue({ session: { id: 's1', status: 'ready_for_aha2', conversationLanguage: 'en' }, turns: [], readyForAha2: true } as never);
  vi.mocked(api.getAha2).mockResolvedValue({ state: 'produced', findings: [] } as never);
  vi.mocked(api.getUnderstanding).mockResolvedValue({ state: 'present', understanding: { offer: { summary: 'x' } } } as never);
  vi.mocked(api.getFounderModel).mockResolvedValue({ ...emptyModel } as never);
  vi.mocked(api.getMirror).mockResolvedValue(mirror as never);
});
afterEach(cleanup);

describe('ConversationPage — the mirror is the post-interview surface', () => {
  it('renders the mirror (three lanes) when the interview is settled', async () => {
    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText('mirror.title')).toBeInTheDocument());
    expect(screen.getByText('mirror.lane.observed')).toBeInTheDocument();
    expect(screen.getByText('mirror.lane.business')).toBeInTheDocument();
    expect(screen.getByText('mirror.lane.self')).toBeInTheDocument();
    expect(screen.getByText('Recovery-focused physiotherapy memberships')).toBeInTheDocument();
    expect(screen.getByText('I avoid direct sales conversations')).toBeInTheDocument();
  });

  it('confirm builds strategy (no jump to content)', async () => {
    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText(/mirror\.confirm/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/mirror\.confirm/));
    expect(navigate).toHaveBeenCalledWith('/b/b1/strategy');
  });

  it('refresh mode REOPENS the interview (not the mirror) even though an old Aha2 exists — no reset', async () => {
    search = 'refresh=1';
    vi.mocked(api.reopenConversation).mockResolvedValue({ session: { id: 's1', status: 'active', conversationLanguage: 'en' }, turns: [{ id: 't1', role: 'bb', content: 'What have you stopped doing?', language: 'en', seq: 1, createdAt: 't' }], readyForAha2: false } as never);
    render(<ConversationPage />);
    await waitFor(() => expect(api.reopenConversation).toHaveBeenCalledWith('b1'));
    expect(api.startConversation).not.toHaveBeenCalled();
    expect(screen.getByText('What have you stopped doing?')).toBeInTheDocument();
    expect(screen.queryByText('mirror.title')).toBeNull();
  });
});
