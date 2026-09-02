import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness,
  startConversation,
  submitTurn,
  getFounderModel,
  updateFounderState,
  updateObservation,
  generateAha2,
  getAha2,
  type Business,
  type ConvTurn,
  type FounderModel,
  type FounderStateItem,
  type Aha2Finding,
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
  const [genning, setGenning] = useState(false);
  const started = useRef(false);

  async function refreshModel(bid: string) {
    try { setModel(await getFounderModel(bid)); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    (async () => {
      try {
        const b = await getBusiness(id);
        setBusiness(b);
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
      } catch {
        setBusiness(null);
      }
    })();
  }, [id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !input.trim()) return;
    setSending(true);
    try {
      const view = await submitTurn(id, input.trim());
      setTurns(view.turns);
      setReady(view.readyForAha2);
      setInput('');
      void refreshModel(id);
    } finally {
      setSending(false);
    }
  }

  async function toAha2() {
    if (!id) return;
    setGenning(true);
    try {
      const r = await generateAha2(id);
      setAha2(r);
      setPhase('aha2');
      void refreshModel(id);
    } finally {
      setGenning(false);
    }
  }

  if (business === undefined || phase === 'loading') {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}`)} style={{ marginBottom: 18 }}>
          ← {t('conv.back')}
        </button>

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
          <>
            <Aha2View aha2={aha2} t={t} />
            <button type="button" className="s0-btn" style={{ maxWidth: 340, marginTop: 30 }} onClick={() => navigate(`/b/${id}/strategy`)}>
              {t('strategy.continue')}
            </button>
          </>
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

function Aha2View(props: { aha2: { state: string; findings?: Aha2Finding[] } | null; t: T }) {
  const { aha2, t } = props;
  if (!aha2 || aha2.state === 'insufficient' || !aha2.findings || aha2.findings.length === 0) {
    return (
      <>
        <h1 className="s0-h1">{t('aha2.insufficient.title')}</h1>
        <p className="s0-lede">{t('aha2.insufficient.body')}</p>
      </>
    );
  }
  return (
    <>
      <h1 className="s0-h1">{t('aha2.heading')}</h1>
      <div className="s0-aha">
        {aha2.findings.map((f, i) => (
          <div key={i} className="s0-finding">
            <p className="s0-finding-text">{f.implication}</p>
            {(f.business.length > 0 || f.founder.length > 0 || f.observations.length > 0) && (
              <details className="s0-why">
                <summary>{t('aha2.why')}</summary>
                <div className="s0-why-body">
                  {f.founder.map((s, j) => <div key={`f${j}`}>{t('aha2.from.founder')}: {s}</div>)}
                  {f.business.map((s, j) => <div key={`b${j}`}>{t('aha2.from.business')}: {s}</div>)}
                  {f.observations.map((s, j) => <div key={`o${j}`}>{t('aha2.from.observed')}: {s}</div>)}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
