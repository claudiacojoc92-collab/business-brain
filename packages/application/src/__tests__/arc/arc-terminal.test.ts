/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { ArcService } from '../../arc/arc.service';

// The strategy moment of the arc: only an explicit founder retry asks the strategy port to generate again (2026-10-17).
describe('ArcService — strategy retry is explicit and one-shot', () => {
  const rec = (status: 'proposal' | 'insufficient') => ({ id: 'v1', status, bundle: { core: { goal: 'g', horizon: 'h', diagnosis: 'd', coreBet: { priority: status === 'proposal' ? 'p' : '', deprioritized: 'x', whyOverAlternative: 'w' }, tradeOffs: [], notNow: [], reconsiderTriggers: [] } }, gateResults: [{ gate: 'judge:specificity', pass: false, detail: 'too vague' }] });
  function arcWith(status: 'proposal' | 'insufficient') {
    const proposalOrGenerate = vi.fn(async () => rec(status));
    const deps: any = {
      understanding: { latest: async () => ({ id: 'snap', understanding: { read: null } }) },
      conversation: { status: async () => 'ready_for_aha2', hasGoal: async () => true, goalCandidate: async () => null, turns: async () => [], awaitingGoal: async () => false },
      strategy: { getCurrent: async () => null, proposalOrGenerate },
      plan: { getActive: async () => null },
      aha1: { latest: async () => null },
    };
    const flags: any = { pourInDone: true, understandingConfirmed: true, mirrorSeen: true };
    return { arc: new ArcService(deps), proposalOrGenerate, view: (a: ArcService) => a.view('B', 'N', 'ro', flags, [], null) };
  }
  it('a terminal insufficient comes back as a final state; the next view does not ask for a retry', async () => {
    const { arc, proposalOrGenerate, view } = arcWith('insufficient');
    const v = await view(arc);
    expect(v.moment).toBe('strategy');
    expect(v.error?.kind).toBe('strategy_insufficient');
    expect((proposalOrGenerate.mock.calls[0] as any[])[5]).toBe(false);
    arc.requestStrategyRetry('B');
    await view(arc);
    expect((proposalOrGenerate.mock.calls[1] as any[])[5]).toBe(true);   // the founder's retry
    await view(arc);
    expect((proposalOrGenerate.mock.calls[2] as any[])[5]).toBe(false);  // one-shot: polling never retries
  });
});
