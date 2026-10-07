import { resolveContentLanguage, detectLanguageSwitchRequest, detectTextLanguage, type IContentLanguageStore } from '@bb/application';

/**
 * The language every model call for this business writes in: the business's CONTENT language (decided once per
 * business, see packages/application/src/business/content-language.ts), never the UI locale. The UI is always
 * English once logged in; the account locale is only the last fallback.
 */
export function contentLanguageFor(store: IContentLanguageStore | undefined, businessId: string, accountLocale: string | null | undefined): Promise<string> {
  return resolveContentLanguage(store, businessId, accountLocale);
}

/**
 * The founder just wrote `text`. A DELIBERATE request ("reply in English", "răspunde în română") switches the
 * business's content language. Otherwise, only when nothing is decided yet (no stored language and no material
 * language), a clearly-detectable message decides it once (the second signal). A short reply decides nothing.
 * Returns the language to answer in.
 */
export async function noteFounderText(store: IContentLanguageStore | undefined, businessId: string, text: string, current: string): Promise<string> {
  if (!store) return current;
  const requested = detectLanguageSwitchRequest(text);
  if (requested) { await store.set(businessId, requested); return requested; }
  const decided = (await store.get(businessId).catch(() => null)) ?? (await store.firstUnderstandingLanguage(businessId).catch(() => null));
  if (decided) return current;
  const detected = detectTextLanguage(text);
  if (detected) { await store.setIfUnset(businessId, detected); return detected; }
  return current;
}
