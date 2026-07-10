import { useCallback, useEffect, useState } from 'react';
import { createSSEParser } from '../upload/sse';
import { founderCategory } from '../copy/vocabulary';

/**
 * Calendar Source (behavior dimension) — founder-facing surface (DEV preview). The founder
 * re-consents ONCE to add the calendar scope on the EXISTING Google flow (incremental auth), then
 * reads their calendar: timed events become TIME-ALLOCATION PATTERNS (observed behavior), which fuse
 * with declared intent to surface the TIME-VS-INTENT tension in "what matters now" ("you told me X is
 * the priority, your calendar shows time on Y"). Observed behavior — never a claim about what the
 * business is. Reuses the two-beat render, the what-matters head, and the U+2028-safe SSE reader.
 *
 * Reversible defaults (noted): 60-day window, bucket heuristic, render format.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading, 680px)', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const say: React.CSSProperties = { ...serif, fontSize: '1.25rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const idChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };
const btn: React.CSSProperties = { fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '11px 22px', cursor: 'pointer' };

interface BLine { label: string; text: string; kind: 'observed' | 'inferred' | 'declared'; fragmentIds: string[] }
interface WMItem { rank: number; category: string; statement: string; stakes: string; fragmentIds: string[]; declaredFragmentIds: string[]; observedFragmentIds: string[] }
type Phase = 'idle' | 'reading' | 'beat1' | 'deepening' | 'beat2' | 'ended';

function Badge({ kind }: { kind: BLine['kind'] }) {
  const base: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.64rem', letterSpacing: '0.04em', borderRadius: 6, padding: '2px 8px', marginRight: 6, display: 'inline-block', border: '1px solid' };
  if (kind === 'declared') return <span style={{ ...base, color: 'var(--gold)', borderColor: 'var(--gold-soft)', background: 'var(--surface)' }}>you said</span>;
  if (kind === 'inferred') return <span style={{ ...base, color: 'var(--gold-soft)', borderColor: 'var(--line)', background: 'var(--surface)' }}>across your sources</span>;
  return <span style={{ ...base, color: 'var(--ink-3)', borderColor: 'var(--line)', background: 'var(--paper-2)' }}>observed</span>;
}

function Line({ line }: { line: BLine }) {
  const label = line.label.charAt(0).toUpperCase() + line.label.slice(1);
  return (
    <div style={{ margin: '0 0 26px', opacity: 0, animation: 'bbIn 0.9s var(--ease, ease) forwards' }}>
      <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6, color: line.kind === 'observed' ? 'var(--ink-3)' : 'var(--gold-soft)' }}>{label}</div>
      <div style={say}>{line.text}</div>
      <div style={{ marginTop: 8 }}>
        <Badge kind={line.kind} />
        {line.fragmentIds.map((id) => <span key={id} style={idChip} title={`evidence fragment ${id}`}>{id.slice(0, 10)}…</span>)}
      </div>
    </div>
  );
}

export function CalendarPreviewPage() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [reading, setReading] = useState<string[]>([]);
  const [calendarLines, setCalendarLines] = useState<BLine[]>([]);
  const [declaredLines, setDeclaredLines] = useState<BLine[]>([]);
  const [inferred, setInferred] = useState<BLine[]>([]);
  const [whatMatters, setWhatMatters] = useState<WMItem[]>([]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [emptyMsg, setEmptyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { const r = await fetch('/dev/google/status'); if (r.ok) setConnected(Boolean((await r.json()).connected)); } catch { setConnected(false); }
    })();
  }, []);

  const read = useCallback(async () => {
    setErr(null); setReading([]); setCalendarLines([]); setDeclaredLines([]); setInferred([]); setWhatMatters([]); setHandoff(null); setEmptyMsg(null);
    setPhase('reading');
    try {
      const res = await fetch('/dev/google/read-calendar', { method: 'POST' });
      if (!res.ok || !res.body) { setErr(`read failed (${res.status})`); setPhase('ended'); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); const parser = createSSEParser();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        for (const { event: ev, data: dt } of parser.feed(dec.decode(value, { stream: true }))) {
          if (!ev || dt === undefined) continue;
          let data: unknown; try { data = JSON.parse(dt); } catch { continue; }
          if (ev === 'reading') setReading((r) => [...r, (data as { message: string }).message]);
          else if (ev === 'observed') {
            const b = data as { state: string; calendarLines: BLine[]; declaredLines: BLine[]; handoff: string | null; message: string | null };
            if (b.state === 'synced') { setCalendarLines(b.calendarLines); setDeclaredLines(b.declaredLines); setHandoff(b.handoff); setPhase('beat1'); setTimeout(() => setPhase('deepening'), 1200); }
            else { setEmptyMsg(b.message); setPhase('ended'); }
          }
          else if (ev === 'inferred') { setInferred(data as BLine[]); setPhase('beat2'); }
          else if (ev === 'matters') { setWhatMatters(data as WMItem[]); }
          else if (ev === 'done') { setPhase('ended'); }
          else if (ev === 'error') { setErr((data as { message: string }).message); setPhase('ended'); }
        }
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('ended'); }
  }, []);

  const busy = phase === 'reading' || phase === 'deepening';

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 28, color: 'var(--ink-3)' }}>
          DEV · Calendar Source — the <b>behavior dimension</b>. Your calendar shows how you spend <b>time</b>; fused with your declared intent it surfaces the <b>time-vs-intent</b> gap. Observed behavior, not a claim about what your business is. Beat 2 runs ~110s.
        </div>
        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>Where does your time actually go?</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 18 }}>Connect your Google Calendar (one extra consent on your existing Google connection). I read only event titles and times over the last 60 days — patterns, not surveillance.</p>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 28, flexWrap: 'wrap' }}>
          <a href="/dev/google/connect" style={{ ...btn, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', textDecoration: 'none' }}>
            {connected ? 'Re-consent to add Calendar' : 'Connect Google (with Calendar)'}
          </a>
          <button onClick={() => void read()} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>Read my calendar</button>
          <span style={{ ...meta, color: connected ? 'var(--ink-3)' : 'var(--gold)' }}>{connected == null ? '' : connected ? 'Google connected' : 'not connected'}</span>
        </div>

        {err && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>error: {err}</div>}
        {phase === 'reading' && reading.map((l, i) => <div key={i} style={{ ...say, color: 'var(--ink-2)', fontSize: '1.05rem' }}>{l}</div>)}
        {phase === 'ended' && emptyMsg && <div style={{ ...serif, fontSize: '1.2rem', color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '22px 24px' }}>{emptyMsg}</div>}

        {(phase === 'beat1' || phase === 'deepening' || phase === 'beat2' || phase === 'ended') && calendarLines.length > 0 && (
          <div>
            {whatMatters.length > 0 && (
              <div style={{ marginBottom: 30 }}>
                <div style={{ ...kicker, color: 'var(--gold)' }}>What matters now</div>
                {whatMatters.map((w, i) => (
                  <div key={`wm-${w.rank}`} style={i === 0
                    ? { background: 'var(--surface)', border: '1px solid var(--gold-soft)', borderRadius: 12, padding: '20px 22px', marginBottom: 14, boxShadow: 'var(--shadow-soft)' }
                    : { borderLeft: '2px solid var(--line-2)', padding: '4px 0 4px 14px', marginBottom: 12, opacity: 0.92 }}>
                    <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold-soft)', marginBottom: 6 }}>{w.rank === 1 ? 'Highest-stakes gap' : `Gap #${w.rank}`} · {founderCategory(w.category)}</div>
                    <div style={{ ...say, fontSize: i === 0 ? '1.3rem' : '1.1rem' }}>{w.statement}</div>
                    <div style={{ ...meta, fontStyle: 'italic', color: 'var(--gold)', marginTop: 6 }}>{w.stakes}</div>
                    <div style={{ marginTop: 8 }}>
                      <span style={{ ...idChip, color: 'var(--gold)', borderColor: 'var(--gold-soft)' }}>you said</span>
                      {w.declaredFragmentIds.map((id) => <span key={id} style={idChip} title={`declared fragment ${id}`}>{id.slice(0, 10)}…</span>)}
                      <span style={{ ...idChip, color: 'var(--ink-3)', marginLeft: 6 }}>your time</span>
                      {w.observedFragmentIds.map((id) => <span key={id} style={idChip} title={`observed calendar fragment ${id}`}>{id.slice(0, 10)}…</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={kicker}>What your time shows</div>
            {calendarLines.map((l) => <Line key={`c-${l.label}`} line={l} />)}
            {declaredLines.length > 0 && <div style={{ ...kicker, color: 'var(--gold-soft)', marginTop: 18 }}>What you told me you&apos;re building</div>}
            {declaredLines.map((l) => <Line key={`d-${l.label}`} line={l} />)}

            {phase === 'deepening' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '10px 0 20px' }}>
                Reading your time against your intent…
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s — it&apos;s thinking, not lagging</span>
              </div>
            )}
            {(phase === 'beat2' || phase === 'ended') && inferred.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={kicker}>Where your time and your intent pull apart</div>
                {inferred.map((l) => <Line key={`i-${l.label}-${l.text.slice(0, 8)}`} line={l} />)}
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
