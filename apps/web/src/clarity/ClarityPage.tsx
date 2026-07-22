import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  clarityTurn, getConcern, acceptProposedChange, rejectProposedChange, crystallizeConcern, revalidateInContext, ApiError,
  pilotReality, pilotShouldFeedback, pilotFeedback, pilotEnding,
  TRUTH_LABEL_TEXT, type ClarityResult, type ClarityMessage, type ConcernDetail, type TruthLabel, type ContinuityItem,
} from '../api/client';
import { AppShell, Button, Thinking } from '../system/ui';

/**
 * Clarity / Sensemaking surface. A founder brings a tension ("everyone says run ads, but I'm not sure ads are the problem").
 * Business Brain audits what is actually happening — separating what is known, assumed, unknown, and in conflict — and
 * offers a plain-language clarity reading with a smallest useful next move, WITHOUT jumping to "run ads / don't run ads".
 * Any Understanding update is PROPOSED (pending) and saved only on an explicit founder action. The founder may end with
 * clarity, keep exploring, or explicitly turn the clarified issue into a strategic question. Everything persists by URL.
 */
export function ClarityPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const { concernId } = useParams<{ concernId?: string }>();
  const [detail, setDetail] = useState<ConcernDetail | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedbackDue, setFeedbackDue] = useState(false);

  const load = useCallback(async (id: string) => {
    try { setDetail(await getConcern(id)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true }); else setError('Could not load this.'); }
  }, [navigate]);
  useEffect(() => { if (founderId && concernId) void load(concernId); }, [founderId, concernId, load]);
  useEffect(() => { if (concernId) void pilotShouldFeedback(concernId).then(setFeedbackDue); }, [concernId, detail]);

  const send = async () => {
    const text = input.trim(); if (text.length < 2 || busy) return;
    setBusy(true); setError(null); setRetry(null);
    try {
      const res = await clarityTurn(text, concernId);
      if (!res.ok) { setRetry(res.message ?? 'I couldn’t read that clearly enough. Your message is saved — try rephrasing.'); if (!concernId) navigate(`/clarity/${res.concernId}`, { replace: true }); else await load(res.concernId); }
      else { setInput(''); if (!concernId) navigate(`/clarity/${res.concernId}`); else await load(res.concernId); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) navigate('/signin', { replace: true });
      else setRetry('I couldn’t complete that just now. Your message is saved — please try again.');
    } finally { setBusy(false); }
  };

  const resolve = async (id: string, accept: boolean) => {
    try { accept ? await acceptProposedChange(id) : await rejectProposedChange(id); if (concernId) await load(concernId); }
    catch { setError('Could not save that just now.'); }
  };
  const crystallize = async (question: string) => {
    if (!concernId) return;
    try { const { sessionId } = await crystallizeConcern(concernId, question); navigate(`/strategy?from=${sessionId}`); }
    catch { setError('Could not turn this into a strategic question just now.'); }
  };
  const revalidate = async (item: ContinuityItem, outcome: 'confirmed' | 'unsure' | 'changed', newStatement?: string) => {
    if (!concernId) return;
    try { await revalidateInContext(concernId, { understandingItemId: item.understandingItemId, outcome, newStatement }); await load(concernId); }
    catch { setError('Could not save that just now.'); }
  };

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const latest: ClarityResult | null = detail && detail.clarity.length ? detail.clarity[detail.clarity.length - 1]!.result : null;
  const pending = (detail?.proposedChanges ?? []).filter((c) => c.status === 'pending');
  const resolved = (detail?.proposedChanges ?? []).filter((c) => c.status !== 'pending');

  return (
    <AppShell actions={<button type="button" onClick={() => navigate('/welcome')} style={backBtn}>Home</button>}>
      <div data-testid="clarity">
        <p style={eyebrow}>Clarity</p>
        <h1 style={h1}>What feels unclear right now?</h1>
        <p style={lede}>Bring a tension, an observation, or a fuzzy worry. I’ll help you see what’s actually known, what’s only assumed, and what deserves attention — before anyone tells you to do more.</p>

        {detail && <ConversationTrail messages={detail.messages} />}

        {(!detail || !busy) && (
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <textarea data-testid="clarity-input" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Everyone tells me I should run ads, but I’m not sure ads are the real problem."
              rows={3} style={textarea} />
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <Button variant="primary" loading={busy} disabled={input.trim().length < 2} onClick={() => void send()}>
                <span data-testid="clarity-send">{detail ? 'Think this through' : 'Help me see it clearly'}</span>
              </Button>
            </div>
          </div>
        )}

        {busy && <Thinking message="Looking at what’s actually known…" />}
        {retry && <div data-testid="clarity-retry" style={{ ...card, borderColor: 'var(--gold)', marginTop: 'var(--sp-4)' }}><p style={{ margin: 0, fontFamily: 'var(--serif)', color: 'var(--ink)' }}>{retry}</p></div>}
        {error && <p style={{ ...meta, color: 'var(--err-ink, #a3423c)', marginTop: 'var(--sp-3)' }}>{error}</p>}

        {latest && latest.continuity.length > 0 && <ContinuityBuiltOn items={latest.continuity} onRevalidate={revalidate} />}
        {latest && <ClarityReading result={latest} />}

        {pending.length > 0 && (
          <section data-testid="proposed-changes" style={{ ...card, marginTop: 'var(--sp-4)', borderColor: 'var(--gold)' }}>
            <p style={sectionKind}>A possible update to your understanding — only if you agree</p>
            {pending.map((c) => (
              <div key={c.id} data-testid="proposed-change" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
                <p data-testid="proposed-label" style={labelTag(c.label)}>{TRUTH_LABEL_TEXT[c.label]}</p>
                <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0' }}>{c.statement}</p>
                {c.explanation && <p style={quiet}>{c.explanation}</p>}
                <div style={{ display: 'flex', gap: 10, marginTop: 'var(--sp-2)' }}>
                  <button type="button" data-testid="accept-change" onClick={() => void resolve(c.id, true)} style={smallBtn(true)}>Yes, save this</button>
                  <button type="button" data-testid="reject-change" onClick={() => void resolve(c.id, false)} style={smallBtn(false)}>Not now</button>
                </div>
              </div>
            ))}
          </section>
        )}
        {resolved.length > 0 && (
          <div data-testid="resolved-changes" style={{ marginTop: 'var(--sp-3)' }}>
            {resolved.map((c) => (
              <p key={c.id} style={quiet} data-testid={`resolved-${c.status}`}>
                {c.status === 'accepted' ? '✓ Saved to your understanding' : '· Set aside'}: “{c.statement}” <span style={{ color: 'var(--ink-3)' }}>({TRUTH_LABEL_TEXT[c.label]})</span>
              </p>
            ))}
          </div>
        )}

        {latest && (
          <section data-testid="endings" style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--line)' }}>
            <p style={meta}>Where to from here — your call</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              <button type="button" data-testid="end-enough" onClick={() => { if (concernId) void pilotEnding(concernId, 'enough'); navigate('/welcome'); }} style={endBtn}>This is enough for now</button>
              <button type="button" data-testid="end-explore" onClick={() => { if (concernId) void pilotEnding(concernId, 'keep_exploring'); setInput(''); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }} style={endBtn}>Keep exploring</button>
              {latest.possibleStrategicQuestion && (
                <button type="button" data-testid="end-crystallize" onClick={() => void crystallize(latest.possibleStrategicQuestion!)} style={{ ...endBtn, borderColor: 'var(--ink)', color: 'var(--ink)' }}>
                  Turn this into a strategic question →
                </button>
              )}
            </div>
            {latest.possibleStrategicQuestion && <p style={quiet}>Would become: “{latest.possibleStrategicQuestion}”</p>}
          </section>
        )}

        {latest && concernId && <PilotResearch concernId={concernId} due={feedbackDue} onFeedbackDone={() => setFeedbackDue(false)} />}
      </div>
    </AppShell>
  );
}

function ConversationTrail({ messages }: { messages: ClarityMessage[] }) {
  if (!messages.length) return null;
  return (
    <div data-testid="trail" style={{ marginTop: 'var(--sp-4)' }}>
      {messages.map((m) => (
        <p key={m.id} style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: m.actor === 'FOUNDER' ? 'var(--ink)' : 'var(--ink-2)', margin: '0 0 6px', ...(m.actor === 'BUSINESS_BRAIN' ? { paddingLeft: 'var(--sp-3)', borderLeft: '2px solid var(--line-2)' } : {}) }}>
          <span style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-3)' }}>{m.actor === 'FOUNDER' ? 'You' : 'Business Brain'}</span><br />{m.content}
        </p>
      ))}
    </div>
  );
}

function List({ testid, title, items }: { testid: string; title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 'var(--sp-3)' }}>
      <p style={sectionKind}>{title}</p>
      <ul style={ul} data-testid={testid}>{items.map((s, i) => <li key={i} style={li}>{s}</li>)}</ul>
    </div>
  );
}

/** Research capture (pilot) — a reality marker + an OPTIONAL, dismissible feedback prompt. Never blocks the reading. */
function PilotResearch({ concernId, due, onFeedbackDone }: { concernId: string; due: boolean; onFeedbackDone: () => void }) {
  const [realityDone, setRealityDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [fb, setFb] = useState<{ clearer?: string; changedAttention?: string; reachedAlone?: string }>({});
  const markReality = async (marker: 'yes_now' | 'yes_not_urgent' | 'exploratory') => { try { await pilotReality(concernId, marker); } catch { /* research, best-effort */ } setRealityDone(true); };
  const submit = async () => { try { await pilotFeedback({ concernId, ...fb }); } catch { /* best-effort */ } onFeedbackDone(); };
  return (
    <div data-testid="pilot-research" style={{ marginTop: 'var(--sp-5)' }}>
      {!realityDone && (
        <div data-testid="reality-marker" style={{ ...researchCard }}>
          <p style={researchQ}>Is this something you’re genuinely dealing with right now?</p>
          <div style={pillRow}>
            <button type="button" data-testid="reality-yes-now" onClick={() => void markReality('yes_now')} style={pill}>Yes, now</button>
            <button type="button" onClick={() => void markReality('yes_not_urgent')} style={pill}>Yes, not urgent</button>
            <button type="button" onClick={() => void markReality('exploratory')} style={pill}>Just exploring</button>
          </div>
        </div>
      )}
      {due && !dismissed && (
        <div data-testid="feedback-prompt" style={{ ...researchCard, marginTop: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><p style={researchQ}>A couple of quick questions — optional</p><button type="button" data-testid="feedback-dismiss" onClick={() => setDismissed(true)} style={dismiss}>Dismiss</button></div>
          <FbRow label="Do you see the situation more clearly now?" opts={[['yes', 'Yes'], ['somewhat', 'Somewhat'], ['no', 'No']]} val={fb.clearer} on={(v) => setFb({ ...fb, clearer: v })} testid="fb-clearer" />
          <FbRow label="Did this change what you think deserves attention next?" opts={[['yes', 'Yes'], ['no', 'No'], ['not_sure', 'Not sure']]} val={fb.changedAttention} on={(v) => setFb({ ...fb, changedAttention: v })} testid="fb-attention" />
          <FbRow label="Would you have reached this on your own?" opts={[['probably', 'Probably'], ['maybe', 'Maybe'], ['probably_not', 'Probably not']]} val={fb.reachedAlone} on={(v) => setFb({ ...fb, reachedAlone: v })} testid="fb-alone" />
          <div style={{ marginTop: 'var(--sp-2)' }}><button type="button" data-testid="feedback-submit" onClick={() => void submit()} style={{ ...pill, borderColor: 'var(--ink)', color: 'var(--ink)' }}>Send</button></div>
        </div>
      )}
    </div>
  );
}
function FbRow({ label, opts, val, on, testid }: { label: string; opts: Array<[string, string]>; val?: string; on: (v: string) => void; testid: string }) {
  return (
    <div style={{ marginTop: 'var(--sp-2)' }} data-testid={testid}>
      <p style={{ ...quiet, color: 'var(--ink-2)' }}>{label}</p>
      <div style={pillRow}>{opts.map(([v, t]) => <button key={v} type="button" onClick={() => on(v)} style={{ ...pill, background: val === v ? 'var(--ink)' : 'transparent', color: val === v ? 'var(--surface)' : 'var(--ink-2)' }}>{t}</button>)}</div>
    </div>
  );
}
const researchCard = { background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', padding: 'var(--sp-3) var(--sp-4)' } as const;
const researchQ = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: 0 } as const;
const pillRow = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, marginTop: 6 };
const pill = { background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' } as const;
const dismiss = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)' } as const;

const STALE_TEXT: Record<string, string> = {
  contradicted: 'Your message suggests this may have changed.',
  unresolved: 'This is still unresolved — worth confirming it hasn’t moved.',
  time_sensitive: 'This can change over time — worth a quick check.',
};
function ContinuityBuiltOn({ items, onRevalidate }: { items: ContinuityItem[]; onRevalidate: (item: ContinuityItem, outcome: 'confirmed' | 'unsure' | 'changed', s?: string) => void }) {
  return (
    <section data-testid="continuity" style={{ ...card, marginTop: 'var(--sp-4)', borderColor: 'var(--line-2)' }}>
      <p style={sectionKind}>What I’m building on</p>
      <p style={quiet}>Prior understanding I’m using for this — and why it matters here. You can correct or confirm any of it without losing this conversation.</p>
      {items.map((c) => <ContinuityRow key={c.understandingItemId} item={c} onRevalidate={onRevalidate} />)}
    </section>
  );
}
function ContinuityRow({ item, onRevalidate }: { item: ContinuityItem; onRevalidate: (item: ContinuityItem, outcome: 'confirmed' | 'unsure' | 'changed', s?: string) => void }) {
  const [changing, setChanging] = useState(false);
  const [draft, setDraft] = useState(item.statement);
  return (
    <div data-testid="continuity-item" style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
      <p data-testid="continuity-label" style={labelTag(item.truthLabel)}>{TRUTH_LABEL_TEXT[item.truthLabel]}</p>
      <p data-testid="continuity-statement" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '4px 0 0' }}>{item.statement}</p>
      <p data-testid="continuity-why" style={{ ...quietBody, marginTop: 4 }}><strong>Why it matters here:</strong> {item.relevanceToCurrentConcern}</p>
      {item.effectOnCurrentReading && <p style={quiet}>{item.effectOnCurrentReading}</p>}
      <p style={quiet}>{item.originSummary}{item.lastConfirmedAt ? ` · last confirmed ${new Date(item.lastConfirmedAt).toLocaleDateString()}` : ''}</p>
      {item.needsRevalidation && !changing && (
        <div data-testid="revalidate" style={{ marginTop: 6 }}>
          {item.possibleStalenessReason && <p style={{ ...quiet, color: 'var(--gold)' }} data-testid="may-need-checking">{STALE_TEXT[item.possibleStalenessReason]}</p>}
          <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '4px 0 2px' }}>Is this still true?</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" data-testid="reval-yes" onClick={() => onRevalidate(item, 'confirmed')} style={smallBtn(false)}>Yes, continue</button>
            <button type="button" data-testid="reval-changed" onClick={() => { setChanging(true); setDraft(item.statement); }} style={smallBtn(false)}>This has changed</button>
            <button type="button" data-testid="reval-unsure" onClick={() => onRevalidate(item, 'unsure')} style={smallBtn(false)}>I’m not sure</button>
          </div>
        </div>
      )}
      {changing && (
        <div style={{ marginTop: 6 }}>
          <textarea data-testid="reval-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} style={textarea} />
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <button type="button" data-testid="reval-save" onClick={() => { onRevalidate(item, 'changed', draft.trim()); setChanging(false); }} style={smallBtn(true)}>Save & re-read</button>
            <button type="button" onClick={() => setChanging(false)} style={smallBtn(false)}>Cancel</button>
          </div>
          <p style={quiet}>Your correction supersedes the old statement (kept in history) and I’ll re-read this with the updated understanding.</p>
        </div>
      )}
    </div>
  );
}

function ClarityReading({ result: r }: { result: ClarityResult }) {
  return (
    <section data-testid="clarity-reading" style={{ ...card, marginTop: 'var(--sp-4)' }}>
      <p style={sectionKind}>What I hear</p>
      <p data-testid="reflected" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-5)', color: 'var(--ink)', margin: '2px 0 0', lineHeight: 'var(--lh-tight)' }}>{r.reflectedConcern}</p>

      {r.relevantContextUsed.length > 0 && (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <p style={sectionKind}>What I’m drawing on</p>
          <ul style={ul} data-testid="context-used">{r.relevantContextUsed.map((c, i) => (
            <li key={i} style={li}><span style={labelTag(c.label)}>{TRUTH_LABEL_TEXT[c.label]}</span> {c.statement}</li>
          ))}</ul>
        </div>
      )}

      <List testid="supported" title="What seems supported" items={r.supportedObservations} />
      <List testid="founder-said" title="What you’ve told me" items={r.founderStatements} />
      <List testid="interpretations" title="My reading (not fact)" items={r.interpretations} />
      <List testid="unknowns" title="What we don’t yet know" items={r.unknowns} />

      {r.conflicts.length > 0 && (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <p style={sectionKind}>Where a claim and the evidence disagree</p>
          <ul style={ul} data-testid="conflicts">{r.conflicts.map((c, i) => (
            <li key={i} style={li}><strong>You:</strong> {c.founderClaim}<br /><strong>Evidence:</strong> {c.evidence}</li>
          ))}</ul>
        </div>
      )}

      <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--line)' }}>
        <p style={sectionKind}>The likely core issue</p>
        <p data-testid="clarified-issue" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '2px 0 0', lineHeight: 'var(--lh-body)' }}>
          {r.clarifiedIssue ?? 'Not yet possible to say — the evidence doesn’t support a confident read yet.'}
        </p>
      </div>
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <p style={sectionKind}>The smallest useful next move</p>
        <p data-testid="next-move" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', margin: '2px 0 0' }}>{r.smallestUsefulNextMove}</p>
      </div>
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <p style={sectionKind}>A different reading — and when it would win</p>
        <p data-testid="alternative" style={quietBody}>{r.alternativeInterpretation}</p>
      </div>
      <List testid="what-would-change" title="What would change this reading" items={r.whatWouldChangeThisReading} />
      <p data-testid="evidence-limit" style={{ ...quiet, marginTop: 'var(--sp-3)', fontStyle: 'italic' }}>{r.evidenceLimitation}</p>
    </section>
  );
}

// ── styles (match the app idiom: CSS variables, inline styles) ──────────────────────────────────────────────────────
const backBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
const card = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)' } as const;
const meta = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: 0 } as const;
const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--gold)', margin: '0 0 var(--sp-2)' };
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-6)', color: 'var(--ink)', margin: '0 0 var(--sp-2)', lineHeight: 'var(--lh-tight)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: '0 0 var(--sp-4)', lineHeight: 'var(--lh-body)' } as const;
const sectionKind = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ink-3)', margin: 0 };
const textarea = { width: '100%', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)', padding: 'var(--sp-3)', lineHeight: 'var(--lh-body)', resize: 'vertical' as const } as const;
const ul = { margin: '4px 0 0', paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' as const, gap: 6 };
const li = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)' } as const;
const quiet = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', margin: '4px 0 0', lineHeight: 'var(--lh-body)' } as const;
const quietBody = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: '2px 0 0', lineHeight: 'var(--lh-body)' } as const;
const endBtn = { background: 'none', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' } as const;
function smallBtn(primary: boolean): React.CSSProperties { return { background: primary ? 'var(--ink)' : 'transparent', color: primary ? 'var(--surface)' : 'var(--ink-2)', border: `1px solid ${primary ? 'var(--ink)' : 'var(--line-2)'}`, borderRadius: 'var(--r-1)', padding: '6px 14px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)' }; }
function labelTag(label: TruthLabel): React.CSSProperties {
  const warn = label === 'unconfirmed_or_disagree'; const founder = label === 'you_told_me' || label === 'you_corrected_this';
  const c = warn ? 'var(--gold)' : founder ? 'var(--ok-ink)' : 'var(--ink-3)';
  return { display: 'inline-block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.04em', color: c, border: `1px solid ${c}`, borderRadius: 'var(--r-1)', padding: '1px 7px', marginBottom: 2 };
}
