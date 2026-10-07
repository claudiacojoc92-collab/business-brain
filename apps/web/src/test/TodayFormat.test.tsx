import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TodayResp } from '../api/client';

// C5/C6 (BUS-11, BUS-12): Today's create button by format. Identity translator → assert on i18n KEYS.
const navigate = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => navigate, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/TalkDrawer', () => ({ useTalk: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }) }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), getToday: vi.fn(), getPlanState: vi.fn(), getCurrentStrategy: vi.fn(),
  proposePlan: vi.fn(), adoptPlan: vi.fn(), applyActionOutcome: vi.fn(), createFromAction: vi.fn(),
  resolveActionState: vi.fn(), submitCorrection: vi.fn(),
}));

import * as api from '../api/client';
import { TodayPage } from '../slice0/TodayPage';
import { createDestination } from '../slice0/create-route';

const STRAT = { strategy: { core: { coreBet: { priority: 'Win trust with proof' } } }, adoptedAt: '2026-01-01' };
const PLAN = { active: { state: 'active', planVersionId: 'pv1', direction: 'A clear direction', priorities: [], notNow: [], stale: false }, proposal: null };
const ready = (executableFormat: 'landing' | 'carousel' | null | undefined): TodayResp => ({
  state: 'active', blocked: null,
  ready: [{ actionId: 'act1', what: 'BB scrie pagina', whyNow: 'y', doneLooksLike: 'z', effort: null, canCreate: true, ...(executableFormat !== undefined ? { executableFormat } : {}) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.getCurrentStrategy).mockResolvedValue(STRAT as never);
  vi.mocked(api.getPlanState).mockResolvedValue(PLAN as never);
});
afterEach(cleanup);

describe('createDestination', () => {
  it('landing → the landing draft for the action; carousel or no surface → Create', () => {
    expect(createDestination('b1', 'act1', { surface: 'landing', createHandoffId: 'h1' })).toBe('/b/b1/landing/act1');
    expect(createDestination('b1', 'act1', { surface: 'carousel', createHandoffId: 'h1' })).toBe('/b/b1/create/h1');
    expect(createDestination('b1', 'act1', { createHandoffId: 'h1' })).toBe('/b/b1/create/h1');
  });
});

describe('TodayPage — the create button by format', () => {
  it('a landing move says "See what BB wrote" and opens the landing draft', async () => {
    vi.mocked(api.getToday).mockResolvedValue(ready('landing'));
    vi.mocked(api.createFromAction).mockResolvedValue({ state: 'ready_for_create', surface: 'landing', objective: 'o', note: 'n', createHandoffId: 'h1' });
    render(<TodayPage />);
    expect(await screen.findByText('today2.becomesLanding')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('today2.seewrote →'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/b/b1/landing/act1'));
  });

  it('a carousel move also says "See what BB wrote" and opens Create', async () => {
    vi.mocked(api.getToday).mockResolvedValue(ready('carousel'));
    vi.mocked(api.createFromAction).mockResolvedValue({ state: 'ready_for_create', surface: 'carousel', objective: 'o', note: 'n', createHandoffId: 'h9' });
    render(<TodayPage />);
    fireEvent.click(await screen.findByText('today2.seewrote →'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/b/b1/create/h9'));
  });

  it('a plan from before formats existed keeps "Make it" and the carousel', async () => {
    vi.mocked(api.getToday).mockResolvedValue(ready(undefined));
    vi.mocked(api.createFromAction).mockResolvedValue({ state: 'ready_for_create', objective: 'o', note: 'n', createHandoffId: 'h2' });
    render(<TodayPage />);
    expect(await screen.findByText('today2.becomes')).toBeInTheDocument();
    fireEvent.click(await screen.findByText('today2.makeit →'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/b/b1/create/h2'));
  });
});
