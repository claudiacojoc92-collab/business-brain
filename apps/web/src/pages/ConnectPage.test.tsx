import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { ConnectPage } from './ConnectPage';
import type { ConnectStatus } from '../connect/types';

/**
 * S1-T5b C2 — the connect journey. api client mocked. Proves: mount does GET /connect/status ONLY (no POST);
 * Generate gating (disabled at zero, enabled by ANY single source); Generate fires POST /reads EXACTLY once on
 * explicit click → navigates to /reads/:id; insufficient_evidence renders calm (not an error); calendar focus-
 * return reads ONCE on transition (not on repeat focus); 401 → /login.
 */
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    getSession: vi.fn(async () => ({ founder_id: 'founder-A' })),
    getConnectStatus: vi.fn(),
    generateRead: vi.fn(),
    readCalendar: vi.fn(async () => ({ source: 'google-calendar', state: 'synced', stored: 2 })),
    connectWebsite: vi.fn(), connectUpload: vi.fn(), disconnectCalendar: vi.fn(),
  };
});
import { getConnectStatus, generateRead, readCalendar, connectWebsite, ApiError } from '../api/client';

const ST = (over: Partial<ConnectStatus> = {}): ConnectStatus => ({ website: { connected: false, count: 0 }, upload: { connected: false, count: 0 }, calendar: { connected: false }, ...over });

async function mount() {
  const r = render(
    <MemoryRouter initialEntries={['/connect']}>
      <AuthProvider>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/reads/:readId" element={<div>READ PAGE</div>} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { level: 1, name: /Connect your sources/ });
  await screen.findByRole('button', { name: /generate a read/i }); // wait for the READY phase (status loaded)
  return r;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => vi.restoreAllMocks());

describe('ConnectPage — journey', () => {
  it('mount fetches GET /connect/status ONLY — no POST /reads, no connect POST', async () => {
    vi.mocked(getConnectStatus).mockResolvedValue(ST());
    await mount();
    await waitFor(() => expect(getConnectStatus).toHaveBeenCalled());
    expect(generateRead).not.toHaveBeenCalled();
    expect(connectWebsite).not.toHaveBeenCalled();
    expect(readCalendar).not.toHaveBeenCalled();
  });

  it('Generate disabled at zero sources (factual hint)', async () => {
    vi.mocked(getConnectStatus).mockResolvedValue(ST());
    await mount();
    const btn = screen.getByRole('button', { name: /generate a read/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText('Connect a source to generate a Read.')).toBeInTheDocument();
  });

  it('Generate enabled by ANY single source (website-only / upload-only / calendar-only)', async () => {
    for (const st of [ST({ website: { connected: true, count: 1 } }), ST({ upload: { connected: true, count: 1 } }), ST({ calendar: { connected: true } })]) {
      vi.mocked(getConnectStatus).mockResolvedValue(st);
      const { unmount } = await mount();
      expect(screen.getByRole('button', { name: /generate a read/i })).toBeEnabled();
      unmount();
    }
  });

  it('Generate click → EXACTLY ONE POST /reads → navigate /reads/:id; no auto-regeneration', async () => {
    vi.mocked(getConnectStatus).mockResolvedValue(ST({ website: { connected: true, count: 2 } }));
    vi.mocked(generateRead).mockResolvedValue({ status: 'generated', readId: 'rid-9', createdAt: 't', schemaVersion: 1, read: {} as never });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /generate a read/i }));
    await waitFor(() => expect(screen.getByText('READ PAGE')).toBeInTheDocument());
    expect(generateRead).toHaveBeenCalledTimes(1); // exactly once
  });

  it('insufficient_evidence → calm guidance (not an error, not "connect more")', async () => {
    vi.mocked(getConnectStatus).mockResolvedValue(ST({ website: { connected: true, count: 1 } }));
    vi.mocked(generateRead).mockResolvedValue({ status: 'insufficient_evidence', reason: 'r', whatToDo: 'Connect a source and try again.' });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /generate a read/i }));
    await waitFor(() => expect(screen.getByText(/there isn't enough grounded material yet/)).toBeInTheDocument());
    expect(screen.queryByText('READ PAGE')).not.toBeInTheDocument();
    expect((document.body.textContent ?? '').toLowerCase()).not.toContain('connect more');
  });

  it('500 → neutral error', async () => {
    vi.mocked(getConnectStatus).mockResolvedValue(ST({ upload: { connected: true, count: 1 } }));
    vi.mocked(generateRead).mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'x'));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /generate a read/i }));
    await waitFor(() => expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument());
  });

  it('calendar focus-return: reads ONCE on false→true transition, NOT on repeat focus', async () => {
    vi.mocked(getConnectStatus).mockResolvedValueOnce(ST()); // initial: not connected
    await mount();
    // now the founder has completed OAuth in another tab → status flips to connected
    vi.mocked(getConnectStatus).mockResolvedValue(ST({ calendar: { connected: true } }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(readCalendar).toHaveBeenCalledTimes(1)); // read once on transition
    await act(async () => { window.dispatchEvent(new Event('focus')); }); // focus again
    await new Promise((r) => setTimeout(r, 10));
    expect(readCalendar).toHaveBeenCalledTimes(1); // NOT re-fired
  });

  it('401 on status load → redirect to /login', async () => {
    vi.mocked(getConnectStatus).mockRejectedValue(new ApiError(401, 'UNAUTH', 'x'));
    render(
      <MemoryRouter initialEntries={['/connect']}>
        <AuthProvider>
          <Routes>
            <Route path="/connect" element={<ConnectPage />} />
            <Route path="/login" element={<div>LOGIN PAGE</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument());
  });
});
