/**
 * Scans text for pseudonymisation placeholder tokens.
 * Any occurrence of [TOKEN_NAME] pattern indicates a PII leak.
 * Source: Corrections Addendum V1 F008.
 */
export function detectPiiPlaceholders(text: string): string[] {
  const matches = text.match(/\[[A-Z][A-Z_]*_[A-Z]+\]/g);
  return matches ?? [];
}

export function hasPiiPlaceholders(text: string): boolean {
  return detectPiiPlaceholders(text).length > 0;
}
