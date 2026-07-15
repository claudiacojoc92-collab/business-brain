import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  request, generateRead, logoutSession, readCalendar, disconnectCalendar,
  connectWebsite, requestMagicLink, connectUpload,
} from './client';

/**
 * GW-FIX C1 — client REQUEST-CONTRACT guard (the test that would have caught the GO-walk P0).
 * These assert the request the client BUILDS (headers + body via a mocked global fetch), NOT that a
 * mocked function was called. The P0: request() attached `Content-Type: application/json` to body-less
 * POSTs, so Fastify's empty-body guard 500'd generate/logout/calendar. The contract now:
 *   - body-less request → NO Content-Type: application/json, and no body
 *   - body-bearing request → Content-Type: application/json AND the serialized JSON body
 *   - a caller-supplied header wins
 *   - connectUpload (FormData) sends no explicit Content-Type (browser sets the multipart boundary)
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => vi.restoreAllMocks());
const ok = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const lastInit = () => fetchMock.mock.calls[0]![1] as RequestInit;
const headerKeysLower = (init: RequestInit) => Object.keys((init.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase());

describe('GW-FIX C1 — body-less POSTs must not claim a JSON body', () => {
  for (const [name, fn] of [
    ['generateRead', generateRead],
    ['logoutSession', logoutSession],
    ['readCalendar', readCalendar],
    ['disconnectCalendar', disconnectCalendar],
  ] as const) {
    it(`${name}: POST with NO Content-Type and NO body`, async () => {
      fetchMock.mockResolvedValue(ok(name === 'logoutSession' ? 204 : 200, { status: 'insufficient_evidence', connected: false }));
      await fn();
      const init = lastInit();
      expect(init.method).toBe('POST');
      expect(headerKeysLower(init)).not.toContain('content-type'); // the P0 regression guard
      expect(init.body).toBeUndefined();                            // no serialized empty body
      expect(init.credentials).toBe('include');
    });
  }
});

describe('GW-FIX C1 — body-bearing POSTs keep the JSON content-type + body', () => {
  it('connectWebsite {url}: Content-Type application/json AND body is the serialized JSON', async () => {
    fetchMock.mockResolvedValue(ok(200, { source: 'website', state: 'synced', stored: 1 }));
    await connectWebsite('https://acme.example');
    const init = lastInit();
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ url: 'https://acme.example' }));
  });

  it('requestMagicLink {email}: keeps Content-Type application/json AND its body', async () => {
    fetchMock.mockResolvedValue(ok(200, { ok: true, devLink: 'x' }));
    await requestMagicLink('founder@acme.example');
    const init = lastInit();
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'founder@acme.example' }));
  });
});

describe('GW-FIX C1 — request() header contract', () => {
  it('preserves a caller-supplied Content-Type (caller wins over the JSON default)', async () => {
    fetchMock.mockResolvedValue(ok(200, {}));
    await request('thing', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'raw-text' });
    const init = lastInit();
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(init.body).toBe('raw-text');
  });

  it('a body-less GET carries no Content-Type', async () => {
    fetchMock.mockResolvedValue(ok(200, {}));
    await request('thing');
    expect(headerKeysLower(lastInit())).not.toContain('content-type');
  });
});

describe('GW-FIX C1 — connectUpload (FormData) is unaffected: no explicit Content-Type', () => {
  it('sends FormData with the browser-set boundary (no JSON header)', async () => {
    fetchMock.mockResolvedValue(ok(200, { source: 'upload', state: 'synced', stored: 3 }));
    await connectUpload(new File([new Uint8Array(4)], 'doc.txt', { type: 'text/plain' }));
    const init = lastInit();
    expect(init.body).toBeInstanceOf(FormData);
    expect(headerKeysLower(init)).not.toContain('content-type');
  });
});
