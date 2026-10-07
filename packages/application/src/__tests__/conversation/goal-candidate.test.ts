import { describe, it, expect } from 'vitest';
import { selectGoalCandidate } from '../../conversation/goal-candidate';
import type { FounderStateItem } from '../../conversation/contracts';

const item = (id: string, kind: FounderStateItem['kind'], statement: string): FounderStateItem =>
  ({ id, kind, statement, scope: null, temporary: false, status: 'active' });

describe('selectGoalCandidate — reflect-back selection (deterministic, no model)', () => {
  it('picks the Body Move priority-with-tradeoff (decision) VERBATIM, preserving the "nu" (deprioritized) half', () => {
    const bodyMoveGoal = 'Prioritatea pentru lunile următoare este activarea B2B medical cu un sistem repetat, nu creșterea volumului de clienți direcți la Decebal';
    const items = [
      item('r1', 'resource', 'Venituri principale: masaj, balet adulți, Pilates'),
      item('d1', 'decision', 'Activarea B2B medical va fi făcută de același specialist care merge la medici'), // tactical — no tradeoff/horizon
      item('d2', 'decision', bodyMoveGoal),
      item('i1', 'intention', 'Urmează să meargă un reprezentant la specialiști cu pliantul pentru a colabora'),
    ];
    const c = selectGoalCandidate(items);
    expect(c?.stateId).toBe('d2');
    expect(c?.hasTradeoff).toBe(true);
    expect(c?.statement).toBe(bodyMoveGoal);            // verbatim, full — never a paraphrase
    expect(c?.statement).toContain('nu creșterea volumului'); // the trade-off half is kept, not dropped
  });

  it('prefers the statement with a trade-off over a same-priority one without', () => {
    const items = [
      item('a', 'intention', 'Focusul principal pentru următoarele luni este creșterea'),          // priority + horizon = 3
      item('b', 'decision', 'Prioritatea în lunile următoare este retenția, nu achiziția de noi clienți'), // + tradeoff = 6
    ];
    expect(selectGoalCandidate(items)?.stateId).toBe('b');
  });

  it('asks cold (null) for a bare business fact — AI Startup: "PT is the main revenue line" is not a forward goal', () => {
    const items = [
      item('d1', 'decision', 'Personal training este linia principală de venit a studioului în prezent'), // priority only = 2 < 3
      item('d2', 'decision', 'PT clients typically move into a class after finishing their package'),
    ];
    expect(selectGoalCandidate(items)).toBeNull();
  });

  it('asks cold (null) when there is no founder-state at all (Timing Test)', () => {
    expect(selectGoalCandidate([])).toBeNull();
  });
});
