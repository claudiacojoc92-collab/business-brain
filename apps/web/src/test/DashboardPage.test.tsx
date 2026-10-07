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
  return {
    ApiError,
    getFounderProfile: vi.fn(),
    getOffer: vi.fn(),
    getCurrentCycle: vi.fn(),
    getCurrentBrief: vi.fn(),
    getCycleHistory: vi.fn(),
    getMemoryConfidence: vi.fn(),
    getCurrentContent: vi.fn(),
  };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ founder: null, isLoading: false, login: vi.fn(), logout: vi.fn(), refreshStatus: vi.fn() }),
}));

import { DashboardPage } from '../pages/DashboardPage';
import * as client from '../api/client';

const m = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;
function apiError(status: number, code: string) {
  return new (client.ApiError as unknown as new (s: number, c: string, msg: string) => Error)(status, code, code);
}
function renderHome() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>);
}

const PROFILE = {
  founderId: 'f1', status: 'ACTIVE', name: 'Dev Founder', businessName: 'Dev Business',
  timezone: 'Europe/London', notificationChannel: 'EMAIL', autoApproveOnWindowClose: true,
  approvalWindowHours: 72, registeredAt: '2025-01-01T00:00:00.000Z', activatedAt: '2025-01-06T04:00:00.000Z', pausedAt: null,
};
const OFFER = {
  offerId: 'o1', name: 'Marketing Clarity Package', primaryPromise: 'Consistent clients without constant hustle.',
  priceTier: 'MID', availability: 'OPEN', maturity: 'ESTABLISHED', capacityAvailable: true, trustMultiplier: 1.5,
};
const BRIEF = {
  briefId: 'b1', cycleId: 'c3', mode: 'TRUST', modeConfidence: 0,
  strategicPurpose: 'Establish the credible alternative', audienceSegment: 'Service-based professionals',
  briefConfidence: 0, uniquenessScore: 50, validationResult: 'COMMITTED', isFallback: false, reviewFlag: false,
  committedAt: '2026-06-28T09:47:44.989Z', founderFocus: null,
};
const HISTORY = {
  items: [{ cycleId: 'c3', cycleNumber: 3, selectedMode: null, contentPieceCount: 0, committedAt: '2026-06-28T09:47:44.948Z', isFallback: false }],
  nextCursor: null, hasMore: false,
};
const MEMORY = {
  founderId: 'f1', compositeConfidence: 0,
  layers: [
    { layer: 'APPROVAL_INTELLIGENCE', confidence: 0, dataPoints: 0, lastUpdatedAt: '2026-06-27T20:46:20.075Z' },
    { layer: 'REJECTION_INTELLIGENCE', confidence: 0, dataPoints: 0, lastUpdatedAt: '2026-06-27T20:46:20.075Z' },
  ],
};
const PIECE = {
  contentPieceId: 'p1', cycleId: 'c3', pieceType: 'REEL', pieceRole: 'PRIMARY',
  contentPreview: 'x', approvalStatus: 'AWAITING_APPROVAL', approvalWindowExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m(client.getFounderProfile).mockResolvedValue(PROFILE);
  m(client.getOffer).mockResolvedValue(OFFER);
  m(client.getCurrentCycle).mockResolvedValue(null);
  m(client.getCurrentBrief).mockResolvedValue(BRIEF);
  m(client.getCycleHistory).mockResolvedValue(HISTORY);
  m(client.getMemoryConfidence).mockResolvedValue(MEMORY);
  m(client.getCurrentContent).mockResolvedValue([]);
});

describe('DashboardPage (Home v1)', () => {
  it('Section 1 — projects real profile, offer and the latest strategic read', async () => {
    renderHome();
    expect(await screen.findByText('Dev Business')).toBeInTheDocument();
    expect(screen.getByText('Marketing Clarity Package')).toBeInTheDocument();
    expect(screen.getByText('Consistent clients without constant hustle.')).toBeInTheDocument();
    expect(screen.getByText(/Establish the credible alternative/)).toBeInTheDocument();
    expect(screen.getByText('Trust')).toBeInTheDocument(); // humanized mode
  });

  it('Section 2 — when no cycle is running, says so and shows the most recent cycle', async () => {
    renderHome();
    expect(await screen.findByText(/No cycle is running right now/)).toBeInTheDocument();
    expect(screen.getByText(/#3 completed/)).toBeInTheDocument();
  });

  it('Section 3 — honest "no schedule" rather than a fabricated date', async () => {
    renderHome();
    expect(await screen.findByText(/No upcoming cycle is currently scheduled/)).toBeInTheDocument();
    expect(screen.getByText(/timing of your next brief/)).toBeInTheDocument();
  });

  it('Section 4 — Not Yet Known reflects real zero-confidence learning state', async () => {
    renderHome();
    expect(await screen.findByText(/Behavioral learning confidence is not yet established/)).toBeInTheDocument();
    // The framing that distinguishes Section 4 (behavioral learning) from Section 1's strategic read.
    expect(screen.getByText(/learns from your behavior as you review and act/)).toBeInTheDocument();
    expect(screen.getAllByText(/not yet known/).length).toBeGreaterThan(0);
  });

  it('Section 5 — no pending content → "Nothing right now"', async () => {
    renderHome();
    expect(await screen.findByText(/Nothing right now — Business Brain is working/)).toBeInTheDocument();
  });

  it('Section 5 — pending content → count + Open review action', async () => {
    m(client.getCurrentContent).mockResolvedValue([PIECE]);
    renderHome();
    expect(await screen.findByText(/1 piece awaiting your review/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open review/i })).toBeInTheDocument();
  });

  it('Section 1 — missing offer renders an honest gap, not a fabricated default', async () => {
    m(client.getOffer).mockRejectedValue(apiError(412, 'NO_ACTIVE_OFFER'));
    renderHome();
    // The gap is surfaced honestly in Section 1 AND re-stated in Section 4 (Not Yet Known).
    expect((await screen.findAllByText(/isn.t defined/)).length).toBeGreaterThan(0);
  });

  it('Section 2 — a running cycle is shown as in progress', async () => {
    m(client.getCurrentCycle).mockResolvedValue({
      cycleId: 'c4', cycleNumber: 4, status: 'REASONING', scheduledFor: '2026-06-29T00:00:00.000Z',
      contentDeliverBy: '2026-06-29T04:00:00.000Z', selectedMode: null, isFallback: false,
      startedAt: '2026-06-29T00:00:00.000Z', committedAt: null,
    });
    renderHome();
    expect(await screen.findByText(/Cycle #4 — Reasoning/)).toBeInTheDocument();
  });

  // ── Brief Read v1 — the latest strategic read is OPEN BY DEFAULT ────────────
  const LONG_STRATEGY =
    'Establish the founder as the credible alternative to both budget self-paced courses and ' +
    'high-volume agencies, bridging the pricing-resistance gap with premium-accessible positioning.';

  it('Brief Read — full strategy + meta render by default on load, with no interaction', async () => {
    m(client.getCurrentBrief).mockResolvedValue({ ...BRIEF, strategicPurpose: LONG_STRATEGY });
    renderHome();
    // No click: the full untruncated strategy and committed meta are already visible.
    expect(await screen.findByText(LONG_STRATEGY)).toBeInTheDocument();
    expect(screen.getByText('Committed')).toBeInTheDocument();             // validationResult, humanized
    // The control reads as a collapse affordance (default-open), not "open".
    expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open full brief/i })).toBeNull();
  });

  it('Brief Read — Collapse hides the full text (teaser truncates) and offers Open again', async () => {
    m(client.getCurrentBrief).mockResolvedValue({ ...BRIEF, strategicPurpose: LONG_STRATEGY });
    renderHome();
    expect(await screen.findByText(LONG_STRATEGY)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));

    // Collapsed: full text gone (truncated), and the open control returns.
    expect(screen.queryByText(LONG_STRATEGY)).toBeNull();
    expect(screen.getByRole('button', { name: /open full brief/i })).toBeInTheDocument();
  });

  it('Brief Read — confidence is never rendered as a percentage (briefConfidence stays omitted)', async () => {
    renderHome();
    // Open by default — no interaction needed.
    await screen.findByRole('button', { name: /collapse/i });
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });

  it('Brief Read — a fallback brief is surfaced honestly by default', async () => {
    m(client.getCurrentBrief).mockResolvedValue({ ...BRIEF, isFallback: true });
    renderHome();
    expect(await screen.findByText(/fallback brief/i)).toBeInTheDocument();
  });

  it('This week’s leverage — renders the founder_focus sentence when present', async () => {
    const sentence = 'The leverage this week is in naming the frustration your audience has not been saying out loud.';
    m(client.getCurrentBrief).mockResolvedValue({ ...BRIEF, founderFocus: sentence });
    renderHome();
    expect(await screen.findByText(/this week’s leverage/i)).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('This week’s leverage — no card when founder_focus is null (honest silence)', async () => {
    m(client.getCurrentBrief).mockResolvedValue({ ...BRIEF, founderFocus: null });
    renderHome();
    await screen.findByRole('button', { name: /collapse/i }); // home loaded
    expect(screen.queryByText(/this week’s leverage/i)).toBeNull();
  });

  it('Brief Read — no current brief (404) → honest empty state, no toggle of any kind', async () => {
    m(client.getCurrentBrief).mockRejectedValue(apiError(404, 'CYCLE_NOT_FOUND'));
    renderHome();
    expect(await screen.findByText(/A strategic read of your audience and positioning/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collapse/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /open full brief/i })).toBeNull();
  });
});
