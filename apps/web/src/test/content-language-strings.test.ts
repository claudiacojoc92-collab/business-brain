import { describe, it, expect } from 'vitest';
import { CONTENT_KEYS, CONTENT_DE, contentT } from '../i18n/content';
import { CATALOG } from '../i18n/messages';

// Rule amendment 2026-10-13: strings that read as BB's sentence about the business follow the STORED content language;
// headings, buttons and chips stay English.
describe('content-language strings', () => {
  it('every content key has an EN, RO, IT and DE entry', () => {
    for (const k of CONTENT_KEYS) {
      expect(CATALOG.en[k], `en ${k}`).toBeTruthy();
      expect(CATALOG.ro[k], `ro ${k}`).toBeTruthy();
      expect(CATALOG.it[k], `it ${k}`).toBeTruthy();
      expect(CONTENT_DE[k], `de ${k}`).toBeTruthy();
    }
    expect(Object.keys(CONTENT_DE).filter((k) => !CONTENT_KEYS.has(k))).toEqual([]); // no German outside the list
  });

  it('every translation keeps the same {vars} as English', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of CONTENT_KEYS) {
      for (const [l, v] of [['ro', CATALOG.ro[k]], ['it', CATALOG.it[k]], ['de', CONTENT_DE[k]]] as const) {
        expect(vars(v ?? ''), `${l} ${k}`).toBe(vars(CATALOG.en[k]!));
      }
    }
  });

  it('a content key follows the content language', () => {
    expect(contentT('de', 'arc.understanding.constraint.tail')).toBe('Alles andere ist ein Symptom.');
    expect(contentT('de', 'arc.understanding.servesLead', { who: 'Privatpersonen' })).toBe('Für: Privatpersonen.');
    expect(contentT('de-DE', 'arc.understanding.stage.means.validating')).toBe('In dieser Phase: erst validieren, nicht skalieren.');
    expect(contentT('ro', 'home.line.bet', { bet: 'Recomandări.' })).toBe('Pariul tău: Recomandări.');
    expect(contentT('de', 'arc.strategy.changed', { because: 'x' })).toContain('„x“');
  });

  it('a heading, button or chip stays English even for a German business', () => {
    expect(contentT('de', 'arc.understanding.constraint')).toBe('Your real constraint');
    expect(contentT('de', 'arc.strategy.adopt')).toBe('Yes, I like it');
    expect(contentT('ro', 'arc.prov.declared')).toBe('you told me');
  });

  it('no, unknown or unsupported language → English', () => {
    expect(contentT(null, 'arc.understanding.constraint.tail')).toBe('Everything else is a symptom.');
    expect(contentT('ru', 'arc.understanding.constraint.tail')).toBe('Everything else is a symptom.');
  });
});
