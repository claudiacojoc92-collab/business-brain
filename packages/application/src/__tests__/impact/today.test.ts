import { describe, it, expect } from 'vitest';
import { classify, todayFactFromReport, type CurrentMoveRef, type ImpactSignal } from '../../impact/index';
import { ResultLoopService } from '../../result-loop/result-loop.service';
import { inMemoryResultLoopRepos } from '../../result-loop/in-memory';
import type { FollowUp } from '../../result-loop/contracts';

// Blocker 2 (acceptance 2026-10-14): the same current move + new FUTURE follow-ups was reported as "Today: CHANGED".
// Today is the current move; the execution queue is a separate fact.

const signal: ImpactSignal = {
  changeKind: 'none', matchedReconsider: null, contradictsAssumption: false, assumptionImpacts: [], whatChanged: [], whatDidNotChange: [],
  todayNextMove: null, todayReason: '', founderStateKind: 'constraint', conflictsWithCurrentMove: false,
};
const brochure: CurrentMoveRef = { followUpId: 'f-hosp', what: 'Trimite broșura pe email', contactName: 'Spitalul Clinic de Recuperare', dueOn: '2026-10-14', reason: 'au cerut broșura pe email' };
const fu = (id: string, dueOn: string): FollowUp => ({
  id, businessId: 'B', contactId: 'c', what: 'Trimite broșura', reason: 'x', dueOn, status: 'OPEN', createdFrom: null, replacesId: null,
  resolvedByTouchId: null, resolvedAt: null, createdBy: 'FOUNDER', createdAt: 't',
});

describe('Today = the current move, apart from the execution queue', () => {
  it('same selected current move + new future follow-ups → Today UNCHANGED (queue reported separately)', () => {
    const fact = todayFactFromReport(brochure, brochure, [fu('a', '2026-10-15'), fu('b', '2026-10-15'), fu('c', '2026-10-21')]);
    expect(fact).toEqual({ changed: false, move: null, reason: null, queue: { added: 3, firstDueOn: '2026-10-15' } });
    const r = classify(signal, { hasHeldStrategy: true, source: 'outcome_report', today: fact });
    expect(r.todayImpact).toMatchObject({ changes: false, newMove: null, reasonCode: 'impact.today.unchanged', followUpsAdded: { count: 3, firstDueOn: '2026-10-15' } });
    expect(r.verdict).toBe('TUNE'); // execution adjusted (new follow-ups); the bet and Today's move did not change
  });

  it('different selected current move → Today CHANGED, with the new move and why', () => {
    const next: CurrentMoveRef = { followUpId: 'f-dr', what: 'Sună medicul', contactName: 'Dr. Rus', dueOn: '2026-10-14', reason: 'vrea să revenim' };
    const fact = todayFactFromReport(brochure, next, []);
    expect(fact).toEqual({ changed: true, move: 'Sună medicul (Dr. Rus, 2026-10-14)', reason: 'vrea să revenim', queue: null });
    const r = classify(signal, { hasHeldStrategy: true, source: 'outcome_report', today: fact });
    expect(r.todayImpact).toMatchObject({ changes: true, newMove: 'Sună medicul (Dr. Rus, 2026-10-14)', followUpsAdded: null });
  });

  it('no move before, one due today after → CHANGED; none before and none after → UNCHANGED', () => {
    expect(todayFactFromReport(null, brochure, [fu('a', '2026-10-14')]).changed).toBe(true);
    expect(todayFactFromReport(null, null, [fu('a', '2026-10-20')])).toMatchObject({ changed: false, queue: { added: 1 } });
  });

  it('ResultLoopService: a report adding only future follow-ups keeps the same current move', async () => {
    const repos = inMemoryResultLoopRepos();
    let n = 0;
    const s = new ResultLoopService({ ...repos, now: () => new Date('2026-10-14T09:00:00Z'), id: () => `id${++n}` });
    const hosp = await s.addContact('B', { type: 'ORGANISATION', name: 'Spital' }, { kind: 'founder' });
    await s.openFollowUp('B', { contactId: hosp.id, what: 'Trimite broșura pe email', reason: 'au cerut', dueOn: '2026-10-14', createdBy: 'BB' });
    const w = await s.applyConfirmedReport('B', 'Două clinici au cerut broșura.', [
      { id: 'i1', contact: { existingContactId: null, name: null, organisationName: null, role: null, type: 'ORGANISATION', placeholder: true }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'MATERIAL_REQUESTED', note: '' }, followUp: { what: 'Trimite broșura', dueInDays: 1 }, quote: 'Două clinici au cerut broșura.' },
    ]);
    expect(w.currentBefore?.followUpId).toBe(w.currentAfter?.followUpId);
    const fact = todayFactFromReport(w.currentBefore, w.currentAfter, w.followUps);
    expect(fact).toMatchObject({ changed: false, queue: { added: 1, firstDueOn: '2026-10-15' } });
  });
});
