import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Fix 3 verification — renders the REAL i18n (not a mocked t), at a Romanian locale, and asserts the classifier's
// reason sentence actually renders IN ROMANIAN on the verdict surface. This is the check the key-file alone can't
// give: a Romanian account must SEE Romanian prose, not English (the desync that Fix 2 also addresses).

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../api/client', () => ({ adoptStrategy: vi.fn(), respondToStrategy: vi.fn(), proposePlan: vi.fn(), adoptPlan: vi.fn() }));

import { VerdictSurface } from '../slice0/VerdictSurface';
import { LocaleProvider, useLocale } from '../i18n/LocaleContext';
import type { ImpactResult } from '../api/client';

// Force the interface language to Romanian through the real locale state (localStorage is unavailable in this
// env), then render VerdictSurface — so the reason sentence goes through the actual translate('ro', ...).
function Ro({ result }: { result: ImpactResult }) {
  const { setLocale } = useLocale();
  useEffect(() => { setLocale('ro'); }, [setLocale]);
  return <VerdictSurface businessId="B" result={result} onDismiss={() => undefined} />;
}

const revise: ImpactResult = {
  verdict: 'REVISE',
  whatChanged: ['Canalul răspunde.'],
  whatDidNotChange: ['Obiectivul tău.'],
  assumptionImpacts: [],
  todayImpact: { changes: true, reason: null, reasonCode: 'impact.today.strategyMoving', newMove: 'Reface planul.' },
  strategyImpact: { changes: true, reasonCode: 'impact.strategy.revise', newVersion: { id: 'v2', version: 2, status: 'proposal', strategy: {} as never } },
  source: 'outcome_report',
};

const reconsider: ImpactResult = {
  ...revise, verdict: 'RECONSIDER',
  strategyImpact: { changes: true, reasonCode: 'impact.strategy.reconsider', reasonVars: { condition: 'medicii nu mai trimit paciente' }, newVersion: { id: 'v2', version: 2, status: 'proposal', strategy: {} as never } },
};

function renderRo(result: ImpactResult) {
  return render(<LocaleProvider><Ro result={result} /></LocaleProvider>);
}

afterEach(cleanup);

describe('VerdictSurface renders the classifier reason in the account language (ro)', () => {
  it('REVISE — the strategy reason renders in Romanian, not English', () => {
    renderRo(revise);
    // the actual Romanian sentence from messages.ts, produced through translate('ro', 'impact.strategy.revise')
    expect(screen.getByText(/merită revizuită/i)).toBeInTheDocument();
    // and the old English internal-vocabulary literal is gone
    expect(screen.queryByText(/load-bearing assumption/i)).toBeNull();
    expect(screen.queryByText(/the strategy needs to change/i)).toBeNull();
    // Today's fallback reason also localized
    expect(screen.getByText(/Strategia ta se schimbă/i)).toBeInTheDocument();
  });

  it('RECONSIDER — the named condition is interpolated into the Romanian sentence', () => {
    renderRo(reconsider);
    expect(screen.getByText(/motiv de regândire: medicii nu mai trimit paciente/i)).toBeInTheDocument();
  });
});
