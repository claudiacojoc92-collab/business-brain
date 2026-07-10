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

/** Dev/default adapter: logs the link (so the flow is testable/demonstrable without a provider). */
export class LogEmailService implements IEmailService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly logger?: { info: (o: any, m?: string) => void }) {}
  async sendMagicLink(email: string, link: string): Promise<void> {
    const line = `[magic-link] to=${email} link=${link}`;
    if (this.logger) this.logger.info({ email }, line); else console.log(line);
  }
}
