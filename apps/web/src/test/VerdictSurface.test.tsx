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
  todayImpact: { changes: true, reason: 'A concrete follow-up exists.', newMove: 'Follow up with the doctor.' },
  strategyImpact: { changes: false, reason: 'The strategic bet is unchanged.', newVersion: null },
  source: 'outcome_report',
};

const revise: ImpactResult = {
  verdict: 'REVISE',
  whatChanged: ['The referral channel is not responding.'],
  whatDidNotChange: ['Your goal.'],
  assumptionImpacts: [{ assumption: 'referrals will respond', direction: 'weaker', note: 'clinics said no' }],
  todayImpact: { changes: true, reason: 'strategy v2 drafted', newMove: 'Re-derive the plan.' },
  strategyImpact: { changes: true, reason: 'This contradicts a load-bearing assumption.', newVersion: { id: 'v2', version: 2, status: 'proposal', strategy: {} as never } },
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
});
