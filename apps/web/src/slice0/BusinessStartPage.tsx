import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useSession } from './session';
import { AppShell } from './AppShell';
import { isNotFound, LoadError } from './errors';
import {
  getBusiness,
  getAha,
  getDiscoveredProfiles,
  learnBusiness,
  setDiscoveredProfileStatus,
  ApiError,
  type Business,
  type AhaFinding,
  type DiscoveredProfile,
} from '../api/client';

type Phase = 'loading' | 'intro' | 'website' | 'reading' | 'result';

// A long "read your business" generation legitimately takes ~45s–4min. The request layer (proxy,
// network) can drop that connection while the API keeps working and persists the result. So a dropped
// request is NOT proof of failure: we keep the founder in the honest "still reading" state and poll the
// persisted Aha before deciding. Bounded so a genuine failure still resolves to a real failure state.
const RECOVERY_WINDOW_MS = 270_000; // ~4.5min — covers the API's max generation (Anthropic 300s)
const RECOVERY_POLL_MS = 6_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  google_business: 'Google Business',
};

/** Slice 1: the real "BB learns my business" flow — website → reading → grounded Aha 1. */
export function BusinessStartPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const { account } = useSession();
  const navigate = useNavigate();

  const [business, setBusiness] = useState<Business | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resultState, setResultState] = useState<'synced' | 'partial' | 'empty' | 'failed' | null>(null);
  const [findings, setFindings] = useState<AhaFinding[]>([]);
  const [ahaStatus, setAhaStatus] = useState<'produced' | 'insufficient' | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredProfile[]>([]);
  const [loadErr, setLoadErr] = useState(false);   // B3 — transient load failure, distinct from a true 404

  const firstName = (account?.name ?? '').trim().split(/\s+/)[0] ?? '';

  // Load the business, and any prior Aha (persisted → resume straight to the result).
  const load = useCallback(async () => {
    if (!id) return;
    setLoadErr(false);
    try {
      const b = await getBusiness(id);
      setBusiness(b);
      const aha = await getAha(id);
      if (aha.state === 'produced' || aha.state === 'insufficient') {
        setAhaStatus(aha.state);
        setFindings(aha.findings ?? []);
        setResultState('synced');
        const dp = await getDiscoveredProfiles(id);
        setDiscovered(dp.profiles);
        setPhase('result');
      } else {
        setPhase('intro');
      }
    } catch (e) {
      if (isNotFound(e)) setBusiness(null); else setLoadErr(true);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function applyLearn(
    state: 'synced' | 'partial' | 'empty' | 'failed',
    status: 'produced' | 'insufficient',
    fs: AhaFinding[],
    dp: DiscoveredProfile[],
  ): void {
    setResultState(state);
    setAhaStatus(status);
    setFindings(fs);
    setDiscovered(dp);
    setPhase('result');
  }

  // After a dropped/timed-out learn request, poll the persisted Aha. Returns true once the result has
  // actually landed (the founder sees success), false if nothing landed within the window (real failure).
  async function recoverLearn(bid: string): Promise<boolean> {
    const deadline = Date.now() + RECOVERY_WINDOW_MS;
    while (Date.now() < deadline) {
      await sleep(RECOVERY_POLL_MS);
      try {
        const aha = await getAha(bid);
        if (aha.state === 'produced' || aha.state === 'insufficient') {
          let dp: DiscoveredProfile[] = [];
          try { dp = (await getDiscoveredProfiles(bid)).profiles; } catch { /* best-effort */ }
          applyLearn('synced', aha.state, aha.findings ?? [], dp.filter((d) => d.status === 'discovered'));
          return true;
        }
      } catch { /* transient — keep polling */ }
    }
    return false;
  }

  async function runLearn(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const bid = id;
    setError(null);
    setPhase('reading');
    try {
      const r = await learnBusiness(bid, url.trim());
      applyLearn(r.state, r.aha.status, r.aha.findings, r.discovered.filter((d) => d.status === 'discovered'));
    } catch (err) {
      // The request dropped — but the API may still be finishing and persisting. Stay in the honest
      // "still reading" state and confirm whether the result landed before ever declaring failure.
      const recovered = await recoverLearn(bid);
      if (recovered) return;
      setResultState('failed');
      setError(err instanceof ApiError ? err.message : t('learn.fail.title'));
      setPhase('result');
    }
  }

  async function confirmProfile(pid: string, status: 'confirmed' | 'rejected') {
    if (!id) return;
    try {
      await setDiscoveredProfileStatus(id, pid, status);
    } catch {
      /* best-effort */
    }
    setDiscovered((prev) => prev.filter((d) => d.id !== pid));
  }

  if (loadErr) return <LoadError onRetry={() => { if (id) void load(); }} />;
  if (business === undefined || phase === 'loading') {
    return (
      <AppShell showSignOut>
        <div className="s0-loading">{t('common.loading')}</div>
      </AppShell>
    );
  }
  if (business === null) return <Navigate to="/" replace />;
  const name = business.name;

  return (
    <AppShell showSignOut>
      <div className="s0-panel s0-panel-wide">
        {phase === 'intro' && (
          <>
            <h1 className="s0-h1">{t('start.greeting', { name: firstName })}</h1>
            <p className="s0-lede">{t('start.understand', { business: name })}</p>
            <button type="button" className="s0-btn" style={{ maxWidth: 320 }} onClick={() => setPhase('website')}>
              {t('start.cta')}
            </button>
          </>
        )}

        {phase === 'website' && (
          <>
            <h1 className="s0-h1">{t('website.title', { business: name })}</h1>
            <p className="s0-lede">{t('website.q')}</p>
            <form onSubmit={runLearn} style={{ maxWidth: 460 }}>
              <div className="s0-field">
                <input
                  className="s0-input"
                  type="text"
                  inputMode="url"
                  placeholder={t('website.placeholder')}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="s0-btn" disabled={url.trim().length === 0}>
                {t('website.cta')}
              </button>
            </form>
          </>
        )}

        {phase === 'reading' && (
          <div>
            <div className="s0-spinner" aria-hidden="true" />
            <h1 className="s0-h1">{t('reading.title', { business: name })}</h1>
            <p className="s0-lede">{t('reading.sub')}</p>
          </div>
        )}

        {phase === 'result' && (
          <ResultView
            name={name}
            resultState={resultState}
            ahaStatus={ahaStatus}
            findings={findings}
            discovered={discovered}
            error={error}
            onRetry={() => { setPhase('website'); setError(null); }}
            onConfirm={confirmProfile}
            onContinue={() => navigate(`/b/${business.id}/talk`)}
            t={t}
          />
        )}
      </div>
    </AppShell>
  );
}

function ResultView(props: {
  name: string;
  resultState: 'synced' | 'partial' | 'empty' | 'failed' | null;
  ahaStatus: 'produced' | 'insufficient' | null;
  findings: AhaFinding[];
  discovered: DiscoveredProfile[];
  error: string | null;
  onRetry: () => void;
  onConfirm: (pid: string, status: 'confirmed' | 'rejected') => void;
  onContinue: () => void;
  t: (k: string, v?: Record<string, string>) => string;
}) {
  const { name, resultState, ahaStatus, findings, discovered, error, onRetry, onConfirm, onContinue, t } = props;

  if (resultState === 'failed') {
    return (
      <>
        <h1 className="s0-h1">{t('learn.fail.title')}</h1>
        {error && <p className="s0-lede">{error}</p>}
        <button type="button" className="s0-btn" style={{ maxWidth: 320 }} onClick={onRetry}>
          {t('learn.fail.retry')}
        </button>
      </>
    );
  }
  if (resultState === 'empty' || ahaStatus === 'insufficient') {
    const title = resultState === 'empty' ? t('learn.empty.title') : t('aha.insufficient.title');
    const body = resultState === 'empty' ? t('learn.empty.body') : t('aha.insufficient.body');
    return (
      <>
        <h1 className="s0-h1">{title}</h1>
        <p className="s0-lede">{body}</p>
        <button type="button" className="s0-btn" style={{ maxWidth: 320 }} onClick={onRetry}>
          {t('learn.fail.retry')}
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="s0-h1">{t('aha.heading', { business: name })}</h1>
      <div className="s0-aha">
        {findings.map((f, i) => (
          <div key={i} className="s0-finding">
            <p className="s0-finding-text">{f.finding}</p>
            {f.implication && <p className="s0-finding-impl">{f.implication}</p>}
            {f.sourceRefs.length > 0 && (
              <details className="s0-why">
                <summary>{t('aha.why')}</summary>
                <div className="s0-why-body">
                  <span>{t('aha.source')}: </span>
                  {f.sourceRefs.map((s, j) => (
                    <a key={j} className="s0-why-source" href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.label}
                    </a>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>

      {discovered.length > 0 && (
        <div className="s0-discovered">
          {discovered.map((d) => (
            <div key={d.id} className="s0-discovered-row">
              <span className="s0-discovered-q">
                {t('aha.discovered.q', { platform: PLATFORM_LABEL[d.platform] ?? d.platform })}
              </span>
              <div className="s0-discovered-actions">
                <button type="button" className="s0-mini" onClick={() => onConfirm(d.id, 'confirmed')}>
                  {t('aha.discovered.yes')}
                </button>
                <button type="button" className="s0-mini" onClick={() => onConfirm(d.id, 'rejected')}>
                  {t('aha.discovered.no')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button type="button" className="s0-btn" style={{ maxWidth: 320, marginTop: 30 }} onClick={onContinue}>
        {t('aha.continue')}
      </button>
    </>
  );
}
