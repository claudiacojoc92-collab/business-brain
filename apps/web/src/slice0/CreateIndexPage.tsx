import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import { getBusiness, getToday, getCurrentStrategy, createFromAction, type Business, type TodayAction } from '../api/client';

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Create entry (M5B) — the honest top-level Create surface. Create is NOT a tool menu or a blank generator:
 * it leads with the ONE strategic move that can become something publishable, framed by the strategy that
 * produced it. When the held strategy does not call for content right now, Create says so PLAINLY, explains
 * why (the strategy's own stance), and links back to the strategy — it never contradicts the strategy by
 * pushing "turn this into content", never offers a bare generator/module picker, never biases Today.
 */
export function CreateIndexPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [move, setMove] = useState<TodayAction | null>(null);
  const [bet, setBet] = useState('');
  const [contentRole, setContentRole] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404
  const [actionError, setActionError] = useState<string | null>(null); // B1 — a primary action that failed

  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try { setBusiness(await getBusiness(id)); }
    catch (e) { if (isNotFound(e)) setBusiness(null); else setLoadErr(true); return; }
    const [td, st] = await Promise.allSettled([getToday(id), getCurrentStrategy(id)]);
    if (td.status === 'fulfilled') setMove((td.value.ready ?? []).find((a) => a.canCreate) ?? null);
    if (st.status === 'fulfilled') {
      setBet(st.value.strategy?.core?.coreBet?.priority ?? '');
      setContentRole((st.value.strategy?.branch?.contentRole ?? '').trim());
    }
    setLoaded(true);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // CASE 1 — lead the founder straight into the move: real createFromAction → real handoff → Create.
  async function makeIt() {
    if (!id || !move) return;
    setBusy(true); setActionError(null);
    try { const r = await createFromAction(id, move.actionId); navigate(`/b/${id}/create/${r.createHandoffId}`); }
    catch { setActionError(t('common.actionFailed')); setBusy(false); }
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === null) return <Navigate to="/home" replace />;
  if (business === undefined || !loaded) return <AppShell><div className="s0-loading">{t('common.loading')}</div></AppShell>;

  return (
    <AppShell>
      {actionError && <div className="s0-error" role="alert">{actionError}</div>}
      <div className="s0-panel s0-panel-wide">
        <p className="s0-eyebrow">{t('nav.create')}</p>
        {move ? (
          <>
            {bet && <div className="s0-today2-from">{t('today2.because')} <span className="em">{clip(bet, 120)}</span></div>}
            <h1 className="s0-h1">{t('create.lead.title')}</h1>
            <p className="s0-lede">{move.what}</p>
            {move.whyNow ? <p className="s0-hint" style={{ marginTop: 8 }}>{clip(move.whyNow, 200)}</p> : null}
            <div className="s0-strat-actions" style={{ marginTop: 18 }}>
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} disabled={busy} onClick={makeIt}>
                {busy ? '…' : `${t('today2.makeit')} →`}
              </button>
            </div>
          </>
        ) : bet ? (
          // A strategy is held but it is NOT calling for content right now (no create-capable move). Say so
          // plainly and explain with the strategy's OWN stance — never contradict it by pushing content.
          <>
            {bet && <div className="s0-today2-from">{t('today2.because')} <span className="em">{clip(bet, 120)}</span></div>}
            <h1 className="s0-h1">{t('create.notnow.title')}</h1>
            <p className="s0-lede">{t('create.notnow.body')}</p>
            {contentRole ? <p className="s0-hint" style={{ marginTop: 8 }}>{t('create.notnow.role', { role: clip(contentRole, 200) })}</p> : null}
            <div className="s0-strat-actions" style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => navigate(`/b/${id}/strategy`)}>
                {t('create.notnow.toStrategy')} →
              </button>
              <button type="button" className="s0-btn-ghost" style={{ maxWidth: 240 }} onClick={() => navigate(`/b/${id}/today`)}>
                {t('create.notnow.toToday')}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="s0-h1">{t('create.none.title')}</h1>
            <p className="s0-lede">{t('create.none.body')}</p>
            <div className="s0-strat-actions" style={{ marginTop: 18 }}>
              <button type="button" className="s0-plan-primary" style={{ maxWidth: 320 }} onClick={() => navigate(`/b/${id}/today`)}>
                {t('create.none.seetoday')}
              </button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
