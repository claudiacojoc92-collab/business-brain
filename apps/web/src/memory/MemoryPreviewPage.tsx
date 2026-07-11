import { useCallback, useEffect, useState } from 'react';
import { createSSEParser } from '../upload/sse';
import { founderCategory } from '../copy/vocabulary';

/**
 * Business Memory v1 (DEV preview) — the C→B response loop. On load it shows the current "what
 * matters now" with any PRIOR responses folded in (the "still knows me" half). Respond to a tension
 * (this matters / already handled / here's the missing context + optional text) → the response
 * becomes `declared` evidence and recompute RE-RUNS → the page shows BEFORE vs AFTER, so you can see
 * the reflection change because of what you said. Reuses the U+2028-safe SSE reader.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: '980px', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const say: React.CSSProperties = { ...serif, fontSize: '1.15rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const idChip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.62rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };
const btn = (active: boolean): React.CSSProperties => ({ fontFamily: 'var(--sans)', fontSize: '0.82rem', fontWeight: 500, padding: '7px 12px', borderRadius: 8, marginRight: 8, marginTop: 8, cursor: 'pointer',
  border: '1px solid ' + (active ? 'var(--gold-soft)' : 'var(--line)'), background: active ? 'var(--surface)' : 'var(--paper-2)', color: active ? 'var(--gold)' : 'var(--ink-2)' });

type Mark = 'new' | 'recurring' | 'addressed' | 'resolved';
interface WMItem { rank: number; tensionId: string; category: string; statement: string; stakes: string; declaredFragmentIds: string[]; observedFragmentIds: string[]; response?: { choice: string; text: string }; mark?: Mark; recurrenceCount?: number }
interface FollowUp { tensionId: string; category: string; statement: string; recurrenceCount: number; framing: string; ask: string }
const MARK_STYLE: Record<Mark, React.CSSProperties> = {
  new:       { color: 'var(--ink-2)', background: 'var(--paper-2)', border: '1px solid var(--line)' },
  recurring: { color: 'var(--gold)', background: 'var(--gold-bg)', border: '1px solid var(--gold-soft)' },
  addressed: { color: 'var(--ink-3)', background: 'var(--surface)', border: '1px solid var(--line-2)' },
  resolved:  { color: 'var(--ink-3)', background: 'var(--surface)', border: '1px solid var(--line-2)' },
};
function MarkBadge({ mark, count }: { mark?: Mark; count?: number }) {
  if (!mark) return null;
  const label = mark === 'recurring' && count && count > 1 ? `recurring ·${count}×` : mark;
  return <span style={{ fontFamily: 'var(--sans)', fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', borderRadius: 20, padding: '2px 9px', marginLeft: 10, ...MARK_STYLE[mark] }}>{label}</span>;
}
const CHOICES: Array<{ key: string; label: string }> = [
  { key: 'matters', label: 'This matters' }, { key: 'handled', label: 'Already handled' }, { key: 'context', label: "Here's the missing context" },
];
const choiceLabel = (c: string) => CHOICES.find((x) => x.key === c)?.label ?? c;

function TensionRow({ item, prominent }: { item: WMItem; prominent?: boolean }) {
  const card: React.CSSProperties = prominent
    ? { background: 'var(--surface)', border: '1px solid var(--gold-soft)', borderRadius: 12, padding: '18px 20px', marginBottom: 12, boxShadow: 'var(--shadow-soft)' }
    : { borderLeft: '2px solid var(--line-2)', padding: '4px 0 10px 14px', marginBottom: 12, opacity: 0.94 };
  return (
    <div style={card}>
      <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--gold-soft)', marginBottom: 6 }}>
        {item.rank === 1 ? 'Highest-stakes gap' : `Gap #${item.rank}`} · {founderCategory(item.category)}
        <MarkBadge mark={item.mark} count={item.recurrenceCount} />
      </div>
      <div style={{ ...say, fontSize: prominent ? '1.2rem' : '1.05rem', ...(item.mark === 'resolved' ? { color: 'var(--ink-3)', textDecoration: 'line-through' } : {}) }}>{item.statement}</div>
      <div style={{ ...meta, fontStyle: 'italic', color: 'var(--gold)', marginTop: 6 }}>{item.stakes}</div>
      <div style={{ marginTop: 8 }}>
        <span style={{ ...idChip, color: 'var(--gold)', borderColor: 'var(--gold-soft)' }}>you said</span>
        {item.declaredFragmentIds.map((id) => <span key={id} style={idChip} title={id}>{id.slice(0, 8)}…</span>)}
        <span style={{ ...idChip, color: 'var(--ink-3)', marginLeft: 6 }}>observed</span>
        {item.observedFragmentIds.map((id) => <span key={id} style={idChip} title={id}>{id.slice(0, 8)}…</span>)}
      </div>
      {item.response && (
        <div style={{ ...meta, marginTop: 10, color: 'var(--gold)', background: 'var(--gold-bg)', border: '1px solid var(--gold-soft)', borderRadius: 8, padding: '6px 10px' }}>
          You responded: <b>{choiceLabel(item.response.choice)}</b>{item.response.text ? ` — ${item.response.text.replace(/^On the tension.*?—\s*/i, '')}` : ''}
        </div>
      )}
    </div>
  );
}

export function MemoryPreviewPage() {
  const [state, setState] = useState<WMItem[]>([]);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [before, setBefore] = useState<WMItem[]>([]);
  const [after, setAfter] = useState<WMItem[]>([]);
  const [phase, setPhase] = useState<'idle' | 'responding' | 'done'>('idle');
  const [progress, setProgress] = useState<string[]>([]);
  const [text, setText] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try { const r = await fetch('/dev/memory/state' + window.location.search); if (r.ok) { const j = await r.json(); setState((j.whatMattersNow ?? []) as WMItem[]); setFollowUp((j.followUp ?? null) as FollowUp | null); } } catch { /* offline */ }
  }, []);
  useEffect(() => { void loadState(); }, [loadState]);

  const respond = useCallback(async (item: WMItem, choice: string) => {
    setErr(null); setBefore([]); setAfter([]); setProgress([]); setPhase('responding');
    try {
      const res = await fetch('/dev/memory/respond', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tensionId: item.tensionId, tensionStatement: item.statement, choice, text: text[item.tensionId] }) });
      if (!res.ok || !res.body) { setErr(`respond failed (${res.status})`); setPhase('done'); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); const parser = createSSEParser();
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        for (const { event: ev, data: dt } of parser.feed(dec.decode(value, { stream: true }))) {
          if (!ev || dt === undefined) continue;
          let data: unknown; try { data = JSON.parse(dt); } catch { continue; }
          if (ev === 'before') setBefore(data as WMItem[]);
          else if (ev === 'reading') setProgress((p) => [...p, (data as { message: string }).message]);
          else if (ev === 'after') setAfter(data as WMItem[]);
          else if (ev === 'done') { setPhase('done'); void loadState(); }
          else if (ev === 'error') { setErr((data as { message: string }).message); setPhase('done'); }
        }
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setPhase('done'); }
  }, [text, loadState]);

  const Column = ({ title, items, note }: { title: string; items: WMItem[]; note?: string }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={kicker}>{title}</div>
      {note && <div style={{ ...meta, marginBottom: 10 }}>{note}</div>}
      {items.length === 0 ? <div style={{ ...meta, fontStyle: 'italic' }}>—</div> : items.map((it) => <TensionRow key={`${title}-${it.tensionId}`} item={it} prominent={it.rank === 1} />)}
    </div>
  );

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 24, color: 'var(--ink-3)' }}>
          DEV · Business Memory v1 — the response loop. Respond to a gap and I <b>re-think</b> it against what you told me. Your response becomes evidence I keep. Re-run takes ~110s.
        </div>
        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>What matters now — and what you said about it.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 22 }}>These are the gaps between what you told me and what I&apos;ve seen. Tell me where each stands.</p>

        {err && <div style={{ ...meta, color: 'var(--gold)', marginBottom: 14 }}>error: {err}</div>}

        {phase === 'idle' && followUp && (
          <div style={{ background: 'var(--gold-bg)', border: '1px solid var(--gold-soft)', borderRadius: 12, padding: '16px 18px', marginBottom: 22 }}>
            <div style={{ ...kicker, color: 'var(--gold)', marginBottom: 8 }}>Picking up where we left off</div>
            <div style={{ ...serif, fontSize: '1.1rem', lineHeight: 1.5, marginBottom: 8 }}>{followUp.framing}</div>
            <div style={{ ...say, fontSize: '1.05rem', margin: '0 0 8px' }}>&ldquo;{followUp.statement}&rdquo;</div>
            <div style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)' }}>{followUp.ask}</div>
          </div>
        )}

        {phase === 'idle' && (
          state.length === 0
            ? <div style={{ ...serif, fontSize: '1.15rem', color: 'var(--ink-2)' }}>No grounded gaps yet — capture your intent on the declared page first, then come back.</div>
            : <div>
                {state.map((it) => (
                  <div key={it.tensionId}>
                    <TensionRow item={it} prominent={it.rank === 1} />
                    <div style={{ marginLeft: it.rank === 1 ? 0 : 14, marginTop: -4, marginBottom: 18 }}>
                      {CHOICES.map((c) => <button key={c.key} style={btn(it.response?.choice === c.key)} onClick={() => void respond(it, c.key)}>{c.label}</button>)}
                      <input value={text[it.tensionId] ?? ''} onChange={(e) => setText((t) => ({ ...t, [it.tensionId]: e.target.value }))}
                        placeholder="optional: a sentence of context…" style={{ display: 'block', width: '100%', maxWidth: 520, marginTop: 8, fontFamily: 'var(--sans)', fontSize: '0.85rem', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line)', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                ))}
              </div>
        )}

        {(phase === 'responding' || phase === 'done') && (
          <div>
            {phase === 'responding' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '4px 0 18px' }}>
                {progress[progress.length - 1] ?? 'Rethinking…'}
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s — it&apos;s thinking, not lagging</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 28, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Column title="Before your response" items={before} note="what mattered before you spoke" />
              <div style={{ width: 1, background: 'var(--line)', alignSelf: 'stretch' }} />
              <Column title="After — I re-thought it" items={after} note={phase === 'responding' ? 'thinking…' : 'now reflecting what you told me'} />
            </div>
            {phase === 'done' && <button style={{ ...btn(false), marginTop: 20 }} onClick={() => { setPhase('idle'); void loadState(); }}>← back to all gaps</button>}
          </div>
        )}
      </div>
    </div>
  );
}
