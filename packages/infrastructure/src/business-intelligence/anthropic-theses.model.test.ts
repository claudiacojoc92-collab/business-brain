import { describe, it, expect } from 'vitest';
import { projectionRules, thesisRules, thesisUserBlock } from './anthropic-theses.model';

// STRATEGIC THESES prompt (2026-10-16): generic for any founder-led business; interpretation yes, new facts no.
describe('thesis prompt', () => {
  it('labels the governed material', () => {
    const b = thesisUserBlock({ businessName: 'N', language: 'en', facts: [{ ref: 'F1', text: 'Plans are monthly.' }], synthesis: 'S text',
      hypotheses: [{ ref: 'H0', interpretation: 'Two motions.', alternative: 'One motion.', unknown: 'How.', reversal: 'If.' }], unknowns: ['performance: revenue'], notConcluding: ['what drives revenue'] });
    for (const x of ['F1: Plans are monthly.', 'S — THE GOVERNED STRUCTURAL SYNTHESIS: S text', 'H0: Two motions.', '- performance: revenue', '- what drives revenue']) expect(b).toContain(x);
  });

  it('asks for theses (not observations), no quota, never new facts, and carries no industry vocabulary', () => {
    const r = thesisRules('Romanian');
    for (const x of ['STAY ABOVE THE SOLUTION', 'asks WHETHER the relationship exists before any HOW', 'model them as POSSIBLE until', 'A structural POSSIBILITY is never a behaviour FACT', 'driverQuestion', 'you may NEVER create a new FACT', 'typically 4 to 8, fewer when the business', 'Never invent a weak one to fill a quota', 'NOT an observation', '"none_observed" is a legitimate answer', 'in Romanian']) expect(r).toContain(x);
    expect(r).not.toMatch(/\b(Body Move|studios?|physio\w*|kineto\w*|pregnan\w*|classes|locations?|subscribers?|gym)\b/i);
  });
});

describe('projection prompt examples are in the founder\'s language (2026-10-17)', () => {
  it('a Romanian prompt quotes Romanian examples only', () => {
    const ro = projectionRules('Romanian', 'ro');
    expect(ro).toContain('în funcție de cât de des X duce la Y');
    expect(ro).toContain('Nu știu încă dacă…');
    expect(ro).not.toMatch(/depending on how often|I don't know yet|clients move from|which means|the only|changes the buying path|gateway or obstacle/);
    expect(projectionRules('English', 'en')).not.toMatch(/singurul|ceea ce înseamnă/);
  });
});
