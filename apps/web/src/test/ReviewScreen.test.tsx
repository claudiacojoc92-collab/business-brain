import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    getCurrentBrief: vi.fn(),
    getCurrentContent: vi.fn(),
    approveContent: vi.fn(),
    rejectContent: vi.fn(),
  };
});

import { ReviewScreen } from '../review/ReviewScreen';
import * as client from '../api/client';

const getBrief = client.getCurrentBrief as unknown as ReturnType<typeof vi.fn>;
const getContent = client.getCurrentContent as unknown as ReturnType<typeof vi.fn>;
const approve = client.approveContent as unknown as ReturnType<typeof vi.fn>;
const reject = client.rejectContent as unknown as ReturnType<typeof vi.fn>;

const BRIEF = {
  briefId: 'b1', cycleId: 'c1', mode: 'AUTHORITY', modeConfidence: 0.8,
  strategicPurpose: 'Build authority this week', audienceSegment: 'early adopters',
  briefConfidence: 0.64, uniquenessScore: 72, validationResult: 'PASS',
  isFallback: false, reviewFlag: false, committedAt: '2026-06-27T10:00:00.000Z',
};
const PIECE = {
  contentPieceId: 'p1', cycleId: 'c1', pieceType: 'REEL', pieceRole: 'Authority',
  contentPreview: '{"hook":"Stop guessing"}', approvalStatus: 'AWAITING_APPROVAL', approvalWindowExpiresAt: null,
};

function apiError(status: number, code: string) {
  return new (client.ApiError as unknown as new (s: number, c: string, m: string) => Error)(status, code, code);
}

beforeEach(() => {
  vi.clearAllMocks();
  getBrief.mockResolvedValue(BRIEF);
  // Pending (no status) → [PIECE]; approved/rejected (status set) → [] by default.
  getContent.mockImplementation((status?: string) => Promise.resolve(status ? [] : [PIECE]));
  approve.mockResolvedValue({});
  reject.mockResolvedValue({});
});

describe('ReviewScreen', () => {
  it('renders the brief panel from the C1 response', async () => {
    render(<ReviewScreen />);
    expect(await screen.findByText('Build authority this week')).toBeInTheDocument();
    expect(screen.getByText('AUTHORITY')).toBeInTheDocument();
    expect(screen.getByText(/Audience: early adopters/)).toBeInTheDocument();
    // Honesty: brief confidence is omitted (persists as 0 and would mislead), matching Home + Brief Read.
    expect(screen.queryByText(/Confidence/)).toBeNull();
    expect(screen.queryByText(/\d+%/)).toBeNull();
    // Honesty parity: unlabeled uniqueness score is omitted too, matching Home + Brief Read.
    expect(screen.queryByText(/Uniqueness/)).toBeNull();
  });

  it('renders a content row incl. contentPreview from the C3 response', async () => {
    render(<ReviewScreen />);
    expect(await screen.findByText('{"hook":"Stop guessing"}')).toBeInTheDocument();
    expect(screen.getByText(/REEL · Authority · AWAITING_APPROVAL/)).toBeInTheDocument();
  });

  it('Approve → POSTs approve and REFETCHES the list', async () => {
    render(<ReviewScreen />);
    await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith('p1'));
    // initial load (pending + approved + rejected) + post-success refetch (×3) = 6
    expect(getContent).toHaveBeenCalledTimes(6);
  });

  it('Reject → POSTs reject and REFETCHES the list', async () => {
    render(<ReviewScreen />);
    await screen.findByRole('button', { name: /reject/i });
    await userEvent.click(screen.getByRole('button', { name: /reject/i }));

    await waitFor(() => expect(reject).toHaveBeenCalledWith('p1'));
    // load (×3) + post-success refetch (×3) = 6
    expect(getContent).toHaveBeenCalledTimes(6);
  });

  it('409 PIECE_ALREADY_DECIDED → notice + refetch', async () => {
    approve.mockRejectedValueOnce(apiError(409, 'PIECE_ALREADY_DECIDED'));
    render(<ReviewScreen />);
    await screen.findByRole('button', { name: /approve/i });
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/already decided/i)).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledTimes(6); // refetched (pending + approved + rejected) despite the 409
  });

  it('brief 403 CYCLE_NOT_COMMITTED → not-ready message', async () => {
    getBrief.mockRejectedValue(apiError(403, 'CYCLE_NOT_COMMITTED'));
    render(<ReviewScreen />);
    expect(await screen.findByText(/not ready yet/i)).toBeInTheDocument();
  });

  it('brief 404 CYCLE_NOT_FOUND → no-review-cycle message', async () => {
    getBrief.mockRejectedValue(apiError(404, 'CYCLE_NOT_FOUND'));
    render(<ReviewScreen />);
    expect(await screen.findByText(/No review cycle yet/i)).toBeInTheDocument();
  });

  it('empty content → empty-state message', async () => {
    getContent.mockResolvedValue([]);
    render(<ReviewScreen />);
    expect(await screen.findByText(/No content is waiting/i)).toBeInTheDocument();
  });

  it('content load error → error message with retry', async () => {
    getContent.mockRejectedValue(apiError(500, 'UNKNOWN_ERROR'));
    render(<ReviewScreen />);
    expect(await screen.findByText(/could not load your content/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('Approve → explicit success confirmation after the backend confirms; piece leaves the list', async () => {
    getContent.mockReset();
    getContent.mockResolvedValueOnce([PIECE]).mockResolvedValue([]); // initial load shows it; refetch is empty
    render(<ReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/this piece is approved and no longer pending/i)).toBeInTheDocument();
    expect(await screen.findByText(/No content is waiting/i)).toBeInTheDocument();
    expect(approve).toHaveBeenCalledWith('p1');
  });

  it('Approve failure → honest error and NO false success', async () => {
    approve.mockRejectedValue(apiError(500, 'UNKNOWN_ERROR'));
    render(<ReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/could not approve that piece/i)).toBeInTheDocument();
    expect(screen.queryByText(/this piece is approved and no longer pending/i)).toBeNull();
  });

  // ── Approved section (read-only; ?status=APPROVED) ─────────────────────────
  const APPROVED_PIECE = {
    contentPieceId: 'a1', cycleId: 'c1', pieceType: 'CAROUSEL', pieceRole: 'PRIMARY',
    contentPreview: '{"slide":"approved one"}', approvalStatus: 'APPROVED', approvalWindowExpiresAt: null,
  };

  it('Approved section renders approved pieces (real fields) and is read-only (no buttons)', async () => {
    // No pending, one approved piece.
    getContent.mockImplementation((status?: string) =>
      Promise.resolve(status === 'APPROVED' ? [APPROVED_PIECE] : []));
    render(<ReviewScreen />);

    expect(await screen.findByText('{"slide":"approved one"}')).toBeInTheDocument();
    expect(screen.getByText(/CAROUSEL · PRIMARY · APPROVED/)).toBeInTheDocument();
    // Read-only: no approve/reject controls anywhere (pending empty + approved view-only).
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
    // Heading present.
    expect(screen.getByRole('heading', { name: /approved/i })).toBeInTheDocument();
  });

  it('Approved section shows an honest empty state when there is none', async () => {
    getContent.mockImplementation(() => Promise.resolve([])); // both pending and approved empty
    render(<ReviewScreen />);
    expect(await screen.findByText(/Nothing approved yet/i)).toBeInTheDocument();
  });

  it('after a successful approve, the Approved section refetches and shows the piece', async () => {
    let approved = false;
    const justApproved = { ...APPROVED_PIECE, contentPieceId: 'p1', contentPreview: '{"approved":true}' };
    getContent.mockImplementation((status?: string) => {
      if (status === 'APPROVED') return Promise.resolve(approved ? [justApproved] : []);
      return Promise.resolve(approved ? [] : [PIECE]);
    });
    approve.mockImplementation(async () => { approved = true; return {}; });

    render(<ReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /approve/i }));

    // The just-approved piece now appears in the Approved section (via refetch, not optimism).
    expect(await screen.findByText('{"approved":true}')).toBeInTheDocument();
    expect(screen.getByText(/· APPROVED/)).toBeInTheDocument();
  });

  it('Approved fetch error does not break the pending section', async () => {
    getContent.mockImplementation((status?: string) => {
      if (status === 'APPROVED') return Promise.reject(apiError(500, 'UNKNOWN_ERROR'));
      if (status === 'REJECTED') return Promise.resolve([]);
      return Promise.resolve([PIECE]);
    });
    render(<ReviewScreen />);
    // Pending still renders; approved shows its honest error.
    expect(await screen.findByText('{"hook":"Stop guessing"}')).toBeInTheDocument();
    expect(screen.getByText(/could not load your approved content/i)).toBeInTheDocument();
  });

  // ── Rejected section (read-only; ?status=REJECTED) ─────────────────────────
  const REJECTED_PIECE = {
    contentPieceId: 'r1', cycleId: 'c1', pieceType: 'REEL', pieceRole: 'SUPPORTING',
    contentPreview: '{"slide":"rejected one"}', approvalStatus: 'REJECTED', approvalWindowExpiresAt: null,
  };

  it('Rejected section renders rejected pieces (real fields) and is read-only (no buttons)', async () => {
    getContent.mockImplementation((status?: string) =>
      Promise.resolve(status === 'REJECTED' ? [REJECTED_PIECE] : []));
    render(<ReviewScreen />);

    expect(await screen.findByText('{"slide":"rejected one"}')).toBeInTheDocument();
    expect(screen.getByText(/REEL · SUPPORTING · REJECTED/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
    expect(screen.getByRole('heading', { name: /^rejected$/i })).toBeInTheDocument();
  });

  it('Rejected section shows an honest empty state when there is none', async () => {
    getContent.mockImplementation(() => Promise.resolve([]));
    render(<ReviewScreen />);
    expect(await screen.findByText(/Nothing rejected yet/i)).toBeInTheDocument();
  });

  it('after a successful reject, the Rejected section refetches and shows the piece', async () => {
    let rejected = false;
    const justRejected = { ...REJECTED_PIECE, contentPieceId: 'p1', contentPreview: '{"rejected":true}' };
    getContent.mockImplementation((status?: string) => {
      if (status === 'REJECTED') return Promise.resolve(rejected ? [justRejected] : []);
      if (status === 'APPROVED') return Promise.resolve([]);
      return Promise.resolve(rejected ? [] : [PIECE]);
    });
    reject.mockImplementation(async () => { rejected = true; return {}; });

    render(<ReviewScreen />);
    await userEvent.click(await screen.findByRole('button', { name: /reject/i }));

    // The just-rejected piece now appears in the Rejected section (via refetch, not optimism).
    expect(await screen.findByText('{"rejected":true}')).toBeInTheDocument();
    expect(screen.getByText(/· REJECTED/)).toBeInTheDocument();
  });

  it('Rejected fetch error does not break pending or approved', async () => {
    getContent.mockImplementation((status?: string) => {
      if (status === 'REJECTED') return Promise.reject(apiError(500, 'UNKNOWN_ERROR'));
      if (status === 'APPROVED') return Promise.resolve([]);
      return Promise.resolve([PIECE]);
    });
    render(<ReviewScreen />);
    expect(await screen.findByText('{"hook":"Stop guessing"}')).toBeInTheDocument(); // pending intact
    expect(screen.getByText(/could not load your rejected content/i)).toBeInTheDocument();
  });
});
