/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { ArcService, compactRecord, governTheses, thesisInput, thesesWithStatus, type ArcFlags, type ThesisInput, type ThesisModelOutput } from '../../arc/index';

// STRATEGIC THESES (2026-10-16). Generic by construction: the fixtures are an invented B2B software business.
const U: any = {
  offer: { summary: 'You sell a scheduling tool on monthly plans and a paid onboarding project for larger teams.', explicit: [], unclear: [] },
  positioning: { summary: '', evidenceBacked: [], implied: [] }, audience: { addressed: [], appearsTargeted: [], unknown: [] },
  messaging: { recurringThemes: [] }, contradictions: [], acquisition: { visiblePaths: ['Start a free trial', 'Book a demo'] },
  unknowns: ['Which plans bring the most revenue today?', 'Where do new customers come from?'],
  read: {
    model: [
      { dimension: 'offer', known: [{ text: 'Monthly plans start at 29 per seat.', basis: 'observed' }, { text: 'An onboarding project is sold separately to teams above 50 seats.', basis: 'observed' }, { text: 'Probably popular.', basis: 'inferred' }], unknown: ['which plan sells most'] },
      { dimension: 'performance', known: [], unknown: ['revenue by plan'] },
    ],
    notConcluding: [{ claim: 'Which plan drives revenue', why: 'no data' }], untrusted: [], websiteNotes: [], diagnosis: { state: 'not_ready', statement: '', checks: {} },
    questions: [
      { question: 'Which plans bring the most revenue today?', why: 'It tells me what carries the business.', dimension: 'performance', changes: ['bet'] },
      { question: 'Where do new customers come from?', why: 'It tells me which paths are real.', dimension: 'acquisition', changes: ['channel'] },
    ],
    questionTiers: [], strategyReadiness: { state: 'not_ready', missing: ['performance', 'acquisition'] },
    structure: {
      synthesis: 'Small teams self-serve through a trial, while larger teams enter through a demo and a paid onboarding project.',
      mechanisms: [], hypotheses: [{ interpretation: 'Two buying motions under one product.', alternative: 'One motion with a size threshold.', reversal: 'Large teams also self-serve.', discriminator: { unknown: 'How large teams actually buy.', question: 'q' }, evidence: [] }],
    },
  },
};
const IN = thesisInput(U, 'Slotly', 'en') as ThesisInput;
const thesis = (o: Partial<ThesisModelOutput['theses'][number]> = {}): ThesisModelOutput['theses'][number] => ({
  id: 'T', headline: 'Two buying motions', facts: ['F1', 'F3'], relationship: 'Small teams self-serve while large teams buy through a demo and a paid project.',
  implication: 'The two motions may need different acquisition and conversion work.', decisions: ['acquisition', 'conversion'], ifTrue: 'Acquisition is planned per motion, not as one funnel.',
  weakenedBy: 'Large teams also start with the free trial.', unknown: 'How large teams actually enter.', question: 'How did your last five large teams first start using the product?',
  questionWhy: 'It shows whether large teams need their own path in.', dimensions: ['acquisition', 'conversion'], priority: 1,
  founder: { headline: 'Two ways in', body: 'Small teams try it alone; large teams buy through a demo and a project. That may need two separate paths in.', refs: ['F1', 'F3'] }, ...o,
});
const out = (theses: ThesisModelOutput['theses'], myRead: ThesisModelOutput['myRead'] = [{ text: 'This suggests you run one product through two buying motions.', kind: 'interpretation', refs: ['F1', 'F3'] }]): ThesisModelOutput =>
  ({ businessModel: { motions: [{ name: 'self-serve', entry: ['self_serve'], buying: ['trial'], continuation: ['subscription'], refs: ['F1'] }, { name: 'invented', entry: [], buying: [], continuation: [], refs: ['X9'] }], offerRoles: [], decisionPoints: [] }, myRead, theses });

describe('thesis input: governed material only', () => {
  it('numbers the verified facts (offer, observed lines, visible paths), never the inferred ones; null only with too little to reason on', () => {
    expect(IN.facts.map((f) => f.text)).toEqual([
      'You sell a scheduling tool on monthly plans and a paid onboarding project for larger teams.', 'Monthly plans start at 29 per seat.',
      'An onboarding project is sold separately to teams above 50 seats.', 'Visible path to buy or book: Start a free trial', 'Visible path to buy or book: Book a demo']);
    expect(IN.unknowns).toContain('performance: revenue by plan');
    expect(thesisInput({ ...U, read: { ...U.read, structure: { ...U.read.structure, synthesis: '' } } }, 'S', 'en')!.synthesis).toBe('');
    expect(thesisInput({ offer: { summary: 'only one fact' }, unknowns: [] } as any, 'S', 'en')).toBeNull(); // too little to reason on
  });
});

describe('existing v1 snapshots (no structured read) are supported', () => {
  const V1: any = { offer: { summary: 'You sell handmade tableware online.', explicit: ['Dinner plates', 'Mugs'], unclear: [] }, positioning: { summary: '', evidenceBacked: ['Made in the US'], implied: [] },
    audience: { addressed: ['home cooks'], appearsTargeted: [], unknown: [] }, acquisition: { visiblePaths: ['Shop now'] }, messaging: { recurringThemes: [] }, contradictions: [], unknowns: ['Which products sell most?', 'not a question'] };
  it('builds the input from the v1 governed fields and fills questions from its stored unknowns', () => {
    const i = thesisInput(V1, 'Ware', 'en')!;
    expect(i.facts.map((f) => f.text)).toEqual(['You sell handmade tableware online.', 'Stated by the business: Dinner plates', 'Stated by the business: Mugs', 'Positioning the sources back up: Made in the US', 'The business addresses: home cooks', 'Visible path to buy or book: Shop now']);
    expect(i.synthesis).toBe('');
    const r = governTheses(out([thesis({ facts: ['F1', 'F6'], question: 'Do buyers come back for a second set?' })]), i, V1, 's')!;
    expect(r.questions.map((q) => q.question)).toEqual(['Do buyers come back for a second set?', 'Which products sell most?']);
  });
});

describe('eligibility is a gate, never a score', () => {
  it('rejects a thesis without two governed facts, a decision, a way to be wrong, or with invented economics; a bad question only loses its question', () => {
    const r = governTheses(out([
      thesis(),
      thesis({ facts: ['F1'] }),
      thesis({ decisions: [] }),
      thesis({ weakenedBy: '' }),
      thesis({ question: 'Should you add a cheaper plan?', relationship: 'The onboarding project is sold only to teams above a seat threshold.', implication: 'Smaller teams may never meet the project offer.' }),
      thesis({ relationship: 'The onboarding project has the best margin in the business.' }),
    ]), IN, U, 'snap')!;
    const reasons = r.theses.filter((t) => !t.eligibility.pass).map((t) => t.eligibility.reasons[0]!.split(' (')[0]);
    expect(reasons).toEqual(['connects fewer than two governed facts', 'names no decision it would change', 'not reversible', 'relationship: ungrounded inference']);
    // A thesis whose question presupposes a future stays eligible, but never supplies a question to the founder.
    expect(r.theses.find((t) => t.question === 'Should you add a cheaper plan?')!.eligibility.pass).toBe(true);
    expect(r.questions.map((q) => q.question)).not.toContain('Should you add a cheaper plan?');
  });
});

describe('ranking: decision leverage first, grounding only breaks ties; an observation is never top', () => {
  it('a high-leverage thesis outranks an easier-to-prove one, and an observation-only thesis cannot be top-ranked', () => {
    const observation = thesis({ headline: 'Plans and projects', facts: ['F1', 'F2', 'F3', 'F4'], relationship: 'Monthly plans start at 29 per seat.', implication: '', decisions: ['pricing'], ifTrue: '' });
    const narrow = thesis({ headline: 'Price anchor', facts: ['F2', 'F3', 'F4', 'F5'], relationship: 'The per-seat price and the project price are shown on different pages.', implication: 'Buyers may compare them separately.', decisions: ['pricing'], ifTrue: '', dimensions: ['offer'], priority: 3, question: 'Do large teams ask about the project price before the demo?' });
    const r = governTheses(out([observation, narrow, thesis({ priority: 2 })]), IN, U, 'snap')!;
    expect(r.top[0]).toBe('T3'); // leverage beats the better-grounded pricing note
    expect(r.top).not.toContain('T1'); // observation-only, whatever its grounding
    const ranks = Object.fromEntries(r.theses.map((t) => [t.id, t.rank]));
    expect(ranks['T1']).toBeGreaterThan(ranks['T2']!);
  });

  it('a thesis making the same point as a higher-ranked one is dropped', () => {
    const r = governTheses(out([thesis(), thesis({ headline: 'Same again', priority: 2 })]), IN, U, 'snap')!;
    expect(r.theses.filter((t) => t.rank)).toHaveLength(1);
    expect(r.dropped.some((d) => d.reason === 'duplicates a higher-ranked thesis')).toBe(true);
  });
});

describe('questions come from the theses', () => {
  it('the current driver first when performance is unknown, then the top thesis question; filled from the governed questions; resolves → thesis id', () => {
    const r = governTheses(out([thesis()]), IN, U, 'snap')!;
    expect(r.questions.map((q) => [q.tier, q.question, q.resolves])).toEqual([
      ['A', 'Which plans bring the most revenue today?', undefined],
      ['B', 'How did your last five large teams first start using the product?', 'T1'],
      ['C', 'Where do new customers come from?', undefined],
    ]);
  });
});

describe('the founder copy is re-checked', () => {
  it('my read keeps grounded sentences only (no catalogue, no overlong sentence, no new fact); matters = the top theses', () => {
    const r = governTheses(out([thesis()], [
      { text: 'This suggests you run one product through two buying motions.', kind: 'interpretation', refs: ['F1', 'F3'] },
      { text: 'You sell plans, projects, add-ons, training, support, audits and consulting.', kind: 'fact', refs: ['F1'] },
      { text: 'Your plans are the strongest growth engine with 500 customers.', kind: 'fact', refs: ['F2'] },
      { text: 'This one cites nothing.', kind: 'fact', refs: [] },
    ]), IN, U, 'snap')!;
    expect(r.founder.myRead).toBe('This suggests you run one product through two buying motions.');
    expect(r.founder.matters).toEqual([{ thesisId: 'T1', headline: 'Two ways in', body: 'Small teams try it alone; large teams buy through a demo and a project. That may need two separate paths in.' }]);
    expect(r.dropped.map((d) => d.reason.split(' (')[0])).toEqual(expect.arrayContaining(['a catalogue, not a read', 'a number the governed input does not contain', 'no governed fact cited']));
    expect(r.businessModel.motions.map((m) => m.name)).toEqual(['self-serve']); // the uncited motion is dropped
  });

  it('nothing usable → null (the card and the flow keep their existing behaviour)', () => {
    expect(governTheses(null, IN, U, 's')).toBeNull();
    expect(governTheses(out([thesis({ facts: [] })], []), IN, U, 's')).toBeNull();
  });
});

describe('founder copy length and the driver question', () => {
  it('a sentence over 30 words is shortened at a clause boundary, never shown at full length', () => {
    const long = 'This suggests you run one product through two buying motions, with small teams trying it alone on monthly plans while larger teams arrive through demos and paid onboarding projects that take several weeks to complete.';
    const r = governTheses(out([thesis()], [{ text: long, kind: 'interpretation', refs: ['F1', 'F3'] }]), IN, U, 's')!;
    expect(r.founder.myRead).toBe('This suggests you run one product through two buying motions.');
  });

  it('an older snapshot without a stored driver question gets the model\'s clean driver question; a presupposing one is refused', () => {
    const V1: any = { offer: { summary: 'You sell handmade tableware online.', explicit: ['Plates', 'Mugs'], unclear: [] }, positioning: { summary: '', evidenceBacked: [], implied: [] }, audience: { addressed: [], appearsTargeted: [], unknown: [] }, acquisition: { visiblePaths: ['Shop now'] }, messaging: { recurringThemes: [] }, contradictions: [], unknowns: [] };
    const i = thesisInput(V1, 'Ware', 'en')!;
    const ok = governTheses({ ...out([thesis({ facts: ['F1', 'F2'] })]), driverQuestion: { text: 'Which products bring most of your orders and revenue today?', why: '' } }, i, V1, 's')!;
    expect(ok.questions[0]).toMatchObject({ tier: 'A', dimension: 'performance', question: 'Which products bring most of your orders and revenue today?' });
    const bad = governTheses({ ...out([thesis({ facts: ['F1', 'F2'] })]), driverQuestion: { text: 'Should you add a cheaper line to grow faster?', why: '' } }, i, V1, 's')!;
    expect(bad.questions.some((q) => q.tier === 'A')).toBe(false);
  });
});

describe('MY READ separates fact from interpretation', () => {
  it('a fact may not claim primacy the evidence does not state; an interpretation must read as a reading', () => {
    const r = governTheses(out([thesis()], [
      { text: 'Monthly plans are the main continuation mechanism.', kind: 'fact', refs: ['F2'] },
      { text: 'Two buying motions coexist under one product.', kind: 'interpretation', refs: ['F1', 'F3'] },
      { text: 'This suggests two buying motions coexist under one product.', kind: 'interpretation', refs: ['F1', 'F3'] },
      { text: 'Monthly plans are the most visible continuation mechanism in the offer.', kind: 'fact', refs: ['F2'] },
    ]), IN, U, 's')!;
    // "the most VISIBLE … in the offer" is an observable description, allowed as a fact
    expect(r.founder.myRead).toBe('This suggests two buying motions coexist under one product. Monthly plans are the most visible continuation mechanism in the offer.');
    expect(r.dropped.map((d) => d.text)).toEqual(expect.arrayContaining(['Monthly plans are the main continuation mechanism.', 'Two buying motions coexist under one product.']));
    expect(r.dropped.map((d) => d.reason)).toContain('an interpretation stated as a fact (no reading marker)');
  });
});

describe('carry-forward helpers', () => {
  it('the record fits the event budget; the top theses carry their latest status', () => {
    const r = governTheses(out([thesis()]), IN, U, 'snap')!;
    expect(JSON.stringify(compactRecord({ ...r, dropped: Array.from({ length: 400 }, (_, i) => ({ part: 'p', text: `x${i}`.repeat(20), reason: 'r' })) })).length).toBeLessThanOrEqual(18000);
    const t = thesesWithStatus(r, [{ thesisId: 'T1', status: 'sharpened', because: 'answer 2' }]);
    expect(t.map((x) => [x.id, x.status, x.because])).toEqual([['T1', 'sharpened', 'answer 2']]);
  });
});

describe('ArcService: the thesis pass runs once per snapshot (existing snapshots included)', () => {
  const OFF: ArcFlags = { pourInDone: true, understandingConfirmed: false, mirrorSeen: false, emailExported: false, containerSeen: false };
  const deps = (compose: () => Promise<ThesisModelOutput | null>) => {
    let calls = 0;
    return { calls: () => calls, deps: {
      understanding: { latest: async () => ({ id: 'snap1', understanding: U }) }, aha1: { latest: async () => null },
      conversation: { status: async () => null, turns: async () => [] }, strategy: { getCurrent: async () => null }, plan: { getActive: async () => null },
      theses: { compose: async () => { calls += 1; return compose(); } },
    } as any };
  };

  it('composes, shows my read + the top theses + the thesis questions, and hands the record over for caching; then reuses it', async () => {
    const m = deps(async () => out([thesis()]));
    const v = await new ArcService(m.deps).view('B', 'Slotly', 'en', OFF, [], null);
    expect(v.understanding!.founderRead).toMatchObject({ snapshotId: 'snap1', myRead: 'This suggests you run one product through two buying motions.', matters: [{ headline: 'Two ways in' }] });
    expect(v.understanding!.read!.asks.map((a) => a.resolves ?? null)).toEqual([null, 'T1', null]);
    expect(v.internal?.theses?.snapshotId).toBe('snap1');
    const again = await new ArcService(m.deps).view('B', 'Slotly', 'en', OFF, [], null, false, null, null, null, v.internal!.theses!);
    expect(again.understanding!.founderRead!.myRead).toBe('This suggests you run one product through two buying motions.');
    expect(again.internal).toBeUndefined(); // cached: nothing new to persist
    expect(m.calls()).toBe(1);
  });

  it('a failing call falls back to the existing screen and questions', async () => {
    const m = deps(async () => { throw new Error('boom'); });
    const v = await new ArcService(m.deps).view('B', 'Slotly', 'en', OFF, [], null);
    expect(v.understanding!.founderRead).toBeUndefined();
    expect(v.internal).toBeUndefined();
    expect(v.understanding!.read!.asks[0]!.question).toBe('Which plans bring the most revenue today?');
  });
});
