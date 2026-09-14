import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// R2A: after the interview, BB shows a current-state BASELINE — what it OBSERVED vs what the founder TOLD it,
// unknowns kept honest — and the founder confirms (→ Strategy) or corrects (→ Add context). No jump to content.

const navigate = vi.fn();
const openAdd = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/AddContextDrawer', () => ({ useAddContext: () => ({ open: openAdd, close: vi.fn(), isOpen: false }) }));
vi.mock('../slice0/errors', () => ({ isNotFound: () => false, LoadError: () => <div>err</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), startConversation: vi.fn(), submitTurn: vi.fn(), getFounderModel: vi.fn(),
  getUnderstanding: vi.fn(), updateFounderState: vi.fn(), updateObservation: vi.fn(), generateAha2: vi.fn(), getAha2: vi.fn(),
}));

import * as api from '../api/client';
import { ConversationPage } from '../slice0/ConversationPage';

const emptyModel = { goal: null, horizon: null, constraints: [], preferences: [], decisions: [], intentions: [], challengePermissions: [], resources: [], businessCorrections: [], observations: [] };

beforeEach(() => {
  vi.clearAllMocks();
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
});
