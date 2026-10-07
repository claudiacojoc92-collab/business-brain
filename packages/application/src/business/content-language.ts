/**
 * CONTENT LANGUAGE — the language BB writes in for a business (understanding, conversation, strategy, plan, mirror,
 * email, pages…). It is a property of the BUSINESS, decided once, and it is SEPARATE from the UI, which is always
 * English once logged in (operator rule, 2026-10-07).
 *
 * Resolution, in order:
 *   1. the business's stored content_language (set once at first understanding, or by an explicit founder switch);
 *   2. the language detected in the business's FIRST understanding (legacy businesses such as Body Move: they stay in
 *      the language they have always had, with no data migration);
 *   3. the account locale (the language the founder signed up in; the old source of truth);
 *   4. English.
 * Detection is deterministic and never per-message: a short "ok" / "thanks", or a foreign word inside a sentence,
 * cannot flip it. Only an explicit request ("reply in English") changes a language that is already set.
 */
import { isSupportedLocale, type SupportedLocale } from './types';

export interface IContentLanguageStore {
  /** The stored content language, or null when it has not been decided yet. */
  get(businessId: string): Promise<SupportedLocale | null>;
  /** Store it only if nothing is stored yet (first understanding / first long conversation turn). */
  setIfUnset(businessId: string, language: SupportedLocale): Promise<void>;
  /** Overwrite: ONLY for a deliberate founder request to switch. */
  set(businessId: string, language: SupportedLocale): Promise<void>;
  /** The source language detected in the business's FIRST understanding snapshot, or null. */
  firstUnderstandingLanguage(businessId: string): Promise<string | null>;
}

export const toLocale = (v: string | null | undefined): SupportedLocale | null => {
  const s = (v ?? '').trim().toLowerCase().slice(0, 2);
  return isSupportedLocale(s) ? s : null;
};

export async function resolveContentLanguage(
  store: IContentLanguageStore | undefined, businessId: string, accountLocale: string | null | undefined,
): Promise<SupportedLocale> {
  if (store) {
    const stored = await store.get(businessId).catch(() => null);
    if (stored) return stored;
    const first = toLocale(await store.firstUnderstandingLanguage(businessId).catch(() => null));
    if (first) return first;
  }
  return toLocale(accountLocale) ?? 'en';
}

/** The founder's MATERIAL language (website, PDFs, pasted text): the majority of the observations' detected
 *  languages. Null when nothing is detected. */
export function detectMaterialLanguage(langs: readonly (string | null | undefined)[]): SupportedLocale | null {
  const counts = new Map<SupportedLocale, number>();
  for (const l of langs) { const k = toLocale(l); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best: SupportedLocale | null = null; let n = 0;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  return best;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP: Record<SupportedLocale, ReadonlySet<string>> = {
  ro: new Set(['si', 'sa', 'este', 'pentru', 'care', 'nu', 'cu', 'la', 'de', 'in', 'din', 'mai', 'am', 'sunt', 'ce', 'un', 'o', 'ca', 'pe', 'noi', 'meu', 'mea', 'avem', 'vreau', 'cum', 'acum', 'asta', 'clientii', 'clienti']),
  it: new Set(['e', 'il', 'la', 'che', 'di', 'per', 'non', 'sono', 'con', 'una', 'gli', 'del', 'della', 'nel', 'ho', 'abbiamo', 'voglio', 'come', 'questo', 'clienti', 'anche', 'ma', 'piu']),
  en: new Set(['the', 'and', 'is', 'for', 'that', 'not', 'with', 'are', 'we', 'our', 'i', 'my', 'have', 'want', 'how', 'this', 'to', 'of', 'a', 'it', 'you', 'clients', 'customers', 'but', 'more']),
};

/** The language of a piece of the founder's OWN writing, or null when it is too short or not clear. Used only as
 *  the SECOND signal (no material) and never on a short reply: below 40 characters or without a clear winner it
 *  returns null, so "ok" / "thanks" / a borrowed English word decide nothing. */
export function detectTextLanguage(text: string): SupportedLocale | null {
  const t = text.trim();
  if (t.length < 40) return null;
  const words = fold(t).split(/[^a-z']+/).filter(Boolean);
  const score: Record<SupportedLocale, number> = { ro: 0, it: 0, en: 0 };
  for (const w of words) for (const l of ['ro', 'it', 'en'] as const) if (STOP[l].has(w)) score[l]++;
  if (/[ăâîșşțţ]/i.test(t)) score.ro += 3;                      // Romanian-only letters
  const ranked = (Object.entries(score) as [SupportedLocale, number][]).sort((a, b) => b[1] - a[1]);
  const [[top, a], [, b]] = ranked as [[SupportedLocale, number], [SupportedLocale, number]];
  return a >= 3 && a >= 2 * b ? top : null;                     // a clear winner, or nothing
}

const SWITCH: { re: RegExp; to: SupportedLocale }[] = [
  { re: /\b(reply|answer|respond|write|talk|speak|continue|switch)\b[^.?!]{0,20}\b(in|to)\s+english\b|\bin english,? please\b/, to: 'en' },
  { re: /\b(reply|answer|respond|write|talk|speak|continue|switch)\b[^.?!]{0,20}\b(in|to)\s+(romanian|italian)\b/, to: 'ro' }, // refined below
  { re: /\b(raspunde|raspundeti|scrie|scrieti|vorbeste|continua|treci)\b[^.?!]{0,20}\bin\s+(engleza)\b/, to: 'en' },
  { re: /\b(raspunde|raspundeti|scrie|scrieti|vorbeste|continua|treci)\b[^.?!]{0,20}\bin\s+(romana)\b/, to: 'ro' },
  { re: /\b(raspunde|raspundeti|scrie|scrieti|vorbeste|continua|treci)\b[^.?!]{0,20}\bin\s+(italiana)\b/, to: 'it' },
  { re: /\b(rispondi|rispondete|scrivi|scrivete|parla|continua|passa)\b[^.?!]{0,20}\bin\s+(inglese)\b/, to: 'en' },
  { re: /\b(rispondi|rispondete|scrivi|scrivete|parla|continua|passa)\b[^.?!]{0,20}\bin\s+(rumeno)\b/, to: 'ro' },
  { re: /\b(rispondi|rispondete|scrivi|scrivete|parla|continua|passa)\b[^.?!]{0,20}\bin\s+(italiano)\b/, to: 'it' },
];

/** A DELIBERATE request to change the content language ("reply in English", "răspunde în română",
 *  "rispondi in inglese"), or null. Mentioning a language in passing is not a request. */
export function detectLanguageSwitchRequest(text: string): SupportedLocale | null {
  const t = fold(text);
  for (const { re, to } of SWITCH) {
    const m = re.exec(t);
    if (!m) continue;
    if (to === 'ro' && /italian/.test(m[0])) return 'it';      // the EN rule matches both romanian and italian
    return to;
  }
  return null;
}
