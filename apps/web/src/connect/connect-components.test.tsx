import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * S1-T5b C1 — source cards. NO network: the api client is mocked (ApiError kept real for the 413/400 map).
 * Proves: factual states from /connect/status (counts, no scores/quality); upload/website carry NO disconnect
 * (no backend endpoint); calendar connect is an ANCHOR (not a fetch) and only calendar shows disconnect; the
 * refresh note is calm; and no forbidden Language strings appear.
 */
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  return { ...actual, connectWebsite: vi.fn(), connectUpload: vi.fn(), disconnectCalendar: vi.fn() };
});

import { connectWebsite, connectUpload, disconnectCalendar, ApiError } from '../api/client';
import { WebsiteCard } from './WebsiteCard';
import { UploadCard } from './UploadCard';
import { CalendarCard } from './CalendarCard';

const FORBIDDEN = ['unlock', 'maximize', 'complete', 'improve', 'AI-powered', 'recommended', 'best-practice', 'great job', 'progress', 'missing', 'you should', 'score', 'quality', '%'];
const noForbidden = () => { const t = (document.body.textContent ?? '').toLowerCase(); for (const f of FORBIDDEN) expect(t, `forbidden "${f}"`).not.toContain(f.toLowerCase()); expect(document.body.textContent).not.toContain('!'); };
beforeEach(() => { vi.clearAllMocks(); });

describe('WebsiteCard', () => {
  it('not connected: URL input + Connect, no disconnect', () => {
    render(<WebsiteCard website={{ connected: false, count: 0 }} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: /connect/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    noForbidden();
  });
  it('connected: factual count + calm refresh note; still no disconnect', () => {
    render(<WebsiteCard website={{ connected: true, count: 3 }} onChanged={vi.fn()} />);
    expect(screen.getByText('Connected · 3 pages')).toBeInTheDocument();
    expect(screen.getByText('Connecting again refreshes this source.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    noForbidden();
  });
  it('connect flow: submit calls connectWebsite(url) then onChanged', async () => {
    vi.mocked(connectWebsite).mockResolvedValue({ source: 'website', state: 'synced', stored: 4 });
    const onChanged = vi.fn();
    render(<WebsiteCard website={{ connected: false, count: 0 }} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText(/your website address/i), { target: { value: 'https://a.example' } });
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(connectWebsite).toHaveBeenCalledWith('https://a.example'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('error: neutral message on failure', async () => {
    vi.mocked(connectWebsite).mockRejectedValue(new Error('net'));
    render(<WebsiteCard website={{ connected: false, count: 0 }} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/your website address/i), { target: { value: 'https://a.example' } });
    fireEvent.click(screen.getByRole('button', { name: /^connect$/i }));
    await waitFor(() => expect(screen.getByText("I couldn't reach that site.")).toBeInTheDocument());
  });
});

describe('UploadCard', () => {
  it('connected: factual section count + refresh note; no disconnect', () => {
    render(<UploadCard upload={{ connected: true, count: 5 }} onChanged={vi.fn()} />);
    expect(screen.getByText('Connected · 5 sections')).toBeInTheDocument();
    expect(screen.getByText('Connecting again refreshes this source.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    noForbidden();
  });
  it('413 → "too large"; 400 → "can\'t read that type"', async () => {
    const file = new File([new Uint8Array(3)], 'big.pdf', { type: 'application/pdf' });
    vi.mocked(connectUpload).mockRejectedValueOnce(new ApiError(413, 'X', 'big'));
    const { unmount } = render(<UploadCard upload={{ connected: false, count: 0 }} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/choose a document/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByText('That file is too large.')).toBeInTheDocument());
    unmount();
    vi.mocked(connectUpload).mockRejectedValueOnce(new ApiError(400, 'X', 'bad'));
    render(<UploadCard upload={{ connected: false, count: 0 }} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/choose a document/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByText("I can't read that type yet.")).toBeInTheDocument());
  });
});

describe('CalendarCard', () => {
  it('not connected: an ANCHOR to /connect/calendar (new tab, rel=noopener), not a fetch; no disconnect', () => {
    render(<CalendarCard calendar={{ connected: false }} onChanged={vi.fn()} />);
    const link = screen.getByRole('link', { name: /connect calendar/i });
    expect(link).toHaveAttribute('href', '/connect/calendar');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    noForbidden();
  });
  it('connected: shows Disconnect → disconnectCalendar', async () => {
    vi.mocked(disconnectCalendar).mockResolvedValue({ connected: false });
    const onChanged = vi.fn();
    render(<CalendarCard calendar={{ connected: true }} onChanged={onChanged} />);
    expect(screen.getByText('Connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(disconnectCalendar).toHaveBeenCalled());
  });
  it('reading state', () => {
    render(<CalendarCard calendar={{ connected: true }} reading onChanged={vi.fn()} />);
    expect(screen.getByText('Reading your calendar…')).toBeInTheDocument();
  });
  it('unavailable (503): quiet line, no anchor/button', () => {
    render(<CalendarCard calendar={{ connected: false }} available={false} onChanged={vi.fn()} />);
    expect(screen.getByText('Calendar connection isn’t available right now.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    noForbidden();
  });
});
