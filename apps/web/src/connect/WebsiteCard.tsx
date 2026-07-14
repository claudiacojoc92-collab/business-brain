import { useId, useState } from 'react';
import { connectWebsite } from '../api/client';
import type { ConnectStatus } from './types';
import { CONNECT_COPY } from './copy';
import { SourceCard } from './SourceCard';
import { statusLine, note, errorLine, input, primaryBtn } from './styles';

const C = CONNECT_COPY.website;

/** Website source — a URL to ingest (POST /connect/website). Connected shows the page count; re-submitting
 *  refreshes the source (the calm refresh note). No disconnect (the backend has no such endpoint). */
export function WebsiteCard({ website, onChanged }: { website: ConnectStatus['website']; onChanged: () => void | Promise<void> }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fieldId = useId();

  const submit = async () => {
    if (!url || busy) return;
    setBusy(true); setError('');
    try { await connectWebsite(url); await onChanged(); }
    catch { setError(C.error); }
    finally { setBusy(false); }
  };

  return (
    <SourceCard title={C.title}>
      {website.connected && <p style={statusLine}>{C.connected(website.count)}</p>}
      <label htmlFor={fieldId} style={{ ...statusLine, marginBottom: 6 }}>{C.field}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input id={fieldId} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} style={input} aria-busy={busy} disabled={busy} placeholder="https://" />
        <button type="button" onClick={() => void submit()} disabled={!url || busy} aria-disabled={!url || busy} style={primaryBtn(Boolean(url) && !busy)}>
          {busy ? C.connecting : C.action}
        </button>
      </div>
      {website.connected && <p style={note}>{CONNECT_COPY.refreshNote}</p>}
      {error && <p style={errorLine} role="alert">{error}</p>}
    </SourceCard>
  );
}
