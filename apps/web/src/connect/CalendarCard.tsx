import { useState } from 'react';
import { disconnectCalendar } from '../api/client';
import type { ConnectStatus } from './types';
import { CONNECT_COPY } from './copy';
import { SourceCard } from './SourceCard';
import { statusLine, errorLine, linkBtn, quietBtn } from './styles';

const C = CONNECT_COPY.calendar;

/**
 * Calendar source — Google OAuth. Connecting is a FULL-PAGE navigation (an anchor to GET /connect/calendar,
 * opened in a new tab), never a fetch — Google renders its own consent screen. When connected, the calendar
 * evidence is read by the page (POST /connect/calendar/read) and a Disconnect control is offered. When the
 * connection isn't available (Google unconfigured / 503), a quiet unavailable line — no broken button.
 */
export function CalendarCard({ calendar, available = true, reading = false, onChanged }: {
  calendar: ConnectStatus['calendar'];
  available?: boolean;
  reading?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const disconnect = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await disconnectCalendar(); await onChanged(); }
    catch { setError(C.unavailable); }
    finally { setBusy(false); }
  };

  return (
    <SourceCard title={C.title}>
      {!available ? (
        <p style={statusLine}>{C.unavailable}</p>
      ) : calendar.connected ? (
        <>
          <p style={statusLine} aria-busy={reading}>{reading ? C.reading : C.connected}</p>
          <button type="button" onClick={() => void disconnect()} disabled={busy} aria-disabled={busy} style={quietBtn}>{C.disconnect}</button>
        </>
      ) : (
        // Full-page OAuth — a real link (new tab), NOT a fetch (GET /api/connect/calendar 302s to Google).
        <a href="/api/connect/calendar" target="_blank" rel="noopener noreferrer" style={linkBtn}>{C.action}</a>
      )}
      {error && <p style={errorLine} role="alert">{error}</p>}
    </SourceCard>
  );
}
