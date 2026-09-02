import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import {
  getBusiness, getToday, applyActionOutcome, createFromAction,
  type Business, type TodayResp, type TodayAction, type PlanOutcome,
} from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

export function TodayPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [today, setToday] = useState<TodayResp | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    (async () => {
      try { setBusiness(await getBusiness(id)); setToday(await getToday(id)); }
      catch { setBusiness(null); }
    })();
  }, [id]);

  async function outcome(actionId: string, o: PlanOutcome) {
    if (!id) return;
    setBusy(actionId);
    try { setToday(await applyActionOutcome(id, actionId, o)); } finally { setBusy(null); }
  }
  async function create(actionId: string) {
    if (!id) return;
    setBusy(actionId);
    try { const r = await createFromAction(id, actionId); navigate(`/b/${id}/create/${r.createHandoffId}`); }
    finally { setBusy(null); }
  }

  if (business === undefined || today === null) {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  const ready = today.ready ?? [];
  const allClear = today.state === 'active' && ready.length === 0 && !today.blocked;

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        <button type="button" className="s0-linkbtn" onClick={() => navigate(`/b/${id}/plan`)} style={{ marginBottom: 18 }}>
          ← {t('plan.viewplan')}
        </button>

        <h1 className="s0-h1">{t('plan.today.title')}</h1>
        <p className="s0-lede">{t('plan.today.sub')}</p>

        {today.state === 'none' && <p className="s0-strat-body">{t('plan.today.empty')}</p>}

        {ready.map((a) => (
          <ActionCard key={a.actionId} a={a} t={t} busy={busy === a.actionId}
            onOutcome={(o) => outcome(a.actionId, o)} onCreate={() => create(a.actionId)} />
        ))}

        {today.state === 'active' && ready.length === 0 && today.blocked && (
          <div className="s0-strat-block s0-today-blocked">
            <div className="s0-strat-label">{t('plan.today.blocked.title')}</div>
            <p className="s0-strat-lead">{today.blocked.what}</p>
            <p className="s0-plan-blocker"><span>{t('plan.today.blocked.need')}</span> {today.blocked.need}</p>
          </div>
        )}

        {allClear && <p className="s0-strat-body">{t('plan.today.allclear')}</p>}
      </div>
    </AppShell>
  );
}

function ActionCard(props: {
  a: TodayAction; t: T; busy: boolean;
  onOutcome: (o: PlanOutcome) => void; onCreate: () => void;
}) {
  const { a, t, busy, onOutcome, onCreate } = props;
  return (
    <div className="s0-strat-block s0-today-action">
      <p className="s0-strat-lead">{a.what}</p>
      {a.effort && <p className="s0-plan-band">{t('plan.today.effort')}: {a.effort}</p>}
      <p className="s0-today-why"><span className="s0-strat-label">{t('plan.today.why')}</span> {a.whyNow}</p>
      <p className="s0-today-done"><span className="s0-strat-label">{t('plan.today.done')}</span> {a.doneLooksLike}</p>
      <div className="s0-today-actions">
        <button type="button" className="s0-plan-primary s0-btn-inline" disabled={busy} onClick={() => onOutcome('done')}>{t('plan.today.markdone')}</button>
        <button type="button" className="s0-linkbtn" disabled={busy} onClick={() => onOutcome('deferred')}>{t('plan.today.defer')}</button>
        <button type="button" className="s0-linkbtn" disabled={busy} onClick={() => onOutcome('skipped')}>{t('plan.today.skip')}</button>
        {a.canCreate && <button type="button" className="s0-linkbtn s0-today-create" disabled={busy} onClick={onCreate}>{t('plan.today.create')} →</button>}
      </div>
    </div>
  );
}
