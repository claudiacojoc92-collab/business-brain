import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Covers the session startup fix (239ed44): a transient failure must NOT sign a founder out, and the entry
// gate must show a retry instead of redirecting when loadError is set — the part keeping the token was useless
// without. The real ApiError class is kept (instanceof drives the auth-vs-transient branch); only the calls and
// token setters are mocked. react-router Navigate and the errors LoadError are stubbed to detectable markers.
vi.mock('../api/client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, setToken: vi.fn(), clearToken: vi.fn(), getMe: vi.fn(), listBusinesses: vi.fn() };
});
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, Navigate: ({ to }: { to: string }) => <div>REDIRECT:{to}</div> };
});
vi.mock('../slice0/errors', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, LoadError: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>RETRY</button> };
});

import * as api from '../api/client';
import { ApiError } from '../api/client';
import { SessionProvider, useSession } from '../slice0/session';
import { RequireSession } from '../App';

/** Reads the session contract so the four provider cases are assertable. */
function Probe() {
  const { account, loadError, isLoading } = useSession();
  return (
    <div>
      <span>{isLoading ? 'LOADING' : 'READY'}</span>
      <span>{account ? 'ACCOUNT' : 'NOACCT'}</span>
      <span>{loadError ? 'LOADERR' : 'NOERR'}</span>
    </div>
  );
}

// jsdom at an opaque origin (about:blank) exposes no localStorage, so stub a minimal in-memory one. session.tsx
// only reads getItem('bb_access_token'); the token setters go through the mocked api/client, not localStorage.
const store: Record<string, string> = {};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  });
  store['bb_access_token'] = 'tok'; // a token is present → the provider attempts the startup load
});
afterEach(() => { cleanup(); for (const k of Object.keys(store)) delete store[k]; vi.unstubAllGlobals(); });

describe('SessionProvider — transient failure is not a sign-out (239ed44)', () => {
  it('1) getMe → ApiError(401): token cleared, signed out, NOT a loadError', async () => {
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(401, 'INVALID_AUTH_TOKEN', 'x'));
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText('READY');
    expect(screen.getByText('NOACCT')).toBeInTheDocument();
    expect(screen.getByText('NOERR')).toBeInTheDocument();
    expect(api.clearToken).toHaveBeenCalledTimes(1);
  });

  it('2) getMe → TypeError with no status (network): token KEPT, loadError set', async () => {
    vi.mocked(api.getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText('READY');
    expect(screen.getByText('NOACCT')).toBeInTheDocument();
    expect(screen.getByText('LOADERR')).toBeInTheDocument();
    expect(api.clearToken).not.toHaveBeenCalled();
  });

  it('3) getMe → ApiError(503): token KEPT, loadError set', async () => {
    vi.mocked(api.getMe).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'x'));
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText('READY');
    expect(screen.getByText('NOACCT')).toBeInTheDocument();
    expect(screen.getByText('LOADERR')).toBeInTheDocument();
    expect(api.clearToken).not.toHaveBeenCalled();
  });

  it('4) getMe ok but listBusinesses fails: account set, token KEPT, loadError set, never signed out', async () => {
    vi.mocked(api.getMe).mockResolvedValue({ id: 'b1' } as never);
    vi.mocked(api.listBusinesses).mockRejectedValue(new ApiError(503, 'UNAVAILABLE', 'x'));
    render(<SessionProvider><Probe /></SessionProvider>);
    await screen.findByText('ACCOUNT');
    expect(screen.getByText('LOADERR')).toBeInTheDocument();
    expect(api.clearToken).not.toHaveBeenCalled();
  });
});

describe('RequireSession gate — loadError shows a retry, not a redirect, and recovers (239ed44)', () => {
  it('a transient load failure renders the retry (not /signin), and retrying recovers when the call succeeds', async () => {
    vi.mocked(api.getMe).mockRejectedValueOnce(new TypeError('net')).mockResolvedValue({ id: 'b1' } as never);
    vi.mocked(api.listBusinesses).mockResolvedValue({ businesses: [] } as never);

    render(
      <SessionProvider>
        <RequireSession><div>PROTECTED</div></RequireSession>
      </SessionProvider>,
    );

    // First load failed transiently → the gate shows the retry, NOT the sign-in redirect, NOT the protected content.
    await screen.findByText('RETRY');
    expect(screen.queryByText('PROTECTED')).toBeNull();
    expect(screen.queryByText(/REDIRECT/)).toBeNull();

    // Retry re-runs the load; getMe now succeeds → the founder is let in, no re-login.
    fireEvent.click(screen.getByText('RETRY'));
    await screen.findByText('PROTECTED');
    expect(api.clearToken).not.toHaveBeenCalled();
  });
});
