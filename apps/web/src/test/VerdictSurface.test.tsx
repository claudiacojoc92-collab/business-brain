import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// Living State — the shared verdict surface: verdict, what changed / didn't, assumptions, Today impact,
// strategy impact, and adopt / challenge / dismiss. Rendered by Add Context, Today, and refresh.

const navigate = vi.fn();
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string, v?: Record<string, string>) => (v ? `${k}:${Object.values(v).join(',')}` : k) }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../api/client', () => ({ adoptStrategy: vi.fn(), respondToStrategy: vi.fn(), proposePlan: vi.fn(), adoptPlan: vi.fn() }));

import * as api from '../api/client';
import { VerdictSurface } from '../slice0/VerdictSurface';
import type { ImpactResult } from '../api/client';

const holds: ImpactResult = {
  verdict: 'STILL_HOLDS',
  whatChanged: ['You have real outcome evidence.'],
  whatDidNotChange: ['Your bet on referrals.', 'Website-first stays not-now.'],
  assumptionImpacts: [],
  todayImpact: { changes: true, reason: 'A concrete follow-up exists.', reasonCode: null, newMove: 'Follow up with the doctor.' },
  strategyImpact: { changes: false, reasonCode: 'impact.strategy.holds', newVersion: null },
  source: 'outcome_report',
};

const revise: ImpactResult = {
  verdict: 'REVISE',
  whatChanged: ['The referral channel is not responding.'],
  whatDidNotChange: ['Your goal.'],
  assumptionImpacts: [{ assumption: 'referrals will respond', direction: 'weaker', note: 'clinics said no' }],
  todayImpact: { changes: true, reason: 'strategy v2 drafted', reasonCode: null, newMove: 'Re-derive the plan.' },
  strategyImpact: { changes: true, reasonCode: 'impact.strategy.revise', newVersion: { id: 'v2', version: 2, status: 'proposal', strategy: {} as never } },
  source: 'add_context',
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('VerdictSurface', () => {
  it('STILL_HOLDS shows the verdict, both lanes, the Today move — and no adopt control', () => {
    render(<VerdictSurface businessId="b1" result={holds} onDismiss={vi.fn()} />);
    expect(screen.getByText('verdict.badge.STILL_HOLDS')).toBeInTheDocument();
    expect(screen.getByText('You have real outcome evidence.')).toBeInTheDocument();       // what changed
    expect(screen.getByText('Website-first stays not-now.')).toBeInTheDocument();           // what didn't
    expect(screen.getByText('Follow up with the doctor.')).toBeInTheDocument();             // today move
    expect(screen.queryByText('verdict.adopt')).toBeNull();                                 // nothing to adopt
    expect(screen.getByText('verdict.dismiss')).toBeInTheDocument();
  });

  it('REVISE offers adopt/challenge; adopt adopts the version AND reshapes the plan so Today re-derives', async () => {
    vi.mocked(api.adoptStrategy).mockResolvedValue({} as never);
    vi.mocked(api.proposePlan).mockResolvedValue({ planVersionId: 'pv2' } as never);
    vi.mocked(api.adoptPlan).mockResolvedValue({} as never);
    render(<VerdictSurface businessId="b1" result={revise} onDismiss={vi.fn()} onAdopted={vi.fn()} />);
    expect(screen.getByText('verdict.badge.REVISE')).toBeInTheDocument();
    expect(screen.getByText('referrals will respond')).toBeInTheDocument();
    expect(screen.getByText('verdict.dir.weaker')).toBeInTheDocument();
    expect(screen.getByText('verdict.newStrategy:2')).toBeInTheDocument();                  // {v} interpolated
    fireEvent.click(screen.getByText('verdict.adopt'));
    await waitFor(() => expect(api.adoptStrategy).toHaveBeenCalledWith('b1', 'v2'));
    await waitFor(() => expect(api.adoptPlan).toHaveBeenCalledWith('b1', 'pv2'));            // plan reshaped → Today re-derives
    expect(await screen.findByText('verdict.adopted')).toBeInTheDocument();
  });

  it('challenge routes to respondToStrategy (the existing challenge loop)', async () => {
    vi.mocked(api.respondToStrategy).mockResolvedValue({} as never);
    render(<VerdictSurface businessId="b1" result={revise} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText('verdict.challenge'));
    fireEvent.change(screen.getByPlaceholderText('verdict.challengePlaceholder'), { target: { value: 'You misread the market.' } });
    fireEvent.click(screen.getByText('verdict.challengeSubmit'));
    await waitFor(() => expect(api.respondToStrategy).toHaveBeenCalledWith('b1', 'constraint', 'You misread the market.'));
  });

  // ── Result Loop V1: one Today interpretation, never both ──
  it('Today unchanged: no move is rendered even if a stale newMove is present; the strategy line no longer repeats "Today is unchanged"', () => {
    const r: ImpactResult = { ...holds, todayImpact: { changes: false, reason: null, reasonCode: 'impact.today.unchanged', newMove: 'Follow up with the doctor.' } };
    const { container } = render(<VerdictSurface businessId="b1" result={r} onDismiss={() => {}} />);
    expect(screen.queryByText('Follow up with the doctor.')).toBeNull();
    expect(screen.queryByText('verdict.today')).toBeNull();
    expect(container.querySelector('[data-today="unchanged"]')?.textContent).toBe('impact.today.unchanged');
    expect(container.querySelector('[data-today="changed"]')).toBeNull();
    expect(screen.getByText('verdict.holds')).toBeInTheDocument();
  });

  it('new follow-ups are the queue, shown apart: Today stays unchanged (acceptance 2026-10-14)', () => {
    const r: ImpactResult = { ...holds, todayImpact: { changes: false, reason: null, reasonCode: 'impact.today.unchanged', newMove: null, followUpsAdded: { count: 2, firstDueOn: '2026-10-15' } } };
    const { container } = render(<VerdictSurface businessId="b1" result={r} onDismiss={() => {}} />);
    expect(container.querySelector('[data-today="unchanged"]')).not.toBeNull();
    expect(container.querySelector('[data-today="changed"]')).toBeNull();
    expect(container.querySelector('[data-queue="added"]')?.textContent).toBe('verdict.queue.many:2,2026-10-15');
  });

  it('Today changed: the move and why, and never the unchanged line', () => {
    const { container } = render(<VerdictSurface businessId="b1" result={holds} onDismiss={() => {}} />);
    expect(screen.getByText('Follow up with the doctor.')).toBeInTheDocument();
    expect(container.querySelector('[data-today="unchanged"]')).toBeNull();
  });

  it('"too early" is said in place of the generic holds line; evidence and condition states are shown', () => {
    const r: ImpactResult = { ...holds, todayImpact: { changes: false, reason: null, reasonCode: 'impact.today.unchanged', newMove: null },
      strategyImpact: { changes: false, reasonCode: 'impact.strategy.tooEarly', newVersion: null },
      evidence: { statements: ['5 target contacts; 5 reached so far over 0 days.'], conditions: [{ condition: 'Fewer than 2 referrals within 6 weeks', state: 'not_yet_measurable', observed: 0, detail: '' }] } };
    render(<VerdictSurface businessId="b1" result={r} onDismiss={() => {}} />);
    expect(screen.getByText('impact.strategy.tooEarly')).toBeInTheDocument();
    expect(screen.queryByText('verdict.holds')).toBeNull();
    expect(screen.getByText('5 target contacts; 5 reached so far over 0 days.')).toBeInTheDocument();
    expect(screen.getByText('verdict.cond.not_yet_measurable')).toBeInTheDocument();
  });

  it('"See this month\'s plan" appears only at cycle close, never on a mid-cycle outcome report', () => {
    const r: ImpactResult = { ...holds, todayImpact: { changes: false, reason: null, reasonCode: 'impact.today.unchanged', newMove: null } };
    const { unmount } = render(<VerdictSurface businessId="b1" result={r} onDismiss={() => {}} />);
    expect(screen.queryByText(/home.close.next/)).toBeNull();
    unmount();
    render(<VerdictSurface businessId="b1" result={r} onDismiss={() => {}} cycleClose />);
    expect(screen.getByText(/home.close.next/)).toBeInTheDocument();
  });
});
