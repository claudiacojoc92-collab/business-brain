import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResendEmailService } from '../../session/resend-email.service';

/**
 * EMAIL-1 — the Resend adapter. Sends one email per link; on failure it THROWS after logging ONLY
 * sanitized metadata — never the token/link/key/Authorization/body/html.
 */
const KEY = 're_SECRET_KEY_do_not_log';
const FROM = 'Business Brain <access@auth.getbusinessbrain.com>';
const TO = 'founder@acme.test';
const TOKEN = 'TOKplaintext_do_not_log';
const LINK = `https://getbusinessbrain.com/api/auth/verify?token=${TOKEN}`;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => vi.restoreAllMocks());
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function svc(logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> }) {
  return new ResendEmailService({ apiKey: KEY, from: FROM, logger });
}
const noLeak = (obj: unknown) => {
  const s = JSON.stringify(obj);
  expect(s).not.toContain(TOKEN);
  expect(s).not.toContain(KEY);
  expect(s).not.toContain('/api/auth/verify');
  expect(s.toLowerCase()).not.toContain('bearer');
};

describe('ResendEmailService — send shape', () => {
  it('POSTs one email to Resend with Bearer auth + from/to/subject and the link in html AND text', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    fetchMock.mockResolvedValue(res(200, { id: 'msg_123' }));
    await svc(logger).sendMagicLink(TO, LINK);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(TO);
    expect(typeof body.subject).toBe('string');
    expect(body.html).toContain(LINK);
    expect(body.text).toContain(LINK);
  });

  it('on 2xx logs only the message id (no token/key/link)', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    fetchMock.mockResolvedValue(res(200, { id: 'msg_123' }));
    await svc(logger).sendMagicLink(TO, LINK);
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]![0]).toMatchObject({ messageId: 'msg_123' });
    noLeak(logger.info.mock.calls);
  });
});

describe('ResendEmailService — failure is sanitized + throws', () => {
  it('non-2xx → throws, logs sanitized {httpStatus, providerCode, providerMessage} only', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    fetchMock.mockResolvedValue(res(422, { name: 'validation_error', message: 'domain not verified' }));
    await expect(svc(logger).sendMagicLink(TO, LINK)).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toMatchObject({ httpStatus: 422, providerCode: 'validation_error' });
    noLeak(logger.warn.mock.calls); // no token, key, link, or bearer in the log
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('network error → throws, sanitized log (no payload/token/key)', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED at 1.2.3.4'));
    await expect(svc(logger).sendMagicLink(TO, LINK)).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledOnce();
    noLeak(logger.warn.mock.calls);
    // the thrown error is generic — carries no token/key
    noLeak(await svc(logger).sendMagicLink(TO, LINK).catch((e) => String(e)));
  });
});
