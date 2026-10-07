/**
 * /brief-preview — hidden (dev-only route) container for the Living Brief.
 *
 * Consumes ONLY the read-only GET /v1/businessbrain/current (getBBCurrent) — no other endpoint,
 * no writes, no refresh. Classifies the six screen states and renders <LivingBrief/> or the matching
 * state surface. A dev-only ?demo=<key> switch renders fixtures deterministically for design review
 * (desktop/mobile screenshots) without a live API or auth.
 */
import { useEffect, useState } from 'react';
import { ApiError, getBBCurrent, type BBCurrent, type BBCurrentVersion } from '../../api/client';
import { classifyBriefState } from './traceability';
import { LivingBrief } from './LivingBrief';
import {
  fullVersion, versionNoTraceability, versionBrokenTraceability, insufficientVersion, noCurrent,
} from './fixtures';

const shell: React.CSSProperties = {
  minHeight: '100vh', background: 'var(--paper, #f7f4ee)', color: 'var(--ink, #26221c)',
  font: '400 16px/1.65 var(--sans, Inter, system-ui)',
};
const centered: React.CSSProperties = {
  maxWidth: 'var(--reading, 680px)', margin: '0 auto', padding: '120px 22px', textAlign: 'center',
};

function Notice({ kicker, head, body }: { kicker: string; head: string; body: string }) {
  return (
    <div style={centered}>
      <p style={{ font: '600 11px/1.4 var(--sans, Inter)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold, #b07d33)', margin: '0 0 14px' }}>{kicker}</p>
      <h1 style={{ font: '400 26px/1.35 var(--serif, Newsreader, Georgia)', color: 'var(--ink, #26221c)', margin: '0 0 12px' }}>{head}</h1>
      <p style={{ font: '400 15px/1.7 var(--sans, Inter)', color: 'var(--ink-2, #4a443b)', margin: 0 }}>{body}</p>
    </div>
  );
}

const DEMOS: Record<string, BBCurrent | null> = {
  version: fullVersion,
  'no-traceability': versionNoTraceability,
  broken: versionBrokenTraceability,
  insufficient: insufficientVersion,
  none: noCurrent,
  loading: null,
};

export function BriefPreviewPage() {
  // Dev-only deterministic demo switch (fixtures) — never runs in a production build.
  const demoKey = import.meta.env.DEV
    ? new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('demo')
    : null;
  const isDemo = !!demoKey && demoKey in DEMOS;

  const [current, setCurrent] = useState<BBCurrent | null>(isDemo ? DEMOS[demoKey!] : null);
  const [authError, setAuthError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (isDemo) return; // fixtures — no fetch
    let alive = true;
    getBBCurrent()
      .then((c) => { if (alive) setCurrent(c); })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) setAuthError(true);
        else setLoadError(true);
      });
    return () => { alive = false; };
  }, [isDemo]);

  if (authError) return <div style={shell}><Notice kicker="Living Brief" head="Sign in to view your Brief" body="This preview reads your current Business Brain version, which requires you to be signed in." /></div>;
  if (loadError) return <div style={shell}><Notice kicker="Living Brief" head="We couldn’t load your Brief just now" body="Nothing was changed. Please try again in a moment." /></div>;

  const cls = classifyBriefState(current);
  const v = cls.version as BBCurrentVersion;

  switch (cls.state) {
    case 'loading':
      return <div style={shell}><Notice kicker="Living Brief" head="Reading your current Brief…" body="One moment — assembling your current version." /></div>;
    case 'no-current':
      return <div style={shell}><Notice kicker="Living Brief" head="No current version yet" body="Once your first Business Brain is generated, it will live here as a reasoned, living document." /></div>;
    case 'insufficient':
      return <div style={shell}><Notice kicker="Living Brief" head="Not enough to read your business yet" body="There isn’t yet enough in the record to form a confident reading. As more of your activity is imported, this Brief will fill in." /></div>;
    case 'version':
      return <div style={shell}><LivingBrief version={v} provenance={cls.provenance} /></div>;
    case 'version-no-traceability':
      return <div style={shell}><LivingBrief version={v} provenanceNote="Provenance links are not available for this version — the reasoning below is complete, but the evidence-to-recommendation trail isn’t shown." /></div>;
    case 'traceability-unavailable':
      return <div style={shell}><LivingBrief version={v} provenanceNote="Provenance links are temporarily unavailable for this version — the reasoning below is complete and unchanged." /></div>;
    default:
      return null;
  }
}
