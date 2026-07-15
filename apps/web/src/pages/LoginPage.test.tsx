import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';
import { AUTH_COPY } from '../copy/auth';

/**
 * EMAIL-1 — LoginPage delivery-outcome copy. On a 200 the founder sees the success copy; on a delivery
 * failure they see one generic failure line — NOT the "check your email" success state, and NOT the
 * server's error text.
 */
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, getSession: vi.fn(async () => { throw new actual.ApiError(401, 'NO_SESSION', 'no session'); }), requestMagicLink: vi.fn() };
});
import { requestMagicLink, ApiError } from '../api/client';

async function mount() {
  const r = render(<MemoryRouter initialEntries={['/login']}><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText(AUTH_COPY.emailLabel)).toBeTruthy()); // form rendered (unauthenticated)
  return r;
}
async function submit(email: string) {
  fireEvent.change(screen.getByLabelText(AUTH_COPY.emailLabel), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: AUTH_COPY.submit }));
}

beforeEach(() => vi.clearAllMocks());

describe('LoginPage — delivery outcome copy', () => {
  it('200 → shows the success copy', async () => {
    (requestMagicLink as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
    await mount();
    await submit('founder@acme.test');
    await waitFor(() => expect(screen.getByText(AUTH_COPY.sentHeading)).toBeTruthy());
  });

  it('delivery failure (503) → generic failure copy, NOT the success state, NOT the server message', async () => {
    (requestMagicLink as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(503, 'EMAIL_SEND_FAILED', 'resend 422 domain not verified'));
    await mount();
    await submit('founder@acme.test');
    await waitFor(() => expect(screen.getByText(AUTH_COPY.sendFailed)).toBeTruthy());
    expect(screen.queryByText(AUTH_COPY.sentHeading)).toBeNull();          // not the inbox-success state
    expect(screen.queryByText(/domain not verified|resend|422/i)).toBeNull(); // no server detail echoed
  });
});
