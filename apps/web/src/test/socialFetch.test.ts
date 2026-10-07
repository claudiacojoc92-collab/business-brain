import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { disconnectInstagram, disconnectMeta, getInstagramStatus } from '../api/client';

/**
 * Regression guard: socialFetch must NOT send `Content-Type: application/json` on a body-less request. The
 * Meta/Instagram disconnect calls are body-less POSTs; advertising a JSON content-type with no body makes
 * Fastify 500 ("Body cannot be empty when content-type is set to 'application/json'"). This cannot come back.
 */
function stubFetch() {
  const fn = vi.fn(() => Promise.resolve({ status: 200, json: async () => ({ connected: false }) } as unknown as Response));
  vi.stubGlobal('fetch', fn);
  return fn;
}
type Stub = ReturnType<typeof stubFetch>;
const initOf = (fn: Stub): RequestInit => ((fn.mock.calls[0] as unknown as [unknown, RequestInit?] | undefined)?.[1] ?? {});
const headersOf = (fn: Stub): Record<string, string> => (initOf(fn).headers ?? {}) as Record<string, string>;

describe('socialFetch — no Content-Type on body-less requests', () => {
  beforeEach(() => {
    // getToken() reads localStorage; stub it so the test is independent of the runtime's storage support.
    vi.stubGlobal('localStorage', { getItem: () => 'tok', setItem: () => {}, removeItem: () => {}, clear: () => {} });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('disconnectInstagram (body-less POST) sends no Content-Type, keeps Authorization', async () => {
    const fn = stubFetch();
    await disconnectInstagram();
    expect(fn).toHaveBeenCalledTimes(1);
    const headers = headersOf(fn);
    expect('Content-Type' in headers).toBe(false);
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(initOf(fn).method).toBe('POST');
  });

  it('disconnectMeta (body-less POST) sends no Content-Type', async () => {
    const fn = stubFetch();
    await disconnectMeta();
    expect('Content-Type' in headersOf(fn)).toBe(false);
  });

  it('a body-less GET sends no Content-Type', async () => {
    const fn = stubFetch();
    await getInstagramStatus();
    expect('Content-Type' in headersOf(fn)).toBe(false);
  });
});
