import { describe, it, expect } from 'vitest';
import type { PageObservation } from '@bb/application';
import { systemPrompt, AnthropicUnderstandingModel, extractJson, visibilityPhrased, buildSourcesBlock } from './anthropic-understanding.model';

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

describe('understanding systemPrompt — the reasoning contract (2026-10-15: a strategist, not a website auditor)', () => {
  const p = systemPrompt('en');
  it('builds the business model first, across all nine dimensions, before tensions and diagnosis', () => {
    expect(p).toMatch(/ORDER OF WORK[\s\S]*Build the BUSINESS MODEL[\s\S]*tensions[\s\S]*diagnosis, which must be EARNED/);
    for (const d of ['offer', 'customer', 'acquisition', 'conversion', 'retention', 'capacity', 'economics', 'performance', 'intent']) expect(p).toContain(`- ${d}:`);
  });
  it('marks every assertion observed / declared / inferred / contradicted, and treats absence as about the sources', () => {
    expect(p).toMatch(/observed: it is in what you read[\s\S]*declared[\s\S]*inferred[\s\S]*contradicted/);
    expect(p).toMatch(/ABSENCE IS ABOUT THE SOURCES, NOT THE BUSINESS/);
    expect(p).toMatch(/NEVER "X does not\s+exist"/);
    expect(p).toMatch(/An absence item has an EMPTY soWhat/);
  });
  it('keeps technical / hygiene findings and stale pages out of the reasoning', () => {
    expect(p).toMatch(/Kind C goes ONLY in read\.websiteNotes/);
    expect(p).toMatch(/STALE OR UNVERIFIED[\s\S]*read\.untrusted/);
  });
  it('never forces a constraint: it is earned by five checks, and never from a website alone', () => {
    expect(p).not.toMatch(/DECIDE, DO NOT LIST|a strategist commits|ROOT-CAUSE ORDER/);
    expect(p).toMatch(/exists[\s\S]*causal[\s\S]*blocks[\s\S]*alternativesWeaker[\s\S]*evidenceSufficient/);
    expect(p).toMatch(/Never a constraint from a website alone/);
    expect(p).toMatch(/several audiences is NOT a constraint by itself/);
  });
  it('no tension quota and no mandatory capability check', () => {
    expect(p).not.toMatch(/3 to 4 real tensions|CAPABILITY CHECK \(always run it\)|NEVER A QUESTION/);
    expect(p).toMatch(/0 to 3[\s\S]*No quota/);
  });
  it('questions carry the strategic decisions their answer could change, about business reality not the website', () => {
    expect(p).toMatch(/"changes" lists the strategic decisions its answer could change/);
    expect(p).toMatch(/Ask about business reality, never the website/);
  });
  it('website positioning is how the site presents the business, never a founder choice; no behaviour, no guessed economics', () => {
    expect(p).toMatch(/positioning\.summary = ONE sentence[\s\S]*how the SOURCES present the business[\s\S]*never "you bet on", "you chose" or "your strategy"/);
    expect(p).toMatch(/NEVER PREDICT BEHAVIOUR/);
    expect(p).toMatch(/Unit economics the sources do not show[\s\S]*are UNKNOWN/);
    expect(p).toMatch(/aha\.findings: 0 to 3, each an OBSERVED fact/);
    expect(p).toMatch(/An ABSENCE is a tension ONLY when it connects to a goal or mechanism the founder declared/);
  });
  it('strategy-critical unknowns get a question; a fact is not an insight; one source owner per claim', () => {
    expect(p).toMatch(/STRATEGY-CRITICAL: for an operating business[\s\S]*performance[\s\S]*acquisition/);
    expect(p).toContain('"fills": [');
    expect(p).toMatch(/A FACT IS NOT AN INSIGHT[\s\S]*"matters"[\s\S]*"changes"/);
    expect(p).toMatch(/SOURCE VOICE — one owner per claim[\s\S]*Never "The site declares that you serve…"/);
  });
  it('every number is grounded (entity, qualifier, verbatim line) or an explicit calculation; why it matters is business-specific', () => {
    expect(p).toMatch(/NUMBERS — every digit you write[\s\S]*qualifier[\s\S]*"calculations"[\s\S]*Never pair a number with a neighbouring offer or package/);
    expect(p).toMatch(/"matters" must be about THIS business[\s\S]*would fit thousands of businesses[\s\S]*session duration, trainer time, utilisation/);
  });
  it('metrics that can diverge stay separate answers', () => {
    expect(p).toMatch(/two metrics can DIVERGE[\s\S]*"a\) … b\) …"[\s\S]*"parts"/);
    expect(p).toContain('"parts": []');
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
