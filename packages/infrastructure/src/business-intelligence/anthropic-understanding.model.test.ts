import { describe, it, expect } from 'vitest';
import type { PageObservation } from '@bb/application';
import type { SynthesisOutput, GovernedUnderstanding } from '@bb/application';
import { systemPrompt, AnthropicUnderstandingModel, extractJson, refineConstraint, restatedTension, deeperConstraintPrompt, visibilityPhrased, levelProblem } from './anthropic-understanding.model';

/**
 * The understanding output is split by "prose BB composes vs items BB lifts": composed prose (written FOR the
 * founder) goes in the FOUNDER'S language (account.interfaceLocale); lifted source items stay in the source
 * language so the founder recognises them on their own site. These deterministic tests lock that split in the
 * prompt; the env-gated LIVE tests exercise it against the real model, including the mixed-language source case.
 */

const COMPOSED = [
  'offer.summary', 'positioning.summary', 'offer.unclear', 'positioning.implied',
  'audience.appearsTargeted', 'audience.unknown', 'understanding.unknowns',
  'contradictions[].tension', 'aha.findings[].finding', 'aha.findings[].implication',
];
const LIFTED = [
  'offer.explicit', 'positioning.evidenceBacked', 'audience.addressed',
  'messaging.recurringThemes', 'acquisition.visiblePaths',
  'contradictions[].statementA', 'contradictions[].statementB',
];

describe('understanding systemPrompt — compose-vs-lift language split', () => {
  const p = systemPrompt('ro');
  const lineA = p.split('\n').find((l) => l.includes('(a) PROSE YOU COMPOSE')) ?? '';
  const lineB = p.split('\n').find((l) => l.includes('(b) ITEMS YOU LIFT')) ?? '';

  it('lists every composed (founder-language) field in half (a)', () => {
    expect(lineA).not.toBe('');
    for (const f of COMPOSED) expect(lineA, `${f} should be in the composed half`).toContain(f);
  });

  it('lists every lifted (source-language) field in half (b)', () => {
    expect(lineB).not.toBe('');
    for (const f of LIFTED) expect(lineB, `${f} should be in the lifted half`).toContain(f);
  });

  it('puts the summaries in the composed half, NOT the lifted half (the reclassification)', () => {
    expect(lineA).toContain('offer.summary');
    expect(lineA).toContain('positioning.summary');
    expect(lineB).not.toContain('offer.summary');
    expect(lineB).not.toContain('positioning.summary');
  });

  it('names the founder language, and keeps proper-noun / mixed-source / no-drift rules', () => {
    expect(systemPrompt('ro')).toContain('Romanian');
    expect(systemPrompt('en')).toContain('English');
    expect(systemPrompt('it')).toContain('Italian');
    expect(p).toContain('MIXED-LANGUAGE SOURCE');
    expect(p).toMatch(/ghișeu unic/);          // the founder's own term is preserved verbatim
    expect(p).toMatch(/original language/i);    // proper nouns kept in both halves
    expect(p).toMatch(/NO DRIFT/i);
  });
});

// ── LIVE (env-gated): real model. Skipped unless ANTHROPIC_API_KEY is set. ──
const KEY = process.env['ANTHROPIC_API_KEY'];
const live = KEY ? it : it.skip;
const RO_DIACRITIC = /[ăâîșțĂÂÎȘȚ]/;

describe('understanding — LIVE language split (real model)', () => {
  live('English source + Romanian founder → composed half Romanian, lifted half English', async () => {
    const model = new AnthropicUnderstandingModel(KEY as string);
    const obs: PageObservation[] = [{
      ref: 'B1', url: 'https://acme.example', pageType: 'home', title: 'Acme', lang: 'en', provenance: 'observed',
      text: 'Acme builds custom furniture for offices. We offer bespoke desks and chairs. Book a call for a quote. Prices on request.',
    }];
    const out = await model.synthesize({ businessName: 'Acme', observations: obs, interfaceLanguage: 'ro' });
    const composed = [out.understanding.offer.summary, ...(out.understanding.unknowns ?? []), ...(out.aha.findings ?? []).map((f) => `${f.finding} ${f.implication ?? ''}`)].join(' ');
    expect(composed).toMatch(RO_DIACRITIC); // founder-facing prose is Romanian even though the site is English
    const lifted = (out.understanding.offer.explicit ?? []).join(' ');
    if (lifted.trim()) expect(lifted).not.toMatch(RO_DIACRITIC); // lifted site items stay English
  }, 90_000);

  // The HARD direction: the primary source is Romanian, so the model's instinct is to write Romanian — but the
  // composed half must follow the FOUNDER (English). Also the mixed-language source case (RO site + EN founder
  // block). Assert English function words in the composed fields: unlike diacritics (which a correct English
  // summary can carry inside a preserved Romanian proper noun), these cannot appear inside Romanian nouns.
  live('MIXED source (Romanian site + English founder block), English founder → composed half English', async () => {
    const model = new AnthropicUnderstandingModel(KEY as string);
    const obs: PageObservation[] = [
      { ref: 'B1', url: 'https://clinica.example', pageType: 'home', title: 'Clinica', lang: 'ro', provenance: 'observed',
        text: 'Studio de kinetoterapie și recuperare. Oferim ședințe de Schroth pentru scolioză și terapie manuală pentru pacienți.' },
      { ref: 'B2', url: 'founder://b2', pageType: 'declared', title: null, lang: 'en', provenance: 'declared',
        text: 'We also run a B2B referral channel for doctors: ten specialties, referral protocols, and a therapeutic team.' },
    ];
    const out = await model.synthesize({ businessName: 'Clinica', observations: obs, interfaceLanguage: 'en' });
    const composed = [out.understanding.offer.summary, ...(out.understanding.unknowns ?? []), ...(out.aha.findings ?? []).map((f) => `${f.finding} ${f.implication ?? ''}`)].join(' ').toLowerCase();
    expect(composed).toMatch(/\b(the|is|appears|for)\b/);
  }, 90_000);
});

describe('understanding systemPrompt — strategic lens (business, not website audit)', () => {
  const p = systemPrompt('en');
  it('runs the capability check and makes a capability gap the primary contradiction', () => {
    expect(p).toMatch(/CAPABILITY CHECK/);
    expect(p).toMatch(/MUST be contradictions\[0\]/);
    expect(p).toMatch(/"capability_gap"/);
  });
  it('keeps website housekeeping (legal-page dates, vague copy) out of contradictions and aha', () => {
    expect(p).toMatch(/legal pages \(Privacy, Terms, Data Deletion/);
    expect(p).toMatch(/NEVER\s+'?,?\s*'?\s*appear in ANY field you compose/);
    expect(p).toMatch(/ANY CRITIQUE OF A PHRASE ON THE SITE/);
  });
  it('asks for 3-4 tensions on different dimensions, second person, consequence so-whats, observations not questions', () => {
    expect(p).toMatch(/3 to 4 real tensions/);
    expect(p).toMatch(/SECOND PERSON, PRESENT TENSE/);
    expect(p).toMatch(/CONSEQUENCE, never a paraphrase/);
    expect(p).toMatch(/A GAP YOU CAN SEE IS AN OBSERVATION, NEVER A QUESTION/);
    expect(p).toMatch(/"customer_proof", "channel_mismatch"/);
  });
  it('requires the so-what and a ranked list', () => {
    expect(p).toMatch(/THE SO-WHAT TEST/);
    expect(p).toMatch(/RANK, do not list/);
  });
  it('forces ONE constraint (cause, not symptom) and a stage from evidence', () => {
    expect(p).toMatch(/CONSTRAINT — DECIDE, DO NOT LIST/);
    expect(p).toMatch(/"constraint": \{"decided": true, "level": "users\|target\|offer\|time", "levelCheck"/);
    expect(p).toMatch(/constraint\.level = the FIRST level whose passed is false/);
    expect(p).toMatch(/"stage": \{"stage": "validating\|growth\|plateau\|undetermined"/);
    expect(p).toMatch(/stage\.evidence = 2 to 4 concrete observations/);
    // the root cause is searched in a fixed order, in the first reading AND the retry
    expect(p).toMatch(/ROOT-CAUSE ORDER[\s\S]*1\. USERS[\s\S]*2\. TARGET[\s\S]*3\. OFFER/);
    expect(deeperConstraintPrompt('en')).toMatch(/ROOT-CAUSE ORDER[\s\S]*1\. USERS[\s\S]*2\. TARGET[\s\S]*3\. OFFER/);
    // users exist (members, clients, placements) → the users level is passed; the core stage = most evidence of sales
    expect(p).toMatch(/Members, clients, customers, placements[\s\S]*this level is PASSED/);
    expect(deeperConstraintPrompt('en')).toMatch(/this level is PASSED/);
    expect(p).toMatch(/the offer with the MOST EVIDENCE OF SALES/);
  });
  it('does not contain the Business Brain test case itself (the dogfood run must find it, not echo it)', () => {
    expect(p).not.toMatch(/decision system/i);
  });
});


describe('extractJson — a lifted „…" quote closed with a straight quote (Body Move, 2026-10-12)', () => {
  it('repairs the typographic pair instead of failing the whole synthesis', () => {
    const raw = 'here: {"evidenceBacked": ["„Nu tratăm simptome. Ne concentrăm pe cauze."", "Ballet Lab"], "q": "„ok”"}';
    expect(extractJson(raw)).toEqual({ evidenceBacked: ['„Nu tratăm simptome. Ne concentrăm pe cauze.”', 'Ballet Lab'], q: '„ok”' });
  });
  it('repairs several stray closers inside one string („A", „B", „C")', () => {
    const raw = '{"statementA": "Promiți „abordare personalizată", „programe adaptate", „evaluare", restul", "b": 1}';
    expect(extractJson(raw)).toEqual({ statementA: 'Promiți „abordare personalizată”, „programe adaptate”, „evaluare”, restul', b: 1 });
  });
  it('repairs a value that opens with a typographic quote instead of a JSON one (NoBullshitRecruiter, 2026-10-12)', () => {
    expect(extractJson('{"themes": ["Positionierung", „ehrliche Beratung"], "n": 1}')).toEqual({ themes: ['Positionierung', '„ehrliche Beratung'], n: 1 });
  });
  it('leaves valid JSON (escaped quotes included) untouched and still fails closed on real garbage', () => {
    expect(extractJson('{"a": "say \\"hi\\" now", "b": "„x”"}')).toEqual({ a: 'say "hi" now', b: '„x”' });
    expect(() => extractJson('{"a": [1, 2}')).toThrow();
  });
});

describe('refineConstraint — one retry when the constraint restates a tension (Strategic Depth W1)', () => {
  const base = (statement: string): SynthesisOutput => ({ modelId: 'm', aha: { status: 'produced', findings: [] }, understanding: {
    offer: { summary: 'x' }, positioning: { summary: '' }, audience: { addressed: [] },
    contradictions: [{ kind: 'customer_proof', tension: 'You describe a full product. No source shows a single founder who used it or a result it produced.', soWhat: 's', sourceRefs: [] }],
    capabilityCheck: { shown: true, insight: '' },
    stage: { stage: 'validating', evidence: [], sourceRefs: [] },
    constraint: { decided: true, statement, why: 'w', sourceRefs: ['Home'], level: 'users', levelCheck: { users: { passed: false, evidence: 'no customer named' } } } } } as unknown as SynthesisOutput);
  const restating = 'You have not shown a single founder who used it or a result it produced.';
  const deeper = 'You have not yet put the product in front of a single founder outside your own circle.';

  it('re-asks once and keeps the deeper cause, flagged retried', async () => {
    const calls: string[] = [];
    const out = await refineConstraint(base(restating), 'en', async (_s, u) => { calls.push(u); return JSON.stringify({ decided: true, statement: deeper, why: 'w2', sourceRefs: ['Home'] }); });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!).problem).toMatch(/No source shows a single founder/);
    expect(out.understanding.constraint).toEqual({ decided: true, statement: deeper, why: 'w2', sourceRefs: ['Home'], retried: true });
    expect(restatedTension(out.understanding)).toBeNull();
  });
  it('flags visibility phrasing, not facts', () => {
    expect(visibilityPhrased('You have not yet shown that a founder can go through the flow.')).toBe(true);
    expect(visibilityPhrased("You haven't demonstrated the method.")).toBe(true);
    expect(visibilityPhrased('No founder has gone through the flow and gotten a result.')).toBe(false);
    expect(visibilityPhrased('You have not chosen who it is for.')).toBe(false);
  });
  it('makes no call when the constraint is already distinct', async () => {
    let n = 0;
    const out = await refineConstraint(base(deeper), 'en', async () => { n++; return '{}'; });
    expect(n).toBe(0);
    expect(out.understanding.constraint?.statement).toBe(deeper);
  });
  it('keeps the retry whenever it is decided, even if it still overlaps (the card merges that tension)', async () => {
    const users = 'No founder has used it yet and got a result from it.';
    const out = await refineConstraint(base(restating), 'en', async () => JSON.stringify({ decided: true, statement: users, why: 'w', sourceRefs: [] }));
    expect(out.understanding.constraint).toMatchObject({ statement: users, retried: true });
  });
  it('re-asks a visibility-phrased constraint even when it overlaps no tension', async () => {
    let n = 0;
    const out = await refineConstraint(base('You have not yet shown that a client can complete the programme.'), 'en',
      async (_s, u) => { n++; expect(JSON.parse(u).problem).toMatch(/visible/); return JSON.stringify({ decided: true, statement: 'No client has completed the programme and got a result.', why: '', sourceRefs: [] }); });
    expect(n).toBe(1);
    expect(out.understanding.constraint?.statement).toBe('No client has completed the programme and got a result.');
  });
  it('keeps the first constraint when the retry is undecided or throws', async () => {
    for (const reply of [JSON.stringify({ decided: false, statement: '', why: '', sourceRefs: [] })]) {
      expect((await refineConstraint(base(restating), 'en', async () => reply)).understanding.constraint?.statement).toBe(restating);
    }
    expect((await refineConstraint(base(restating), 'en', async () => { throw new Error('boom'); })).understanding.constraint?.statement).toBe(restating);
  });
});

describe('levelProblem — the constraint level must match the model\'s own level check (Strategic Depth W1)', () => {
  const u = (constraint: object, stage = 'validating'): GovernedUnderstanding => ({ stage: { stage }, constraint: { decided: true, statement: 's', why: '', sourceRefs: [], ...constraint } }) as unknown as GovernedUnderstanding;
  const passed = (evidence: string) => ({ passed: true, evidence });
  const failed = (evidence: string) => ({ passed: false, evidence });
  it('accepts the first failing level', () => {
    expect(levelProblem(u({ level: 'users', levelCheck: { users: failed('no customer') } }))).toBeNull();
    expect(levelProblem(u({ level: 'target', levelCheck: { users: passed('members'), target: failed('three audiences') } }, 'growth'))).toBeNull();
    expect(levelProblem(u({ level: 'time', levelCheck: { users: passed('a'), target: passed('b'), offer: passed('c') } }, 'growth'))).toBeNull();
  });
  it('rejects a missing level, a skipped level, and users at growth/plateau (BIZZ.CLUB run a)', () => {
    expect(levelProblem(u({}))).toMatch(/does not say/);
    expect(levelProblem(u({ level: 'offer', levelCheck: { users: passed('members'), target: failed('three audiences') } }, 'growth'))).toMatch(/"target"/);
    expect(levelProblem(u({ level: 'users', levelCheck: { users: failed('no published member result') } }, 'growth'))).toMatch(/stage is growth/);
  });
  it('re-asks when the level is inconsistent, and keeps a retry only if its level is consistent', async () => {
    const first = { understanding: { contradictions: [], stage: { stage: 'growth' }, constraint: { decided: true, statement: 'No member has a published result.', why: '', sourceRefs: [], level: 'users', levelCheck: { users: failed('no published result') } } } } as unknown as SynthesisOutput;
    const good = { decided: true, level: 'target', levelCheck: { users: passed('hundreds of members'), target: failed('three audiences') }, statement: 'You have not chosen who the club is for.', why: '', sourceRefs: [] };
    const out = await refineConstraint(first, 'en', async (_s, body) => { expect(JSON.parse(body).problem).toMatch(/stage is growth/); return JSON.stringify(good); });
    expect(out.understanding.constraint).toMatchObject({ statement: 'You have not chosen who the club is for.', level: 'target', retried: true });
    const stillBad = await refineConstraint(first, 'en', async () => JSON.stringify({ ...good, level: 'users', levelCheck: { users: failed('x') } }));
    expect(stillBad.understanding.constraint?.statement).toBe('No member has a published result.');
  });
});
