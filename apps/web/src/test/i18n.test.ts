import { describe, it, expect } from 'vitest';
import { CATALOG, LOCALES, translate, isLocale } from '../i18n/messages';

describe('i18n catalogs (RO / EN / IT)', () => {
  it('exposes exactly ro, en, it', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(['en', 'it', 'ro']);
  });

  it('every locale defines the same keys (no missing translations)', () => {
    const enKeys = Object.keys(CATALOG.en).sort();
    for (const loc of ['ro', 'it'] as const) {
      expect(Object.keys(CATALOG[loc]).sort()).toEqual(enKeys);
    }
  });

  it('translates the decision-framed auth headline per locale', () => {
    // Category framing: the auth headline is decision-led (marketing decision system), not "strategist".
    expect(translate('en', 'auth.headline')).toMatch(/marketing decisions/i);
    expect(translate('ro', 'auth.headline')).toMatch(/decizii/i);
    expect(translate('it', 'auth.headline')).toMatch(/decisioni/i);
  });

  it('interpolates the greeting name', () => {
    expect(translate('en', 'home.greeting', { name: 'Claudia' })).toBe('Hi Claudia.');
    expect(translate('ro', 'home.greeting', { name: 'Claudia' })).toBe('Bună, Claudia.');
    expect(translate('it', 'home.greeting', { name: 'Claudia' })).toBe('Ciao Claudia.');
  });

  it('falls back to the key when missing', () => {
    expect(translate('en', 'nonexistent.key')).toBe('nonexistent.key');
  });

  it('guards the locale type', () => {
    expect(isLocale('ro')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });
});
