import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TodayResp, ImpactResult } from '../api/client';

// Living State on Today — "since you were last here" + report an outcome → the verdict surface.
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k), locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => () => {}, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../slice0/TalkDrawer', () => ({ useTalk: () => ({ open: vi.fn(), close: vi.fn(), isOpen: false }) }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), getToday: vi.fn(), getPlanState: vi.fn(), getCurrentStrategy: vi.fn(),
  proposePlan: vi.fn(), adoptPlan: vi.fn(), applyActionOutcome: vi.fn(), createFromAction: vi.fn(),
  resolveActionState: vi.fn(), submitCorrection: vi.fn(), evaluateImpact: vi.fn(),
  adoptStrategy: vi.fn(), respondToStrategy: vi.fn(),
}));

const noSince = { show: false, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null, awayHours: null };

import * as api from '../api/client';
import { TodayPage } from '../slice0/TodayPage';

const STRAT = { strategy: { core: { coreBet: { priority: 'Win trust with proof' } } }, adoptedAt: '2026-01-01' };
const PLAN = { active: { state: 'active', planVersionId: 'pv1', direction: 'A clear direction', priorities: [], notNow: [], stale: false }, proposal: null };
const readyMove = { actionId: 'act1', what: 'Call three clinics', whyNow: 'y', doneLooksLike: 'z', effort: null, canCreate: false };

function todayWith(since: TodayResp['sinceLastHere']): TodayResp {
  return { state: 'active', ready: [readyMove], blocked: null, sinceLastHere: since };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.getCurrentStrategy).mockResolvedValue(STRAT as never);
  vi.mocked(api.getPlanState).mockResolvedValue(PLAN as never);
});
afterEach(cleanup);

describe('TodayPage — Living State (return loop + outcome report)', () => {
  it('renders "since you were last here" after a real absence, with strategy + one-thing', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayWith({
      show: true, hasChanges: true, changes: ['You completed a move.'], strategyMoved: false, todayChanged: true,
      oneThing: 'Follow up with the doctor.', since: '2026-09-10T00:00:00.000Z', awayHours: 120,
    }));
    render(<TodayPage />);
    expect(await screen.findByText('since.k')).toBeInTheDocument();
    expect(screen.getByText('You completed a move.')).toBeInTheDocument();
    // strategy line + one-thing are text fragments inside one <p> (mixed nodes) — assert on the block's text.
    const line = document.querySelector('.s0-since-line');
    expect(line?.textContent).toContain('since.holds');                  // strategy still holds
    expect(line?.textContent).toContain('Follow up with the doctor.');   // the one thing
  });

  it('no "since" block on a first visit / same session (show=false)', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayWith({ show: false, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null, awayHours: null }));
    render(<TodayPage />);
    await screen.findByText('today2.donow');
    expect(screen.queryByText('since.k')).toBeNull();
  });

  it('a quiet week shows the block calmly (no invented activity)', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayWith({ show: true, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: '2026-09-08T00:00:00.000Z', awayHours: 168 }));
    render(<TodayPage />);
    expect(await screen.findByText('since.k')).toBeInTheDocument();
    expect(screen.getByText('since.quiet')).toBeInTheDocument();       // calm, honest
    expect(screen.queryByText('since.revised')).toBeNull();            // nothing invented
  });

  it('reporting an outcome calls the evaluator and shows the verdict surface', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayWith({ show: false, hasChanges: false, changes: [], strategyMoved: false, todayChanged: false, oneThing: null, since: null, awayHours: null }));
    const verdict: ImpactResult = {
      verdict: 'STILL_HOLDS', whatChanged: ['Outcome evidence exists.'], whatDidNotChange: ['Your bet.'],
      assumptionImpacts: [], todayImpact: { changes: true, reason: 'a follow-up exists', newMove: 'Email the interested doctor.' },
      strategyImpact: { changes: false, reason: 'unchanged', newVersion: null }, source: 'outcome_report',
    };
    vi.mocked(api.evaluateImpact).mockResolvedValue(verdict);
    render(<TodayPage />);
    fireEvent.click(await screen.findByText('today2.report'));
    fireEvent.change(screen.getByPlaceholderText('today2.reportPh'), { target: { value: 'Visited five clinics; one wants a follow-up.' } });
    fireEvent.click(screen.getByText('today2.reportSubmit'));
    await waitFor(() => expect(api.evaluateImpact).toHaveBeenCalledWith('b1', 'outcome_report', 'Visited five clinics; one wants a follow-up.'));
    expect(await screen.findByText('verdict.badge.STILL_HOLDS')).toBeInTheDocument();
    expect(screen.getByText('Email the interested doctor.')).toBeInTheDocument();
  });

  it('TUNE reaches Today: the operating constraint is shown as a persistent line', async () => {
    vi.mocked(api.getToday).mockResolvedValue({ state: 'active', ready: [readyMove], blocked: null, sinceLastHere: noSince, constraints: ['No kinetotherapy Tue/Thu evenings'], todayNote: null });
    render(<TodayPage />);
    expect(await screen.findByText('today2.constraintK')).toBeInTheDocument();
    expect(screen.getByText('No kinetotherapy Tue/Thu evenings')).toBeInTheDocument();
  });

  it('REVISE→adopt reaches Today: "Changed because: strategy vN adopted" is shown', async () => {
    vi.mocked(api.getToday).mockResolvedValue({ state: 'active', ready: [readyMove], blocked: null, sinceLastHere: noSince, constraints: [], todayNote: { kind: 'strategy_adopted', version: 2 } });
    render(<TodayPage />);
    expect(await screen.findByText('today2.changedStrategy:2')).toBeInTheDocument(); // {v} interpolated by the identity t
  });
});
