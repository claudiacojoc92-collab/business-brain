import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import { FirstReadPage } from './FirstReadPage';
import type { StoredReadResponse } from '../reads/types';

/**
 * S1-T6 C2 — the First Read page as the founder sees it. Fetch is mocked at the network layer so we can
 * prove: only GET /reads/:id is called (NEVER POST — loading a historical Read never generates); the six
 * sections render in fixed order; S4 is intentionally empty; receipts expand in place, verbatim, with no
 * interpretation; the two Gap sides stay separate; no internal enum / obey control / attention-direction
 * leaks; and corrupt / unknown-version / not-found all fail closed to neutral copy.
 */
const fullRead = (): StoredReadResponse => ({
  readId: 'rid-1', createdAt: '2026-07-10T00:00:00.000Z', schemaVersion: 1,
  read: {
    founderId: 'founder-A', assembledAt: '2026-07-10T00:00:00.000Z',
    sections: [
      { id: 'what_i_read', title: 'What I Read', empty: false, manifest: [{ source: 'website', itemCount: 2, earliest: '2026-06-01T00:00:00.000Z', latest: '2026-06-05T00:00:00.000Z' }] },
      { id: 'what_i_observe', title: 'What I Observe', empty: false, claims: [
        { statement: 'Calm software for everyone.', epistemicKind: 'observed', provenance: { fragmentIds: ['o1'] }, receipts: [{ fragmentId: 'o1', epistemicKind: 'observed', sourceType: 'website', text: 'Calm software for everyone, on your homepage.', sourceLabel: 'a.example', capturedAt: '2026-07-01T00:00:00.000Z' }] },
      ] },
      { id: 'gaps', title: 'Where Story & Evidence Diverge', empty: false, claims: [
        { statement: 'Your declared enterprise focus and your calm-for-everyone positioning diverge.', epistemicKind: 'inferred', internalCategory: 'contradictions', provenance: { fragmentIds: [] },
          declaredReceipts: [{ fragmentId: 'd1', epistemicKind: 'declared', sourceType: 'founder', text: 'We are enterprise-first.', sourceLabel: 'Direction', capturedAt: '2026-07-01T00:00:00.000Z' }],
          observedReceipts: [{ fragmentId: 'o1', epistemicKind: 'observed', sourceType: 'website', text: 'Calm software for everyone, on your homepage.', sourceLabel: 'a.example', capturedAt: '2026-07-01T00:00:00.000Z' }] },
      ] },
      { id: 'bets', title: "What You're Betting On", empty: true, claims: [] },
      { id: 'my_read', title: 'My Read', empty: false, claims: [
        { statement: 'Client collaboration is an under-marketed moat.', epistemicKind: 'inferred', internalCategory: 'hiddenStrengths', provenance: { fragmentIds: ['o1'] }, receipts: [{ fragmentId: 'o1', epistemicKind: 'observed', sourceType: 'upload', text: 'Clients who would not touch other tools use ours.', sourceLabel: 'plan.pdf', capturedAt: '2026-07-01T00:00:00.000Z' }], disclosure: { assumptions: ['SMB buyers value simplicity'], confidence: 'medium', truthStatus: 'inferred' } },
      ] },
      { id: 'cannot_see', title: 'What I Cannot See Yet', empty: false, limits: [{ kind: 'absent_source', source: 'google-calendar', detail: 'stored detail unused for absent_source' }] },
    ],
  },
});

let fetchImpl: (url: string, opts?: { method?: string }) => { ok: boolean; status: number; json: () => Promise<unknown> };
beforeEach(() => {
  global.fetch = vi.fn((url: string | URL, opts?: { method?: string }) => Promise.resolve(fetchImpl(String(url), opts))) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

function mount(readId = 'rid-1') {
  return render(
    <MemoryRouter initialEntries={[`/reads/${readId}`]}>
      <AuthProvider>
        <Routes><Route path="/reads/:readId" element={<FirstReadPage />} /></Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const err = (status: number) => ({ ok: false, status, json: async () => ({ error: { code: 'E', message: 'e' } }) });
const authOk = (u: string) => u.includes('auth/me');

describe('FirstReadPage — the six-section document', () => {
  it('renders all six sections in fixed order; S4 is intentionally empty', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Business Read/ })).toBeInTheDocument());
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(['What I Read', 'What I Observe', 'Where Your Story and Evidence Diverge', "What You're Betting On", 'My Read', 'What I Cannot See Yet']);
    // S4 principle copy, no bet content
    expect(screen.getByText(/A bet is a wager you're choosing to make/)).toBeInTheDocument();
  });

  it('loading a historical Read calls ONLY GET /reads/:id — never POST (never generates)', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const calls = (global.fetch as unknown as { mock: { calls: [string, { method?: string }?][] } }).mock.calls;
    const readCalls = calls.filter(([u]) => /\/?reads\/rid-1/.test(u));
    expect(readCalls.length).toBeGreaterThan(0);
    expect(readCalls.every(([, o]) => (o?.method ?? 'GET') === 'GET')).toBe(true);       // GET only
    expect(calls.some(([u, o]) => /reads/.test(u) && o?.method === 'POST')).toBe(false); // NEVER POST /reads
  });

  it('no internal enum, no attention-direction, no obey control in the DOM', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const text = (document.body.textContent ?? '').toLowerCase();
    for (const e of ['contradictions', 'blindspots', 'hiddenweaknesses', 'hiddenstrengths', 'positioningopportunities']) expect(text).not.toContain(e);
    for (const w of ['stakes', 'rank', 'priority', 'severity', 'urgency', 'biggest', 'take action', 'you should', 'fix this']) expect(text).not.toContain(w);
    expect(screen.queryByRole('button', { name: /accept|apply|do this|generate another|mark done/i })).not.toBeInTheDocument();
    expect(text).not.toContain('!');
  });

  it('observed vs inferred labels are distinct; recommendation is a read, not an order', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText('Inferred read')).toBeInTheDocument();
    expect(screen.getByText(/My read, not a fact\./)).toBeInTheDocument();
  });

  it('S3 Gap: two SEPARATE receipt groups expand in place, verbatim', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const story = screen.getByRole('button', { name: /the story you/i });
    const evidence = screen.getAllByRole('button', { name: /the evidence/i })[0]!;
    expect(story).not.toBe(evidence);
    expect(screen.queryByText('“We are enterprise-first.”')).not.toBeInTheDocument();
    fireEvent.click(story);
    expect(screen.getByText('“We are enterprise-first.”')).toBeInTheDocument(); // verbatim, in place
  });

  it('S6 absent-source is instrument-phrased (never "you\'re missing" / "connect")', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(fullRead()));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    const text = document.body.textContent ?? '';
    expect(text).toContain("I haven't read anything from your calendar");
    expect(text.toLowerCase()).not.toContain("you're missing");
    expect(text.toLowerCase()).not.toContain('connect your');
  });

  it('unknown schemaVersion → fail closed (neutral copy, no partial render)', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok({ ...fullRead(), schemaVersion: 999 }));
    mount();
    await waitFor(() => expect(screen.getByText("This Read can't be shown.")).toBeInTheDocument());
    expect(screen.queryByText('Calm software for everyone.')).not.toBeInTheDocument(); // no claims rendered
  });

  it('not-found → neutral, non-leaking copy', async () => {
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : err(404));
    mount('ghost');
    await waitFor(() => expect(screen.getByText("This Read isn't available.")).toBeInTheDocument());
  });

  it('sparse Read (only S1 + S6 content) renders honestly — empties not padded', async () => {
    const sparse = fullRead();
    sparse.read.sections[1] = { id: 'what_i_observe', title: 'What I Observe', empty: true, claims: [] };
    sparse.read.sections[2] = { id: 'gaps', title: 'x', empty: true, claims: [] };
    sparse.read.sections[4] = { id: 'my_read', title: 'x', empty: true, claims: [] };
    fetchImpl = (u) => (authOk(u) ? ok({ founder_id: 'founder-A' }) : ok(sparse));
    mount();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(6); // all six still present
    expect(screen.getByText(/No read to offer yet\./)).toBeInTheDocument(); // honest empty S5
  });
});
