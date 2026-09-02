/**
 * URL front door — normalization + validation. Honest, bounded: default to https, fall
 * back to http only if https fails at fetch time (caller's concern). Rejects non-http(s).
 */
export type NormalizedUrl =
  | { ok: true; url: string; origin: string; host: string }
  | { ok: false; error: string };

export function normalizeUrl(input: string): NormalizedUrl {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'Enter a website URL.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, error: `That doesn't look like a valid URL: "${raw}".` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) websites can be read.' };
  }
  if (!parsed.hostname || !parsed.hostname.includes('.')) {
    return { ok: false, error: `That doesn't look like a website domain: "${raw}".` };
  }

  return { ok: true, url: parsed.toString(), origin: parsed.origin, host: parsed.hostname };
}

/** Same-origin check used to keep discovery on the founder's own site (never third-party). */
export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
