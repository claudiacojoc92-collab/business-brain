import { describe, it, expect } from 'vitest';
import type { PageObservation, SynthesisOutput, GovernedUnderstanding } from '@bb/application';
import { systemPrompt, AnthropicUnderstandingModel, extractJson, visibilityPhrased, buildSourcesBlock, refineConstraint, restatedTension, levelProblem, deeperConstraintPrompt } from './anthropic-understanding.model';

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

  it('audience.summary is COMPOSED (founder language); audience.addressed stays LIFTED (2026-10-14)', () => {
    expect(lineA).toContain('audience.summary');
    expect(lineB).not.toContain('audience.summary');
    expect(lineB).toContain('audience.addressed');
    expect(lineA).not.toMatch(/audience\.addressed/);
    expect(systemPrompt('de')).toMatch(/audience\.summary = a short LABEL in German/);
    expect(p).toContain('"audience": {"summary": ""');
  });

  it('names the founder language, and keeps proper-noun / mixed-source / no-drift rules', () => {
    expect(systemPrompt('ro')).toContain('Romanian');
    expect(systemPrompt('en')).toContain('English');
    expect(systemPrompt('it')).toContain('Italian');
    expect(p).toContain('MIXED-LANGUAGE SOURCE');
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

describe('understanding systemPrompt — the reasoning contract (2026-10-15; strategist restored 2026-10-17)', () => {
  const p = systemPrompt('en');
  it('builds the business model first, across all nine dimensions, then the ranked tensions, then DECIDES the constraint', () => {
    expect(p).toMatch(/ORDER OF WORK[\s\S]*Build the BUSINESS MODEL[\s\S]*3 to 4 tensions, ranked[\s\S]*DECIDE the ONE constraint/);
    for (const d of ['offer', 'customer', 'acquisition', 'conversion', 'retention', 'capacity', 'economics', 'performance', 'intent']) expect(p).toContain(`- ${d}:`);
  });
  it('marks every assertion observed / declared / inferred / contradicted, and treats absence as about the sources', () => {
    expect(p).toMatch(/observed: it is in what you read[\s\S]*declared[\s\S]*inferred[\s\S]*contradicted/);
    expect(p).toMatch(/ABSENCE IS ABOUT THE SOURCES, NOT THE BUSINESS/);
    expect(p).toMatch(/NEVER "X does not\s+exist"/);
    // A website-structure absence is a website note; a business absence (sold vs shown) stays a tension with a so-what.
    expect(p).toMatch(/About the WEBSITE\\?'s structure[\s\S]*website notes only[\s\S]*About the BUSINESS[\s\S]*cannot see, judge or check/);
    expect(p).not.toMatch(/An absence item has an EMPTY soWhat/);
  });
  it('keeps technical / hygiene findings and stale pages out of the reasoning', () => {
    expect(p).toMatch(/Kind C goes ONLY in read\.websiteNotes/);
    expect(p).toMatch(/STALE OR UNVERIFIED[\s\S]*read\.untrusted/);
  });
  // RESTORED 2026-10-17 (operator): the 10-15 contract forbade a position on a first read. A strategist commits.
  it('decides ONE constraint, by the root-cause order, and commits: no website-only ban, no "not ready" as an answer', () => {
    expect(p).toMatch(/CONSTRAINT — DECIDE, DO NOT LIST\. This is the most important field/);
    expect(p).toMatch(/Being careful is not a reason to be undecided: a strategist commits/);
    expect(p).toMatch(/ROOT-CAUSE ORDER[\s\S]*1\. USERS[\s\S]*2\. TARGET[\s\S]*3\. OFFER[\s\S]*levelCheck/);
    expect(p).toContain('"constraint": {"decided": true, "level": "users|target|offer|time"');
    expect(p).not.toMatch(/Never a constraint from a website alone|is a strong, honest answer at the first read|several audiences is NOT a constraint by itself/);
  });
  it('3 to 4 tensions ranked by severity, the capability check first, every tension with a so-what', () => {
    expect(p).toMatch(/3 to 4 real tensions about the BUSINESS[\s\S]*RANKED by severity/);
    expect(p).toMatch(/CAPABILITY CHECK \(always run it\)[\s\S]*PRIMARY contradiction/);
    expect(p).toContain('"capabilityCheck": {"sells": ""');
    expect(p).toMatch(/THE SO-WHAT TEST[\s\S]*This means <what your customers cannot see, judge or do>, so <what that leaves you with/);
    expect(p).toMatch(/A GAP YOU CAN SEE IS AN OBSERVATION, NEVER A QUESTION/);
    expect(p).not.toMatch(/0 to 3, about the BUSINESS|none is a valid answer/);
  });
  it('questions carry the strategic decisions their answer could change, about business reality not the website', () => {
    expect(p).toMatch(/"changes" lists the strategic decisions its answer could change/);
    expect(p).toMatch(/Ask about business reality, never the website/);
  });
  it('positioning is what you are betting on; behaviour predictions are banned, what a customer cannot judge is allowed', () => {
    expect(p).toMatch(/positioning\.summary = ONE sentence, at most 20 words: what you are betting on/);
    expect(p).toMatch(/NO BEHAVIOUR PREDICTIONS: never claim how people FEEL, whether they CONVERT, or what they WILL DO/);
    expect(p).toMatch(/ALLOWED, because it is about the\s+information available[\s\S]*CANNOT see, judge or check/);
    expect(p).toMatch(/Unit economics the sources do not show[\s\S]*are UNKNOWN/);
    expect(p).toMatch(/aha\.findings: 2 to 3 findings, RANKED/);
    expect(p).not.toMatch(/how the SOURCES present the business|NEVER PREDICT BEHAVIOUR|An ABSENCE is a tension ONLY when/);
  });
  it('strategy-critical unknowns get a question; a fact is not an insight; one source owner per claim', () => {
    expect(p).toMatch(/STRATEGY-CRITICAL: for an operating business[\s\S]*performance[\s\S]*acquisition/);
    expect(p).toContain('"fills": [');
    expect(p).toMatch(/A FACT IS NOT AN INSIGHT[\s\S]*"matters"[\s\S]*"changes"/);
    expect(p).not.toMatch(/SOURCE VOICE/); // the site no longer owns the sentence: BB speaks to the founder
  });
  it('every number is grounded (entity, qualifier, verbatim line) or an explicit calculation; why it matters is business-specific', () => {
    expect(p).toMatch(/NUMBERS — every digit you write[\s\S]*qualifier[\s\S]*"calculations"[\s\S]*Never pair a number with a neighbouring offer or package/);
    expect(p).toMatch(/"matters" must be about THIS business[\s\S]*would fit thousands of businesses[\s\S]*session duration, trainer time, utilisation/);
  });
  it('stage evidence and the secondary\'s evidence are explicit JSON lists, and their numbers are grounded', () => {
    expect(p).toMatch(/stage\.evidence = a LIST \(JSON array\) of 2 to 4[\s\S]*stage\.secondary\.evidence = a LIST[\s\S]*1 to 2 observations, never a single string/);
    expect(p).toContain('"secondary": {"stage": "", "area": "", "evidence": ["<observation>"]');
  });
  it('metrics that can diverge stay separate answers', () => {
    expect(p).toMatch(/two metrics can DIVERGE[\s\S]*"a\) … b\) …"[\s\S]*"parts"/);
    expect(p).toContain('"parts": []');
  });
  it('relates the facts (STRUCTURE) after the model and before tensions: reversible hypotheses, like with like, no footprint stage', () => {
    expect(p).toMatch(/ORDER OF WORK[\s\S]*BUSINESS MODEL[\s\S]*RELATE the facts[\s\S]*STRUCTURE \(read\.structure\)[\s\S]*tensions/);
    expect(p).toContain('"structure": {"synthesis": "", "hypotheses": [{"pattern": ""');
    for (const f of ['"alternative"', '"discriminator"', '"reversal"', '"between"', '"dimensions"', '"whyItMatters"', '"context"', '"counts"']) expect(p).toContain(f);
    expect(p).not.toMatch(/weaker than a conclusion the evidence has not earned|Not every service seems to be sold the same way/);
    expect(p).toMatch(/Never a fixed opening formula/);
    expect(p).toMatch(/Never "N businesses"/);
    expect(p).toMatch(/SCOPE: every statement covers exactly the items its source says it for/);
    expect(p).toMatch(/one\s+person listed on a team page does not establish capacity or availability/);
    expect(p).toMatch(/OPERATING MODEL = a different MECHANISM[\s\S]*A\s+different audience, life stage or service name alone is NOT an operating model/);
    expect(p).toMatch(/reversal = NEW evidence[\s\S]*Never something on the pages[\s\S]*not already true there/);
    expect(p).toMatch(/never presupposes a future the founder has not stated/);
    expect(p).toMatch(/COMPARE LIKE WITH LIKE/);
    expect(p).not.toMatch(/FOOTPRINT IS NOT STAGE EVIDENCE/);
    expect(p).toMatch(/"growth" = it demonstrably works and is expanding[\s\S]*several locations/);
    expect(p).toMatch(/which acquisition paths are already real and which options would be new\s+bets/);
    expect(p).not.toMatch(/confidence (score|percentage)/i);
  });

  it('contains no real business: no test case, no Body Move example, no withheld initiative', () => {
    expect(p).not.toMatch(/decision system/i);
    expect(p).not.toMatch(/karate|Ballet|Automasaj|kineto|Body Move|medical-referral|referral protocol|ghișeu/i);
  });
});

describe('sources block — how each page was found, and technical pages left out (2026-10-15)', () => {
  const page = (ref: string, url: string, discoveredVia?: PageObservation['discoveredVia']): PageObservation => ({ ref, url, pageType: 'page', title: null, text: `${ref} text`, lang: 'en', provenance: 'observed', sourceKind: 'website', ...(discoveredVia ? { discoveredVia } : {}) });
  it('labels sitemap-only pages, orders linked pages first, and never shows sitemap XML or maintenance pages', () => {
    const block = buildSourcesBlock([
      page('Old page', 'https://a.ro/old/', 'sitemap'), page('Home', 'https://a.ro/', 'entry'), page('Page-sitemap.xml', 'https://a.ro/page-sitemap.xml', 'sitemap'),
      page('Maintenance', 'https://a.ro/maintenance/', 'link'), page('Services', 'https://a.ro/services/', 'link'),
    ]);
    expect(block.indexOf('ref="Home"')).toBeLessThan(block.indexOf('ref="Services"'));
    expect(block.indexOf('ref="Services"')).toBeLessThan(block.indexOf('ref="Old page"'));
    expect(block).toMatch(/ref="Old page"[^\n]*listed ONLY in the sitemap/);
    expect(block).not.toMatch(/sitemap\.xml|Maintenance/);
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

describe('visibilityPhrased (kept for the arc projection)', () => {
  it('flags visibility phrasing, not facts', () => {
    expect(visibilityPhrased('You have not yet shown that a founder can go through the flow.')).toBe(true);
    expect(visibilityPhrased("You haven't demonstrated the method.")).toBe(true);
    expect(visibilityPhrased('No founder has gone through the flow and gotten a result.')).toBe(false);
    expect(visibilityPhrased('You have not chosen who it is for.')).toBe(false);
  });
});

// RESTORED 2026-10-17 with the constraint retry (removed on 10-15).
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

describe('deeperConstraintPrompt — the retry digs in the same root-cause order (restored 2026-10-17)', () => {
  it('names the order and the passed-level rule, and never asks for visibility phrasing', () => {
    expect(deeperConstraintPrompt('en')).toMatch(/ROOT-CAUSE ORDER[\s\S]*1\. USERS[\s\S]*2\. TARGET[\s\S]*3\. OFFER/);
    expect(deeperConstraintPrompt('en')).toMatch(/this level is PASSED/);
    expect(deeperConstraintPrompt('ro')).toMatch(/Write statement and why in Romanian/);
  });
});
