import { describe, it, expect, vi, afterEach } from 'vitest';
import { LogEmailService } from '../../session/email.service';

/**
 * GW-FIX C2 — the LogEmailService (dev-only magic-link adapter) must never write a live sign-in token
 * to production logs, and must not silently be the wired sender in production (a founder would get no
 * email). Same NODE_ENV signal the route uses for its devLink response.
 */
const LINK = 'http://localhost:3000/api/auth/verify?token=LIVE_SIGNIN_TOKEN_abc123';
const prevEnv = process.env['NODE_ENV'];
afterEach(() => { if (prevEnv === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = prevEnv; vi.restoreAllMocks(); });

describe('LogEmailService — dev', () => {
  it('logs the link under a non-production NODE_ENV (dev convenience path stays working)', async () => {
    process.env['NODE_ENV'] = 'test';
    const logger = { info: vi.fn() };
    await new LogEmailService(logger).sendMagicLink('founder@acme.test', LINK);
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]![1]).toContain('LIVE_SIGNIN_TOKEN_abc123'); // dev only
  });
});

describe('LogEmailService — production safety', () => {
  it('never logs the token in production (no live sign-in token in prod logs)', async () => {
    process.env['NODE_ENV'] = 'production';
    const logger = { info: vi.fn() };
    // Constructs fine under production — route registration (which builds this) must not break;
    // the fix is that it does not LOG the token, not that it refuses to exist.
    const svc = new LogEmailService(logger);
    await svc.sendMagicLink('founder@acme.test', LINK);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
