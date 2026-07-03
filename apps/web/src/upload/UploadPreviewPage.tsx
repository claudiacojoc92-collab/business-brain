import { useCallback, useEffect, useRef, useState } from 'react';
import { UPLOAD_CASES, type UploadCase, type ULine, type Src } from './fixtures';

/**
 * M2.2 — Upload Connector, founder-facing surface.
 *
 * TWO modes share one render:
 *   • LIVE — a real file is uploaded to the dev SSE endpoint (POST multipart /dev/m22/upload)
 *     and the two-beat streams back over fetch()+ReadableStream: Beat 1 (upload + website
 *     observed) fast, Beat 2 (inferred spanning sources) ~110s behind. Real transport.
 *   • DEMO — the fixture cases replay REAL captured output to showcase the honest states
 *     (redundant/unsupported/empty/failed) and the source-distinction badges.
 * Every rendered line is traceable; honest states get as much care as synced.
 */

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading, 680px)', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const say: React.CSSProperties = { ...serif, fontSize: '1.25rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const idChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };
const stateCard: React.CSSProperties = { ...serif, fontSize: '1.2rem', lineHeight: 1.55, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '22px 24px', boxShadow: 'var(--shadow-soft)' };

function SourceBadge({ source, doc, location }: { source: Src; doc?: string; location?: string }) {
  const badge: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.64rem', letterSpacing: '0.04em', borderRadius: 6, padding: '2px 8px', marginRight: 6, display: 'inline-block', border: '1px solid' };
  if (source === 'upload') return <span style={{ ...badge, color: 'var(--gold)', borderColor: 'var(--gold-soft)', background: 'var(--surface)' }}>your document{doc ? ` · ${doc}` : ''}{location ? ` · ${location}` : ''}</span>;
  if (source === 'website') return <span style={{ ...badge, color: 'var(--ink-3)', borderColor: 'var(--line)', background: 'var(--paper-2)' }}>your website</span>;
  if (source === 'model') return <span style={{ ...badge, color: 'var(--gold-soft)', borderColor: 'var(--line)', background: 'var(--surface)' }}>across your connected sources</span>;
  return <span style={{ ...badge, color: 'var(--gold)', borderColor: 'var(--gold)', background: 'var(--surface)', fontWeight: 600 }}>your website ⋈ your document — a contradiction only you could see</span>;
}

function LineView({ line }: { line: ULine }) {
  const label = line.label.charAt(0).toUpperCase() + line.label.slice(1);
  return (
    <div style={{ margin: '0 0 26px', opacity: 0, animation: 'bbIn 0.9s var(--ease, ease) forwards' }}>
      <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6, color: line.kind === 'inferred' ? 'var(--gold-soft)' : 'var(--ink-3)' }}>{label}</div>
      <div style={say}>{line.text}</div>
      <div style={{ marginTop: 8 }}>
        <SourceBadge source={line.source} doc={line.doc} location={line.location} />
        {line.fragmentIds.map((id) => <span key={id} style={idChip} title={`evidence fragment ${id}`}>{id.slice(0, 10)}…</span>)}
      </div>
    </div>
  );
}

type Phase = 'idle' | 'reading' | 'beat1' | 'deepening' | 'beat2' | 'ended';
const isReflective = (s: UploadCase['state']) => s === 'synced' || s === 'partial';

// backend line shape (ReflectionLine) → UI ULine
interface BLine { label: string; text: string; kind: 'observed' | 'inferred'; fragmentIds: string[] }
const mapUpload = (l: BLine): ULine => { const [doc, location] = l.label.split(' · '); return { label: location || l.label, text: l.text, kind: 'observed', source: 'upload', fragmentIds: l.fragmentIds, doc, location }; };
const mapWebsite = (l: BLine): ULine => ({ label: l.label, text: l.text, kind: 'observed', source: 'website', fragmentIds: l.fragmentIds });
const mapInferred = (l: BLine): ULine => ({ label: l.label, text: l.text, kind: 'inferred', source: 'model', fragmentIds: l.fragmentIds });

export function UploadPreviewPage() {
  const [active, setActive] = useState<UploadCase | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [readIdx, setReadIdx] = useState(0);
  const [beat2Count, setBeat2Count] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const reset = () => { timers.current.forEach(clearTimeout); timers.current = []; setLiveErr(null); };
  useEffect(() => reset, []);

  // ── DEMO replay (fixtures) ────────────────────────────────────────────────
  const run = useCallback((c: UploadCase) => {
    reset();
    setActive(c); setPhase('reading'); setReadIdx(0); setBeat2Count(0);
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
    c.readingLines.forEach((_, i) => at(400 + i * 520, () => setReadIdx(i + 1)));
    const readDone = 400 + c.readingLines.length * 520 + 400;
    at(readDone, () => setPhase(isReflective(c.state) ? 'beat1' : 'ended'));
    if (isReflective(c.state)) {
      if (c.beat2.length) {
        at(readDone + 1400, () => setPhase('deepening'));
        at(readDone + 3200, () => setPhase('beat2'));
        c.beat2.forEach((_, i) => at(readDone + 3200 + i * 900, () => setBeat2Count(i + 1)));
        at(readDone + 3200 + c.beat2.length * 900 + 200, () => setPhase('ended'));
      } else at(readDone + 400, () => setPhase('ended'));
    }
  }, []);

  // ── LIVE upload (real transport: POST multipart → streamed SSE) ────────────
  const onFile = useCallback(async (file: File) => {
    reset();
    const t0 = Date.now();
    const live: UploadCase = { key: 'live', filename: file.name, state: 'reading', readingLines: [], lead: null, beat1: [], beat2: [], handoff: null, message: null, timing: { firstMs: 0, fullMs: 0 } };
    setActive({ ...live }); setPhase('reading'); setReadIdx(0); setBeat2Count(0);
    const patch = (o: Partial<UploadCase>) => setActive((a) => (a ? { ...a, ...o } : a));
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/dev/m22/upload', { method: 'POST', body: fd });
      if (!res.ok || !res.body) { setLiveErr(`upload failed (${res.status})`); setPhase('ended'); patch({ state: 'failed', message: `Upload failed (${res.status}).` }); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = /^event: (.*)$/m.exec(frame)?.[1]; const dt = /^data: (.*)$/m.exec(frame)?.[1];
          if (!ev || dt === undefined) continue;
          let data: unknown; try { data = JSON.parse(dt); } catch { continue; }
          if (ev === 'reading') { const m = (data as { message: string }).message; setActive((a) => (a ? { ...a, readingLines: [...a.readingLines, m] } : a)); setReadIdx((n) => n + 1); }
          else if (ev === 'observed') {
            const b = data as { state: UploadCase['state']; uploadLines: BLine[]; websiteLines: BLine[]; handoff: string | null; message: string | null };
            if (isReflective(b.state)) {
              patch({ state: b.state, lead: "Here's what I can already see:", handoff: b.handoff, message: b.message, timing: { firstMs: Date.now() - t0, fullMs: 0 }, beat1: [...b.uploadLines.map(mapUpload), ...b.websiteLines.map(mapWebsite)] });
              setPhase('beat1'); timers.current.push(window.setTimeout(() => setPhase('deepening'), 1200));
            } else { patch({ state: b.state, message: b.message }); setPhase('ended'); }
          }
          else if (ev === 'inferred') { const lines = (data as BLine[]).map(mapInferred); patch({ beat2: lines }); setPhase('beat2'); lines.forEach((_, i) => timers.current.push(window.setTimeout(() => setBeat2Count(i + 1), i * 600))); }
          else if (ev === 'done') { const d = data as { timing?: { fullMs: number } }; patch({ timing: { firstMs: 0, fullMs: d.timing?.fullMs ?? Date.now() - t0 } }); setPhase('ended'); }
          else if (ev === 'error') { setLiveErr((data as { message: string }).message); patch({ state: 'failed', message: 'Something went wrong reading that file.' }); setPhase('ended'); }
        }
      }
    } catch (e) { setLiveErr(e instanceof Error ? e.message : String(e)); patch({ state: 'failed', message: 'Could not reach the upload endpoint.' }); setPhase('ended'); }
  }, []);

  const uploadObserved = active?.beat1.filter((l) => l.source === 'upload') ?? [];
  const websiteObserved = active?.beat1.filter((l) => l.source === 'website') ?? [];

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 28, color: 'var(--ink-3)' }}>
          DEV · Upload Connector (M2.2). <b>Choose a file → live</b> transport (POST <code>/dev/m22/upload</code> → streamed two-beat). Demo-case chips replay real captured output for the honest states. Beat 2 runs ~110s live.
        </div>

        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>Share a document you already have.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 18 }}>A pitch deck, brand guide, strategy doc, an export from a tool you use — I&apos;ll read it. No forms.</p>

        <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void onFile(f); }}
          style={{ border: `1.5px dashed ${dragOver ? 'var(--gold)' : 'var(--line-2)'}`, background: dragOver ? 'var(--surface)' : 'var(--paper-2)', borderRadius: 12, padding: '28px 22px', textAlign: 'center', marginBottom: 16, transition: 'all .15s ease' }}
        >
          <div style={{ ...serif, fontSize: '1.05rem', color: 'var(--ink-2)', marginBottom: 8 }}>Drop a document here — it uploads for real</div>
          <button onClick={() => fileInput.current?.click()} style={{ fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '10px 20px', cursor: 'pointer' }}>Choose a file</button>
          <div style={{ ...meta, marginTop: 10 }}>PDF · Word · text — kept private to you</div>
        </div>

        <div style={{ ...meta, marginBottom: 34 }}>
          demo cases (replayed):&nbsp;
          {UPLOAD_CASES.map((c) => (
            <button key={c.key} onClick={() => run(c)} style={{ ...idChip, cursor: 'pointer', marginRight: 8, marginBottom: 6 }}>{c.key} · {c.filename}</button>
          ))}
        </div>

        {liveErr && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>live: {liveErr}</div>}

        {active && phase === 'reading' && (
          <div>{active.readingLines.slice(0, readIdx).map((l, i) => <div key={i} style={{ ...say, color: 'var(--ink-2)', fontSize: '1.05rem', opacity: 0, animation: 'bbIn 0.6s ease forwards' }}>{l}</div>)}</div>
        )}

        {active && phase === 'ended' && !isReflective(active.state) && (
          <div style={stateCard}>
            <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--gold)', marginBottom: 10 }}>{active.state}</div>
            {active.message}
            {(active.state === 'empty' || active.state === 'unsupported' || active.state === 'failed') && (
              <div style={{ marginTop: 16 }}>
                <button onClick={() => fileInput.current?.click()} style={{ ...idChip, cursor: 'pointer', padding: '8px 14px', fontSize: '0.8rem' }}>Try another file →</button>
                <div style={{ ...meta, marginTop: 8 }}>an honest next step — never a padded or fabricated read</div>
              </div>
            )}
            {active.state === 'redundant' && <div style={{ ...meta, marginTop: 12, color: 'var(--ink-3)' }}>Shown honestly — your upload duplicated reality I already have, so I didn&apos;t add it twice or pretend it was new.</div>}
          </div>
        )}

        {active && (phase === 'beat1' || phase === 'deepening' || phase === 'beat2' || (phase === 'ended' && isReflective(active.state))) && (
          <div>
            <div style={kicker}>{active.lead}</div>
            {active.state === 'partial' && active.message && <div style={{ ...meta, color: 'var(--ink-3)', marginBottom: 16 }}>{active.message}</div>}

            {uploadObserved.length > 0 && <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--gold)', margin: '4px 0 14px' }}>From your document</div>}
            {uploadObserved.map((line) => <LineView key={`u-${line.label}`} line={line} />)}
            {websiteObserved.length > 0 && <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--ink-3)', margin: '10px 0 14px' }}>From your website</div>}
            {websiteObserved.map((line) => <LineView key={`w-${line.label}`} line={line} />)}

            {active.timing.firstMs > 0 && <div style={{ ...meta, marginTop: -8, marginBottom: 30, color: 'var(--faint)' }}>first grounded reflection in ~{(active.timing.firstMs / 1000).toFixed(1)}s (live)</div>}

            {phase === 'deepening' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '10px 0 20px' }}>
                Reading your document against your website…
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s live — it&apos;s thinking, not lagging</span>
              </div>
            )}

            {(phase === 'beat2' || phase === 'ended') && beat2Count > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={kicker}>What I&apos;m starting to see across the two</div>
                {active.beat2.slice(0, beat2Count).map((line) => <LineView key={`i-${line.label}-${line.text.slice(0, 8)}`} line={line} />)}
              </div>
            )}

            {phase === 'ended' && active.handoff && <div style={{ ...say, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)', color: 'var(--ink)' }}>{active.handoff}</div>}
          </div>
        )}
      </div>
      <style>{`@keyframes bbIn { to { opacity: 1 } }`}</style>
    </div>
  );
}
