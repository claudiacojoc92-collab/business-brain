import { describe, it, expect, afterEach } from 'vitest';
import { selectEmailService, validateProductionEmailConfig } from '../../session/email.compose';
import { LogEmailService } from '../../session/email.service';
import { ResendEmailService } from '../../session/resend-email.service';

/**
 * EMAIL-1 composition. Production selects Resend after DETERMINISTIC config validation (fail fast); dev
 * keeps LogEmailService. A localhost/loopback APP_BASE_URL can never reach a real inbox → rejected.
 */
const prev = { ...process.env };
afterEach(() => { process.env = { ...prev }; });

const GOOD = {
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM: 'Business Brain <access@auth.getbusinessbrain.com>',
  APP_BASE_URL: 'https://getbusinessbrain.com',
} as NodeJS.ProcessEnv;

describe('validateProductionEmailConfig — fail fast', () => {
  it('passes with complete, valid prod config', () => {
    expect(() => validateProductionEmailConfig(GOOD)).not.toThrow();
  });
  it('throws when RESEND_API_KEY is missing', () => {
    expect(() => validateProductionEmailConfig({ ...GOOD, RESEND_API_KEY: undefined })).toThrow(/RESEND_API_KEY/);
  });
  it('throws when EMAIL_FROM is absent or malformed', () => {
    expect(() => validateProductionEmailConfig({ ...GOOD, EMAIL_FROM: undefined })).toThrow(/EMAIL_FROM/);
    expect(() => validateProductionEmailConfig({ ...GOOD, EMAIL_FROM: 'not-an-email' })).toThrow(/EMAIL_FROM/);
  });
  it('rejects a localhost / loopback / bare-host / non-https / private APP_BASE_URL', () => {
    for (const bad of ['http://getbusinessbrain.com', 'https://localhost:3000', 'https://127.0.0.1', 'http://localhost:3000', 'https://bb-api', 'https://192.168.1.10', 'https://10.0.0.5']) {
      expect(() => validateProductionEmailConfig({ ...GOOD, APP_BASE_URL: bad }), bad).toThrow(/APP_BASE_URL/);
    }
  });
  it('the error message carries no secret value', () => {
    try { validateProductionEmailConfig({ ...GOOD, APP_BASE_URL: undefined }); } catch (e) {
      expect(String(e)).not.toContain('re_key');
    }
  });
});

describe('selectEmailService', () => {
  it('dev/test → LogEmailService (labeled dev link, no send)', () => {
    process.env['NODE_ENV'] = 'test';
    expect(selectEmailService()).toBeInstanceOf(LogEmailService);
  });
  it('production with valid config → ResendEmailService', () => {
    expect(selectEmailService(undefined, GOOD)).toBeInstanceOf(ResendEmailService);
  });
  it('production with missing config → throws (startup fail-fast)', () => {
    expect(() => selectEmailService(undefined, { ...GOOD, RESEND_API_KEY: undefined })).toThrow(/not configured/i);
  });
});
