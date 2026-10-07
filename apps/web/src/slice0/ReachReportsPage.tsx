import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError, actionErrorKey } from './errors';
import {
  getBusiness, listReachReports, correctReachReport, deleteReachReport,
  type Business, type ReachReportView,
} from '../api/client';

type Tr = (k: string, v?: Record<string, string>) => string;

/**
 * "What you've told me" — the founder's collected weekly reach reports (attribution by asking, V081). Their
 * report, their data: they can review, correct, or delete any entry. Reflective-only — these are the founder's
 * own words, shown back verbatim, never a claim BB makes.
 */
export function ReachReportsPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [reports, setReports] = useState<ReachReportView[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const started = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try {
      setBusiness(await getBusiness(id));
      const r = await listReachReports(id);
      setReports(r.reports);
    } catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); }
  }, [id]);

  useEffect(() => {
    if (!id || started.current) return;
    started.current = true;
    void load();
  }, [id, load]);

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || reports === null) {
    return <AppShell showSignOut><div className="s0-loading">{t('common.loading')}</div></AppShell>;
  }
  if (business === null) return <Navigate to="/" replace />;

  return (
    <AppShell showSignOut>
      <div className="s0-reach-page">
        <div className="s0-reach-page-head">
          <h1 className="s0-reach-page-title">{t('reach.title')}</h1>
          <p className="s0-reach-page-lead">{t('reach.lead')}</p>
        </div>
        {reports.length === 0 ? (
          <div className="s0-today2-empty">
            <p className="s0-today2-empty-lead">{t('reach.empty')}</p>
            <button type="button" className="s0-linkbtn" onClick={() => id && navigate(`/b/${id}/today`)}>{t('reach.toToday')} →</button>
          </div>
        ) : (
          <ul className="s0-reach-list">
            {reports.map((r) => (
              <ReachRow key={r.id} businessId={id!} report={r} t={t}
                onChanged={(next) => setReports((rs) => (rs ?? []).map((x) => (x.id === next.id ? next : x)))}
                onDeleted={() => setReports((rs) => (rs ?? []).filter((x) => x.id !== r.id))} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function fmtWeek(weekStart: string): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? weekStart : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ReachRow({ businessId, report, t, onChanged, onDeleted }: {
  businessId: string; report: ReachReportView; t: Tr;
  onChanged: (r: ReachReportView) => void; onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState(report.text);
  const [count, setCount] = useState(report.newPeopleCount === null ? '' : String(report.newPeopleCount));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try {
      const n = count.trim() ? Number(count.trim()) : null;
      const next = await correctReachReport(businessId, report.id, { text: text.trim(), newPeople: Number.isFinite(n as number) ? (n as number) : null });
      onChanged(next); setEditing(false);
    } catch (e) { setErr(t(actionErrorKey(e))); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await deleteReachReport(businessId, report.id); onDeleted(); }
    catch (e) { setErr(t(actionErrorKey(e))); setBusy(false); }
  };

  return (
    <li className="s0-reach-row">
      <div className="s0-reach-row-meta">
        <span className="s0-reach-row-week">{t('reach.weekOf', { d: fmtWeek(report.weekStart) })}</span>
        {report.newPeopleCount !== null ? <span className="s0-reach-row-count">{t('reach.countLabel', { n: String(report.newPeopleCount) })}</span> : null}
      </div>
      {err ? <div className="s0-error" role="alert">{err}</div> : null}
      {editing ? (
        <div className="s0-reach-form">
          <input className="s0-blk-input" inputMode="numeric" placeholder={t('reach.countPh')} value={count} onChange={(e) => setCount(e.target.value)} disabled={busy} />
          <textarea className="s0-blk-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} autoFocus />
          <div className="s0-today2-actions">
            <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={save}>{busy ? t('today2.working') : t('reach.saveEdit')}</button>
            <button type="button" className="s0-today2-defer" disabled={busy} onClick={() => { setEditing(false); setText(report.text); setCount(report.newPeopleCount === null ? '' : String(report.newPeopleCount)); }}>{t('today2.blk.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="s0-reach-row-text">{report.text}</p>
          <div className="s0-reach-row-actions">
            {confirming ? (
              <>
                <span className="s0-reach-confirm">{t('reach.deleteConfirm')}</span>
                <button type="button" className="s0-linkbtn s0-reach-del" disabled={busy} onClick={remove}>{t('reach.deleteYes')}</button>
                <button type="button" className="s0-linkbtn" disabled={busy} onClick={() => setConfirming(false)}>{t('today2.blk.cancel')}</button>
              </>
            ) : (
              <>
                <button type="button" className="s0-linkbtn" disabled={busy} onClick={() => setEditing(true)}>{t('reach.edit')}</button>
                <button type="button" className="s0-linkbtn s0-reach-del" disabled={busy} onClick={() => setConfirming(true)}>{t('reach.delete')}</button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}
