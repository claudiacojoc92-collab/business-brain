/**
 * Transactional email adapter for the magic link (S0-T2). A magic-link email is a DIRECT response to a
 * founder's own login request — transactional, NOT an Article VI summon/nudge/cadence.
 *
 * The default is a dev-safe LOG adapter (logs the link; never a real send). A real provider (Postmark/
 * SES/SendGrid) plugs in behind the same interface, env-gated — not wired here (no provider secret in
 * this task). The magic-link route never enumerates emails regardless of the adapter.
 */
export interface IEmailService {
  sendMagicLink(email: string, link: string): Promise<void>;
}

/** The same dev signal the magic-link route uses for its `devLink` response (session.routes.ts:21). */
const isProduction = (): boolean => process.env['NODE_ENV'] === 'production';

/**
 * Dev/default adapter: logs the link (so the flow is testable/demonstrable without a provider).
 * The link is a live single-use sign-in token, so it is logged ONLY outside production — the same
 * NODE_ENV signal that gates the route's `devLink` response.
 *
 * NOTE (email-delivery task): this adapter does not actually SEND, so wiring it in production is a
 * silent login dead-end (a founder gets no email). The honest fix — a real provider in prod, or a
 * fail-fast when none is wired — belongs to that task and must live at the composition layer, not
 * here: this class is constructed during route registration, which is exercised under
 * NODE_ENV=production (routes must be present, 401 not 404), so a throw here would wrongly break
 * route registration rather than just email delivery.
 */
export class LogEmailService implements IEmailService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly logger?: { info: (o: any, m?: string) => void }) {}
  async sendMagicLink(email: string, link: string): Promise<void> {
    if (isProduction()) return; // never write a live sign-in token to production logs
    const line = `[magic-link] to=${email} link=${link}`;
    if (this.logger) this.logger.info({ email }, line); else console.log(line);
  }
}
