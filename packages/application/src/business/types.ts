/**
 * Slice 0 tenancy + locale value types.
 *
 * Canonical business/strategy state is language-INDEPENDENT (M1 decision 8). These
 * locales describe founder-facing preferences only: the UI interface language and the
 * per-business default conversation language.
 */

export const SUPPORTED_LOCALES = ['ro', 'en', 'it'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function coerceLocale(value: unknown, fallback: SupportedLocale = 'en'): SupportedLocale {
  return isSupportedLocale(value) ? value : fallback;
}

/** Membership role. Owner-only in M1; the type reserves room without building team features now. */
export type MembershipRole = 'owner';

export interface BusinessRecord {
  readonly id: string;
  readonly name: string;
  readonly ownerFounderId: string;
  readonly defaultConversationLanguage: SupportedLocale;
  readonly createdAt: string;
}

export interface CreateBusinessInput {
  readonly founderId: string;
  readonly name: string;
  readonly defaultConversationLanguage?: SupportedLocale;
}
