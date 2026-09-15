import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { getMirror, correctMirror, type MirrorView as MirrorData, type MirrorLaneItem, type MirrorMismatch } from '../api/client';

type T = (k: string, v?: Record<string, string>) => string;

/**
 * THE MIRROR — the differentiator. Three lanes of the founder's own inputs side by side (what I saw / what you
 * told me about the business / what you told me about yourself) and, below, the CONTRAST: where they don't line
 * up. Each contrast cites BOTH sides. Calm, specific, non-accusatory. The founder can correct any line; a
 * correction persists and the mirror recomputes. It is a projection over existing state — never a profile.
 */
export function MirrorView(props: { businessId: string; onConfirm: () => void; t?: T }) {
  const loc = useLocale() as { t: T };
  const t = props.t ?? loc.t;
  const { businessId } = props;
  const [data, setData] = useState<MirrorData | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setErr(false);
    try { setData(await getMirror(businessId)); } catch { setErr(true); }
  }, [businessId]);
  useEffect(() => { void load(); }, [load]);

  const onCorrect = useCallback(async (subject: string, statement: string) => {
    setData(await correctMirror(businessId, subject, statement)); // recomputed mirror replaces the view
  }, [businessId]);

  if (err) return <p className="s0-lede">{t('mirror.err')}</p>;
  if (!data) return <div className="s0-loading">{t('common.loading')}</div>;

  const lanes: { key: 'observed' | 'business' | 'self'; label: string; items: MirrorLaneItem[]; tone: string }[] = [
    { key: 'observed', label: t('mirror.lane.observed'), items: data.observed, tone: 's0-mirror-lane-observed' },
    { key: 'business', label: t('mirror.lane.business'), items: data.business, tone: 's0-mirror-lane-business' },
    { key: 'self', label: t('mirror.lane.self'), items: data.self, tone: 's0-mirror-lane-self' },
  ];

  return (
    <div className="s0-mirror">
      <h1 className="s0-h1">{t('mirror.title')}</h1>
      <p className="s0-lede">{t('mirror.sub')}</p>

      <div className="s0-mirror-lanes">
        {lanes.map((lane) => (
          <section key={lane.key} className={`s0-mirror-lane ${lane.tone}`}>
            <div className="s0-mirror-lane-k">{lane.label}</div>
            {lane.items.length === 0 ? (
              <p className="s0-mirror-empty">{lane.key === 'self' ? t('mirror.self.empty') : t('mirror.lane.empty')}</p>
            ) : (
              <ul className="s0-mirror-list">
                {lane.items.map((it, i) => (
                  <li key={i} className="s0-mirror-item">
                    <span className="s0-mirror-item-label">{it.label}</span>
                    <span className="s0-mirror-item-stmt">{it.statement}</span>
                    {it.provenance === 'unknown' ? <span className="s0-mirror-prov">{t('mirror.prov.unknown')}</span> : null}
                    {it.provenance === 'inferred' ? <span className="s0-mirror-prov">{t('mirror.prov.inferred')}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section className="s0-mirror-contrast">
        <div className="s0-mirror-contrast-k">{t('mirror.contrast.k')}</div>
        {data.contrasts.length === 0 ? (
          <p className="s0-mirror-contrast-none">{data.hasSelf ? t('mirror.contrast.none') : t('mirror.contrast.needself')}</p>
        ) : (
          <div className="s0-mirror-contrast-list">
            {data.contrasts.map((c, i) => <ContrastCard key={i} c={c} t={t} onCorrect={onCorrect} />)}
          </div>
        )}
      </section>

      <div className="s0-today2-foot">
        <div className="s0-today2-actions">
          <button type="button" className="s0-btn" onClick={props.onConfirm}>{t('mirror.confirm')} →</button>
        </div>
      </div>
    </div>
  );
}

const LANE_TAG: Record<string, string> = {
  observed: 'mirror.tag.observed', business: 'mirror.tag.business', self: 'mirror.tag.self', strategy: 'mirror.tag.strategy',
};

/** One reflected mismatch: the founder's own words held against real evidence, then a calm tension. Correctable. */
function ContrastCard({ c, t, onCorrect }: { c: MirrorMismatch; t: T; onCorrect: (subject: string, statement: string) => Promise<void> }) {
  const [correcting, setCorrecting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function save() {
    const s = text.trim();
    if (!s || busy) return;
    setBusy(true); setErr(false);
    try { await onCorrect(`mirror:${c.founderLane}`, s); setCorrecting(false); setText(''); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  return (
    <div className="s0-mirror-card">
      <p className="s0-mirror-said"><span className="s0-mirror-side-tag">{t(LANE_TAG[c.founderLane])}</span> {c.founderWords}</p>
      <p className="s0-mirror-against"><span className="s0-mirror-side-tag">{t(LANE_TAG[c.againstLane])}</span> {c.against}</p>
      <p className="s0-mirror-tension">{c.tension}</p>
      {correcting ? (
        <div className="s0-correct">
          <textarea className="s0-correct-field" rows={2} autoFocus value={text} placeholder={t('mirror.correct.ph')} onChange={(e) => setText(e.target.value)} />
          {err ? <div className="s0-error" role="alert">{t('common.actionFailed')}</div> : null}
          <div className="s0-today2-actions">
            <button type="button" className="s0-btn" disabled={busy || !text.trim()} onClick={save}>{busy ? '…' : t('mirror.correct.save')}</button>
            <button type="button" className="s0-btn-ghost" onClick={() => setCorrecting(false)}>{t('verdict.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="s0-linkbtn s0-mirror-notright" onClick={() => setCorrecting(true)}>{t('mirror.correct.open')}</button>
      )}
    </div>
  );
}
