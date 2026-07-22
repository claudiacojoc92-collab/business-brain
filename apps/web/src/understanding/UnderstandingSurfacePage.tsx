import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getEffectiveUnderstanding, getUnderstandingItemHistory, correctUnderstanding, ApiError,
  TRUTH_LABEL_TEXT, type EffectiveUnderstanding, type EffectiveUnderstandingItem, type UnderstandingItemHistory, type TruthLabel,
} from '../api/client';
import { AppShell, Button, Thinking } from '../system/ui';

/**
 * The founder-facing Understanding surface — the accumulated, effective picture of the business, in plain language. It shows
 * current items (with the five truth labels), open unknowns, unresolved disagreements, and changes recently accepted from
 * clarity conversations. A founder can inspect an item's origin/history, correct it (a correction supersedes without
 * rewriting history), or start a contextual clarity conversation. No internal terminology is shown.
 */
export function UnderstandingSurfacePage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<EffectiveUnderstanding | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null); // itemId being corrected
  const [draft, setDraft] = useState('');
  const [history, setHistory] = useState<Record<string, UnderstandingItemHistory[]>>({});

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setData(await getEffectiveUnderstanding()); }
    catch (e) { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); else setError('Could not load your understanding.'); }
    finally { setBusy(false); }
  }, [navigate]);
  useEffect(() => { if (founderId) void load(); }, [founderId, load]);

  const toggleHistory = async (id: string) => {
    if (history[id]) { setHistory((h) => { const n = { ...h }; delete n[id]; return n; }); return; }
    try { setHistory((h) => ({ ...h, [id]: [] })); const chain = await getUnderstandingItemHistory(id); setHistory((h) => ({ ...h, [id]: chain })); }
    catch { /* founder-governed items only have history; ignore for synthesized */ }
  };
  const saveCorrection = async (item: EffectiveUnderstandingItem) => {
    const statement = draft.trim(); if (statement.length < 2) return;
    try {
      await correctUnderstanding(item.source === 'founder' ? { supersedesItemId: item.id, statement } : { conclusionRef: item.id, statement });
      setCorrecting(null); setDraft(''); await load();
    } catch { setError('Could not save that correction just now.'); }
  };

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={backBtn}>Home</button>}>
      <div data-testid="understanding-surface">
        <p style={eyebrow}>Your business, as I understand it</p>
        <h1 style={h1}>What we currently know — and what we don’t</h1>
        <p style={lede}>This is the picture we’ve built together. Some of it I read or inferred; some you told me or corrected. You can change anything here — a correction never erases the earlier version.</p>

        {busy && <Thinking message="Gathering what we know…" />}
        {error && <p style={{ ...meta, color: 'var(--err-ink, #a3423c)', marginTop: 'var(--sp-3)' }}>{error}</p>}

        {data && (
          <>
            <Section title="What we currently understand" testid="current" empty="Nothing yet — start by talking something through.">
              {data.current.map((i) => (
                <Item key={`${i.origin}-${i.id}`} item={i}
                  correcting={correcting === i.id} draft={draft} setDraft={setDraft}
                  onCorrect={() => { setCorrecting(i.id); setDraft(i.statement); }} onCancel={() => setCorrecting(null)}
                  onSave={() => void saveCorrection(i)} onHistory={() => void toggleHistory(i.id)} history={history[i.id]} />
              ))}
            </Section>

            {data.unknowns.length > 0 && (
              <Section title="What we still don’t know" testid="unknowns" empty="">
                <ul style={ul} data-testid="unknowns-list">{data.unknowns.map((u, n) => <li key={n} style={li}>{u}</li>)}</ul>
              </Section>
            )}

            {data.disagreements.length > 0 && (
              <Section title="Still unresolved / where we disagree" testid="disagreements" empty="">
                {data.disagreements.map((i) => <p key={i.id} data-testid="disagreement" style={li}><span style={labelTag(i.label)}>{TRUTH_LABEL_TEXT[i.label]}</span> {i.statement}</p>)}
              </Section>
            )}

            {data.recentlyAccepted.length > 0 && (
              <Section title="Recently added from a clarity conversation" testid="recently-accepted" empty="">
                {data.recentlyAccepted.map((i) => <p key={i.id} data-testid="recent-item" style={li}><span style={labelTag(i.label)}>{TRUTH_LABEL_TEXT[i.label]}</span> {i.statement}</p>)}
              </Section>
            )}

            <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
              <Button variant="primary" onClick={() => navigate('/clarity')}><span data-testid="talk-this-through">Talk something through →</span></Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Section({ title, testid, empty, children }: { title: string; testid: string; empty: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section data-testid={`section-${testid}`} style={{ ...card, marginTop: 'var(--sp-4)' }}>
      <p style={sectionKind}>{title}</p>
      {has ? children : (empty ? <p style={quiet}>{empty}</p> : null)}
    </section>
  );
}

function Item({ item, correcting, draft, setDraft, onCorrect, onCancel, onSave, onHistory, history }: {
  item: EffectiveUnderstandingItem; correcting: boolean; draft: string; setDraft: (s: string) => void;
  onCorrect: () => void; onCancel: () => void; onSave: () => void; onHistory: () => void; history?: UnderstandingItemHistory[];
}) {
  return (
    <div data-testid="understanding-item" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
      <p data-testid="item-label" style={labelTag(item.label)}>{TRUTH_LABEL_TEXT[item.label]}</p>
      {!correcting ? (
        <>
          <p data-testid="item-statement" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0', lineHeight: 'var(--lh-body)' }}>{item.statement}</p>
          <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
            <button type="button" data-testid="correct-item" onClick={onCorrect} style={linkBtn}>Correct this</button>
            {item.source === 'founder' && <button type="button" data-testid="item-history" onClick={onHistory} style={linkBtn}>{history ? 'Hide history' : 'Where this came from'}</button>}
          </div>
          {history && history.length > 0 && (
            <ul style={{ ...ul, marginTop: 6 }} data-testid="history-chain">{history.map((h) => (
              <li key={h.id} style={quiet}><span style={labelTag(h.truthLabel)}>{TRUTH_LABEL_TEXT[h.truthLabel]}</span> {h.statement}</li>
            ))}</ul>
          )}
        </>
      ) : (
        <div style={{ marginTop: 6 }}>
          <textarea data-testid="correction-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} style={textarea} />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" data-testid="save-correction" onClick={onSave} style={smallBtn(true)}>Save correction</button>
            <button type="button" onClick={onCancel} style={smallBtn(false)}>Cancel</button>
          </div>
          <p style={quiet}>Your correction becomes the current version and is labelled “You corrected this.” The earlier version stays in history.</p>
        </div>
      )}
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const backBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' } as const;
const meta = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: 0 } as const;
const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--gold)', margin: '0 0 var(--sp-2)' };
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-6)', color: 'var(--ink)', margin: '0 0 var(--sp-2)', lineHeight: 'var(--lh-tight)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: '0 0 var(--sp-4)', lineHeight: 'var(--lh-body)' } as const;
const sectionKind = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ink-3)', margin: 0 };
const ul = { margin: '4px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' as const, gap: 6 };
const li = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '4px 0 0' } as const;
const quiet = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '4px 0 0', lineHeight: 'var(--lh-body)' } as const;
const textarea = { width: '100%', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', padding: 'var(--sp-3)', lineHeight: 'var(--lh-body)', resize: 'vertical' as const } as const;
const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } as const;
function smallBtn(primary: boolean): React.CSSProperties { return { background: primary ? 'var(--ink)' : 'transparent', color: primary ? 'var(--surface)' : 'var(--ink-2)', border: `1px solid ${primary ? 'var(--ink)' : 'var(--line-2)'}`, borderRadius: 'var(--r-1)', padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }; }
function labelTag(label: TruthLabel): React.CSSProperties {
  const warn = label === 'unconfirmed_or_disagree'; const founder = label === 'you_told_me' || label === 'you_corrected_this';
  const c = warn ? 'var(--gold)' : founder ? 'var(--ok-ink)' : 'var(--ink-3)';
  return { display: 'inline-block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.04em', color: c, border: `1px solid ${c}`, borderRadius: 'var(--r-1)', padding: '1px 7px' };
}
