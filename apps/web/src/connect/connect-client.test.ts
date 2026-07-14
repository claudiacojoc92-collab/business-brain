import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectUpload, generateRead, getConnectStatus, ApiError } from '../api/client';

/**
 * S1-T5b C1 — connect client fns. connectUpload MUST use multipart (FormData, no JSON Content-Type — the
 * browser sets the boundary). generateRead returns the discriminated union for 201/200 and throws on 500.
 */
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock as unknown as typeof fetch; });
afterEach(() => vi.restoreAllMocks());
const ok = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('connectUpload — multipart', () => {
  it('sends FormData with NO JSON Content-Type, credentials included', async () => {
    fetchMock.mockResolvedValue(ok(200, { source: 'upload', state: 'synced', stored: 3 }));
    const file = new File([new Uint8Array(4)], 'doc.txt', { type: 'text/plain' });
    const r = await connectUpload(file);
    expect(r.stored).toBe(3);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/connect\/upload$/);
    expect(opts.method).toBe('POST');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.credentials).toBe('include');
    // no Content-Type header → the browser sets multipart/form-data; boundary=…
    const headers = (opts.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });
  it('413 → ApiError(413)', async () => {
    fetchMock.mockResolvedValue(ok(413, { error: 'file exceeds the cap' }));
    await expect(connectUpload(new File([new Uint8Array(9)], 'big.pdf'))).rejects.toBeInstanceOf(ApiError);
    await expect(connectUpload(new File([new Uint8Array(9)], 'big.pdf'))).rejects.toMatchObject({ status: 413 });
  });
});

describe('generateRead — discriminated union', () => {
  it('201 generated → union with readId', async () => {
    fetchMock.mockResolvedValue(ok(201, { status: 'generated', readId: 'rid-1', createdAt: 't', schemaVersion: 1, read: {} }));
    const r = await generateRead();
    expect(r.status).toBe('generated');
    if (r.status === 'generated') expect(r.readId).toBe('rid-1');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });
  it('200 insufficient_evidence → union with reason/whatToDo', async () => {
    fetchMock.mockResolvedValue(ok(200, { status: 'insufficient_evidence', reason: 'r', whatToDo: 'w' }));
    const r = await generateRead();
    expect(r.status).toBe('insufficient_evidence');
    if (r.status === 'insufficient_evidence') { expect(r.reason).toBe('r'); expect(r.whatToDo).toBe('w'); }
  });
  it('500 → throws ApiError', async () => {
    fetchMock.mockResolvedValue(ok(500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }));
    await expect(generateRead()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getConnectStatus', () => {
  it('GET /connect/status → presence shape', async () => {
    fetchMock.mockResolvedValue(ok(200, { website: { connected: true, count: 2 }, upload: { connected: false, count: 0 }, calendar: { connected: false } }));
    const s = await getConnectStatus();
    expect(s.website.connected).toBe(true); expect(s.website.count).toBe(2);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/connect\/status$/);
  });
});
