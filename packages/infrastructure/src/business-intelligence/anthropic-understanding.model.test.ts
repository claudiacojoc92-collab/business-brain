import { describe, it, expect } from 'vitest';
import type { PageObservation } from '@bb/application';
import { systemPrompt, AnthropicUnderstandingModel } from './anthropic-understanding.model';

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
    expect(p).toMatch(/NEVER go in contradictions or aha\.findings/);
  });
  it('requires the so-what and a ranked list', () => {
    expect(p).toMatch(/THE SO-WHAT TEST/);
    expect(p).toMatch(/RANK, do not list/);
  });
  it('does not contain the Business Brain test case itself (the dogfood run must find it, not echo it)', () => {
    expect(p).not.toMatch(/decision system/i);
  });
});

