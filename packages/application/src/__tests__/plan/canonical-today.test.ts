/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { canonicalTodayMove, deriveAllReadiness, selectToday, todayPlanAction } from '../../plan/index';

// BUS-82: every user-facing "today" uses ONE selection: due follow-up → selectToday's move → its blocked fallback.
const act = (actionId: string, what: string, over: Record<string, unknown> = {}): any => ({ actionId, priorityId: 'p1', what, why: '', doneDefinition: '', leadsToCreate: false, prerequisites: [], requiredMaterial: [], planTimeFeasible: true, ...over });
// The plan's FIRST action needs material nobody has → blocked; the second is ready.
const PLAN: any = { planVersionId: 'v1', currentFocusPriorityId: 'p1', priorities: [{ priorityId: 'p1', order: 1, title: 'P', actions: [
  act('a1', 'Publish the landing page', { requiredMaterial: ['testimonials'] }),
  act('a2', 'Write to two orthopaedic doctors'),
] }] };
const today = selectToday(PLAN, deriveAllReadiness(PLAN.priorities[0].actions, [], { strategyStale: false, availableMaterial: new Set(), decisionNeeded: new Set(), constrainedActions: new Map() }));

describe('canonicalTodayMove', () => {
  it('is selectToday\'s move, never the plan\'s first action', () => {
    expect(canonicalTodayMove(today)).toMatchObject({ kind: 'plan', actionId: 'a2', what: 'Write to two orthopaedic doctors' });
    expect(todayPlanAction(today)?.actionId).toBe('a2');
  });
  it('a due follow-up comes first (what the Today page shows first)', () => {
    expect(canonicalTodayMove(today, [{ followUpId: 'f1', what: 'Trimite broșura pe email', contactName: 'Spitalul Clinic' }]))
      .toEqual({ kind: 'follow_up', what: 'Trimite broșura pe email (Spitalul Clinic)', followUpId: 'f1', actionId: null });
  });
  it('nothing ready → the blocked fallback; nothing at all → null', () => {
    const allBlocked: any = { ...PLAN, priorities: [{ ...PLAN.priorities[0], actions: [PLAN.priorities[0].actions[0]] }] };
    const t = selectToday(allBlocked, deriveAllReadiness(allBlocked.priorities[0].actions, [], { strategyStale: false, availableMaterial: new Set(), decisionNeeded: new Set(), constrainedActions: new Map() }));
    expect(canonicalTodayMove(t)).toMatchObject({ kind: 'blocked', actionId: 'a1' });
    expect(canonicalTodayMove(null)).toBeNull();
  });
});
