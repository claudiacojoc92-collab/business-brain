/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { noteFounderText, contentLanguageFor } from '../../routes/content-language';

const store = (stored: string | null, first: string | null = null) => {
  let v = stored;
  return { get: async () => v as any, setIfUnset: async (_b: string, l: string) => { if (!v) v = l; }, set: async (_b: string, l: string) => { v = l; }, firstUnderstandingLanguage: async () => first, value: () => v };
};

describe('conversation never flips the business language mid-conversation (rule 2026-10-07)', () => {
  it('a Romanian business: "ok", "thanks", an English word → still Romanian', async () => {
    const s = store('ro');
    for (const msg of ['ok', 'thanks', 'Da, e ok cu landing page-ul', 'perfect, thanks!']) {
      expect(await noteFounderText(s as any, 'b', msg, 'ro')).toBe('ro');
    }
    expect(s.value()).toBe('ro');
  });

  it('even a long English message does not flip a decided language', async () => {
    const s = store(null, 'ro'); // Body Move: decided by its first understanding, nothing stored
    expect(await noteFounderText(s as any, 'b', 'We want more patients for recovery after an injury, and we have two locations.', 'ro')).toBe('ro');
    expect(s.value()).toBeNull();
  });

  it('a deliberate "reply in English" switches it, and it stays switched', async () => {
    const s = store('ro');
    expect(await noteFounderText(s as any, 'b', 'Răspunde în engleză de acum, te rog', 'ro')).toBe('en');
    expect(s.value()).toBe('en');
    expect(await contentLanguageFor(s as any, 'b', 'ro')).toBe('en');
  });

  it('nothing decided and no material: a clear first message decides it once', async () => {
    const s = store(null, null);
    expect(await noteFounderText(s as any, 'b', 'Vreau mai mulți clienți pentru recuperare după naștere, și am un studio în Cluj.', 'en')).toBe('ro');
    expect(s.value()).toBe('ro');
    expect(await noteFounderText(s as any, 'b', 'ok thanks', 'ro')).toBe('ro');
  });
});
