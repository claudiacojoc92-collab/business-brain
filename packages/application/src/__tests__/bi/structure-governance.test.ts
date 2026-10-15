/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { agendaUnknowns, checkAttributePropagation, governRationale, governStructure, governUnderstanding, groundCounts, verifiedMechanisms, type GovernedUnderstanding, type PageObservation, type StructuralHypothesis } from '../../bi/index';
import { ArcService } from '../../arc/index';

/**
 * Structural synthesis (2026-10-15): a hypothesis is kept only when it connects facts (two anchored quotes, two
 * dimensions, two of the business's own named things), stays reversible (alternative, discriminator, reversal), names a
 * decision rather than an outcome, and never argues from what a page does not show. Invented two-location studio.
 */
const page = (ref: string, text: string): PageObservation => ({
  ref, url: `https://north.example/${ref.toLowerCase()}/`, pageType: 'page', title: `${ref} - Studio North`, text, lang: 'en',
  provenance: 'observed', sourceKind: 'website', discoveredVia: 'link',
});
const OBS: PageObservation[] = [
  page('Locations', 'Our locations. Two locations. The same care. Studio North Riverside A bright space for movement. Services available Classes · Massage Discover the location Studio North Hilltop A friendly space for the whole family. Services available Classes · Physiotherapy · Massage Discover the location'),
  page('Team', 'Our team Riverside Anna Pop Physiotherapist Maria Ilie Pilates coach Hilltop Dan Rus Physiotherapist'),
  page('Timetable', 'Timetable Riverside Monday 09:00 Prenatal class with Anna 10:00 Postpartum class with Anna 18:00 Pilates with Maria Tuesday 09:00 Prenatal class with Anna 10:00 Postpartum class with Anna Timetable Hilltop Monday 18:00 Posture class (children 10–15 years) with Dan'),
];
const trusted = (): boolean => true;
const CTX = { hasDeclared: false, trusted, entities: ['Classes', 'Physiotherapy', 'Massage'] };

const H: StructuralHypothesis = {
  pattern: 'The locations page lists Physiotherapy at Hilltop and not at Riverside. The Riverside team lists Anna Pop as Physiotherapist.',
  relationship: 'asymmetry',
  between: ['Studio North Riverside', 'Studio North Hilltop'],
  dimensions: ['offer', 'capacity'],
  interpretation: 'The two locations may play different roles.',
  whyItMatters: 'This decides whether to plan Riverside and Hilltop as one business or as two.',
  changes: ['resources', 'offer'],
  alternative: 'The split may follow rooms, equipment, staff availability or a deliberate choice.',
  discriminator: { unknown: 'Whether the split was chosen or imposed.', question: 'Is the difference between Riverside and Hilltop deliberate, or set by rooms, equipment or people?', why: 'This tells me whether to plan the locations as one business or two.' },
  reversal: 'Clients booking freely at both locations, or a room limit the founder names.',
  evidence: [
    { ref: 'Locations', quote: 'Services available Classes · Physiotherapy · Massage', context: 'Studio North Hilltop', surface: 'location_page' },
    { ref: 'Team', quote: 'Anna Pop Physiotherapist', surface: 'team_page' },
  ],
  compares: ['location_page', 'team_page'],
  comparisonBasis: 'Both list what each location has: one its services, the other its people.',
};
const SYNTHESIS = 'Your offer appears to combine several operating models under one brand: scheduled classes, physiotherapy and massage. I don\'t yet know whether they behave as one business economically or as separate engines.';
const govern = (h: Partial<StructuralHypothesis>, synthesis = SYNTHESIS) => governStructure({ synthesis, hypotheses: [{ ...H, ...h }] }, OBS, CTX)!;
const rejected = (h: Partial<StructuralHypothesis>) => { const g = govern(h); expect(g.hypotheses).toHaveLength(0); return g.audit!.find((a) => a.verdict === 'rejected')!.reason; };

describe('structural hypotheses: synthesis, not inventory', () => {
  it('keeps a reversible two-location reading with anchored evidence; the section heading travels as context', () => {
    const g = govern({});
    expect(g.synthesis).toBe(SYNTHESIS);
    expect(g.hypotheses).toHaveLength(1);
    expect(g.hypotheses[0]!.evidence[0]).toMatchObject({ quote: 'Services available Classes · Physiotherapy · Massage', context: 'Studio North Hilltop' });
  });

  it('accepts a quote with its heading joined by a dash, and re-attributes a quote cited on the wrong page', () => {
    const g = govern({ evidence: [
      { ref: 'Locations', quote: 'Studio North Hilltop – Services available Classes · Physiotherapy · Massage', surface: 'location_page' },
      { ref: 'Locations', quote: 'Anna Pop Physiotherapist', surface: 'team_page' },
    ] });
    expect(g.hypotheses[0]!.evidence.map((e) => e.ref)).toEqual(['Locations', 'Team']);
  });

  it('rejects a restatement of one fact, a single dimension, and categories instead of named things', () => {
    expect(rejected({ evidence: [H.evidence[0]!] })).toMatch(/fewer than two distinct anchored facts/);
    expect(rejected({ dimensions: ['offer'] })).toMatch(/fewer than two business-model dimensions/);
    expect(rejected({ between: ['the clinical segment', 'the fitness segment'] })).toMatch(/fewer than two of this business's own things/);
  });

  it('is reversible: an alternative that is not a paraphrase, a discriminator and a reversal are required', () => {
    expect(rejected({ alternative: '' })).toMatch(/no real alternative/);
    expect(rejected({ alternative: 'The two locations may play different roles.' })).toMatch(/no real alternative/);
    expect(rejected({ discriminator: { unknown: '', question: '' } })).toMatch(/discriminating/);
    expect(rejected({ reversal: '' })).toMatch(/no valid reversal/);
  });

  it('category confusion: a reading that rests on what a page does not show is dropped; a stray sentence is trimmed', () => {
    expect(rejected({ pattern: 'The Riverside timetable contains no physiotherapy session.' })).toMatch(/category confusion/);
    const g = govern({ pattern: `${H.pattern} The Riverside timetable does not include physiotherapy.` });
    expect(g.hypotheses[0]!.pattern).toBe(H.pattern);
    expect(g.audit!.find((a) => a.verdict === 'kept')!.reason).toMatch(/dropped sentences: category confusion/);
    expect(rejected({ compares: ['timetable', 'price_list'], comparisonBasis: '' })).toMatch(/compares a timetable with a price_list/);
  });

  it('hedging is allowed; demand read from footprint, behaviour and advice are not', () => {
    expect(govern({ interpretation: 'The two locations may play different roles; it seems deliberate.' }).hypotheses).toHaveLength(1);
    expect(rejected({ interpretation: 'Riverside may have higher demand than Hilltop.' })).toMatch(/demand, volume or occupancy/);
    expect(rejected({ interpretation: 'Clients at Riverside may leave when they cannot find physiotherapy.' })).toMatch(/behaviour/);
    expect(rejected({ whyItMatters: 'You should move physiotherapy to Riverside.' })).toMatch(/outcome, gives advice/);
  });

  it('a transcribed schedule, a customer trait read from a schedule, or a market claim does not stand', () => {
    const t = govern({ pattern: `${H.pattern} The Riverside timetable lists Prenatal class at 09:00 Monday, 09:00 Tuesday and 10:00 Tuesday.` });
    expect(t.hypotheses[0]!.pattern).toBe(H.pattern);
    expect(t.audit!.find((a) => a.verdict === 'kept')!.reason).toMatch(/transcription of a schedule/);
    const l = govern({ pattern: `${H.pattern} The Riverside timetable lists Pilates, Yoga, Barre, Dance, Prenatal class, Postpartum class and Stretching.` });
    expect(l.hypotheses[0]!.pattern).toBe(H.pattern);
    expect(l.audit!.find((a) => a.verdict === 'kept')!.reason).toMatch(/transcription of a list/);
    expect(rejected({ interpretation: 'Riverside may serve mothers who are available in the morning, Hilltop people with working hours.' })).toMatch(/customer trait/);
    expect(rejected({ interpretation: 'Hilltop may have a competitive advantage over Riverside.' })).toMatch(/behaviour, economics/);
  });

  it('numbers: a count word is a count; the page\'s own "two locations", clock times and quoted names are not BB\'s numbers', () => {
    const trimmed = govern({ pattern: `${H.pattern} Anna leads four classes at Riverside.`, interpretation: 'Riverside and Hilltop may play different roles; Anna leads four classes.' });
    expect(`${trimmed.hypotheses[0]!.pattern} ${trimmed.hypotheses[0]!.interpretation}`).not.toMatch(/four/);
    expect(trimmed.audit!.find((a) => a.verdict === 'kept')!.reason).toMatch(/a number that is not grounded/);
    expect(rejected({ pattern: 'Anna leads four classes at Riverside and Hilltop.' })).toMatch(/not grounded/);
    const ok = govern({ pattern: `${H.pattern} The Hilltop timetable lists Posture class (children 10–15 years) at 18:00.` });
    expect(ok.hypotheses).toHaveLength(1);
    expect(ok.hypotheses[0]!.pattern).toContain('10–15');
  });

  it('a counted list recounts exactly: right count kept, wrong count rejected', () => {
    const items = [{ ref: 'Timetable', quote: '09:00 Prenatal class with Anna' }, { ref: 'Timetable', quote: '09:00 Prenatal class with Anna' }];
    expect(groundCounts([{ value: 2, of: 'prenatal classes', items }], OBS, trusted)).toMatchObject({ ok: true, values: [2] });
    expect(groundCounts([{ value: 3, of: 'prenatal classes', items: [...items, items[0]!] }], OBS, trusted).ok).toBe(false); // the line occurs twice, not three times
    const kept = govern({ pattern: `${H.pattern} Anna leads 2 prenatal classes at Riverside.`, counts: [{ value: 2, of: 'prenatal classes', items }] });
    expect(kept.hypotheses).toHaveLength(1);
  });

  it('the synthesis may say what BB does not know; it may not overstate the structure', () => {
    expect(govern({}, 'Studio North is really three businesses under one name.').synthesis).toBe('');
    expect(govern({}, 'Your offer appears to combine classes and physiotherapy. I don\'t yet know whether they behave as one business or as two businesses.').synthesis).not.toBe('');
  });
});

describe('synthesis integrity: reversals fact-checked, alternatives open, operating models by mechanism', () => {
  it('a reversal condition already satisfied by current evidence is rejected (the team page already lists it)', () => {
    expect(rejected({ reversal: 'If a physiotherapist appeared on the Riverside team.' })).toMatch(/no valid reversal remains: already true in the pages BB read/);
  });

  it('a reversal clause about what the pages show is dropped; a clause the founder can answer stays', () => {
    const g = govern({ reversal: 'Clients booking freely at both locations, or if physiotherapy appeared in the Riverside timetable.' });
    expect(g.hypotheses[0]!.reversal).toBe('Clients booking freely at both locations');
    expect(g.hypotheses[0]!.reversalCheck!.checked).toBe(true);
    expect(g.hypotheses[0]!.reversalCheck!.dropped).toHaveLength(1);
    expect(g.hypotheses[0]!.reversalCheck!.dropped[0]!.reason).toMatch(/already true in the pages|about what the pages show/);
  });

  it('an alternative may not collapse a multi-cause uncertainty into one cause; a negated mention does not count', () => {
    expect(rejected({ alternative: 'The split may simply reflect staff availability at each location, not a deliberate choice.' })).toMatch(/collapses the uncertainty into one explanation \(staffing\)/);
    expect(govern({ alternative: 'The split may reflect staff availability or the rooms each location has, not a deliberate choice.' }).hypotheses).toHaveLength(1);
  });

  it('a reversal the founder can answer stays even when it mentions the site; only "if it appeared / were listed" is a page condition', () => {
    const g = govern({ reversal: 'If the physiotherapists actually work at both locations and the site timetable does not reflect it.' });
    expect(g.hypotheses[0]!.reversal).toMatch(/actually work at both locations/);
    expect(g.hypotheses[0]!.reversalCheck!.dropped).toEqual([]);
  });

  it('a reversal that only DESCRIBES what the page does not show ("appointments that do not appear in the timetable") is about the business', () => {
    const g = govern({ reversal: 'If physiotherapy is in fact delivered at Riverside by individual appointments that do not appear in the class timetable.' });
    expect(g.hypotheses[0]!.reversalCheck!.dropped).toEqual([]);
  });

  it('a structure word counted by BB ("two steps") is not a count of things on a page', () => {
    expect(govern({ interpretation: 'Physiotherapy at Hilltop may be sold in two steps, unlike classes at Riverside.' }).hypotheses).toHaveLength(1);
  });

  it('an operating model named by audience or life stage is not earned', () => {
    expect(govern({}, 'Your offer appears to combine group classes, one-to-one physiotherapy and a perinatal program. I don\'t yet know how they relate.').synthesis).toBe('');
    expect(govern({}, 'Your offer appears to combine group classes, physiotherapy and activities for children. I don\'t yet know how they relate.').synthesis).toBe('');
    expect(govern({}, 'Your offer appears to combine scheduled group classes and one-to-one physiotherapy. I don\'t yet know how they relate.').synthesis).not.toBe('');
  });
});

const UQ = (): GovernedUnderstanding => ({
    offer: { summary: 'You sell classes, physiotherapy and massage at two locations.', explicit: ['Classes', 'Physiotherapy', 'Massage'], unclear: [], sourceRefs: ['Locations'] },
    positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] },
    audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [] },
    messaging: { recurringThemes: [], sourceRefs: [] },
    acquisition: { visiblePaths: [], sourceRefs: [] },
    contradictions: [],
    unknowns: [],
    stage: { stage: 'growth', evidence: ['Two locations with their own teams.', 'A weekly timetable at both locations.'], sourceRefs: ['Locations'] },
    read: {
      model: [{ dimension: 'offer', known: [{ text: 'Classes, Physiotherapy and Massage are listed.', basis: 'observed', sourceRefs: ['Locations'] }], unknown: [] }],
      notConcluding: [], untrusted: [], websiteNotes: [],
      questions: [
        { question: 'How many clients renew their package after the first one?', dimension: 'retention', changes: ['retention', 'offer', 'resources'], why: 'If most pay per session, revenue is unpredictable and pricing deserves reconsideration.' },
        { question: 'Which offers bring the most visits, and which the most revenue?', dimension: 'performance', changes: ['bet', 'offer'], why: 'This tells me whether classes or physiotherapy carry the business.', fills: ['performance'] },
        { question: 'Where do new clients come from today?', dimension: 'acquisition', changes: ['channel'], why: 'This tells me which acquisition paths are already real and which options would be new bets.' },
      ],
      diagnosis: { state: 'not_ready', statement: '', checks: {}, sourceRefs: [] },
      structure: { synthesis: SYNTHESIS, hypotheses: [H] },
    },
  } as unknown as GovernedUnderstanding);

describe('question selection is not hypothesis selection; stage is earned', () => {
  const U = UQ();

  it('A (readiness) first, then B (the hypothesis fork), then C; three shown; acquisition is one of them', () => {
    const g = governUnderstanding(U, OBS);
    expect(g.read!.questionTiers!.map((q) => q.tier)).toEqual(['A', 'A', 'B', 'C']);
    const shown = agendaUnknowns(g);
    expect(shown).toHaveLength(3);
    expect(shown[1]).toBe('Where do new clients come from today?');
    expect(shown[2]).toBe(H.discriminator.question);
  });

  it('a "why" that predicts what the answer would mean is blanked; one that names the decision stays', () => {
    const q = governUnderstanding(U, OBS).read!.questions;
    expect(q.find((x) => x.dimension === 'retention')!.why).toBe('');
    expect(q.find((x) => x.dimension === 'acquisition')!.why).toMatch(/already real/);
  });

  it('a leading question (what would have to change, expand, add…) is never asked; no slot is spent on that fork', () => {
    const leading = { ...U, read: { ...U.read!, structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: 'What would have to change for physiotherapy to be offered at Riverside too?' } }] } } } as GovernedUnderstanding;
    const g = governUnderstanding(leading, OBS);
    expect(g.read!.questionTiers!.map((q) => q.tier)).toEqual(['A', 'A', 'C']);
    expect(g.read!.excludedQuestions![0]!.reason).toMatch(/presupposes a future/);
    expect(agendaUnknowns(g).join(' ')).not.toMatch(/would have to change/);
  });

  it('a B question must settle the actual fork; a narrower one gives way to a candidate that does', () => {
    const narrow = { ...U, read: { ...U.read!,
      questions: [...U.read!.questions, { question: 'Is the split between Riverside and Hilltop deliberate, or set by rooms or equipment?', dimension: 'capacity', changes: ['offer'], why: 'This tells me whether to plan the locations as one or two.' }],
      structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: 'Is physiotherapy at Hilltop because of demand, or because Dan Rus works there?' } }] } } } as GovernedUnderstanding;
    const g = governUnderstanding(narrow, OBS);
    const b = g.read!.questionTiers!.find((q) => q.tier === 'B')!;
    expect(b.question).toBe('Is the split between Riverside and Hilltop deliberate, or set by rooms or equipment?');
    expect(b.reason).toMatch(/settles hypothesis 1: .* vs .*; the answer chooses between/);
    expect(g.read!.excludedQuestions!.some((x) => /does not settle the fork/.test(x.reason))).toBe(true);
  });

  it('a negation in the question does not hide the explanations it offers; the brand prefix is not needed to name a location', () => {
    const own = 'Why is physiotherapy not listed at Riverside: rooms or equipment, a deliberate choice, or nobody available there?';
    const g = governUnderstanding({ ...U, read: { ...U.read!, structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: own } }] } } } as GovernedUnderstanding, OBS);
    expect(g.read!.questionTiers!.find((q) => q.tier === 'B')!.question).toBe(own);
  });

  it('a weaker look-alike never replaces the question that settles the fork', () => {
    const u = UQ();
    const g = governUnderstanding({ ...u, read: { ...u.read!,
      questions: [{ question: 'Is physiotherapy only at Hilltop or also at Riverside, and why?', dimension: 'capacity', changes: ['offer'], why: '' }, ...u.read!.questions],
      structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: 'Is physiotherapy only at Hilltop because you chose to specialise the locations, or because of rooms, equipment or availability?' } }] } } } as GovernedUnderstanding, OBS);
    const b = g.read!.questionTiers!.find((q) => q.tier === 'B')!;
    expect(b.question).toMatch(/because you chose to specialise/);
    expect(b.reason).toMatch(/the answer chooses between \S+/);
  });

  it('a tension on the same topic does not remove the hypothesis\'s question', () => {
    const g = governUnderstanding(U, OBS);
    const withTension = { ...g, contradictions: [{ statementA: '', statementB: '', tension: 'Is the difference between Riverside and Hilltop deliberate or set by rooms?', sourceRefs: ['Locations'] }] } as GovernedUnderstanding;
    expect(agendaUnknowns(withTension)).toContain(H.discriminator.question);
  });

  it('footprint is not stage evidence: "growth" from two locations and a timetable is undetermined, kept for audit', () => {
    const g = governUnderstanding(U, OBS);
    expect(g.stage).toMatchObject({ stage: 'undetermined', proposed: 'growth' });
  });

  it('the card leads with the structure, says it is not naming a stage, and keeps the model for "What I read"', () => {
    const card = (new ArcService({} as any) as any).projectUnderstanding(governUnderstanding(U, OBS), []);
    expect(card.stage).toEqual({ stage: 'undetermined' });
    expect(card.read.structure).toMatchObject({ synthesis: SYNTHESIS, stageNotNamed: true });
    expect(card.read.structure.hypotheses[0]).toMatchObject({ interpretation: H.interpretation, alternative: H.alternative, reversal: H.reversal });
    expect(card.read.structure.hypotheses[0].evidence[0].page).toMatch(/Studio North Hilltop/);
    expect(card.read.model.length).toBeGreaterThan(0);
    expect(card.read.asks).toHaveLength(3);
  });
});

describe('final integrity: no attribute propagation, every stored field governed, a safe fallback', () => {
  // Own pages per offer: physiotherapy starts with a paid assessment, massage does not; both are sold in packages.
  const OWN: PageObservation[] = [
    ...OBS,
    page('Physiotherapy', 'Physiotherapy Every programme starts with an assessment. Assessment 1 session 200 lei. Physiotherapy individual session 1 session 150 lei Package 8 1000 lei'),
    page('Massage', 'Massage Relaxing massage 50 min 1 session 180 lei Package 4 600 lei'),
  ];
  const brand = new Set(['studio', 'north']);

  it('an attribute valid for every member of the group stands unchanged', () => {
    const r = checkAttributePropagation('Your offer appears to combine scheduled classes and one-to-one services (Physiotherapy, Massage) sold in packages.', OWN, trusted, brand);
    expect(r).toMatchObject({ narrowed: [], failed: [] });
    expect(r.text).toContain('(Physiotherapy, Massage)');
  });

  it('an attribute valid for only one member narrows the group to that member', () => {
    const r = checkAttributePropagation('Your offer appears to combine scheduled classes and one-to-one services (Physiotherapy, Massage, which start with a paid assessment and continue with a plan).', OWN, trusted, brand);
    expect(r.narrowed).toEqual([{ member: 'Massage', attribute: 'evaluation first' }]);
    expect(r.text).toContain('(Physiotherapy, which start with a paid assessment and continue with a plan)');
    expect(r.text).not.toMatch(/Massage, which/);
  });

  it('a model extending an attribute across a group none of whose members show it: the synthesis does not stand', () => {
    const g = governStructure({ synthesis: 'Your offer appears to combine classes and individual services (Massage, Pilates coaching) that start with a paid assessment. I don\'t yet know how they relate.', hypotheses: [] }, OWN, CTX)!;
    expect(g.synthesis).toBe('');
    expect(g.audit![0]!.reason).toMatch(/evaluation first" applied to a group none of whose members/);
  });

  const STORED_LEAKS = /under-?utili[sz]ed|potential|weak demand|strong demand|higher value|better economics/i;
  it('stored reasoning is governed like shown text: judgements are trimmed or rejected, and live only in the quarantined audit', () => {
    const leaky = { ...H,
      whyItMatters: 'This decides whether to plan Riverside and Hilltop as one business, or whether Riverside is under-utilised versus its potential.',
      alternative: 'Rooms, equipment or staff availability may explain it. Riverside may also simply have weak demand.',
      comparisonBasis: 'Both list what each location has; Hilltop clearly has higher value clients.',
    };
    const u = { offer: { summary: '', explicit: ['Classes', 'Physiotherapy', 'Massage'], unclear: [], sourceRefs: [] }, positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] }, audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [] }, messaging: { recurringThemes: [], sourceRefs: [] }, acquisition: { visiblePaths: [], sourceRefs: [] }, contradictions: [], unknowns: [],
      read: { model: [], notConcluding: [], untrusted: [], websiteNotes: [], questions: [], diagnosis: { state: 'not_ready', statement: '', checks: {}, sourceRefs: [] }, structure: { synthesis: SYNTHESIS, hypotheses: [leaky] } } } as unknown as GovernedUnderstanding;
    const g = governUnderstanding(u, OBS);
    const h = g.read!.structure!.hypotheses[0]!;
    expect(h.whyItMatters).toBe('This decides whether to plan Riverside and Hilltop as one business.');
    expect(h.alternative).toBe('Rooms, equipment or staff availability may explain it.');
    expect(h.comparisonBasis).toBe('Both list what each location has.');
    expect(JSON.stringify(g.read!.structure)).not.toMatch(STORED_LEAKS);
    expect(JSON.stringify(g.read!.structureAudit)).toMatch(/under-utilised/);
    expect(rejected({ reversal: 'If Riverside is in fact below its potential.' })).toMatch(/no valid reversal/);
    expect(rejected({ discriminator: { unknown: 'Whether Riverside has strong demand.', question: H.discriminator.question } })).toMatch(/no discriminating unknown/);
  });

  it('when the synthesis does not stand, the card names only verified mechanisms (never the inventory)', () => {
    expect(verifiedMechanisms(OWN, trusted).map((m) => m.kind)).toEqual(['group_timetable', 'one_to_one', 'paid_first_step', 'packages']);
    const u = { offer: { summary: 'You sell classes, physiotherapy and massage.', explicit: [], unclear: [], sourceRefs: [] }, positioning: { summary: '', evidenceBacked: [], implied: [], sourceRefs: [] }, audience: { addressed: [], appearsTargeted: [], unknown: [], sourceRefs: [] }, messaging: { recurringThemes: [], sourceRefs: [] }, acquisition: { visiblePaths: [], sourceRefs: [] }, contradictions: [], unknowns: [],
      read: { model: [], notConcluding: [], untrusted: [], websiteNotes: [], questions: [], diagnosis: { state: 'not_ready', statement: '', checks: {}, sourceRefs: [] }, structure: { synthesis: 'Studio North is really three businesses under one name.', hypotheses: [] } } } as unknown as GovernedUnderstanding;
    const card = (new ArcService({} as any) as any).projectUnderstanding(governUnderstanding(u, OWN), []);
    expect(card.read.structure.synthesis).toBe('');
    expect(card.read.structure.fallback.mechanisms).toEqual(['group_timetable', 'one_to_one', 'paid_first_step', 'packages']);
    // fewer than two verified mechanisms: BB says it is not ready (the web renders that), still no inventory
    const bare = (new ArcService({} as any) as any).projectUnderstanding(governUnderstanding(u, [page('About', 'We care about movement.')]), []);
    expect(bare.read.structure.fallback.mechanisms.length).toBeLessThan(2);
  });

  it('a catch-all ("or another operational decision") does not stand in for the reading\'s side of the fork', () => {
    const own = 'Is physiotherapy only at Hilltop because of rooms, equipment, staff availability or another operational decision?';
    const g = governUnderstanding({ ...UQ(), read: { ...UQ().read!, structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: own } }] } } } as GovernedUnderstanding, OBS);
    expect(g.read!.questionTiers!.some((q) => q.tier === 'B')).toBe(false);
    expect(g.read!.excludedQuestions!.find((x) => x.question === own)!.reason).toMatch(/does not settle the fork/);
  });
});

describe('final hardening: abstract groups resolve to offer families; rationales add no unlicensed framing', () => {
  const FAM: PageObservation[] = [
    ...OBS,
    page('Classes', 'Classes Pilates 1 session 90 lei Package 8 350 lei. Group classes on the weekly timetable.'),
    page('Physiotherapy', 'Physiotherapy Every programme starts with an assessment. Assessment 1 session 200 lei. Individual physiotherapy 1 session 150 lei Package 8 1000 lei'),
    page('Massage', 'Massage Individual massage 50 min 1 session 180 lei Package 4 600 lei'),
  ];
  const brand = new Set(['studio', 'north']);
  const prop = (text: string) => checkAttributePropagation(text, FAM, trusted, brand);

  it('A. explicit member list, every member supports the attribute: unchanged', () => {
    const r = prop('Your offer appears to combine group classes and one-to-one services (Physiotherapy, Massage) sold in packages.');
    expect(r).toMatchObject({ narrowed: [], failed: [], removed: [] });
  });

  it('B. explicit member list, only a subset supports it: the list narrows to that subset', () => {
    const r = prop('Your offer appears to combine group classes and one-to-one services (Physiotherapy, Massage, which start with a paid assessment).');
    expect(r.text).toContain('(Physiotherapy, which start with a paid assessment)');
  });

  it('C. abstract category, every offer family it covers supports the attribute: unchanged', () => {
    const t = 'Your offer appears to combine group classes, individual services sold in packages, and nothing else.';
    expect(prop(t)).toMatchObject({ text: t, narrowed: [], removed: [] });
  });

  it('D. abstract category, only a subset supports it: the category is narrowed to the families that do', () => {
    const r = prop('Your offer appears to combine group classes, individual services that start with a paid assessment, and packages.');
    expect(r.text).toContain('individual services (Physiotherapy) that start with a paid assessment');
    expect(r.narrowed).toEqual([{ member: 'Massage', attribute: 'evaluation first' }]);
  });

  it('E. an ambiguous category that cannot be resolved to the offers keeps no universal attribute', () => {
    const r = prop('Your offer appears to combine group classes, specialised services that start with a paid assessment, and packages.');
    expect(r.text).toContain('specialised services,');
    expect(r.text).not.toMatch(/assessment/);
    expect(r.removed[0]!.reason).toMatch(/cannot be resolved/);
  });

  it('a family named without a list gets no attribute its own page does not show', () => {
    const r = prop('Your offer appears to combine group classes and Massage that starts with a paid assessment.');
    expect(r.text).not.toMatch(/assessment/);
    expect(r.removed[0]!.reason).toMatch(/no offer the category covers shows evaluation first/);
  });

  it('a rationale says which reading the answer resolves; it may not invent a size, demand or role framing', () => {
    const q = 'Is the difference between Riverside and Hilltop deliberate, or caused by rooms, equipment or availability?';
    expect(governRationale('This tells me whether the difference is deliberate or operational, or whether one location is simply smaller.', [q]))
      .toBe('This tells me whether the difference is deliberate or operational.');
    expect(governRationale('This tells me which channels are already real and which would be new bets, without assuming the website is the main source.', ['Where do new clients come from today?']))
      .toBe('This tells me which channels are already real and which would be new bets.');
    const clean = 'This tells me what carries the business, and whether volume and revenue point the same way.';
    expect(governRationale(clean, ['Which offers bring the most sessions, and which the most revenue?'])).toBe(clean);
    expect(governRationale('This tells me whether demand is higher at Riverside.', [q])).toBe('');
    expect(governRationale('This tells me whether one location is smaller.', ['How many clients does each location have?'])).toBe('This tells me whether one location is smaller.');
  });

  it('a presence reversal already shown by the pages ("if there is another physiotherapist at Riverside") is already true', () => {
    expect(rejected({ reversal: 'If there is another physiotherapist at Riverside who is not in the timetable.' })).toMatch(/already true in the pages BB read/);
    // two conditions written without "or": each is checked; the already-true one is dropped, the answerable one stays
    const g = govern({ reversal: 'If Dan Rus also works at Riverside outside the published timetable, if there is another physiotherapist at Riverside.' });
    expect(g.hypotheses[0]!.reversal).toBe('If Dan Rus also works at Riverside outside the published timetable');
    expect(g.hypotheses[0]!.reversalCheck!.dropped[0]!.reason).toMatch(/already true/);
  });

  it('a fork rationale may not presuppose a future the founder never stated', () => {
    expect(governRationale('This decides whether physiotherapy can be expanded to Riverside.', ['Is the split deliberate, or set by rooms?'])).toBe('');
    expect(governRationale('This decides whether the clinical line can be extended to Riverside.', ['Is the split deliberate, or set by rooms?'])).toBe('');
  });

  it('the same discipline on stored question rationales and fork text; a hypothesis may stand without earning a question', () => {
    const u = UQ();
    const g = governUnderstanding({ ...u, read: { ...u.read!,
      questions: [...u.read!.questions, { question: 'Is the split between Riverside and Hilltop deliberate, or set by rooms or equipment?', dimension: 'capacity', changes: ['offer'], why: 'This decides whether the locations are complementary, or whether one is simply smaller.' }],
      structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, why: 'This decides whether the split is deliberate, or whether Hilltop simply has more demand.' } }] } } } as GovernedUnderstanding, OBS);
    expect(JSON.stringify(g.read!.questions)).not.toMatch(/simply smaller/);
    expect(g.read!.structure!.hypotheses[0]!.discriminator.why).toBe('This decides whether the split is deliberate.');
    const narrow = governUnderstanding({ ...u, read: { ...u.read!, structure: { synthesis: SYNTHESIS, hypotheses: [{ ...H, discriminator: { ...H.discriminator, question: 'Is physiotherapy at Hilltop because of the rooms?' } }] } } } as GovernedUnderstanding, OBS);
    expect(narrow.read!.structure!.hypotheses).toHaveLength(1);
    expect(narrow.read!.questionTiers!.some((t) => t.tier === 'B')).toBe(false);
  });
});
