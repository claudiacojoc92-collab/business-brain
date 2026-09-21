import { describe, it, expect } from 'vitest';
import { parseBriefing } from '../slice0/parse-briefing';

// The real Body Move opener (model output, unchanged): one recap paragraph + the invitation as its own paragraph.
const REAL = [
  'Înainte să vorbim, iată ce știu deja despre Body Move Studio. Din pliantul terapeutic pe care l-ai încărcat: aveți deja o broșură clinică completă adresată medicilor — ortopedie, neurologie, reumatologie — cu un flux clar de colaborare în șase pași și cinci specialiști nominalizați. Din pliantul corporate: există un al doilea canal de outreach — companii — cu servicii precum Pilates, Aerial Yoga, Functional Training. De pe site: Decebal este singura locație cu kinetoterapie, iar Schroth are cel mai mare preț per ședință (220 lei/ședință). Ce nu îmi este clar din surse: Decebal funcționează la ~70% capacitate; reprezentantul există dar nu a început.',
  'Ce lipsește? Ce am înțeles greșit?',
].join('\n\n');

describe('parseBriefing — the opener becomes a scannable structure (no model change)', () => {
  it('splits into a lead, source-labelled sections with bullets, a not-sure section, and the invitation', () => {
    const b = parseBriefing(REAL);
    expect(b.lead).toMatch(/^Înainte să vorbim/);
    expect(b.lead).not.toMatch(/pliantul terapeutic/); // the lead does not swallow the sections
    // three source sections, each labelled and bulleted
    const labels = b.sections.map((s) => s.label);
    expect(labels.some((l) => /pliantul terapeutic/i.test(l))).toBe(true);
    expect(labels.some((l) => /pliantul corporate/i.test(l))).toBe(true);
    expect(labels.some((l) => /de pe site/i.test(l))).toBe(true);
    for (const s of b.sections) expect(s.points.length).toBeGreaterThan(0);
    // the therapeutic section's em-dash sub-points became separate bullets
    const therap = b.sections.find((s) => /terapeutic/i.test(s.label))!;
    expect(therap.points.length).toBeGreaterThanOrEqual(2);
    // "what I'm not sure about" is its own section, not a source section
    expect(b.notSure).not.toBeNull();
    expect(b.notSure!.label).toMatch(/nu îmi este clar/i);
    expect(b.notSure!.points.length).toBeGreaterThan(0);
    // the invitation is captured separately (goes in the clay card, not the recap)
    expect(b.invitation).toBe('Ce lipsește? Ce am înțeles greșit?');
  });

  it('falls back cleanly when there are no "Label:" sections (no blob, invitation still separated)', () => {
    const b = parseBriefing('This is a plain paragraph with no sections at all. It just runs on. What did I get wrong?');
    expect(b.sections).toHaveLength(0);
    expect(b.notSure).toBeNull();
    expect(b.invitation).toBe('What did I get wrong?');
    expect(b.lead).toMatch(/plain paragraph/);
  });

  it('handles an opener with no invitation (nothing forced into a question)', () => {
    const b = parseBriefing('From your site: two locations and six services.');
    expect(b.invitation).toBeNull();
    expect(b.sections[0]?.label).toMatch(/from your site/i);
  });
});
