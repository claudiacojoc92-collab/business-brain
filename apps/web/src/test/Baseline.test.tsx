import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// R2A: after the interview, BB shows a current-state BASELINE — what it OBSERVED vs what the founder TOLD it,
// unknowns kept honest — and the founder confirms (→ Strategy) or corrects (→ Add context). No jump to content.

const navigate = vi.fn();
const openAdd = vi.fn();
let search = '';
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, useSearchParams: () => [new URLSearchParams(search), vi.fn()], Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/AddContextDrawer', () => ({ useAddContext: () => ({ open: openAdd, close: vi.fn(), isOpen: false }) }));
vi.mock('../slice0/errors', () => ({ isNotFound: () => false, LoadError: () => <div>err</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), startConversation: vi.fn(), submitTurn: vi.fn(), getFounderModel: vi.fn(),
  getUnderstanding: vi.fn(), reopenConversation: vi.fn(), updateFounderState: vi.fn(), updateObservation: vi.fn(), generateAha2: vi.fn(), getAha2: vi.fn(),
}));

import * as api from '../api/client';
import { ConversationPage } from '../slice0/ConversationPage';

const emptyModel = { goal: null, horizon: null, constraints: [], preferences: [], decisions: [], intentions: [], challengePermissions: [], resources: [], businessCorrections: [], observations: [] };

beforeEach(() => {
  vi.clearAllMocks();
  search = '';
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.startConversation).mockResolvedValue({ session: { id: 's1', status: 'ready_for_aha2', conversationLanguage: 'en' }, turns: [], readyForAha2: true } as never);
  vi.mocked(api.getAha2).mockResolvedValue({ state: 'produced', findings: [{ implication: 'Your referral channel is your real growth path.', business: [], founder: [], observations: [] }] } as never);
  vi.mocked(api.getUnderstanding).mockResolvedValue({ state: 'present', understanding: {
    offer: { summary: 'Recovery-focused physiotherapy memberships' },
    audience: { addressed: ['post-op patients', 'active adults'] },
    acquisition: { visiblePaths: ['doctor referrals'] },
    unknowns: ['whether corporate partnerships convert'],
  } } as never);
  vi.mocked(api.getFounderModel).mockResolvedValue({ ...emptyModel, goal: { id: 'g', kind: 'goal', statement: 'Grow recurring memberships', scope: null, temporary: false, status: 'active' }, resources: [{ id: 'r', kind: 'resource', statement: 'We already have printed clinic brochures', scope: null, temporary: false, status: 'active' }] } as never);
});
afterEach(cleanup);

describe('ConversationPage — current-state baseline confirmation (R2A)', () => {
  it('shows what BB observed AND what the founder told it, with unknowns kept honest', async () => {
    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText('baseline.title')).toBeInTheDocument());
    expect(screen.getByText('baseline.observed')).toBeInTheDocument();
    expect(screen.getByText('Recovery-focused physiotherapy memberships')).toBeInTheDocument(); // observed offer
    expect(screen.getByText('doctor referrals')).toBeInTheDocument();                             // observed acquisition
    expect(screen.getByText('baseline.told')).toBeInTheDocument();
    expect(screen.getByText('Grow recurring memberships')).toBeInTheDocument();                   // told: goal
    expect(screen.getByText('We already have printed clinic brochures')).toBeInTheDocument();      // told: resource
    expect(screen.getByText('whether corporate partnerships convert')).toBeInTheDocument();         // unknowns honest
  });

  it('confirm builds strategy; correct opens Add context — no jump to content', async () => {
    render(<ConversationPage />);
    await waitFor(() => expect(screen.getByText(/baseline\.confirm/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('baseline.correct'));
    expect(openAdd).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/baseline\.confirm/));
    expect(navigate).toHaveBeenCalledWith('/b/b1/strategy');
  });

  it('R2B refresh mode REOPENS the interview (not the baseline) even though an old Aha2 exists — no reset', async () => {
    search = 'refresh=1';
    // reopen returns an active session (new domain to ask) with a fresh opener turn
    vi.mocked(api.reopenConversation).mockResolvedValue({ session: { id: 's1', status: 'active', conversationLanguage: 'en' }, turns: [{ id: 't1', role: 'bb', content: 'What marketing are you doing today?', language: 'en', seq: 1, createdAt: 't' }], readyForAha2: false } as never);
    render(<ConversationPage />);
    await waitFor(() => expect(api.reopenConversation).toHaveBeenCalledWith('b1'));
    expect(api.startConversation).not.toHaveBeenCalled();                 // reopened, not a fresh start
    expect(screen.getByText('What marketing are you doing today?')).toBeInTheDocument(); // interview, not baseline
    expect(screen.queryByText('baseline.title')).toBeNull();               // Aha2 exists but interview takes precedence
  });
});
