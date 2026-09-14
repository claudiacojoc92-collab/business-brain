import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useSession } from './session';
import { useLocale } from '../i18n/LocaleContext';
import {
  getUnderstanding, getCurrentStrategy, getToday,
  type UnderstandingView, type StrategyResp, type TodayResp, type TodayAction,
} from '../api/client';

/**
 * Home — "what matters right now." BB speaks first. This surface invents nothing: it composes three
 * existing real reads (understanding, current strategy, today) into one honest orientation. There is NO
 * cross-visit monitoring, so Home NEVER claims "something moved" or "while you were away" — it states
 * present truth and the one next action for wherever the founder actually is in the loop.
 */

type Stage = 'no_understanding' | 'need_strategy' | 'need_today' | 'has_move';

interface Composed {
  stage: Stage;
  interp: string;          // the one strong BB orientation
  why: string;             // why it matters (concise)
  primaryLabel: string;
  primaryTo: string;
  move?: TodayAction | null;
  tension?: string | null; // one unresolved thing, only when real
  canCreate?: boolean;
}

const firstNonEmpty = (...xs: (string | undefined | null)[]): string => {
  for (const x of xs) if (typeof x === 'string' && x.trim().length > 0) return x.trim();
  return '';
};

/** Keep the hero to one legible thought. Understanding summaries can be long paragraphs; the full detail
 *  always lives on the Business surface, so the hero clips at a word boundary rather than blowing the fold. */
const clip = (s: string, n: number): string => {
  const t = s.trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[.,;:\s]+$/, '')}…`;
};

function deriveTension(u: UnderstandingView | null, s: StrategyResp | null): string | null {
  const bundle = s?.strategy?.core;
  const to = bundle?.tradeOffs?.find((t) => t.choosing && t.over);
  if (to) return `You're choosing ${to.choosing} over ${to.over}${to.why ? ` — ${to.why}` : ''}.`;
  const nn = bundle?.notNow?.find((n) => n.item);
  if (nn) return `Deliberately not now: ${nn.item}${nn.reason ? ` — ${nn.reason}` : ''}.`;
  const contra = u?.understanding?.contradictions?.find((c) => c.tension);
  if (contra) return contra.tension;
  const unk = u?.understanding?.unknowns?.find((x) => typeof x === 'string' && x.trim());
  if (unk) return `Still unresolved: ${unk}`;
  return null;
}

function compose(
  base: string,
  u: UnderstandingView | null,
  s: StrategyResp | null,
  today: TodayResp | null,
): Composed {
  const uPresent = u?.state === 'present';
  const adopted = Boolean(s?.strategy && s?.adoptedAt);
  const bet = firstNonEmpty(s?.strategy?.core?.coreBet?.priority);
  const betWhy = firstNonEmpty(
    s?.strategy?.core?.coreBet?.whyOverAlternative,
    s?.strategy?.core?.coreBet?.relationToGoal,
  );
  const offer = firstNonEmpty(u?.understanding?.offer?.summary);
  const positioning = firstNonEmpty(u?.understanding?.positioning?.summary);
  const move = today?.state === 'active' ? (today.ready?.[0] ?? null) : null;
  const tension = deriveTension(u, s);

  if (!uPresent) {
    return {
      stage: 'no_understanding',
      interp: "I don't know your business yet.",
      why: 'Point me at your website and I’ll read it — everything else in Business Brain builds on what I understand.',
      primaryLabel: 'Read my business',
      primaryTo: base, // Business surface owns the learn flow
      tension: null,
    };
  }

  if (!adopted) {
    // Hero stays to one thought; the full descriptive read becomes the supporting body (the whole
    // understanding lives on the Business surface). Never let a paragraph become the headline.
    const lead = clip(firstNonEmpty(positioning, offer, 'I’ve read your business.'), 150);
    const body = firstNonEmpty(
      positioning && offer && positioning !== offer ? offer : '',
      'This is what I read from your site. The next move is to decide the one strategic bet worth making.',
    );
    return {
      stage: 'need_strategy',
      interp: lead,
      why: body,
      primaryLabel: 'Decide the strategic bet',
      primaryTo: `${base}/strategy`,
      tension,
    };
  }

  if (!move) {
    // Today has no ready move but a blocked one is waiting on the founder — say so, don't imply "all set".
    if (today?.state === 'active' && today.blocked) {
      return {
        stage: 'need_today',
        interp: 'Something needs you before the next move.',
        why: firstNonEmpty(today.blocked.what, betWhy) || 'A move on Today is waiting on you.',
        primaryLabel: 'Resolve it on Today',
        primaryTo: `${base}/today`,
        tension,
      };
    }
    return {
      stage: 'need_today',
      interp: bet ? clip(bet, 150) : 'Your strategic bet is set.',
      why: betWhy || 'Your bet is adopted. The next move is to turn it into what to do now.',
      primaryLabel: "Shape today’s move",
      primaryTo: `${base}/today`,
      tension,
    };
  }

  return {
    stage: 'has_move',
    interp: bet ? clip(bet, 150) : 'Your strategic bet is set.',
    why: betWhy || '',
    primaryLabel: 'Go to today’s move',
    primaryTo: `${base}/today`,
    move,
    canCreate: Boolean(move.canCreate),
    tension,
  };
}

function Skeleton() {
  return (
    <div className="s0-home">
      <div className="s0-home-eyebrow">Loading…</div>
      <div className="s0-home-lead s0-home-skel" aria-hidden="true">&nbsp;</div>
    </div>
  );
}

export function HomePage(): React.ReactElement {
  const { id } = useParams();
  const { businesses } = useSession();
  const { t } = useLocale();
  const business = businesses.find((b) => b.id === id);
  const base = `/b/${id}`;

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState<Composed | null>(null);

  useEffect(() => {
    let live = true;
    if (!id) return;
    setLoading(true);
    setFailed(false);
    void Promise.allSettled([getUnderstanding(id), getCurrentStrategy(id), getToday(id)]).then((r) => {
      if (!live) return;
      const u = r[0].status === 'fulfilled' ? r[0].value : null;
      const s = r[1].status === 'fulfilled' ? r[1].value : null;
      const today = r[2].status === 'fulfilled' ? r[2].value : null;
      // A total failure (all three rejected) is the only real error; partials degrade gracefully.
      if (!u && !s && !today) { setFailed(true); setLoading(false); return; }
      setData(compose(base, u, s, today));
      setLoading(false);
    });
    return () => { live = false; };
  }, [id, base]);

  return (
    <AppShell>
      {loading ? (
        <Skeleton />
      ) : failed || !data ? (
        <div className="s0-home">
          <div className="s0-home-eyebrow">{business?.name ?? ''}</div>
          <h1 className="s0-home-lead">{t('home.here')}</h1>
          <p className="s0-home-interp">
            I couldn’t load your business just now. Refresh, or open a surface directly.
          </p>
          <div className="s0-home-links">
            <Link to={`${base}`}>{t('nav.business')}</Link>
            <Link to={`${base}/strategy`}>{t('nav.strategy')}</Link>
            <Link to={`${base}/talk`}>{t('nav.talk')}</Link>
          </div>
        </div>
      ) : (
        <div className="s0-home">
          <div className="s0-home-eyebrow">
            {business?.name ? `${business.name} · ` : ''}{t('home.context')}
          </div>
          <h1 className="s0-home-lead">{t('home.here')}</h1>

          <p className="s0-home-interp">{data.interp}</p>
          {data.why ? <p className="s0-home-why">{data.why}</p> : null}

          {data.stage === 'has_move' && data.move ? (
            <div className="s0-home-move">
              <div className="s0-home-move-k">{t('home.donow')}</div>
              <div className="s0-home-move-what">{data.move.what}</div>
              {data.move.whyNow ? <div className="s0-home-move-why">{data.move.whyNow}</div> : null}
            </div>
          ) : null}

          <div className="s0-home-actions">
            <Link className="s0-btn" to={data.primaryTo}>{data.primaryLabel}</Link>
            {data.stage === 'has_move' && data.canCreate ? (
              <Link className="s0-btn-ghost" to={`${base}/create`}>{t('nav.create')}</Link>
            ) : null}
          </div>

          {data.tension ? (
            <div className="s0-home-tension">
              <div className="s0-home-tension-k">{t('home.tension')}</div>
              <p className="s0-home-tension-body">{data.tension}</p>
            </div>
          ) : null}

          <div className="s0-home-links">
            <Link to={`${base}`}>{t('nav.business')}</Link>
            <Link to={`${base}/strategy`}>{t('nav.strategy')}</Link>
            <Link to={`${base}/today`}>{t('nav.today')}</Link>
            <Link to={`${base}/talk`}>{t('nav.talk')}</Link>
          </div>
        </div>
      )}
    </AppShell>
  );
}
