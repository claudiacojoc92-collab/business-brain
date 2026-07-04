import { useCallback, useEffect, useState } from 'react';
import { createSSEParser } from '../upload/sse';

/**
 * Capability B v1 — Be Understood (declared intent capture), founder-facing surface (DEV preview).
 * One structured conversation: ~6 fixed questions (one per field), free-text answers. Each answer
 * becomes `declared` evidence; the reflection then shows what you TOLD me (declared) alongside what
 * I've SEEN (observed: website/upload/google) and, in Beat 2, where they pull apart. Declared is
 * always attributed as declared ("you told me"), never as observed truth. Reuses the M2.2 two-beat
 * render + the U+2028-safe SSE reader.
 *
 * Reversible defaults (noted): question wording/order, one-shot (not resumable), UI feel.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading, 680px)', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const say: React.CSSProperties = { ...serif, fontSize: '1.25rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const idChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };

interface Field { key: string; label: string; question: string }
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

export function DeclaredPreviewPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [reading, setReading] = useState<string[]>([]);
  const [declaredLines, setDeclaredLines] = useState<BLine[]>([]);
  const [observedLines, setObservedLines] = useState<BLine[]>([]);
  const [inferred, setInferred] = useState<BLine[]>([]);
  const [whatMatters, setWhatMatters] = useState<WMItem[]>([]);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [emptyMsg, setEmptyMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try { const r = await fetch('/dev/declared/questions'); if (r.ok) setFields((await r.json()).fields ?? []); } catch { /* offline */ }
    })();
  }, []);

  const submit = useCallback(async () => {
    const payload = fields.map((f) => ({ field: f.key, text: (answers[f.key] ?? '').trim() })).filter((a) => a.text);
    setErr(null); setReading([]); setDeclaredLines([]); setObservedLines([]); setInferred([]); setWhatMatters([]); setHandoff(null); setEmptyMsg(null);
    setPhase('reading');
    try {
      const res = await fetch('/dev/declared/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: payload }) });
      if (!res.ok || !res.body) { setErr(`submit failed (${res.status})`); setPhase('ended'); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); const parser = createSSEParser();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        for (const { event: ev, data: dt } of parser.feed(dec.decode(value, { stream: true }))) {
          if (!ev || dt === undefined) continue;
          let data: unknown; try { data = JSON.parse(dt); } catch { continue; }
          if (ev === 'reading') setReading((r) => [...r, (data as { message: string }).message]);
          else if (ev === 'observed') {
            const b = data as { state: string; declaredLines: BLine[]; observedLines: BLine[]; handoff: string | null; message: string | null };
            if (b.state === 'synced') { setDeclaredLines(b.declaredLines); setObservedLines(b.observedLines); setHandoff(b.handoff); setPhase('beat1'); setTimeout(() => setPhase('deepening'), 1200); }
            else { setEmptyMsg(b.message); setPhase('ended'); }
          }
          else if (ev === 'inferred') { setInferred(data as BLine[]); setPhase('beat2'); }
          else if (ev === 'matters') { setWhatMatters(data as WMItem[]); }
          else if (ev === 'done') { setPhase('ended'); }
          else if (ev === 'error') { setErr((data as { message: string }).message); setPhase('ended'); }
        }
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('ended'); }
  }, [fields, answers]);

  const busy = phase === 'reading' || phase === 'deepening';

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 28, color: 'var(--ink-3)' }}>
          DEV · Capability B v1 — Be Understood. Answer ~6 questions → your <b>declared intent</b> becomes evidence and fuses with what I&apos;ve observed (website/upload/Google). Beat 2 runs ~110s.
        </div>
        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>Now tell me the part your documents can&apos;t.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 18 }}>Your website and docs show what you&apos;ve made. These show what you&apos;re trying to build. In your own words — short is fine.</p>

        {fields.map((f) => (
          <div key={f.key} style={{ marginBottom: 16 }}>
            <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold-soft)', marginBottom: 6 }}>{f.label}</div>
            <div style={{ ...serif, fontSize: '1.05rem', color: 'var(--ink)', marginBottom: 8 }}>{f.question}</div>
            <textarea value={answers[f.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))} rows={2}
              style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '0.95rem', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)', boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
        ))}
        <button onClick={() => void submit()} disabled={busy || fields.length === 0} style={{ fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '11px 22px', cursor: 'pointer', opacity: busy ? 0.6 : 1, marginBottom: 28 }}>Tell me</button>

        {err && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>error: {err}</div>}
        {phase === 'reading' && reading.map((l, i) => <div key={i} style={{ ...say, color: 'var(--ink-2)', fontSize: '1.05rem' }}>{l}</div>)}
        {phase === 'ended' && emptyMsg && <div style={{ ...serif, fontSize: '1.2rem', color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '22px 24px' }}>{emptyMsg}</div>}

        {(phase === 'beat1' || phase === 'deepening' || phase === 'beat2' || phase === 'ended') && declaredLines.length > 0 && (
          <div>
            {whatMatters.length > 0 && (
              <div style={{ marginBottom: 30 }}>
                <div style={{ ...kicker, color: 'var(--gold)' }}>What matters now</div>
                {whatMatters.map((w, i) => (
                  <div key={`wm-${w.rank}`} style={i === 0
                    ? { background: 'var(--surface)', border: '1px solid var(--gold-soft)', borderRadius: 12, padding: '20px 22px', marginBottom: 14, boxShadow: 'var(--shadow-soft)' }
                    : { borderLeft: '2px solid var(--line-2)', padding: '4px 0 4px 14px', marginBottom: 12, opacity: 0.92 }}>
                    <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold-soft)', marginBottom: 6 }}>{w.rank === 1 ? 'Highest-stakes tension' : `Tension #${w.rank}`} · {w.category}</div>
                    <div style={{ ...say, fontSize: i === 0 ? '1.3rem' : '1.1rem' }}>{w.statement}</div>
                    <div style={{ ...meta, fontStyle: 'italic', color: 'var(--gold)', marginTop: 6 }}>{w.stakes}</div>
                    <div style={{ marginTop: 8 }}>
                      <span style={{ ...idChip, color: 'var(--gold)', borderColor: 'var(--gold-soft)' }}>you said</span>
                      {w.declaredFragmentIds.map((id) => <span key={id} style={idChip} title={`declared fragment ${id}`}>{id.slice(0, 10)}…</span>)}
                      <span style={{ ...idChip, color: 'var(--ink-3)', marginLeft: 6 }}>observed</span>
                      {w.observedFragmentIds.map((id) => <span key={id} style={idChip} title={`observed fragment ${id}`}>{id.slice(0, 10)}…</span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={kicker}>What you told me</div>
            {declaredLines.map((l) => <Line key={`d-${l.label}`} line={l} />)}
            {observedLines.length > 0 && <div style={{ ...kicker, color: 'var(--ink-3)', marginTop: 18 }}>What I&apos;ve already seen</div>}
            {observedLines.map((l, i) => <Line key={`o-${i}`} line={l} />)}

            {phase === 'deepening' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '10px 0 20px' }}>
                Reading your intent against your evidence…
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s — it&apos;s thinking, not lagging</span>
              </div>
            )}
            {(phase === 'beat2' || phase === 'ended') && inferred.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={kicker}>Where your intent and your evidence pull apart</div>
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
