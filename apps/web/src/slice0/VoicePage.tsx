import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness,
  getVoice,
  startVoiceCalibration,
  reactToSample,
  editSample,
  getVoiceProjection,
  type Business,
  type VoiceSample,
  type VoiceProjection,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

export function VoicePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready'>('loading');
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [projection, setProjection] = useState<VoiceProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed
  const started = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try {
      const b = await getBusiness(id);
      setBusiness(b);
      const v = await getVoice(id);
      if (v.state === 'none') {
        const r = await startVoiceCalibration(id);
        setSamples(r.samples);
      } else {
        setSamples(v.samples ?? []);
        setProjection(v.projection ?? null);
      }
      setPhase('ready');
    } catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); }
  }, [id]);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load();
  }, [id, load]);

  async function refreshProjection() {
    if (!id) return;
    try { setProjection(await getVoiceProjection(id)); } catch { /* ignore */ }
  }

  function replaceSample(oldId: string, next: VoiceSample | null) {
    setSamples((prev) => prev.map((s) => (s.id === oldId ? (next ?? s) : s)));
  }

  async function react(sampleId: string, reaction: string) {
    if (!id || !reaction.trim()) return;
    setBusy(true); setActionError(null);
    try {
      const r = await reactToSample(id, sampleId, reaction.trim());
      replaceSample(sampleId, r.sample);
      void refreshProjection();
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(false); }
  }
  async function saveEdit(sampleId: string, text: string) {
    if (!id || !text.trim()) return;
    setBusy(true); setActionError(null);
    try {
      const r = await editSample(id, sampleId, text.trim());
      replaceSample(sampleId, r.sample);
      void refreshProjection();
    } catch { setActionError(t('common.actionFailed')); } finally { setBusy(false); }
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
        <h1 className="s0-h1">{t('voice.title')}</h1>
        <p className="s0-lede">{t('voice.lede')}</p>

        <div className="s0-voice-samples">
          {samples.map((s) => (
            <SampleCard key={s.id} sample={s} t={t} busy={busy} onReact={react} onEdit={saveEdit} />
          ))}
        </div>

        {projection && (
          <details className="s0-model" open>
            <summary>{t('voice.learned')}</summary>
            <div className="s0-model-group">
              {projection.calibrated
                ? projection.lines.map((l, i) => <div key={i} className="s0-voice-learned-line">{l}</div>)
                : <div className="s0-voice-learned-line">{t('voice.uncalibrated')}</div>}
            </div>
          </details>
        )}

        <div className="s0-strat-next">
          <button type="button" className="s0-btn" style={{ maxWidth: 320 }} onClick={() => navigate(`/b/${id}/plan`)}>
            {t('plan.continue')} →
          </button>
        </div>
      </div>
    </AppShell>
  );
}

function SampleCard(props: { sample: VoiceSample; t: T; busy: boolean; onReact: (id: string, r: string) => void; onEdit: (id: string, text: string) => void }) {
  const { sample, t, busy, onReact, onEdit } = props;
  const [reaction, setReaction] = useState('');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const c = sample.content;

  return (
    <div className="s0-voice-card">
      <div className="s0-voice-kind">{t(`voice.channel.${sample.channel}`)}</div>
      {sample.channel === 'caption' ? (
        <p className="s0-voice-caption">{c.caption}</p>
      ) : (
        <>
          {c.hook && <p className="s0-voice-hook">{c.hook}</p>}
          {(c.beats ?? []).map((b, i) => <p key={i} className="s0-voice-beat">{b}</p>)}
        </>
      )}
      {c.cta && <p className="s0-voice-cta">{c.cta}</p>}

      {!editing ? (
        <>
          <form className="s0-composer" onSubmit={(e) => { e.preventDefault(); onReact(sample.id, reaction); setReaction(''); }}>
            <textarea value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder={t('voice.react.placeholder')} disabled={busy} aria-label={t('voice.react.placeholder')} />
            <button type="submit" className="s0-btn s0-btn-inline" disabled={busy || !reaction.trim()}>{busy ? '…' : t('voice.react.send')}</button>
          </form>
          <button type="button" className="s0-linkbtn" onClick={() => { setEditing(true); setEditText(c.caption ?? [c.hook, ...(c.beats ?? []), c.cta].filter(Boolean).join('\n')); }}>
            {t('voice.rewrite')}
          </button>
        </>
      ) : (
        <div className="s0-strat-correct">
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} aria-label={t('voice.rewrite')} />
          <div className="s0-strat-correct-actions">
            <button type="button" className="s0-btn s0-btn-inline" disabled={busy || !editText.trim()} onClick={() => { onEdit(sample.id, editText); setEditing(false); }}>{t('voice.rewrite.save')}</button>
            <button type="button" className="s0-linkbtn" onClick={() => setEditing(false)}>{t('voice.rewrite.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
