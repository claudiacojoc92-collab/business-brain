import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return { ApiError, getCycleHistory: vi.fn(), getCycleBrief: vi.fn() };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ founder: null, isLoading: false, login: vi.fn(), logout: vi.fn(), refreshStatus: vi.fn() }),
}));

import { HistoryPage } from '../pages/HistoryPage';
import * as client from '../api/client';

const m = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;
function apiError(status: number, code: string) {
  return new (client.ApiError as unknown as new (s: number, c: string, msg: string) => Error)(status, code, code);
}
function renderHistory() {
  return render(<MemoryRouter><HistoryPage /></MemoryRouter>);
}

const HISTORY = {
  items: [
    { cycleId: 'c3', cycleNumber: 3, selectedMode: null, contentPieceCount: 0, committedAt: '2026-06-28T09:47:44.948Z', isFallback: false },
    { cycleId: 'c1', cycleNumber: 1, selectedMode: 'TRUST', contentPieceCount: 0, committedAt: '2026-06-28T06:47:57.667Z', isFallback: true },
  ],
  nextCursor: null,
  hasMore: false,
};

const BRIEF = {
  briefId: 'b3', cycleId: 'c3', mode: 'TRUST', modeConfidence: 0,
  strategicPurpose: 'Establish the credible alternative', audienceSegment: 'Service-based professionals',
  briefConfidence: 0, uniquenessScore: 50, validationResult: 'COMMITTED', isFallback: false, reviewFlag: false,
  committedAt: '2026-06-28T09:47:44.989Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  m(client.getCycleHistory).mockResolvedValue(HISTORY);
  m(client.getCycleBrief).mockResolvedValue(BRIEF);
});

describe('HistoryPage (Past cycles)', () => {
  it('renders the founder\'s committed cycles with real fields, newest first', async () => {
    renderHistory();
    expect(await screen.findByText('Cycle #3')).toBeInTheDocument();
    expect(screen.getByText('Cycle #1')).toBeInTheDocument();
    // fallback flag surfaced only for the fallback cycle
    expect(screen.getByText(/Fallback brief/i)).toBeInTheDocument();
    // selectedMode shown when present (humanized)
    expect(screen.getByText(/Mode: Trust/)).toBeInTheDocument();
  });

  it('never shows the hardcoded contentPieceCount (no fabricated count)', async () => {
    renderHistory();
    await screen.findByText('Cycle #3');
    expect(screen.queryByText(/piece/i)).toBeNull();
    expect(screen.queryByText(/contentPieceCount/)).toBeNull();
  });

  it('does not reintroduce briefConfidence or uniquenessScore', async () => {
    renderHistory();
    await screen.findByText('Cycle #3');
    expect(screen.queryByText(/Confidence/)).toBeNull();
    expect(screen.queryByText(/Uniqueness/)).toBeNull();
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it('shows an honest empty state when there are no committed cycles', async () => {
    m(client.getCycleHistory).mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    renderHistory();
    expect(await screen.findByText(/No past cycles yet/i)).toBeInTheDocument();
  });

  it('shows an honest error state with retry when history fails to load', async () => {
    m(client.getCycleHistory).mockRejectedValue(apiError(500, 'UNKNOWN_ERROR'));
    renderHistory();
    expect(await screen.findByText(/could not load your history/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('opens a past cycle to view its brief read-only, with no confidence/uniqueness', async () => {
    renderHistory();
    await screen.findByText('Cycle #3');
    await userEvent.click((await screen.findAllByRole('button', { name: /view brief/i }))[0]!);

    expect(await screen.findByText('Establish the credible alternative')).toBeInTheDocument();
    expect(screen.getByText(/Audience: Service-based professionals/)).toBeInTheDocument();
    // honesty omissions hold here too
    expect(screen.queryByText(/Confidence/)).toBeNull();
    expect(screen.queryByText(/Uniqueness/)).toBeNull();
    expect(screen.queryByText(/\d+%/)).toBeNull();
    // view-only: no approve/reject/edit actions
    expect(screen.queryByRole('button', { name: /approve|reject|edit/i })).toBeNull();
    expect(client.getCycleBrief).toHaveBeenCalledWith('c3');
  });

  it('shows an honest error when a past brief fails to load; the list still works', async () => {
    m(client.getCycleBrief).mockRejectedValue(apiError(404, 'BRIEF_NOT_FOUND'));
    renderHistory();
    await screen.findByText('Cycle #3');
    await userEvent.click((await screen.findAllByRole('button', { name: /view brief/i }))[0]!);

    expect(await screen.findByText(/No brief is available for this cycle/i)).toBeInTheDocument();
    expect(screen.getByText('Cycle #3')).toBeInTheDocument(); // list intact
  });
});
