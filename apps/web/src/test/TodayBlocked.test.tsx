import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { TodayResp } from '../api/client';

// Identity translator → assertions can match i18n KEYS directly (and prove no internal term leaks).
vi.mock('../i18n/LocaleContext', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'en' }) }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useParams: () => ({ id: 'b1' }), useNavigate: () => () => {}, Navigate: () => null };
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

// Adopted strategy + active, non-stale plan → the page reaches the `blocked` stage and renders BlockedMove.
const STRAT = { strategy: { core: { coreBet: { priority: 'Win trust with proof' } } }, adoptedAt: '2026-01-01' };
const PLAN = { active: { state: 'active', planVersionId: 'pv1', direction: 'A clear direction', priorities: [], notNow: [], stale: false }, proposal: null };
const todayBlocked = (blocked: NonNullable<TodayResp['blocked']>): TodayResp => ({ state: 'active', ready: [], blocked });
const readyResp: TodayResp = { state: 'active', ready: [{ actionId: 'act1', what: 'x', whyNow: 'y', doneLooksLike: 'z', effort: null, canCreate: false }], blocked: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getBusiness).mockResolvedValue({ id: 'b1', name: 'Acme' } as never);
  vi.mocked(api.getCurrentStrategy).mockResolvedValue(STRAT as never);
  vi.mocked(api.getPlanState).mockResolvedValue(PLAN as never);
  vi.mocked(api.applyActionOutcome).mockResolvedValue(readyResp as never);
  vi.mocked(api.resolveActionState).mockResolvedValue(readyResp as never);
  vi.mocked(api.submitCorrection).mockResolvedValue({ correction: { id: 'c1', subject: 'offer', statement: 's' } } as never);
});
afterEach(cleanup);

const NEVER_LEAK = ['missing_material', 'prerequisite_unfinished', 'founder_decision', 'strategy_stale', 'founder_state', 'blocker', 'actionId'];

describe('TodayPage — blocked move renders a kind-specific response (P0)', () => {
  it('missing_material: shows "I have this" and confirming writes a RESOURCE (the exact material), never a correction', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayBlocked({ kind: 'missing_material', actionId: 'act1', what: 'Publish the proof piece', need: 'Missing: brand logo files.', material: 'brand logo files', prerequisite: null }));
    render(<TodayPage />);
    const have = await screen.findByText('today2.blk.have');
    expect(screen.getByText('today2.blk.matK')).toBeInTheDocument();
    // no internal enum/term leaks into founder-facing text
    for (const term of NEVER_LEAK) expect(document.body.textContent).not.toContain(term);
    fireEvent.click(have);
    await waitFor(() => expect(api.resolveActionState).toHaveBeenCalledWith('b1', 'act1', 'resource', 'brand logo files'));
    expect(api.submitCorrection).not.toHaveBeenCalled();
    expect(api.applyActionOutcome).not.toHaveBeenCalled(); // NOT auto-done — becomes ready, completed normally
  });

  it('missing_material: "I can\'t get this" records a constraint + SKIP, never DONE', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayBlocked({ kind: 'missing_material', actionId: 'act1', what: 'Publish', need: 'Missing: a paid subscription.', material: 'a paid subscription', prerequisite: null }));
    render(<TodayPage />);
    fireEvent.click(await screen.findByText('today2.blk.cant'));
    const setAside = await screen.findByText('today2.blk.setAside');
    fireEvent.click(setAside);
    await waitFor(() => expect(api.resolveActionState).toHaveBeenCalledWith('b1', 'act1', 'constraint', expect.any(String)));
    expect(api.applyActionOutcome).toHaveBeenCalledWith('b1', 'act1', 'skipped', expect.any(String));
    const doneCalls = vi.mocked(api.applyActionOutcome).mock.calls.filter((c) => c[2] === 'done');
    expect(doneCalls).toHaveLength(0);
  });

  it('prerequisite_unfinished: names the prerequisite and "already finished" applies DONE to A, never the blocked child', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayBlocked({ kind: 'prerequisite_unfinished', actionId: 'child1', what: 'Publish the cleared study', need: 'Do "preA" first.', prerequisite: { actionId: 'preA', what: 'Confirm the study is cleared' } }));
    render(<TodayPage />);
    const done = await screen.findByText('today2.blk.prereqDone');
    expect(screen.getByText('Confirm the study is cleared', { exact: false })).toBeInTheDocument(); // prerequisite named, not the raw id
    fireEvent.click(done);
    await waitFor(() => expect(api.applyActionOutcome).toHaveBeenCalledWith('b1', 'preA', 'done')); // A, not child1
    expect(vi.mocked(api.applyActionOutcome).mock.calls.every((c) => c[1] !== 'child1')).toBe(true);
  });

  it('founder_decision: the founder states a choice → decision fact + DONE on the decision action', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayBlocked({ kind: 'founder_decision', actionId: 'dec1', what: 'Decide the lead audience', need: 'Choose which single audience to lead with.' }));
    render(<TodayPage />);
    const submit = await screen.findByText('today2.blk.decisionSubmit');
    const box = screen.getByPlaceholderText('today2.blk.decisionPlaceholder');
    fireEvent.change(box, { target: { value: 'Lead with fractional CFOs' } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.resolveActionState).toHaveBeenCalledWith('b1', 'dec1', 'decision', 'Lead with fractional CFOs'));
    expect(api.applyActionOutcome).toHaveBeenCalledWith('b1', 'dec1', 'done', 'Lead with fractional CFOs');
  });

  it('missing_material: "that\'s not right" routes to a business CORRECTION (held truth), not a resource/constraint', async () => {
    vi.mocked(api.getToday).mockResolvedValue(todayBlocked({ kind: 'missing_material', actionId: 'act1', what: 'Audit the color pages', need: 'Missing: live color pages.', material: 'live color pages', prerequisite: null }));
    render(<TodayPage />);
    fireEvent.click(await screen.findByText('today2.blk.notright'));
    const save = await screen.findByText('today2.blk.corrSubmit');
    const box = screen.getByPlaceholderText('today2.blk.corrPlaceholder');
    fireEvent.change(box, { target: { value: 'We have no per-color pages' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.submitCorrection).toHaveBeenCalledWith('b1', 'offer', 'We have no per-color pages'));
    expect(api.resolveActionState).not.toHaveBeenCalled(); // not a resource/constraint
  });
});
