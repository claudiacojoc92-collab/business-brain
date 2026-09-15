import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { VerdictSurface } from './VerdictSurface';
import { MirrorView } from './MirrorView';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness,
  startConversation,
  submitTurn,
  getFounderModel,
  getUnderstanding,
  reopenConversation,
  updateFounderState,
  updateObservation,
  generateAha2,
  getAha2,
  evaluateImpact,
  type Business,
  type ConvTurn,
  type FounderModel,
  type FounderStateItem,
  type Aha2Finding,
  type UnderstandingView,
  type ImpactResult,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refreshMode = params.get('refresh') === '1';

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [turns, setTurns] = useState<ConvTurn[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'talk' | 'aha2'>('loading');
  // Aha2 is generated + stored (it gates the mirror), but the mirror surface reads live state itself, so the
  // value isn't rendered here — only the setter/existence matters.
  const [, setAha2] = useState<{ state: string; findings?: Aha2Finding[] } | null>(null);
  const [model, setModel] = useState<FounderModel | null>(null);
  const [understanding, setUnderstanding] = useState<UnderstandingView | null>(null);
  const [genning, setGenning] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
  const [showHistory, setShowHistory] = useState(false); // R2B refresh: history is collapsed, not dumped
  const [verdict, setVerdict] = useState<ImpactResult | null>(null); // Living State: baseline-refresh impact
  const started = useRef(false);

  async function refreshModel(bid: string) {
    try { setModel(await getFounderModel(bid)); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try {
      const b = await getBusiness(id);
      setBusiness(b);
      try { setUnderstanding(await getUnderstanding(id)); } catch { /* baseline degrades gracefully */ }
      const existing = await getAha2(id);
      // Refresh mode (R2B): reopen the interview to update the baseline; else resume normally.
      const view = refreshMode ? await reopenConversation(id) : await startConversation(id);
      setTurns(view.turns);
      setReady(view.readyForAha2);
      const hasAha2 = existing.state === 'produced' || existing.state === 'insufficient';
      // Show the baseline only when the interview is settled (ready) AND an Aha2 exists. A reopened refresh
      // with new domains to ask (readyForAha2 === false) re-shows the interview even though an old Aha2 exists.
      if (view.readyForAha2 && hasAha2) { setAha2(existing); setPhase('aha2'); }
      else { setPhase('talk'); }
      void refreshModel(id);
    } catch (e) {
      if (isNotFound(e)) setBusiness(null); else setLoadErr(true);
    }
  }, [id]);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load();
  }, [id, load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !input.trim()) return;
    setSending(true); setActionError(null);
    try {
      const view = await submitTurn(id, input.trim());
      setTurns(view.turns);
      setReady(view.readyForAha2);
      setInput('');
      void refreshModel(id);
    } catch {
      setActionError(t('common.actionFailed'));
    } finally {
      setSending(false);
    }
  }

  async function toAha2() {
    if (!id) return;
    setGenning(true); setActionError(null);
    try {
      const r = await generateAha2(id);
      setAha2(r);
      setPhase('aha2');
      void refreshModel(id);
    } catch {
      setActionError(t('common.actionFailed'));
    } finally {
      setGenning(false);
    }
  }

  // Living State: confirming an updated baseline on a deliberate REFRESH assesses what the founder just told
  // BB against the held strategy → the verdict surface. A first-time baseline (no refresh) goes to Strategy.
  async function confirmBaseline() {
    if (!id) return;
    if (!refreshMode) { navigate(`/b/${id}/strategy`); return; }
    const answers = turns.filter((tn) => tn.role === 'founder').map((tn) => tn.content).join('\n').trim();
    if (!answers) { navigate(`/b/${id}/strategy`); return; }
    setActionError(null);
    try { setVerdict(await evaluateImpact(id, 'baseline_refresh', answers)); }
    catch { navigate(`/b/${id}/strategy`); }
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || phase === 'loading') {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-panel s0-panel-wide">

        {phase === 'talk' && (() => {
          // R2B refresh UX: don't dump the whole historical transcript above the refresh question. Lead with a
          // compact current-state summary + the latest question; keep history one click away.
          const refreshCollapsed = refreshMode && !showHistory && turns.length > 1;
          const visibleTurns = refreshCollapsed ? turns.slice(-1) : turns;
          return (
          <>
            {refreshMode ? <RefreshSummary understanding={understanding} t={t} /> : null}
            {refreshCollapsed ? (
              <button type="button" className="s0-refresh-history" onClick={() => setShowHistory(true)}>{t('refresh.showHistory')}</button>
            ) : null}
            <div className="s0-thread">
              {visibleTurns.map((tn) => (
                <div key={tn.id} className={tn.role === 'bb' ? 's0-turn-bb' : 's0-turn-founder'}>{tn.content}</div>
              ))}
            </div>

            {ready ? (
              <div style={{ marginTop: 10 }}>
                <h2 style={{ fontFamily: 'var(--s0-serif)', fontSize: 24, margin: '0 0 16px' }}>{t('conv.ready.title')}</h2>
                <button type="button" className="s0-btn" style={{ maxWidth: 340 }} disabled={genning} onClick={toAha2}>
                  {genning ? t('common.loading') : t('conv.ready.cta')}
                </button>
              </div>
            ) : (
              <form className="s0-composer" onSubmit={send}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('conv.placeholder')}
                  disabled={sending}
                  aria-label={t('conv.placeholder')}
                />
                <button type="submit" className="s0-btn s0-btn-inline" disabled={sending || !input.trim()}>
                  {sending ? '…' : t('conv.send')}
                </button>
              </form>
            )}

            <FounderModelPanel model={model} t={t} businessId={id ?? ''} onChanged={() => id && refreshModel(id)} />
          </>
          );
        })()}

        {phase === 'aha2' && verdict && (
          <VerdictSurface businessId={id ?? ''} result={verdict} onDismiss={() => navigate(`/b/${id}/strategy`)} onAdopted={() => navigate(`/b/${id}/strategy`)} />
        )}
        {phase === 'aha2' && !verdict && (
          <MirrorView businessId={id ?? ''} onConfirm={confirmBaseline} t={t} />
        )}
      </div>
    </AppShell>
  );
}

/** R2B refresh: a compact "here's what I currently hold" summary shown above the refreshed interview, so the
 * founder re-enters against their known state instead of scrolling a replayed transcript. */
function RefreshSummary({ understanding, t }: { understanding: UnderstandingView | null; t: T }) {
  const u = understanding?.understanding;
  const offer = (u?.offer?.summary ?? '').trim();
  const audience = (u?.audience?.addressed ?? []).filter(Boolean).slice(0, 3);
  const acquisition = (u?.acquisition?.visiblePaths ?? []).filter(Boolean).slice(0, 3);
  if (!offer && audience.length === 0 && acquisition.length === 0) return null;
  return (
    <div className="s0-refresh-summary">
      <div className="s0-refresh-summary-k">{t('refresh.current')}</div>
      {offer ? <p className="s0-refresh-summary-offer">{offer}</p> : null}
      {audience.length > 0 ? <p className="s0-refresh-summary-line"><span>{t('baseline.audience')}</span> {audience.join(' · ')}</p> : null}
      {acquisition.length > 0 ? <p className="s0-refresh-summary-line"><span>{t('baseline.acquisition')}</span> {acquisition.join(' · ')}</p> : null}
    </div>
  );
}

function FounderModelPanel(props: { model: FounderModel | null; t: T; businessId: string; onChanged: () => void }) {
  const { model, t, businessId, onChanged } = props;
  if (!model) return null;
  const stated: FounderStateItem[] = [
    ...(model.goal ? [model.goal] : []),
    ...(model.horizon ? [model.horizon] : []),
    ...model.constraints, ...model.preferences, ...model.decisions, ...model.intentions,
    ...model.challengePermissions, ...model.resources, ...model.businessCorrections,
  ];
  if (stated.length === 0 && model.observations.length === 0) return null;

  async function removeState(sid: string) {
    try { await updateFounderState(businessId, sid, 'delete'); } catch { /* ignore */ }
    onChanged();
  }
  async function removeObs(oid: string) {
    try { await updateObservation(businessId, oid, 'deleted'); } catch { /* ignore */ }
    onChanged();
  }

  return (
    <details className="s0-model">
      <summary>{t('conv.model.title')}</summary>
      {stated.length > 0 && (
        <div className="s0-model-group">
          <div className="s0-model-label">{t('conv.model.stated')}</div>
          {stated.map((s) => (
            <div key={s.id} className="s0-model-item">
              <span className="s0-model-text">{s.statement}</span>
              <button type="button" className="s0-linkbtn" onClick={() => removeState(s.id)}>{t('conv.model.remove')}</button>
            </div>
          ))}
        </div>
      )}
      {model.observations.length > 0 && (
        <div className="s0-model-group s0-model-observed">
          <div className="s0-model-label">{t('conv.model.observed')}</div>
          {model.observations.map((o) => (
            <div key={o.id} className="s0-model-item">
              <span className="s0-model-text">{o.behavior}</span>
              <button type="button" className="s0-linkbtn" onClick={() => removeObs(o.id)}>{t('conv.model.notmine')}</button>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}

