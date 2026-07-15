/**
 * EMAIL-1 composition: choose the magic-link email adapter and, in production, FAIL FAST at startup on
 * missing/invalid config — a silent "sends nothing" dead-end is worse than a loud boot failure.
 *
 * WHERE THIS LIVES (deliberate): it is called from main.ts (the process entry). It must NOT run inside a
 * service constructor or registerRoutes/registerSessionRoutes — the production route-registration tests
 * (connect-routes/read-routes) call registerRoutes(app) under NODE_ENV=production and would break (the C2
 * regression). No test imports main.ts, so a startup fail-fast here is invisible to the suites.
 *
 * The checks are DETERMINISTIC + LOCAL — no test email, no Resend availability dependency at boot.
 */
import type { IEmailService } from './email.service';
import { LogEmailService } from './email.service';
import { ResendEmailService } from './resend-email.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };

const isProduction = (env: NodeJS.ProcessEnv): boolean => env['NODE_ENV'] === 'production';

/** A syntactically-plausible "Name <local@domain>" or bare "local@domain" sender. */
function isValidFrom(from: string): boolean {
  const m = from.match(/<([^>]+)>\s*$/);
  const addr = (m?.[1] ?? from).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

/**
 * A production magic-link base URL must be a public https origin that a real inbox can reach — never
 * localhost/loopback, never a bare container hostname (no dot), never a private range. A localhost link
 * in a real email is a dead letter.
 */
function isPublicHttpsOrigin(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') return false;
  if (!h.includes('.')) return false;                                  // bare container host
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return false;           // private ranges
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  return true;
}

/** Throws (with a clear, secret-free message) when production email config is missing/invalid. */
export function validateProductionEmailConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];
  if (!env['RESEND_API_KEY']) problems.push('RESEND_API_KEY is missing');
  const from = env['EMAIL_FROM'];
  if (!from) problems.push('EMAIL_FROM is missing');
  else if (!isValidFrom(from)) problems.push('EMAIL_FROM is not a valid sender address');
  const base = env['APP_BASE_URL'];
  if (!base) problems.push('APP_BASE_URL is missing');
  else if (!isPublicHttpsOrigin(base)) problems.push('APP_BASE_URL must be a public https origin (not localhost/loopback/private/bare-host)');
  if (problems.length > 0) {
    throw new Error(`Production email is not configured: ${problems.join('; ')}. Refusing to start (magic-link login would silently fail).`);
  }
}

/**
 * Production → ResendEmailService (after validating config). Dev/test → LogEmailService (the labeled dev
 * link, unchanged). The API key/from never appear in logs or errors here.
 */
export function selectEmailService(logger?: Log, env: NodeJS.ProcessEnv = process.env): IEmailService {
  if (!isProduction(env)) return new LogEmailService(logger);
  validateProductionEmailConfig(env);
  return new ResendEmailService({ apiKey: env['RESEND_API_KEY']!, from: env['EMAIL_FROM']!, logger });
}
