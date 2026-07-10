import { useCallback, useEffect, useState } from 'react';
import { createSSEParser } from '../upload/sse';
import { founderCategory } from '../copy/vocabulary';

/**
 * M-Google — Connect Your World: Google (Docs/Drive), founder-facing surface (DEV preview).
 * Reuses the M2.2 two-beat render + the U+2028-safe SSE reader.
 *
 * The drive.file consent mechanism (the HONESTY mechanism, not UI polish): the founder picks
 * files via the REAL Google Picker. drive.file scope means the app can only ever read files the
 * founder explicitly picked — a file that was never picked returns 404, even with a valid token.
 * The browser mints a short-lived GIS token (drive.file) ONLY to open the Picker and grant the
 * selected files to our OAuth client; the file content is then read SERVER-SIDE with the stored,
 * encrypted, never-client-exposed token (containment).
 *
 * Env (apps/web/.env): VITE_GOOGLE_PICKER_API_KEY (browser key), VITE_GOOGLE_CLIENT_ID.
 */
const PICKER_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined;
// drive.file granting requires the Picker to carry the app's ID = the Cloud PROJECT NUMBER, which
// is the numeric prefix of the OAuth client id. Without setAppId, a pick returns the file id but
// Drive records NO grant → every files.get 404s. Derived client-side; no new secret/env.
const APP_ID = ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').split('-')[0];

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading, 680px)', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const say: React.CSSProperties = { ...serif, fontSize: '1.25rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const idChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };
const stateCard: React.CSSProperties = { ...serif, fontSize: '1.2rem', lineHeight: 1.55, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '22px 24px', boxShadow: 'var(--shadow-soft)' };

interface BLine { label: string; text: string; kind: 'observed' | 'inferred'; fragmentIds: string[] }
type Src = 'google' | 'website' | 'model';
type Phase = 'idle' | 'reading' | 'beat1' | 'deepening' | 'beat2' | 'ended';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Open the REAL Google Picker. The Picker uses the SERVER's authorization token (minted from the
// stored credential via /dev/google/picker-token), so files it grants attach to the server's
// authorization — the same one the server read uses. The durable refresh token never reaches the
// browser; only this short-lived access token does (which the Picker inherently requires).
async function openPicker(): Promise<string[]> {
  if (!PICKER_KEY) throw new Error('Picker not configured — set VITE_GOOGLE_PICKER_API_KEY in apps/web/.env');
  const tr = await fetch('/dev/google/picker-token');
  if (!tr.ok) throw new Error('could not get a Drive token — connect Google first');
  const accessToken = (await tr.json()).accessToken as string | undefined;
  if (!accessToken) throw new Error('no Drive token — connect Google first');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((res) => w.gapi.load('picker', () => res()));

  return new Promise<string[]>((resolve) => {
    const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    const picker = new w.google.picker.PickerBuilder()
      .enableFeature(w.google.picker.Feature.MULTISELECT_ENABLED)
      .setAppId(APP_ID)           // project number — binds the pick to our app so drive.file grants attach
      .setDeveloperKey(PICKER_KEY)
      .setOAuthToken(accessToken) // SERVER authorization token → picked files granted to the server
      .addView(view)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .setCallback((data: any) => {
        if (data.action === w.google.picker.Action.PICKED) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resolve((data.docs || []).map((d: any) => String(d.id)));
        } else if (data.action === w.google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

function Badge({ source }: { source: Src }) {
  const base: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.64rem', letterSpacing: '0.04em', borderRadius: 6, padding: '2px 8px', marginRight: 6, display: 'inline-block', border: '1px solid' };
  if (source === 'google') return <span style={{ ...base, color: 'var(--gold)', borderColor: 'var(--gold-soft)', background: 'var(--surface)' }}>your Google doc · private</span>;
  if (source === 'website') return <span style={{ ...base, color: 'var(--ink-3)', borderColor: 'var(--line)', background: 'var(--paper-2)' }}>your website</span>;
  return <span style={{ ...base, color: 'var(--gold-soft)', borderColor: 'var(--line)', background: 'var(--surface)' }}>across your connected sources</span>;
}

function Line({ line, source }: { line: BLine; source: Src }) {
  // Inferred lines carry the internal category enum in `label` → founder vocabulary; observed keep theirs.
  const label = line.kind === 'inferred' ? founderCategory(line.label) : line.label.charAt(0).toUpperCase() + line.label.slice(1);
  return (
    <div style={{ margin: '0 0 26px', opacity: 0, animation: 'bbIn 0.9s var(--ease, ease) forwards' }}>
      <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6, color: line.kind === 'inferred' ? 'var(--gold-soft)' : 'var(--ink-3)' }}>{label}</div>
      <div style={say}>{line.text}</div>
      <div style={{ marginTop: 8 }}>
        <Badge source={source} />
        {line.fragmentIds.map((id) => <span key={id} style={idChip} title={`evidence fragment ${id}`}>{id.slice(0, 10)}…</span>)}
      </div>
    </div>
  );
}

export function GooglePreviewPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [fileIds, setFileIds] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [reading, setReading] = useState<string[]>([]);
  const [googleLines, setGoogleLines] = useState<BLine[]>([]);
  const [websiteLines, setWebsiteLines] = useState<BLine[]>([]);
  const [inferred, setInferred] = useState<BLine[]>([]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [stateMsg, setStateMsg] = useState<{ state: string; message: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try { const r = await fetch('/dev/google/status'); if (r.ok) setConnected((await r.json()).connected); else setConnected(false); }
    catch { setConnected(false); }
  }, []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const read = useCallback(async (idsOverride?: string[]) => {
    const ids = idsOverride ?? fileIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (idsOverride) setFileIds(ids.join(', '));
    setErr(null); setReading([]); setGoogleLines([]); setWebsiteLines([]); setInferred([]); setHandoff(null); setStateMsg(null);
    setPhase('reading');
    try {
      const res = await fetch('/dev/google/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileIds: ids }) });
      if (!res.ok || !res.body) { setErr(`read failed (${res.status})`); setPhase('ended'); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); const parser = createSSEParser();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        for (const { event: ev, data: dt } of parser.feed(dec.decode(value, { stream: true }))) {
          if (!ev || dt === undefined) continue;
          let data: unknown; try { data = JSON.parse(dt); } catch { continue; }
          if (ev === 'reading') setReading((r) => [...r, (data as { message: string }).message]);
          else if (ev === 'observed') {
            const b = data as { state: string; googleLines: BLine[]; websiteLines: BLine[]; handoff: string | null; message: string | null };
            if (b.state === 'synced' || b.state === 'partial') { setGoogleLines(b.googleLines); setWebsiteLines(b.websiteLines); setHandoff(b.handoff); setPhase('beat1'); setTimeout(() => setPhase('deepening'), 1200); }
            else { setStateMsg({ state: b.state, message: b.message }); setPhase('ended'); }
          }
          else if (ev === 'inferred') { setInferred(data as BLine[]); setPhase('beat2'); }
          else if (ev === 'done') { setPhase('ended'); }
          else if (ev === 'error') { setErr((data as { message: string }).message); setPhase('ended'); }
        }
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('ended'); }
  }, [fileIds]);

  const pick = useCallback(async () => {
    setErr(null);
    try {
      const ids = await openPicker();
      if (ids.length === 0) { setErr('No files picked.'); return; }
      await read(ids);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [read]);

  const busy = phase === 'reading' || phase === 'deepening';

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 28, color: 'var(--ink-3)' }}>
          DEV · Google Source (authenticated). <b>Connect Google</b> → <b>Pick from Drive</b> → live two-beat read. Only picked files are readable (drive.file). Beat 2 runs ~110s live.
        </div>
        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>Connect your private working documents.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 18 }}>Your strategy docs, plans, notes in Google — I&apos;ll read only the ones you pick. Kept private to you; never published, never synced in the background.</p>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap' }}>
          <a href="/dev/google/connect" style={{ fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', borderRadius: 10, padding: '10px 20px' }}>Connect Google</a>
          <button onClick={() => void pick()} disabled={busy} style={{ fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--gold)', color: 'var(--ink)', border: 'none', borderRadius: 10, padding: '10px 20px', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>Pick from Drive</button>
          <span style={meta}>status: {connected === null ? '…' : connected ? 'connected ✓' : 'not connected'}</span>
          <button onClick={() => void refreshStatus()} style={{ ...idChip, cursor: 'pointer' }}>refresh</button>
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ ...meta, cursor: 'pointer' }}>dev fallback: paste file IDs manually</summary>
          <div style={{ border: '1.5px dashed var(--line-2)', background: 'var(--paper-2)', borderRadius: 12, padding: '14px', marginTop: 8 }}>
            <input value={fileIds} onChange={(e) => setFileIds(e.target.value)} placeholder="1AbC…  1XyZ…" style={{ width: '100%', fontFamily: 'var(--sans)', padding: '9px 11px', borderRadius: 8, border: '1px solid var(--line)', marginBottom: 10, boxSizing: 'border-box' }} />
            <button onClick={() => void read()} disabled={busy} style={{ ...idChip, cursor: 'pointer', padding: '8px 14px' }}>Read pasted IDs</button>
            <div style={{ ...meta, marginTop: 6 }}>a non-picked ID will 404 under drive.file — that&apos;s the scoping guarantee, not a bug</div>
          </div>
        </details>

        {err && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>error: {err}</div>}

        {phase === 'reading' && reading.map((l, i) => <div key={i} style={{ ...say, color: 'var(--ink-2)', fontSize: '1.05rem' }}>{l}</div>)}

        {phase === 'ended' && stateMsg && (stateMsg.state !== 'synced' && stateMsg.state !== 'partial') && (
          <div style={stateCard}>
            <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--gold)', marginBottom: 10 }}>{stateMsg.state}</div>
            {stateMsg.message}
          </div>
        )}

        {(phase === 'beat1' || phase === 'deepening' || phase === 'beat2' || phase === 'ended') && (googleLines.length > 0 || websiteLines.length > 0) && (
          <div>
            <div style={kicker}>Here&apos;s what I can already see:</div>
            {googleLines.length > 0 && <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--gold)', margin: '4px 0 14px' }}>From your Google docs</div>}
            {googleLines.map((l) => <Line key={`g-${l.label}`} line={l} source="google" />)}
            {websiteLines.length > 0 && <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--ink-3)', margin: '10px 0 14px' }}>From your website</div>}
            {websiteLines.map((l) => <Line key={`w-${l.label}`} line={l} source="website" />)}

            {phase === 'deepening' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '10px 0 20px' }}>
                Reading your documents against your website…
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s live — it&apos;s thinking, not lagging</span>
              </div>
            )}
            {(phase === 'beat2' || phase === 'ended') && inferred.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={kicker}>What I&apos;m starting to see across your sources</div>
                {inferred.map((l) => <Line key={`i-${l.label}-${l.text.slice(0, 8)}`} line={l} source="model" />)}
              </div>
            )}
            {phase === 'ended' && handoff && <div style={{ ...say, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)', color: 'var(--ink)' }}>{handoff}</div>}
          </div>
        )}
      </div>
      <style>{`@keyframes bbIn { to { opacity: 1 } }`}</style>
    </div>
  );
}
