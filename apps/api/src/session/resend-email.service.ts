/**
 * Production magic-link email adapter (EMAIL-1). Sends the sign-in link via Resend behind the SAME
 * IEmailService boundary as the dev LogEmailService — one email per requested link, over the Resend
 * HTTP API (raw fetch; Node 20 has global fetch, so no SDK dependency). It sends; it does not mint
 * tokens or decide policy (the route owns that).
 *
 * REDACTION (critical — the link IS the token): on failure this logs ONLY sanitized metadata
 * (http status + provider error code/message). It NEVER logs or echoes the token, the access link,
 * the request body, the html/text, the Authorization header, or the API key. On success it logs only
 * the provider message id.
 */
import type { IEmailService } from './email.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Log = { info: (o: any, m?: string) => void; warn: (o: any, m?: string) => void };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface ResendConfig {
  apiKey: string;
  from: string; // e.g. "Business Brain <access@auth.getbusinessbrain.com>"
  logger?: Log;
}

/** Extract only non-sensitive fields from a Resend error body (never the whole payload). */
function providerError(body: unknown): { code: string | null; message: string | null } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const code = typeof b['name'] === 'string' ? (b['name'] as string) : null;
    const message = typeof b['message'] === 'string' ? (b['message'] as string) : null;
    return { code, message };
  }
  return { code: null, message: null };
}

export class ResendEmailService implements IEmailService {
  constructor(private readonly cfg: ResendConfig) {}

  async sendMagicLink(email: string, link: string): Promise<void> {
    const subject = 'Your sign-in link';
    const html = `<p>Here is your sign-in link for Business Brain. It expires in 15 minutes and can be used once.</p>`
      + `<p><a href="${link}">Sign in</a></p>`
      + `<p>If you didn't request this, you can ignore this email.</p>`;
    const text = `Here is your sign-in link for Business Brain. It expires in 15 minutes and can be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.`;

    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.cfg.from, to: email, subject, html, text }),
      });
    } catch (e) {
      // Network/transport failure — sanitized only (no key, no link, no payload).
      this.cfg.logger?.warn({ event: 'magic_link_send_failed', reason: 'network' }, 'magic-link send failed');
      throw new Error('magic-link send failed');
    }

    if (!res.ok) {
      const { code, message } = providerError(await res.json().catch(() => null));
      // Sanitized metadata ONLY — http status + provider error code/message. Never the token/link/body.
      this.cfg.logger?.warn(
        { event: 'magic_link_send_failed', httpStatus: res.status, providerCode: code, providerMessage: message },
        'magic-link send failed',
      );
      throw new Error('magic-link send failed');
    }

    const id = ((await res.json().catch(() => null)) as { id?: unknown } | null)?.id;
    this.cfg.logger?.info({ event: 'magic_link_sent', messageId: typeof id === 'string' ? id : null }, 'magic-link sent');
  }
}
