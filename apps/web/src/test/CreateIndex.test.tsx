import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { TodayResp, StrategyResp } from '../api/client';

// Block 1.3 — Create must NOT contradict Strategy. When the held strategy isn't calling for content
// (no create-capable move), Create says so plainly, explains with the strategy's stance, and links to Strategy.
const navigate = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k) }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/errors', () => ({ isNotFound: () => false, LoadError: () => <div>err</div> }));
vi.mock('../api/client', () => ({ getBusiness: vi.fn(), getToday: vi.fn(), getCurrentStrategy: vi.fn(), createFromAction: vi.fn() }));

import * as api from '../api/client';
import { CreateIndexPage } from '../slice0/CreateIndexPage';

const strategyHeld = (contentRole: string): StrategyResp => ({
  id: 's1', version: 1, status: 'proposal', adoptedAt: '2026-01-01',
  strategy: { core: { coreBet: { priority: 'Grow referrals' } }, branch: { contentRole } } as never,
});
const noMove: TodayResp = { state: 'active', ready: [], blocked: null };
const withCreateMove: TodayResp = { state: 'active', ready: [{ actionId: 'a1', what: 'Design the carousel', whyNow: 'y', doneLooksLike: 'z', effort: null, canCreate: true }], blocked: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
});
afterEach(cleanup);

describe('CreateIndexPage — does not contradict Strategy (Block 1.3)', () => {
  it('strategy held but content not-now (no create move) → "content isn\'t the move", with the strategy\'s stance + link to Strategy', async () => {
    vi.mocked(api.getToday).mockResolvedValue(noMove as never);
    vi.mocked(api.getCurrentStrategy).mockResolvedValue(strategyHeld('very little — proof over promotion') as never);
    render(<CreateIndexPage />);
    expect(await screen.findByText('create.notnow.title')).toBeInTheDocument();
    expect(screen.getByText('create.notnow.body')).toBeInTheDocument();
    expect(screen.getByText(/create\.notnow\.role/)).toBeInTheDocument();      // the strategy's own content stance
    expect(screen.getByText(/very little — proof over promotion/)).toBeInTheDocument();
    expect(screen.getByText('create.notnow.toStrategy →')).toBeInTheDocument();
    // it must NOT push content anymore
    expect(screen.queryByText('create.concepts.cta →')).toBeNull();
  });

  it('a create-capable move exists → leads into making it (Create is not suppressed when content IS the move)', async () => {
    vi.mocked(api.getToday).mockResolvedValue(withCreateMove as never);
    vi.mocked(api.getCurrentStrategy).mockResolvedValue(strategyHeld('content carries the message') as never);
    render(<CreateIndexPage />);
    await waitFor(() => expect(screen.getByText('Design the carousel')).toBeInTheDocument());
    expect(screen.getByText('today2.makeit →')).toBeInTheDocument();
    expect(screen.queryByText('create.notnow.title')).toBeNull();
  });
});
