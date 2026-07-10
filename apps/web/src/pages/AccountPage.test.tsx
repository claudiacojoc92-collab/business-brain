import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountPage } from './AccountPage';

/**
 * S0-T4 §C3 — the minimal account UI. Export triggers the export call; delete posts confirmEmail, and on
 * success logs out + redirects; a wrong email surfaces a NEUTRAL message; the copy carries no retention
 * dark-patterns (Article XIII/VI — leaving is as easy as staying).
 */
const h = vi.hoisted(() => {
  class ApiError extends Error { constructor(public status: number, public code = '', msg = '') { super(msg); } }
  return { logout: vi.fn(), navigate: vi.fn(), getExport: vi.fn(), del: vi.fn(), ApiError };
});
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ founderId: 'f1', isLoading: false, logout: h.logout }) }));
vi.mock('react-router-dom', async (orig) => ({ ...(await (orig() as Promise<object>)), useNavigate: () => h.navigate, Navigate: () => null }));
vi.mock('../api/client', () => ({ getAccountExport: h.getExport, deleteAccount: h.del, ApiError: h.ApiError }));

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no object-URL API — stub it so the export download path runs.
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('AccountPage', () => {
  it('export: clicking Download my data calls the export API and confirms the download', async () => {
    h.getExport.mockResolvedValue({ founder: { founderId: 'f1' } });
    render(<AccountPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(h.getExport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Your download has started.')).toBeInTheDocument();
  });

  it('delete: posts confirmEmail, then logs out and redirects to /login on success', async () => {
    h.del.mockResolvedValue(undefined);
    h.logout.mockResolvedValue(undefined);
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText('Type your email to confirm'), { target: { value: 'me@test.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await waitFor(() => expect(h.del).toHaveBeenCalledWith('me@test.co'));
    await waitFor(() => expect(h.logout).toHaveBeenCalled());
    expect(h.navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('delete: a wrong email shows a NEUTRAL message and stays on the page', async () => {
    h.del.mockRejectedValue(new h.ApiError(400));
    render(<AccountPage />);
    fireEvent.change(screen.getByLabelText('Type your email to confirm'), { target: { value: 'wrong@test.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText("That didn't match your email. Please try again.")).toBeInTheDocument();
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('carries no retention dark-patterns in its copy', () => {
    render(<AccountPage />);
    const text = document.body.textContent ?? '';
    for (const bad of [/you'll miss/i, /are you sure you want to leave/i, /don't go/i, /reconsider/i]) {
      expect(text).not.toMatch(bad);
    }
    // states the genuine irreversibility fact, neutrally
    expect(text).toMatch(/can’t be undone|cannot be undone/i);
  });
});
