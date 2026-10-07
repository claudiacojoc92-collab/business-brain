import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseSignedRequest } from '../connectors/instagram/signed-request';
import { confirmationCodeFor } from '../connectors/instagram/instagram-compliance.store';

const SECRET = 'test_app_secret_value';

/** Build a valid Meta-style signed_request the way Instagram signs it. */
function makeSigned(payload: Record<string, unknown>, secret = SECRET): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}

describe('parseSignedRequest', () => {
  it('accepts a correctly signed request and extracts the user id', () => {
    const signed = makeSigned({ user_id: '178414230', algorithm: 'HMAC-SHA256', issued_at: 1700000000 });
    const out = parseSignedRequest(signed, SECRET);
    expect(out).not.toBeNull();
    expect(out?.userId).toBe('178414230');
    expect(out?.algorithm).toBe('HMAC-SHA256');
  });

  it('rejects a request signed with the wrong secret', () => {
    const signed = makeSigned({ user_id: '1', algorithm: 'HMAC-SHA256' }, 'wrong_secret');
    expect(parseSignedRequest(signed, SECRET)).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const signed = makeSigned({ user_id: '1', algorithm: 'HMAC-SHA256' });
    const [sig] = signed.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ user_id: '999' })).toString('base64url');
    expect(parseSignedRequest(`${sig}.${forgedPayload}`, SECRET)).toBeNull();
  });

  it('rejects malformed input (no dot, empty, missing parts)', () => {
    expect(parseSignedRequest('', SECRET)).toBeNull();
    expect(parseSignedRequest('nodothere', SECRET)).toBeNull();
    expect(parseSignedRequest('.onlypayload', SECRET)).toBeNull();
    expect(parseSignedRequest('onlysig.', SECRET)).toBeNull();
  });

  it('rejects a non-HMAC-SHA256 algorithm even if otherwise well-formed', () => {
    const signed = makeSigned({ user_id: '1', algorithm: 'PLAINTEXT' });
    expect(parseSignedRequest(signed, SECRET)).toBeNull();
  });

  it('rejects when the app secret is empty', () => {
    const signed = makeSigned({ user_id: '1' });
    expect(parseSignedRequest(signed, '')).toBeNull();
  });

  it('rejects a valid signature carrying no user_id', () => {
    const signed = makeSigned({ algorithm: 'HMAC-SHA256', issued_at: 1 });
    expect(parseSignedRequest(signed, SECRET)).toBeNull();
  });
});

describe('confirmationCodeFor', () => {
  it('is deterministic, prefixed, and non-reversible (no raw id present)', () => {
    const a = confirmationCodeFor('178414230');
    const b = confirmationCodeFor('178414230');
    expect(a).toBe(b);
    expect(a.startsWith('bbdel_')).toBe(true);
    expect(a).not.toContain('178414230');
  });

  it('differs per Instagram user id', () => {
    expect(confirmationCodeFor('1')).not.toBe(confirmationCodeFor('2'));
  });
});
