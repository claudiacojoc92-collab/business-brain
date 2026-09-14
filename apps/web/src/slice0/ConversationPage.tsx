import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { useAddContext } from './AddContextDrawer';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness,
  startConversation,
  submitTurn,
  getFounderModel,
  getUnderstanding,
  updateFounderState,
  updateObservation,
  generateAha2,
  getAha2,
  type Business,
  type ConvTurn,
  type FounderModel,
  type FounderStateItem,
  type Aha2Finding,
  type UnderstandingView,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [turns, setTurns] = useState<ConvTurn[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'talk' | 'aha2'>('loading');
  const [aha2, setAha2] = useState<{ state: string; findings?: Aha2Finding[] } | null>(null);
  const [model, setModel] = useState<FounderModel | null>(null);
  const [understanding, setUnderstanding] = useState<UnderstandingView | null>(null);
  const addCtx = useAddContext();
  const [genning, setGenning] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
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
      const view = await startConversation(id);
      setTurns(view.turns);
      setReady(view.readyForAha2);
      if (existing.state === 'produced' || existing.state === 'insufficient') {
        setAha2(existing);
        setPhase('aha2');
      } else {
        setPhase('talk');
      }
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

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || phase === 'loading') {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-panel s0-panel-wide">

        {phase === 'talk' && (
          <>
            <div className="s0-thread">
              {turns.map((tn) => (
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
        )}

        {phase === 'aha2' && (
          <BaselineView
            understanding={understanding} model={model} aha2={aha2} t={t}
            onConfirm={() => navigate(`/b/${id}/strategy`)}
            onCorrect={() => addCtx.open()}
          />
        )}
      </div>
    </AppShell>
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

/**
 * The current-state BASELINE confirmation moment (R2A): "here's where I think the business is today",
 * projected from what BB OBSERVED (the understanding snapshot) + what the founder TOLD BB (the founder model)
 * + the cross-source insight (Aha 2). It invents nothing — unknowns stay unknown — and keeps the two lanes
 * visibly separate. The founder confirms (→ Strategy) or corrects (→ Add context), so recommendation follows
 * a grounded, confirmed baseline rather than jumping from website → strategy.
 */
function BaselineView(props: {
  understanding: UnderstandingView | null; model: FounderModel | null;
  aha2: { state: string; findings?: Aha2Finding[] } | null; t: T;
  onConfirm: () => void; onCorrect: () => void;
}) {
  const { understanding, model, aha2, t, onConfirm, onCorrect } = props;
  const u = understanding?.understanding;
  const told: string[] = model ? [
    ...(model.goal ? [model.goal.statement] : []),
    ...(model.horizon ? [model.horizon.statement] : []),
    ...model.resources.map((s) => s.statement),
    ...model.decisions.map((s) => s.statement),
    ...model.constraints.map((s) => s.statement),
    ...model.preferences.map((s) => s.statement),
    ...model.intentions.map((s) => s.statement),
  ].filter(Boolean) : [];
  const offer = (u?.offer?.summary ?? '').trim();
  const audience = (u?.audience?.addressed ?? []).filter(Boolean);
  const acquisition = (u?.acquisition?.visiblePaths ?? []).filter(Boolean);
  const unknowns = (u?.unknowns ?? []).filter(Boolean);
  const insight = (aha2?.state === 'produced' ? aha2.findings : [])?.map((f) => f.implication).filter(Boolean) ?? [];

  const Row = (label: string, items: string[]) => items.length > 0 ? (
    <div className="s0-base-row"><div className="s0-base-k">{label}</div><ul className="s0-base-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
  ) : null;

  return (
    <>
      <h1 className="s0-h1">{t('baseline.title')}</h1>
      <p className="s0-lede">{t('baseline.sub')}</p>

      <div className="s0-base-observed">
        <div className="s0-base-lane">{t('baseline.observed')}</div>
        {offer ? Row(t('baseline.offer'), [offer]) : null}
        {Row(t('baseline.audience'), audience)}
        {Row(t('baseline.acquisition'), acquisition)}
      </div>

      {told.length > 0 ? (
        <div className="s0-base-told">
          <div className="s0-base-lane">{t('baseline.told')}</div>
          {Row(t('baseline.youtold'), told)}
        </div>
      ) : null}

      {insight.length > 0 ? Row(t('baseline.standsout'), insight) : null}
      {Row(t('baseline.unsure'), unknowns)}

      <div className="s0-today2-foot">
        <div className="s0-today2-actions">
          <button type="button" className="s0-btn" onClick={onConfirm}>{t('baseline.confirm')} →</button>
          <button type="button" className="s0-btn-ghost" onClick={onCorrect}>{t('baseline.correct')}</button>
        </div>
      </div>
    </>
  );
}

