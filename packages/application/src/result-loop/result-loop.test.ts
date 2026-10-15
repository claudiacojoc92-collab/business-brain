import { describe, it, expect } from 'vitest';
import { ResultLoopService, statusFor } from './result-loop.service';
import { inMemoryResultLoopRepos } from './in-memory';
import { checkParsedReport, type ConfirmedReportItem } from './report';
import { checkConditionChecks, cumulativeEvidence, evaluateCondition, evidenceStatements, type ConditionCheck } from './evidence';
import type { ResultProvenance } from './contracts';

const B = 'biz-bodymove';
const founder: ResultProvenance = { kind: 'founder' };
const leaf = (o: Partial<ConditionCheck> & { condition: string }): ConditionCheck => ({
  measurable: true, kind: 'absolute_count', metric: null, denominator: null, comparator: null, threshold: null, minContacts: null, withinDays: null, parts: [], ...o,
});
function svc(now = new Date('2026-10-14T09:00:00Z')) {
  let n = 0;
  const repos = inMemoryResultLoopRepos();
  let clock = now;
  const s = new ResultLoopService({ ...repos, now: () => clock, id: () => `id${++n}` });
  return { s, repos, setNow: (d: Date) => { clock = d; } };
}

describe('contacts', () => {
  it('creates a contact with provenance, TARGET by default; a name is required', async () => {
    const { s } = svc();
    const c = await s.addContact(B, { type: 'PERSON', name: ' Dr. Ana Pop ', role: 'ortoped', organisationName: 'Clinica Ortopedică' }, founder);
    expect(c).toMatchObject({ name: 'Dr. Ana Pop', role: 'ortoped', status: 'TARGET', source: { kind: 'founder' } });
    await expect(s.addContact(B, { type: 'PERSON', name: '  ' }, founder)).rejects.toThrow(/needs a name/);
  });
});

describe('touches + outcomes are append-only; follow-ups keep what was due and what happened', () => {
  it('a touch is appended (never edited); an outbound touch completes the open follow-up with that touch', async () => {
    const { s, repos } = svc();
    const c = await s.addContact(B, { type: 'PERSON', name: 'Dr. Ana Pop' }, founder);
    const fu = await s.openFollowUp(B, { contactId: c.id, what: 'Send the brochure', dueOn: '2026-10-15', createdBy: 'BB' });
    const t = await s.logTouch(B, { contactId: c.id, channel: 'EMAIL', type: 'SENT', summary: 'Sent the brochure', source: founder, createdBy: 'FOUNDER' });
    const touches = await repos.touches.list(B);
    expect(touches).toHaveLength(1);
    expect(Object.isFrozen(touches[0])).toBe(true); // the store hands out immutable rows
    expect('update' in repos.touches).toBe(false);
    expect('update' in repos.outcomes).toBe(false);
    const [resolved] = await repos.followUps.list(B);
    expect(resolved).toMatchObject({ id: fu.id, status: 'DONE', resolvedByTouchId: t.id, dueOn: '2026-10-15' });
    expect((await repos.contacts.get(B, c.id))!.status).toBe('CONTACTED');
  });

  it('typed outcomes move the contact status; a partner stays a partner', async () => {
    const { s, repos } = svc();
    const c = await s.addContact(B, { type: 'PERSON', name: 'Dr. Ion' }, founder);
    await s.recordOutcome(B, { contactId: c.id, outcomeType: 'MATERIAL_REQUESTED', evidence: founder, createdBy: 'FOUNDER' });
    expect((await repos.contacts.get(B, c.id))!.status).toBe('IN_CONVERSATION');
    await s.recordOutcome(B, { contactId: c.id, outcomeType: 'REFERRAL_RECEIVED', evidence: founder, createdBy: 'FOUNDER' });
    await s.recordOutcome(B, { contactId: c.id, outcomeType: 'NO_RESPONSE', evidence: founder, createdBy: 'FOUNDER' });
    expect((await repos.contacts.get(B, c.id))!.status).toBe('PARTNER');
    await expect(s.recordOutcome(B, { contactId: c.id, outcomeType: 'MAYBE' as never, evidence: founder, createdBy: 'FOUNDER' })).rejects.toThrow(/Unknown outcome/);
  });

  it('reschedule keeps the original due date (RESCHEDULED) and opens a new row pointing at it; cancel resolves once', async () => {
    const { s, repos } = svc();
    const c = await s.addContact(B, { type: 'ORGANISATION', name: 'Clinica X' }, founder);
    const fu = await s.openFollowUp(B, { contactId: c.id, what: 'Call back', dueOn: '2026-10-16', createdBy: 'BB' });
    const next = await s.rescheduleFollowUp(B, fu.id, '2026-10-20', 'FOUNDER');
    expect(next).toMatchObject({ replacesId: fu.id, dueOn: '2026-10-20', status: 'OPEN' });
    expect((await repos.followUps.list(B)).find((f) => f.id === fu.id)).toMatchObject({ status: 'RESCHEDULED', dueOn: '2026-10-16' });
    await s.cancelFollowUp(B, next.id);
    await expect(s.cancelFollowUp(B, next.id)).rejects.toThrow(/open follow-up/);
  });

  it('due(): open follow-ups due today or earlier, oldest first', async () => {
    const { s } = svc();
    const c = await s.addContact(B, { type: 'PERSON', name: 'Dr. A' }, founder);
    await s.openFollowUp(B, { contactId: c.id, what: 'later', dueOn: '2026-10-20', createdBy: 'BB' });
    await s.openFollowUp(B, { contactId: c.id, what: 'today', dueOn: '2026-10-14', createdBy: 'BB' });
    await s.openFollowUp(B, { contactId: c.id, what: 'overdue', dueOn: '2026-10-10', createdBy: 'BB' });
    expect((await s.due(B)).map((d) => d.followUp.what)).toEqual(['overdue', 'today']);
  });

  it('statusFor: a placeholder stays NEEDS_DETAILS until named', () => {
    expect(statusFor('NEEDS_DETAILS', [], [])).toBe('NEEDS_DETAILS');
  });
});

const REPORT = 'The representative visited five clinics. Two were not interested. Two asked for the brochure by email. One doctor wants a follow-up.';
/** What a model would propose for REPORT (5 visits; 2 no, 2 brochure, 1 follow-up), with one item quoting words that are not there. */
const proposal = {
  items: [
    ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION', organisationName: 'Clinic' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'NOT_INTERESTED', note: '' }, quote: 'Two were not interested' })),
    ...[1, 2].map(() => ({ contact: { placeholder: true, type: 'ORGANISATION', organisationName: 'Clinic' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'MATERIAL_REQUESTED', note: 'brochure by email' }, followUp: { what: 'Email the brochure' }, quote: 'Two asked for the brochure by email' })),
    { contact: { placeholder: true, type: 'PERSON', role: 'doctor' }, touch: { channel: 'VISIT', type: 'VISITED' }, outcome: { type: 'FOLLOW_UP_REQUESTED', note: '' }, followUp: { what: 'Follow up with the doctor', dueInDays: 7 }, quote: 'One doctor wants a follow-up' },
    { contact: { placeholder: true }, outcome: { type: 'REFERRAL_RECEIVED' }, quote: 'three referrals already' },
  ],
};

describe('report parsing: proposed by the model, checked here, confirmed by the founder', () => {
  it('keeps only items whose quote is in the founder\'s words; defaults a due date by outcome', () => {
    const p = checkParsedReport(proposal, REPORT, []);
    expect(p.items).toHaveLength(5);
    expect(p.unclear).toEqual(['three referrals already']); // invented: not in her words → never written
    expect(p.items.filter((i) => i.outcome?.type === 'MATERIAL_REQUESTED').every((i) => i.followUp?.dueInDays === 1)).toBe(true);
    expect(p.items[4]!.followUp).toEqual({ what: 'Follow up with the doctor', dueInDays: 7 });
  });

  it('an existing contact id that does not exist is not trusted', () => {
    const p = checkParsedReport({ items: [{ contact: { existingContactId: 'ghost' }, outcome: { type: 'NOT_INTERESTED' }, quote: 'Two were not interested' }] }, REPORT, [{ id: 'real' }]);
    expect(p.items).toHaveLength(0);
  });

  it('confirmed items (one corrected by the founder) become typed touches / outcomes / follow-ups with her words as evidence', async () => {
    const { s, repos } = svc();
    const p = checkParsedReport(proposal, REPORT, []);
    // The founder corrects item 5: it was a neurologist, name known.
    const confirmed: ConfirmedReportItem[] = p.items.map((i, k) => (k === 4 ? { ...i, contact: { ...i.contact, name: 'Dr. Mihai Rus', role: 'neurolog', placeholder: false }, edited: true } : i));
    const w = await s.applyConfirmedReport(B, REPORT, confirmed);
    expect(w.contacts).toHaveLength(5);
    expect(w.touches.every((t) => t.type === 'VISITED' && t.channel === 'VISIT')).toBe(true);
    expect(w.outcomes.map((o) => o.outcomeType)).toEqual(['NOT_INTERESTED', 'NOT_INTERESTED', 'MATERIAL_REQUESTED', 'MATERIAL_REQUESTED', 'FOLLOW_UP_REQUESTED']);
    expect(w.outcomes.every((o) => o.evidence.statement === REPORT && o.evidence.kind === 'report')).toBe(true);
    expect(w.outcomes[4]!.evidence).toMatchObject({ quote: 'One doctor wants a follow-up', editedByFounder: true });
    expect(w.followUps.map((f) => [f.what, f.dueOn])).toEqual([['Email the brochure', '2026-10-15'], ['Email the brochure', '2026-10-15'], ['Follow up with the doctor', '2026-10-21']]);
    expect(w.openBefore).toEqual([]);
    expect(w.openAfter).toHaveLength(3);
    const contacts = await repos.contacts.list(B);
    expect(contacts.filter((c) => c.status === 'NEEDS_DETAILS')).toHaveLength(4); // unnamed clinics: BB will ask who
    expect(contacts.find((c) => c.name === 'Dr. Mihai Rus')!.status).toBe('IN_CONVERSATION');
  });
});

describe('cumulative evidence + the strategy\'s own reconsider conditions', () => {
  it('counts across all logged outreach, not the latest report', async () => {
    const { s, repos, setNow } = svc();
    await s.applyConfirmedReport(B, REPORT, checkParsedReport(proposal, REPORT, []).items);
    setNow(new Date('2026-11-30T09:00:00Z'));
    const later = 'Called the last two clinics: no answer.';
    const c = (await repos.contacts.list(B))[0]!;
    await s.applyConfirmedReport(B, later, [{ id: 'x', contact: { existingContactId: c.id, name: null, organisationName: null, role: null, type: 'ORGANISATION', placeholder: false }, touch: { channel: 'PHONE', type: 'FOLLOW_UP' }, outcome: { type: 'NO_RESPONSE', note: '' }, followUp: null, quote: 'no answer' }]);
    const ev = await s.evidence(B);
    expect(ev).toMatchObject({ contacts: 5, contacted: 5, referrals: 0, daysSinceFirstTouch: 47 });
    expect(ev.outcomes).toMatchObject({ NOT_INTERESTED: 2, MATERIAL_REQUESTED: 2, FOLLOW_UP_REQUESTED: 1, NO_RESPONSE: 1 });
    expect(ev.positiveRate).toBeCloseTo(3 / 5);
    expect(evidenceStatements(ev)[1]).toMatch(/2 not interested, 1 no response, 2 asked for material/);
  });

  it('a shortfall condition is only met once its own window has passed; there is no global minimum', () => {
    const base = cumulativeEvidence({ contacts: [], touches: [], outcomes: [], followUps: [] }, new Date());
    const ev = { ...base, contacted: 8, referrals: 0, daysSinceFirstTouch: 20 };
    const check = leaf({ condition: 'Fewer than 2 referrals within 6 weeks of starting outreach', metric: 'referrals', comparator: '<', threshold: 2, withinDays: 42 });
    expect(evaluateCondition(check, ev).state).toBe('not_yet_measurable');
    expect(evaluateCondition(check, { ...ev, daysSinceFirstTouch: 43 }).state).toBe('met');
    expect(evaluateCondition(check, { ...ev, daysSinceFirstTouch: 43, referrals: 2 }).state).toBe('not_met');
    // With no window and no sample in its own words, the condition is read as stated.
    expect(evaluateCondition({ ...check, withinDays: null }, ev).state).toBe('met');
  });

  it('an exceedance is met as soon as it is crossed; a non-measurable condition never triggers', () => {
    const base = cumulativeEvidence({ contacts: [], touches: [], outcomes: [], followUps: [] }, new Date());
    const ev = { ...base, contacted: 5, outcomes: { NOT_INTERESTED: 4 }, daysSinceFirstTouch: 3 };
    expect(evaluateCondition(leaf({ condition: 'More than 3 clinics say no', metric: 'not_interested', comparator: '>', threshold: 3 }), ev).state).toBe('met');
    expect(evaluateCondition(leaf({ condition: 'If Raluca\'s capacity changes', measurable: false, kind: null }), ev).state).toBe('not_measurable');
  });

  it('checkConditionChecks: only the strategy\'s own conditions; "20" as a rate means 20%; anything malformed is unmeasurable', () => {
    const conds = ['Response rate below 20% after 10 clinics', 'If the founder\'s time changes'];
    const out = checkConditionChecks({ checks: [
      { condition: conds[0], measurable: true, metric: 'response_rate', comparator: '<', threshold: 20, minContacts: 10 },
      { condition: conds[1], measurable: true, metric: 'made_up', comparator: '<', threshold: 1 },
      { condition: 'An invented condition', measurable: true, metric: 'referrals', comparator: '<', threshold: 1 },
    ] }, conds);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ measurable: true, kind: 'ratio', metric: 'responded', denominator: 'contacts_reached', threshold: 0.2, minContacts: 10 });
    expect(out[1]).toMatchObject({ measurable: false, metric: null });
  });

  // Blocker 1 (acceptance 2026-10-14): "more than half of the clinics contacted refuse" was evaluated as `not_interested > 0.5`.
  describe('quantity semantics: a proportion is a ratio, never a bare count', () => {
    const HALF = 'Dacă peste jumătate din clinicile contactate refuză explicit';
    const ratio = leaf({ condition: HALF, kind: 'ratio', metric: 'not_interested', denominator: 'contacts_reached', comparator: '>', threshold: 0.5 });
    const at = (refused: number, reached: number) => ({ ...cumulativeEvidence({ contacts: [], touches: [], outcomes: [], followUps: [] }, new Date()), contacts: reached, contacted: reached, outcomes: { NOT_INTERESTED: refused }, daysSinceFirstTouch: 9 });

    it('2 rejected / 7 reached / threshold > 50% → NOT_MET', () => {
      const e = evaluateCondition(ratio, at(2, 7));
      expect(e.state).toBe('not_met');
      expect(e.observed).toBeCloseTo(2 / 7);
      expect(e.detail).toBe('not_interested / contacts_reached = 2/7 = 28.6% (condition: > 50%)');
    });
    it('4 rejected / 7 reached / threshold > 50% → MET', () => {
      expect(evaluateCondition(ratio, at(4, 7)).state).toBe('met');
    });
    it('nobody reached yet → not yet measurable (never met)', () => {
      expect(evaluateCondition(ratio, at(0, 0)).state).toBe('not_yet_measurable');
    });
    it('a proportion structured as a count (`not_interested > 0.5`) is refused as unmeasurable, so it can never fire', () => {
      const [c] = checkConditionChecks({ checks: [{ condition: HALF, measurable: true, metric: 'not_interested', comparator: '>', threshold: 0.5 }] }, [HALF]);
      expect(c).toMatchObject({ measurable: false });
      expect(evaluateCondition(c!, at(2, 7)).state).toBe('not_measurable');
    });
    it('a ratio given as a percentage is a fraction; a ratio over contacts_reached cannot be "contacts reached"', () => {
      const out = checkConditionChecks({ checks: [
        { condition: HALF, measurable: true, kind: 'ratio', metric: 'not_interested', denominator: 'contacts_reached', comparator: '>', threshold: 50 },
        { condition: 'x', measurable: true, kind: 'ratio', metric: 'contacts_reached', comparator: '>', threshold: 0.5 },
      ] }, [HALF, 'x']);
      expect(out[0]).toMatchObject({ measurable: true, kind: 'ratio', threshold: 0.5 });
      expect(out[1]).toMatchObject({ measurable: false });
    });
    it('a referral shortfall over 8 weeks, 9 days in → not yet measurable', () => {
      const cond = 'Mai puțin de 2 recomandări noi în 8 săptămâni de la începerea contactării sistematice';
      const [c] = checkConditionChecks({ checks: [{ condition: cond, measurable: true, kind: 'absolute_count', metric: 'referrals', comparator: '<', threshold: 2, withinDays: 56 }] }, [cond]);
      expect(evaluateCondition(c!, at(2, 7)).state).toBe('not_yet_measurable');
    });
    it('a combined condition: all parts must be met; any not-met part makes it not met', () => {
      const cond = 'Fewer than 2 referrals and more than half refuse';
      const [c] = checkConditionChecks({ checks: [{ condition: cond, measurable: true, kind: 'all', parts: [
        { kind: 'absolute_count', metric: 'referrals', comparator: '<', threshold: 2 },
        { kind: 'ratio', metric: 'not_interested', denominator: 'contacts_reached', comparator: '>', threshold: 0.5 },
      ] }] }, [cond]);
      expect(c).toMatchObject({ measurable: true, kind: 'all' });
      expect(evaluateCondition(c!, at(2, 7)).state).toBe('not_met');
      expect(evaluateCondition(c!, at(4, 7)).state).toBe('met');
    });
  });
});
