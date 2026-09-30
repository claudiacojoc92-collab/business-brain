import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// Consume ONLY getBBCurrent — assert the container touches no other endpoint.
vi.mock('../api/client', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, getBBCurrent: vi.fn() };
});

import * as client from '../api/client';
import { BriefPreviewPage } from '../businessbrain/brief/BriefPreviewPage';
import { fullVersion, insufficientVersion, noCurrent } from '../businessbrain/brief/fixtures';

const mock = (v: unknown) => (client.getBBCurrent as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(v);
const reject = (e: unknown) => (client.getBBCurrent as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(e);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('BriefPreviewPage — states from GET /current only', () => {
  it('renders the Living Brief for a current Version', async () => {
    mock(fullVersion);
    render(<BriefPreviewPage />);
    await waitFor(() => expect(screen.getByTestId('living-brief')).toBeInTheDocument());
    expect(screen.getByText(/The most important thing right now/i)).toBeInTheDocument();
  });

  it('shows the empty state when there is no current Version', async () => {
    mock(noCurrent);
    render(<BriefPreviewPage />);
    await waitFor(() => expect(screen.getByText(/No current version yet/i)).toBeInTheDocument());
  });

  it('shows the insufficient state for a too-thin Version', async () => {
    mock(insufficientVersion);
    render(<BriefPreviewPage />);
    await waitFor(() => expect(screen.getByText(/Not enough to read your business yet/i)).toBeInTheDocument());
  });

  it('prompts sign-in on 401 (never crashes)', async () => {
    reject(new client.ApiError(401, 'MISSING_AUTH_TOKEN', 'no token'));
    render(<BriefPreviewPage />);
    await waitFor(() => expect(screen.getByText(/Sign in to view your Brief/i)).toBeInTheDocument());
  });

  it('consumes ONLY GET /current (no other Business Brain endpoint)', async () => {
    mock(fullVersion);
    render(<BriefPreviewPage />);
    await waitFor(() => expect(screen.getByTestId('living-brief')).toBeInTheDocument());
    expect(client.getBBCurrent).toHaveBeenCalledTimes(1);
  });
});
