import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { StrategyResp, StrategyBundle } from '../api/client';

vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => () => {}, Navigate: () => null };
});
vi.mock('../slice0/AppShell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../api/client', () => ({
  getBusiness: vi.fn(), getCurrentStrategy: vi.fn(), getStrategyProposal: vi.fn(),
  regenerateStrategy: vi.fn(), adoptStrategy: vi.fn(), respondToStrategy: vi.fn(),
}));

import * as api from '../api/client';
import { StrategyPage } from '../slice0/StrategyPage';

const bundle: StrategyBundle = {
  core: {
    goal: 'Land 10 recurring retainer clients', horizon: '6 months',
    diagnosis: 'The homepage gives healthcare buyers no clear next action toward a retainer conversation.',
    coreBet: { priority: 'Convert warm referrals into retainer scoping calls', deprioritized: 'Cold inbound content', whyOverAlternative: 'Warm reaches buyers faster within limited hours', relationToGoal: 'Retainers come from warm relationships', relationToBottleneck: 'Routes around the broken homepage', founderFit: 'No personal video needed', resourceFit: 'Fits 8 hours a week' },
    offerDirection: 'Retainers', positioningDirection: 'Senior engineering expertise',
    audiencePrimaryForGoal: 'Engineering leaders at healthcare software companies', audienceRoles: [{ role: 'buyer', who: 'engineering leaders' }],
    founderConstraints: ['no daily personal video'], resourceEnvelope: ['8 hours a week'],
    assumptions: [{ statement: 'Warm network has enough buyers' }], tradeOffs: [{ choosing: 'warm', over: 'cold', why: 'faster' }],
    notNow: [{ item: 'Broad follower growth', reason: 'Does not move retainers in 6 months' }],
    reconsiderTriggers: [{ condition: 'If 15 conversations produce no interest, revisit the offer' }],
  },
  branch: {
    market: 'US', language: 'en', messagingDirection: 'Case-study credibility',
    channelPriorities: [{ channel: 'Warm referral outreach', whyGoal: 'Reaches retainer buyers', whyAudience: 'engineering leaders', whyResource: 'few hours', overAlternative: 'over cold content', assumption: 'network reachable' }],
    acquisitionApproach: 'Direct outreach', contentRole: 'Minimal, proof via case studies', ctaDirection: 'Book a scoping call',
  },
  decisions: [{ key: 'warm', title: 'Warm first', rationale: 'Homepage path broken', sourceRefs: ['B2'], founderRefs: ['F1'], claimStrength: 'bounded', assumption: null, reconsiderTrigger: null }],
};
const proposal: StrategyResp = { id: 'v1', version: 1, status: 'proposal', language: 'en', createdAt: 't', strategy: bundle };
const current: StrategyResp = { ...proposal, adoptedAt: '2026-08-09' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'thoughtbot' } as never);
  vi.mocked(api.getCurrentStrategy).mockResolvedValue({ state: 'none' } as never);
  vi.mocked(api.getStrategyProposal).mockResolvedValue(proposal as never);
  vi.mocked(api.adoptStrategy).mockResolvedValue(current as never);
});
afterEach(cleanup);

describe('StrategyPage', () => {
  it('renders the founder-facing proposal hierarchy (bet, not-now, reconsider) — not a tactic pile', async () => {
    render(<StrategyPage />);
    // Current contract (strat2): the proposal opens with "here's the call I'd make", the bet dominates,
    // and not-now / reconsider hang off it — a held decision, not a tactic pile.
    expect(await screen.findByText('strat2.recommend')).toBeInTheDocument();
    expect(screen.getByText(bundle.core.coreBet.priority)).toBeInTheDocument();
    expect(screen.getByText(bundle.core.notNow[0]!.item, { exact: false })).toBeInTheDocument();
    expect(screen.getByText(bundle.core.reconsiderTriggers[0]!.condition)).toBeInTheDocument();
    // no Plan / Voice / Create surfaces yet
    expect(screen.queryByText(/30-day|first month plan|voice|create asset|generate post/i)).toBeNull();
  });

  it('adopting the proposal transitions to the Current strategy', async () => {
    render(<StrategyPage />);
    const adopt = await screen.findByText('strat2.adopt');
    fireEvent.click(adopt);
    await waitFor(() => expect(api.adoptStrategy).toHaveBeenCalledWith('b1', 'v1'));
    // Adopting transitions to the held state ("Adopted · holding").
    expect(await screen.findByText('strat2.holding')).toBeInTheDocument();
  });

  it('reopens straight to Current when one is already adopted (no regeneration)', async () => {
    vi.mocked(api.getCurrentStrategy).mockResolvedValue(current as never);
    render(<StrategyPage />);
    expect(await screen.findByText('strat2.holding')).toBeInTheDocument();
    expect(api.getStrategyProposal).not.toHaveBeenCalled();
  });

  it('shows the insufficient state honestly instead of a fake strategy', async () => {
    vi.mocked(api.getStrategyProposal).mockResolvedValue({ status: 'insufficient' } as never);
    render(<StrategyPage />);
    expect(await screen.findByText('strat2.insuff')).toBeInTheDocument();
  });
});
