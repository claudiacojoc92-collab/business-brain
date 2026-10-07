import { describe, it, expect } from 'vitest';
import {
  resolveContentLanguage, detectMaterialLanguage, detectTextLanguage, detectLanguageSwitchRequest,
  type IContentLanguageStore,
} from './content-language';
import type { SupportedLocale } from './types';

function store(init: { stored?: SupportedLocale | null; first?: string | null } = {}) {
  let stored = init.stored ?? null;
  const s: IContentLanguageStore & { value: () => SupportedLocale | null } = {
    get: async () => stored,
    setIfUnset: async (_b, l) => { if (!stored) stored = l; },
    set: async (_b, l) => { stored = l; },
    firstUnderstandingLanguage: async () => init.first ?? null,
    value: () => stored,
  };
  return s;
}

describe('content language — a property of the business, separate from the (English) UI', () => {
  it('resolves stored → first understanding → account → English', async () => {
    expect(await resolveContentLanguage(store({ stored: 'it', first: 'ro' }), 'b', 'en')).toBe('it');
    expect(await resolveContentLanguage(store({ first: 'ro' }), 'b', 'en')).toBe('ro');
    expect(await resolveContentLanguage(store(), 'b', 'ro')).toBe('ro');
    expect(await resolveContentLanguage(store(), 'b', null)).toBe('en');
    expect(await resolveContentLanguage(undefined, 'b', 'it')).toBe('it');
  });

  it('Body Move (no stored value, Romanian first understanding, any account locale) stays Romanian — no migration', async () => {
    expect(await resolveContentLanguage(store({ first: 'ro' }), 'bodymove', 'en')).toBe('ro');
    expect(await resolveContentLanguage(store({ first: 'ro-RO' }), 'bodymove', 'en')).toBe('ro');
  });

  it('material language = the majority of the founder\'s material', () => {
    expect(detectMaterialLanguage(['ro', 'ro', 'en'])).toBe('ro');
    expect(detectMaterialLanguage(['it', null, 'it-IT', 'en'])).toBe('it');
    expect(detectMaterialLanguage([null, undefined, 'de'])).toBeNull();
  });

  it('a short reply or a borrowed word never decides the language', () => {
    for (const t of ['ok', 'thanks', 'Da', 'ok, thanks!', 'perfect']) expect(detectTextLanguage(t)).toBeNull();
    expect(detectTextLanguage('Vreau mai mulți clienți pentru recuperare după naștere, și am un studio în Cluj.')).toBe('ro');
    expect(detectTextLanguage('Vreau să fac un landing page pentru clienții care vin la recuperare cu noi.')).toBe('ro');
    expect(detectTextLanguage('We want more patients for recovery after an injury, and we have two locations.')).toBe('en');
    expect(detectTextLanguage('Voglio più clienti per il recupero dopo il parto, e abbiamo uno studio a Milano.')).toBe('it');
  });

  it('only a DELIBERATE request switches it', () => {
    expect(detectLanguageSwitchRequest('Can you reply in English please?')).toBe('en');
    expect(detectLanguageSwitchRequest('Răspunde în engleză, te rog.')).toBe('en');
    expect(detectLanguageSwitchRequest('Please answer in Romanian from now on')).toBe('ro');
    expect(detectLanguageSwitchRequest('switch to Italian')).toBe('it');
    expect(detectLanguageSwitchRequest('Rispondi in inglese')).toBe('en');
    expect(detectLanguageSwitchRequest('Scrie în română')).toBe('ro');
    expect(detectLanguageSwitchRequest('Avem clienți care vorbesc engleza și româna.')).toBeNull(); // mentions, not a request
    expect(detectLanguageSwitchRequest('ok')).toBeNull();
  });

  it('setIfUnset never overwrites; set (explicit switch) does', async () => {
    const s = store({ stored: 'ro' });
    await s.setIfUnset('b', 'en');
    expect(s.value()).toBe('ro');
    await s.set('b', 'en');
    expect(s.value()).toBe('en');
  });
});
