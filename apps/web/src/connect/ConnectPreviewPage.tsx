import { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_CASES, type DemoCase, type Line } from './fixtures';

/**
 * M2.1 — Connect Your World, website magic moment (DEV preview).
 *
 * Renders the real two-beat reflection surface:
 *   Beat 1 (observed) — the fast primary moment (~2.5s live).
 *   Beat 2 (inferred) — a DEEPENING that arrives behind it (~110s live), so the wait
 *     reads as the product thinking harder, not as lag.
 * Honest empty/partial/failed states; live "reading" progress; closing handoff.
 *
 * TRANSPORT: this preview replays REAL captured live-run output (see fixtures.ts). The
 * live socket is the dev SSE endpoint `/dev/m21/connect` — written and wired, but it needs
 * the api image rebuilt to run, so it is NOT used here. Nothing is faked as live; the demo
 * pacing is compressed for viewing and the real measured timings are labelled.
 */

const paper = 'var(--paper)';
const wrap: React.CSSProperties = { minHeight: '100vh', background: paper, color: 'var(--ink)', padding: '48px 20px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading, 680px)', margin: '0 auto' };
const serif: React.CSSProperties = { fontFamily: 'var(--serif)' };
const kicker: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.7rem', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold)', fontWeight: 600, margin: '0 0 14px' };
const say: React.CSSProperties = { ...serif, fontSize: '1.25rem', lineHeight: 1.5, color: 'var(--ink)', margin: '0 0 6px' };
const meta: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.72rem', color: 'var(--faint)', letterSpacing: '0.02em' };
const chip: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.66rem', color: 'var(--ink-3)', background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px', marginRight: 6, display: 'inline-block' };

function Provenance({ ids }: { ids: string[] }) {
  return (
    <div style={{ marginTop: 8 }}>
      <span style={{ ...meta, marginRight: 8 }}>read from</span>
      {ids.map((id) => (
        <span key={id} style={chip} title={`evidence fragment ${id}`}>{id.slice(0, 10)}…</span>
      ))}
    </div>
  );
}

function ReflectionLineView({ line }: { line: Line }) {
  const label = line.label.charAt(0).toUpperCase() + line.label.slice(1);
  return (
    <div style={{ margin: '0 0 26px', opacity: 0, animation: 'bbIn 0.9s var(--ease, ease) forwards' }}>
      <div style={{ ...meta, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6, color: line.kind === 'inferred' ? 'var(--gold-soft)' : 'var(--ink-3)' }}>{label}</div>
      <div style={say}>{line.text}</div>
      <Provenance ids={line.fragmentIds} />
    </div>
  );
}

type Phase = 'idle' | 'reading' | 'beat1' | 'deepening' | 'beat2' | 'ended';

export function ConnectPreviewPage() {
  const [active, setActive] = useState<DemoCase | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [readIdx, setReadIdx] = useState(0);
  const [beat2Count, setBeat2Count] = useState(0);
  const [url, setUrl] = useState('');
  const timers = useRef<number[]>([]);

  const reset = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => reset, []);

  const run = useCallback((c: DemoCase) => {
    reset();
    setActive(c); setPhase('reading'); setReadIdx(0); setBeat2Count(0);
    const at = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };
    // Live "reading" progress (honest: real page paths from the run).
    c.readingLines.forEach((_, i) => at(500 + i * 550, () => setReadIdx(i + 1)));
    const readDone = 500 + c.readingLines.length * 550 + 400;
    // Beat 1 (or honest empty/failed) lands.
    at(readDone, () => setPhase(c.state === 'synced' || c.state === 'partial' ? 'beat1' : 'ended'));
    if (c.state === 'synced' || c.state === 'partial') {
      at(readDone + 1400, () => setPhase('deepening'));           // the deepening beat
      at(readDone + 3200, () => setPhase('beat2'));               // inferred begins streaming
      c.beat2.forEach((_, i) => at(readDone + 3200 + i * 900, () => setBeat2Count(i + 1)));
      at(readDone + 3200 + c.beat2.length * 900 + 200, () => setPhase('ended'));
    }
  }, []);

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ ...meta, border: '1px solid var(--line-2)', borderRadius: 8, padding: '8px 12px', marginBottom: 28, color: 'var(--ink-3)' }}>
          DEV · Connect Your World (M2.1). Rendered from <b>real captured live-run output</b>. Live transport (SSE <code>/dev/m21/connect</code>) is wired but needs the api rebuild — not used here. Demo pacing compressed; real timings labelled.
        </div>

        <h1 style={{ ...serif, fontSize: '1.6rem', fontWeight: 500, letterSpacing: '-0.01em', marginBottom: 6 }}>Point me at where your business lives.</h1>
        <p style={{ ...meta, fontSize: '0.85rem', color: 'var(--ink-2)', marginBottom: 18 }}>Enter your website and I&apos;ll read it — no forms, no questions yet.</p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            value={url} onChange={(e) => setUrl(e.target.value)} placeholder="yourbusiness.com"
            style={{ flex: 1, minWidth: 220, background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 10, color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.05rem', padding: '12px 14px', outline: 'none' }}
          />
          <button
            onClick={() => run(DEMO_CASES[0]!)}
            style={{ fontFamily: 'var(--sans)', fontWeight: 500, background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 10, padding: '12px 22px', cursor: 'pointer' }}
          >Read my site</button>
        </div>
        <div style={{ ...meta, marginBottom: 34 }}>
          demo cases:&nbsp;
          {DEMO_CASES.map((c) => (
            <button key={c.key} onClick={() => run(c)}
              style={{ ...chip, cursor: 'pointer', marginRight: 8 }}>{c.key} · {c.url.replace('https://', '')}</button>
          ))}
        </div>

        {active && phase === 'reading' && (
          <div>
            {active.readingLines.slice(0, readIdx).map((l, i) => (
              <div key={i} style={{ ...say, color: 'var(--ink-2)', fontSize: '1.05rem', opacity: 0, animation: 'bbIn 0.6s ease forwards' }}>{l}</div>
            ))}
          </div>
        )}

        {active && (phase === 'ended') && active.state !== 'synced' && active.state !== 'partial' && (
          <div style={{ ...serif, fontSize: '1.2rem', lineHeight: 1.55, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 12, padding: '22px 24px', boxShadow: 'var(--shadow-soft)' }}>
            {active.message}
            {active.state === 'empty' && (
              <div style={{ marginTop: 16 }}>
                <button style={{ ...chip, cursor: 'pointer', padding: '8px 14px', fontSize: '0.8rem' }} title="upload lane — later slice">Upload a page or doc instead →</button>
                <div style={{ ...meta, marginTop: 8 }}>upload lane is a later slice — shown as the honest next step, never a padded read</div>
              </div>
            )}
          </div>
        )}

        {active && (phase === 'beat1' || phase === 'deepening' || phase === 'beat2' || (phase === 'ended' && (active.state === 'synced' || active.state === 'partial'))) && (
          <div>
            <div style={kicker}>{active.lead}</div>
            {active.state === 'partial' && <div style={{ ...meta, color: 'var(--warn-ink)', marginBottom: 16 }}>Some pages didn&apos;t load cleanly — here&apos;s what I&apos;ve got so far.</div>}
            {active.beat1.map((line) => <ReflectionLineView key={line.label} line={line} />)}
            <div style={{ ...meta, marginTop: -8, marginBottom: 30, color: 'var(--faint)' }}>first grounded reflection in ~{(active.timing.firstMs / 1000).toFixed(1)}s (live)</div>

            {phase === 'deepening' && (
              <div style={{ ...meta, ...serif, fontStyle: 'italic', fontSize: '1rem', color: 'var(--gold)', margin: '10px 0 20px' }}>
                Reading between your pages…
                <span style={{ ...meta, fontStyle: 'normal', display: 'block', marginTop: 4 }}>the deeper read takes ~110s live — it&apos;s thinking, not lagging</span>
              </div>
            )}

            {(phase === 'beat2' || phase === 'ended') && beat2Count > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={kicker}>What I&apos;m starting to see underneath</div>
                {active.beat2.slice(0, beat2Count).map((line) => <ReflectionLineView key={line.label + line.text.slice(0, 8)} line={line} />)}
              </div>
            )}

            {phase === 'ended' && active.handoff && (
              <div style={{ ...say, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--line)', color: 'var(--ink)' }}>{active.handoff}</div>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes bbIn { to { opacity: 1 } }`}</style>
    </div>
  );
}
