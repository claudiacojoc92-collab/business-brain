import { useId, useState } from 'react';
import { connectUpload, ApiError } from '../api/client';
import type { ConnectStatus } from './types';
import { CONNECT_COPY } from './copy';
import { SourceCard } from './SourceCard';
import { statusLine, note, errorLine, primaryBtn } from './styles';

const C = CONNECT_COPY.upload;

/** Upload source — a document to ingest (POST /connect/upload, multipart). Connected shows the section
 *  count; re-uploading refreshes the source. No disconnect (no backend endpoint). */
export function UploadCard({ upload, onChanged }: { upload: ConnectStatus['upload']; onChanged: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fieldId = useId();

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true); setError('');
    try { await connectUpload(file); await onChanged(); }
    catch (e) { setError(e instanceof ApiError && e.status === 413 ? C.tooLarge : C.unsupported); }
    finally { setBusy(false); }
  };

  return (
    <SourceCard title={C.title}>
      {upload.connected && <p style={statusLine}>{C.connected(upload.count)}</p>}
      <label htmlFor={fieldId} style={{ ...statusLine, marginBottom: 6 }}>{C.field}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input id={fieldId} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-busy={busy} disabled={busy} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-2)' }} />
        <button type="button" onClick={() => void submit()} disabled={!file || busy} aria-disabled={!file || busy} style={primaryBtn(Boolean(file) && !busy)}>
          {busy ? C.connecting : C.action}
        </button>
      </div>
      {upload.connected && <p style={note}>{CONNECT_COPY.refreshNote}</p>}
      {error && <p style={errorLine} role="alert">{error}</p>}
    </SourceCard>
  );
}
