/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { MirrorService, governReadUpdate, type MirrorReadInput, type MirrorReadOutput } from '../../mirror/index';
import { pairExchanges, strategyRead } from '../../arc/arc.service';

// UPDATED READ (2026-10-16): the mirror becomes the payoff of the understanding questions. An invented business.
const SNAP = {
  understanding: {
    offer: { summary: 'Classes and physio in two studios.', sourceRefs: [] }, positioning: { summary: '', evidenceBacked: [], sourceRefs: [] },
    audience: { addressed: [], sourceRefs: [] }, acquisition: { visiblePaths: [], sourceRefs: [] }, messaging: { recurringThemes: [], sourceRefs: [] },
    unknowns: ['Which lines bring the most clients?', 'Where do new clients come from?', 'Is physio also offered at Riverside?'],
    read: { structure: {
      synthesis: 'Classes are booked from the timetable, while physio starts with a paid assessment.',
      hypotheses: [{ interpretation: 'The two studios may play different roles.', evidence: [{ ref: 'Locations', quote: 'Services: Physio' }], alternative: 'Space or staffing.', reversal: 'Physio by appointment at Riverside.', discriminator: { unknown: 'Why physio is not at Riverside.', question: 'Is physio offered at Riverside?' } }],
    } },
  },
};
const STATE = [
  { id: 'g', kind: 'goal', statement: 'Grow the number of clients across all services', scope: null, temporary: false, status: 'active', sourceTurnId: 't6' },
  { id: 'f', kind: 'resource', statement: 'Referrals bring most clients', scope: null, temporary: false, status: 'active' },
];
const EXCHANGES = [
  { asked: 'Which lines bring the most clients?', answer: 'Riverside earns from pilates and massage, Old Town from group training and massage, less from physio.' },
  { asked: 'Where do new clients come from?', answer: 'Referrals and organic content; a prenatal event got no sign-ups.' },
  { asked: 'Is physio also offered at Riverside?', answer: '(skip)' },
];
const input = (over: Partial<MirrorReadInput> = {}): MirrorReadInput => ({
  businessName: 'Northside', interfaceLanguage: 'en', synthesis: 'S', hypotheses: [{ interpretation: 'The studios may play different roles.', evidence: [], alternative: 'a', unknown: 'u', question: 'q', reversal: 'r' }],
  questions: [], exchanges: EXCHANGES, goal: 'Grow the number of clients across all services', observed: [], business: [], ...over,
});
const field = (f: string, text: string, answers = [0], evidence = ['H0']) => ({ field: f as any, text, answers, evidence });

describe('updated read governance', () => {
  it('keeps grounded consequences; "what changed" only when a prior reading actually moved', () => {
    const out: MirrorReadOutput = {
      hypotheses: [{ index: 0, status: 'sharpened', because: 'answer 0 shows each studio earns from different lines' }],
      fields: [
        field('now', 'Each studio earns from different lines, and massage runs in both.'),
        field('changed', 'I read the studios as maybe playing different roles; now it is clear they earn from different lines.'),
        field('matters', 'Growth is not starting from zero: the open question is whether that word of mouth can be made repeatable.', [1]),
        field('next', 'Which line each studio should lead with before choosing any channel.', [0, 1]),
      ],
    };
    const g = governReadUpdate(out, input())!;
    // launch: three sections; "what matters most" is folded into "what I'd look at next"
    expect(Object.keys(g.read!)).toEqual(['now', 'changed', 'next']);
    expect(g.audit.grounding.map((x) => x.field)).toEqual(['now', 'changed', 'next']);
    expect(g.audit.dropped).toContainEqual({ field: 'matters', reason: 'not shown at launch (folded into next)' });
    // no movement → no "what changed" (never manufactured)
    const still = governReadUpdate({ ...out, hypotheses: [{ index: 0, status: 'unresolved', because: '' }] }, input())!;
    expect(still.read!.changed).toBeUndefined();
    expect(still.audit.dropped).toContainEqual({ field: 'changed', reason: 'no prior read actually moved' });
  });

  it('drops a field with no founder answer behind it (a skipped answer does not count), a restatement, a question, exposed labels and unlicensed claims', () => {
    const g = governReadUpdate({ hypotheses: [], fields: [
      field('now', 'Each studio carries a different part of the business. Your clients clearly trust you more than anyone in town.'),
      field('next', 'Should you add physio at Riverside?', [0]),
      field('changed', 'Referrals and organic content bring clients; a prenatal event got no sign-ups.', [1]),
    ] }, input())!;
    expect(g.read).toEqual({ now: 'Each studio carries a different part of the business.' }); // the unlicensed sentence goes, the rest stays
    expect(g.audit.dropped.map((d) => d.reason.split(' (')[0])).toEqual(['escalation', 'a claim the founder did not license', 'a question', 'restates the answers']); // "clearly" is an intensity the founder never stated
    expect(governReadUpdate({ hypotheses: [], fields: [field('now', 'A read with only the skipped answer.', [2])] }, input())!.read).toBeUndefined();
    expect(governReadUpdate({ hypotheses: [], fields: [field('now', 'The hypothesis was strengthened by your answer.')] }, input())!.read).toBeUndefined();
  });

  it('"next" may name what BB would check (conversion, retention) without it reading as a claim', () => {
    const g = governReadUpdate({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.'),
      field('next', 'I would look first at how many assessments convert into memberships: if few do, the problem is after the assessment.', [1])] }, input())!;
    expect(g.read!.next).toBe('I would look first at how many assessments convert into memberships: if few do, the problem is after the assessment.');
  });

  it('a skipped deciding question keeps its hypothesis unresolved: "what changed" cannot claim that fork moved', () => {
    const g = governReadUpdate({ hypotheses: [{ index: 0, status: 'sharpened', because: 'the studios earn from different lines' }], fields: [
      field('now', 'Each studio carries a different part of the business.'),
      field('changed', 'The split between the studios is deliberate, not an accident of space.'),
    ] }, input({ unresolved: [0] }))!;
    expect(g.audit.hypotheses[0]!.status).toBe('unresolved');
    expect(g.read!.changed).toBeUndefined();
  });

  it('anchored to the top theses: "next" must be about one of them (an H-ref), never a new topic', () => {
    const g = governReadUpdate({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.'), field('next', 'I would look at how massage clients move to other services next.', [0], ['O3'])] }, input({ anchored: true }))!;
    expect(g.read!.next).toBeUndefined();
    expect(g.audit.dropped).toContainEqual({ field: 'next', reason: 'not anchored to a top thesis' });
    const anchoredInput = input({ anchored: true, hypotheses: [{ interpretation: 'The paid assessment may gate entry into recovery programmes.', evidence: [], alternative: 'a', unknown: 'Whether the assessment is mandatory.', question: 'Is the assessment mandatory?', reversal: 'r' }] });
    const ok = governReadUpdate({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.'), field('next', 'I would look first at whether the assessment is mandatory before any programme.', [0], ['H0'])] }, anchoredInput)!;
    expect(ok.read!.next).toBe('I would look first at whether the assessment is mandatory before any programme.');
    // citing a thesis is not enough: the move must be ABOUT it
    const off = governReadUpdate({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.'), field('next', 'I would look at how massage clients move to other services next.', [0], ['H0'])] }, anchoredInput)!;
    expect(off.audit.dropped).toContainEqual({ field: 'next', reason: 'not anchored to a top thesis' });
  });

  it('conservative language: an escalation the founder did not state is removed sentence by sentence; the facts stay', () => {
    const g = governReadUpdate({ hypotheses: [], fields: [
      field('now', 'Physio brings less than the classes. Physio is stagnating. Clients come from referrals and content.'),
      field('next', 'Clients arrive exclusively through referrals, with no channel at all. I would look first at how many assessments become memberships.', [1]),
    ] }, input())!;
    expect(g.read).toEqual({ now: 'Physio brings less than the classes. Clients come from referrals and content.', next: 'I would look first at how many assessments become memberships.' });
    expect(g.audit.dropped.map((d) => d.reason.split(':')[0])).toEqual(['escalation (stagn)', 'escalation (exclusiv, no channel)']);
    // the founder's own word licenses it
    const said = governReadUpdate({ hypotheses: [], fields: [field('now', 'Physio is stagnating while the classes grow.')] },
      input({ exchanges: [{ asked: 'q', answer: 'physio is stagnating this year' }] }))!;
    expect(said.read!.now).toBe('Physio is stagnating while the classes grow.');
  });

  it('launch length: at most two sentences per section', () => {
    const g = governReadUpdate({ hypotheses: [], fields: [field('now', 'One about the studios. Two about the lines. Three that is too much.')] }, input())!;
    expect(g.read!.now).toBe('One about the studios. Two about the lines.');
  });

  it('without "now" there is no read (the contrast stays the fallback)', () => {
    expect(governReadUpdate({ hypotheses: [], fields: [field('matters', 'A consequence.')] }, input())!.read).toBeUndefined();
    expect(governReadUpdate(null, input())).toBeNull();
  });
});

describe('MirrorService builds the updated read beside the contrast', () => {
  const deps = (readUpdate?: (i: MirrorReadInput) => Promise<MirrorReadOutput | null>) => {
    const seen: MirrorReadInput[] = [];
    return { seen, deps: {
      understanding: { latest: async () => SNAP } as any,
      state: { listActive: async () => STATE } as any,
      strategy: { getCurrent: async () => null } as any,
      model: {
        contrast: async () => ({ mismatches: [{ founderWords: 'Referrals bring most clients', founderLane: 'business' as const, against: 'Classes and physio in two studios.', againstLane: 'observed' as const, tension: 't' }] }),
        ...(readUpdate ? { readUpdate: async (i: MirrorReadInput) => { seen.push(i); return readUpdate(i); } } : {}),
      },
    } };
  };

  it('feeds the structural read, the shown questions, the paired answers and the goal (stored state only)', async () => {
    const m = deps(async () => ({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.')] }));
    const view = await new MirrorService(m.deps).build('B', 'Northside', 'en', { exchanges: EXCHANGES });
    const i = m.seen[0]!;
    expect(i.synthesis).toBe('Classes are booked from the timetable, while physio starts with a paid assessment.');
    expect(i.hypotheses[0]).toMatchObject({ interpretation: 'The two studios may play different roles.', evidence: ['Services: Physio'], unknown: 'Why physio is not at Riverside.', question: 'Is physio offered at Riverside?', reversal: 'Physio by appointment at Riverside.' });
    expect(i.questions).toEqual(SNAP.understanding.unknowns);
    expect(i.exchanges).toEqual(EXCHANGES);
    expect(i.goal).toBe('Grow the number of clients across all services');
    expect(i.business).toEqual(['Referrals bring most clients']); // the goal is not repeated as a fact
    expect(view.read).toEqual({ now: 'Each studio carries a different part of the business.' });
    expect(view.contrasts).toHaveLength(1);
  });

  it('the B question the founder skipped marks its hypothesis unresolved in the input', async () => {
    const snap = { understanding: { ...SNAP.understanding, read: { ...SNAP.understanding.read, questionTiers: [{ question: 'Is physio also offered at Riverside?', tier: 'B', reason: 'settles 1', resolves: 0 }] } } };
    const m = deps(async () => ({ hypotheses: [], fields: [field('now', 'Each studio carries a different part of the business.')] }));
    (m.deps.understanding as any) = { latest: async () => snap };
    await new MirrorService(m.deps).build('B', 'Northside', 'en', { exchanges: EXCHANGES });
    expect(m.seen[0]!.unresolved).toEqual([0]);
  });

  it('a failing read call leaves the contrast standing; no answers → no read call', async () => {
    const broken = deps(async () => { throw new Error('boom'); });
    const v1 = await new MirrorService(broken.deps).build('B', 'Northside', 'en', { exchanges: EXCHANGES });
    expect(v1.read).toBeUndefined();
    expect(v1.contrasts).toHaveLength(1);
    const unasked = deps(async () => ({ hypotheses: [], fields: [] }));
    await new MirrorService(unasked.deps).build('B', 'Northside', 'en', { exchanges: [{ asked: 'q', answer: '(skip)' }] });
    expect(unasked.seen).toHaveLength(0);
  });
});

describe('arc: answers paired to questions; strategy gets the read the founder saw', () => {
  it('pairs each founder turn with the BB turn that asked it (the opener question is its invitation)', () => {
    const turns = [
      { id: '1', role: 'bb' as const, content: JSON.stringify({ __arcOpener: { lead: 'I read it all.', bullets: ['x'], invitation: 'Which lines bring the most clients?' } }) },
      { id: '2', role: 'founder' as const, content: 'Pilates and massage.' },
      { id: '3', role: 'bb' as const, content: 'Got it. Where do new clients come from?' },
      { id: '4', role: 'founder' as const, content: 'Referrals.' },
    ];
    expect(pairExchanges(turns)).toEqual([
      { asked: 'Which lines bring the most clients?', answer: 'Pilates and massage.' },
      { asked: 'Got it. Where do new clients come from?', answer: 'Referrals.' },
    ]);
  });

  it('strategy context: synthesis, readings, answered exchanges (skips dropped) and the updated read', () => {
    const r = strategyRead(SNAP.understanding as any, EXCHANGES, { now: 'n', matters: 'm' })!;
    expect(r.synthesis).toBe(SNAP.understanding.read.structure.synthesis);
    expect(r.readings).toEqual(['The two studios may play different roles.']);
    expect(r.exchanges).toHaveLength(2);
    expect(r.updatedRead).toEqual({ now: 'n', matters: 'm' });
    expect(strategyRead({ offer: {} } as any, EXCHANGES, null)).toBeNull();
  });
});
