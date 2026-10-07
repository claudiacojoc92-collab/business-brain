import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Mocked public API client — the frontend never touches persistence/Candidate types. */
vi.mock('../api/client', () => {
  class ApiError extends Error {
    constructor(public readonly status: number, public readonly code: string, message: string) {
      super(message);
      this.name = 'ApiError';
    }
  }
  return {
    ApiError,
    getBBFounder: vi.fn(),
    getBBSession: vi.fn(),
    getBBConnection: vi.fn(),
    getBBCurrent: vi.fn(),
    getBBRefresh: vi.fn(),
    bbConnect: vi.fn(),
    bbDisconnect: vi.fn(),
    bbStartRefresh: vi.fn(),
    bbCancelRefresh: vi.fn(),
  };
});

import * as client from '../api/client';
import { BusinessBrainWorkspace } from '../businessbrain/BusinessBrainWorkspace';

const m = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;
function apiError(status: number, code: string) {
  return new (client.ApiError as unknown as new (s: number, c: string, msg: string) => Error)(status, code, code);
}

const SNAP = (o: Partial<Record<string, unknown>> = {}) => ({
  refreshReference: 'R1', refreshState: 'none', importState: 'none',
  diagnosisState: 'none', validationState: 'none', transitionMarker: 0, ...o,
});
const NONE = { state: 'no_current_version' as const };
const VERSION = (id: string) => ({
  versionId: id,
  producedAt: '2025-01-06T04:00:00.000Z',
  businessReality: 'Your communication makes it hard for the right clients to understand what you sell and why to choose you.',
  businessConsequences: ['The right clients rarely discover that you can help them.', 'People who like you have no clear path to becoming buyers.'],
  evidence: { claims: [{ claimStatement: 'Almost nothing you publish makes the case for your offer.', measures: [{ descriptor: 'personal / lifestyle share', kind: 'proportion', value: 87 }, { descriptor: 'average reach per post', kind: 'count', value: 1545 }, { descriptor: 'proof-of-results posts', kind: 'absence' }] }] },
  cannotYetKnow: 'We cannot yet see your actual sales, or what your audience privately thinks.',
  rootCauses: ['Your expertise is not made legible.'],
  recommendations: ['Make your expertise visible and state your offer plainly.'],
  executionPlan: [{ label: 'Weeks one to four', actions: [{ statement: 'Introduce a recurring educational focus.', sequence: 1 }, { statement: 'State your offer plainly.', sequence: 2 }] }],
});

function setDefaults() {
  m(client.getBBFounder).mockResolvedValue({ founderReference: 'f1' });
  m(client.getBBSession).mockResolvedValue({ sessionReference: 'f1', state: 'active' });
  m(client.getBBConnection).mockResolvedValue({ connectionState: 'not_connected' });
  m(client.getBBRefresh).mockResolvedValue(SNAP());
  m(client.getBBCurrent).mockResolvedValue(NONE);
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.sessionStorage?.clear();
  globalThis.localStorage?.clear();
  setDefaults();
});
afterEach(() => cleanup());

const renderWs = (poll = 15) => render(<BusinessBrainWorkspace pollIntervalMs={poll} />);

describe('Business Brain V1 frontend', () => {
  it('1. initial authenticated load fetches authoritative state', async () => {
    renderWs();
    await waitFor(() => expect(client.getBBFounder).toHaveBeenCalled());
    expect(client.getBBSession).toHaveBeenCalled();
    expect(client.getBBConnection).toHaveBeenCalled();
    expect(client.getBBRefresh).toHaveBeenCalled();
    expect(client.getBBCurrent).toHaveBeenCalled();
  });

  it('2. no_current_version renders as a valid empty state (not an error)', async () => {
    renderWs();
    expect(await screen.findByTestId('no-current-version')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('3. disconnected Founder cannot Start Refresh', async () => {
    renderWs();
    const btn = await screen.findByTestId('start-refresh');
    expect(btn).toBeDisabled();
    expect(screen.getByText(/Connect before starting a refresh/i)).toBeInTheDocument();
  });

  it('4. Connect begins REAL Instagram Business Login by redirecting to the consent URL', async () => {
    const authUrl = 'https://www.instagram.com/oauth/authorize?client_id=ig&scope=instagram_business_basic&state=abc';
    m(client.bbConnect).mockResolvedValue({ authUrl });
    // jsdom's location.assign is non-configurable — replace window.location wholesale, then restore.
    const original = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { ...original, assign } });
    try {
      renderWs();
      const connectBtn = await screen.findByRole('button', { name: /Connect Instagram/i });
      await userEvent.click(connectBtn);
      await waitFor(() => expect(client.bbConnect).toHaveBeenCalled());
      await waitFor(() => expect(assign).toHaveBeenCalledWith(authUrl));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original });
    }
  });

  it('5. Start Refresh sends exactly one idempotency token; 6/7 token reuse & new token', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.bbStartRefresh).mockResolvedValue(SNAP({ refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshState: 'completed', importState: 'sufficient', diagnosisState: 'produced', validationState: 'passed', transitionMarker: 5 }));
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1'));
    renderWs();
    const start = await screen.findByTestId('start-refresh');
    await userEvent.click(start);
    await waitFor(() => expect(client.bbStartRefresh).toHaveBeenCalledTimes(1));
    const token1 = m(client.bbStartRefresh).mock.calls[0][0].idempotencyToken;
    expect(token1).toBeTruthy();
    // Deliberate later refresh (after completion) uses a NEW token.
    await waitFor(() => expect(screen.getByTestId('current-business-brain')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('start-refresh'));
    await waitFor(() => expect(client.bbStartRefresh).toHaveBeenCalledTimes(2));
    const token2 = m(client.bbStartRefresh).mock.calls[1][0].idempotencyToken;
    expect(token2).not.toBe(token1);
  });

  it('6. a network-uncertain retry reuses the same unresolved token', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: undefined, refreshState: 'none' })); // Start enabled at load
    m(client.bbStartRefresh).mockRejectedValueOnce(new Error('network')); // no ApiError code -> keep token
    m(client.bbStartRefresh).mockResolvedValueOnce(SNAP({ refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    renderWs(100000);
    const start = await screen.findByTestId('start-refresh');
    await userEvent.click(start); // fails, token retained
    await waitFor(() => expect(client.bbStartRefresh).toHaveBeenCalledTimes(1));
    const t1 = m(client.bbStartRefresh).mock.calls[0][0].idempotencyToken;
    await userEvent.click(start); // retry reuses token
    await waitFor(() => expect(client.bbStartRefresh).toHaveBeenCalledTimes(2));
    expect(m(client.bbStartRefresh).mock.calls[1][0].idempotencyToken).toBe(t1);
  });

  it('8/9. accepted Start does not show a Version; existing Current stays; snapshot is coherent', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1')); // an existing Current
    m(client.bbStartRefresh).mockResolvedValue(SNAP({ refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    renderWs(100000); // avoid completing during this test
    await screen.findByTestId('current-business-brain');
    await userEvent.click(screen.getByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('refresh-progress')).toHaveAttribute('data-refresh-state', 'in_progress'));
    // Current V1 still visible during the active Refresh.
    expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V1');
  });

  it('11. lower transition_marker / 12. older refresh_reference responses are ignored', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBRefresh).mockResolvedValueOnce(SNAP({ refreshReference: undefined, refreshState: 'none' })); // initial load: Start enabled
    m(client.bbStartRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'in_progress', importState: 'sufficient', diagnosisState: 'running', transitionMarker: 5 }));
    // Subsequent polls return a STALE snapshot: older ref R1 and lower marker — must be ignored.
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: 'R1', refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    renderWs(15);
    await userEvent.click(await screen.findByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('refresh-progress')).toBeInTheDocument());
    // Give the poller a few ticks; the stale snapshot must NOT regress the label.
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.getByText(/Preparing the diagnosis|Validating the complete version/i)).toBeInTheDocument();
  });

  it('13/14/15. completed Refresh refetches Current and replaces it atomically with a new Version ID', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValueOnce(VERSION('V1')); // initial load
    m(client.getBBRefresh).mockResolvedValueOnce(SNAP({ refreshReference: 'R1', refreshState: 'none' })); // initial load
    m(client.bbStartRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'completed', importState: 'sufficient', diagnosisState: 'produced', validationState: 'passed', transitionMarker: 6 }));
    m(client.getBBCurrent).mockResolvedValue(VERSION('V2')); // refetch after completion
    renderWs(15);
    await waitFor(() => expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V1'));
    await userEvent.click(screen.getByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V2'), { timeout: 2000 });
    // Sections are from the new Version only (never merged): one reality statement.
    expect(screen.getAllByTestId('section-business-reality')).toHaveLength(1);
  });

  it('16. sections render in the frozen order; 26. measures only inside Evidence; 27. one-based actions', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1'));
    renderWs();
    await screen.findByTestId('current-business-brain');
    const order = ['section-business-reality', 'section-business-consequences', 'section-evidence', 'section-cannot-yet-know', 'section-root-causes', 'section-recommendations', 'section-execution-plan'];
    // each later section follows the first in document order
    for (let i = 1; i < order.length; i += 1) {
      expect(screen.getByTestId(order[0]).compareDocumentPosition(screen.getByTestId(order[i])) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // measures only in Evidence
    expect(screen.getByTestId('section-evidence')).toHaveTextContent('87%');
    expect(screen.getByTestId('section-business-reality')).not.toHaveTextContent('87');
    // count measures render as plain numbers, NEVER as a percentage
    expect(screen.getByTestId('section-evidence')).toHaveTextContent('1545');
    expect(screen.getByTestId('section-evidence')).not.toHaveTextContent('1545%');
    // one-based ordered actions
    const items = screen.getByTestId('section-execution-plan').querySelectorAll('ol > li');
    expect(items[0]).toHaveAttribute('value', '1');
  });

  it('17. failed Refresh preserves Current', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1'));
    m(client.bbStartRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'in_progress', importState: 'running', transitionMarker: 1 }));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'failed', importState: 'insufficient', failureCategory: 'insufficient_evidence', transitionMarker: 3 }));
    renderWs(15);
    await waitFor(() => expect(screen.getByTestId('current-business-brain')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('refresh-progress')).toHaveAttribute('data-refresh-state', 'failed'), { timeout: 2000 });
    expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V1'); // preserved
  });

  it('19. Disconnect preserves Current', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1'));
    m(client.bbDisconnect).mockResolvedValue({ connectionState: 'not_connected' });
    renderWs(100000);
    await screen.findByTestId('current-business-brain');
    await userEvent.click(screen.getByRole('button', { name: /Disconnect/i }));
    await waitFor(() => expect(screen.getByTestId('connection-status')).toHaveTextContent(/not connected/i));
    expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V1'); // preserved
  });

  it('21. REFRESH_ALREADY_IN_PROGRESS reconciles toward the active Refresh (not an error)', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.bbStartRefresh).mockRejectedValue(apiError(409, 'REFRESH_ALREADY_IN_PROGRESS'));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: 'R9', refreshState: 'in_progress', importState: 'running', transitionMarker: 2 }));
    renderWs(100000);
    await userEvent.click(await screen.findByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('refresh-progress')).toHaveAttribute('data-refresh-state', 'in_progress'));
    expect(screen.queryByTestId('command-error')).not.toBeInTheDocument();
  });

  it('22. IDEMPOTENCY_CONFLICT surfaces safely and reconciles', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.bbStartRefresh).mockRejectedValue(apiError(409, 'IDEMPOTENCY_CONFLICT'));
    m(client.getBBRefresh).mockResolvedValue(SNAP());
    renderWs(100000);
    await userEvent.click(await screen.findByTestId('start-refresh'));
    await waitFor(() => expect(screen.getByTestId('command-error')).toBeInTheDocument());
    expect(screen.getByTestId('command-error').textContent).not.toMatch(/select|insert|pg|constraint/i);
    expect(sessionStorage.getItem('bb_pending_refresh_token')).toBeNull(); // cleared -> next uses new token
  });

  it('23. Session loss produces the authentication state', async () => {
    m(client.getBBFounder).mockRejectedValue(apiError(401, 'NOT_AUTHENTICATED'));
    renderWs();
    expect(await screen.findByText(/Please sign in again/i)).toBeInTheDocument();
  });

  it('28. no internal IDs appear in rendered output', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('01ABCDEF'));
    const { container } = renderWs();
    await screen.findByTestId('current-business-brain');
    const html = container.innerHTML;
    expect(html).toContain('01ABCDEF'); // versionId IS public
    for (const marker of ['-ei-', '-rc-', '-rec-', '-epv', 'evidenceItemId', 'rootCauseId', 'recommendationId', 'actionId', 'candidateVersionId', 'diagnosis_job']) {
      expect(html.includes(marker)).toBe(false);
    }
  });

  it('29. reload during active Refresh restores and continues to completion', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    // Simulate a reload landing mid-refresh: initial snapshot in_progress, then completes on poll.
    m(client.getBBRefresh).mockResolvedValueOnce(SNAP({ refreshReference: 'R2', refreshState: 'in_progress', importState: 'sufficient', diagnosisState: 'running', transitionMarker: 3 }));
    m(client.getBBRefresh).mockResolvedValue(SNAP({ refreshReference: 'R2', refreshState: 'completed', importState: 'sufficient', diagnosisState: 'produced', validationState: 'passed', transitionMarker: 7 }));
    m(client.getBBCurrent).mockResolvedValueOnce(NONE); // initial
    m(client.getBBCurrent).mockResolvedValue(VERSION('V2')); // after completion
    renderWs(15);
    await waitFor(() => expect(screen.getByTestId('refresh-progress')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('current-business-brain')).toHaveAttribute('data-version-id', 'V2'), { timeout: 2000 });
  });

  it('30. no Business Brain content is written to localStorage/sessionStorage', async () => {
    m(client.getBBConnection).mockResolvedValue({ connectionState: 'connected' });
    m(client.getBBCurrent).mockResolvedValue(VERSION('V1'));
    renderWs();
    await screen.findByTestId('current-business-brain');
    const dump = JSON.stringify({ ...(globalThis.localStorage ?? {}) }) + JSON.stringify({ ...(globalThis.sessionStorage ?? {}) });
    expect(dump).not.toMatch(/businessReality|Almost nothing|expertise is not made legible|cannotYetKnow/i);
  });
});
