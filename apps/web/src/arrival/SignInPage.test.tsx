import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { SignInPage } from './SignInPage';

/**
 * Wave 1 correction 1 — the Continue-with-Google control is driven by SERVER-declared capability, never a
 * frontend assumption. It must be ABSENT when the backend reports googleLogin:false and appear only when
 * the backend reports it ready. (No dead/misleading control for planned-but-unconfigured functionality.)
 */
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return {
    ...actual,
    getSession: vi.fn(async () => { throw new actual.ApiError(401, 'NO_SESSION', 'no session'); }),
    getAuthCapabilities: vi.fn(),
    signIn: vi.fn(),
  };
});
import { getAuthCapabilities } from '../api/client';

function mount() {
  return render(<MemoryRouter initialEntries={['/signin']}><AuthProvider><SignInPage /></AuthProvider></MemoryRouter>);
}
beforeEach(() => vi.clearAllMocks());

describe('SignInPage — Google control visibility (capability-gated)', () => {
  it('email/password is the complete path; Google control ABSENT when capability is unavailable', async () => {
    (getAuthCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue({ googleLogin: false });
    mount();
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    // give the capability effect a tick, then assert no Google control
    await waitFor(() => expect(getAuthCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });

  it('Google control APPEARS only when the backend declares it ready', async () => {
    (getAuthCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue({ googleLogin: true });
    mount();
    await waitFor(() => expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy());
  });

  it('a failed capability check fails safe → no Google control', async () => {
    (getAuthCapabilities as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    mount();
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    await waitFor(() => expect(getAuthCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });
});
