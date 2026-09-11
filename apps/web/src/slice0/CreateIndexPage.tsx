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
 * produced it. When BB is not holding a creation job it says so plainly and points back to Today — it never
 * offers a bare generator or a module picker (carousel/photos/reel), and it never biases Today toward content.
 */
export function CreateIndexPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [move, setMove] = useState<TodayAction | null>(null);
  const [bet, setBet] = useState('');
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
    if (st.status === 'fulfilled') setBet(st.value.strategy?.core?.coreBet?.priority ?? '');
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
