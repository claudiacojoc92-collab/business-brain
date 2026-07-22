import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import {
  getBusinessProfile, getEffectiveUnderstanding, listConcerns,
  TRUTH_LABEL_TEXT, type BusinessProfile, type EffectiveUnderstanding, type ConcernSummary,
} from '../api/client';
import { AppShell, Button } from '../system/ui';

/**
 * Home (Phase 1) — the founder's landing inside the product. Two honest states:
 *
 *  NEW FOUNDER (no business context yet): a calm invitation to help Business Brain understand the business —
 *  add a website, describe it, add materials, or continue later. It does NOT push the founder into a blank
 *  Clarity box before there is anything to be clear about.
 *
 *  RETURNING FOUNDER: what is understood so far, what is still incomplete, unresolved questions, the single
 *  most relevant next action, unfinished work, and a way to bring a tension. Everything shown is grounded in
 *  real state — nothing invented.
 */
export function HomePage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [understanding, setUnderstanding] = useState<EffectiveUnderstanding | null>(null);
  const [concerns, setConcerns] = useState<ConcernSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!founderId) return;
    let alive = true;
    void (async () => {
      const [p, u, c] = await Promise.all([
        getBusinessProfile().catch(() => null),
        getEffectiveUnderstanding().catch(() => null),
        listConcerns().catch(() => [] as ConcernSummary[]),
      ]);
      if (!alive) return;
      setProfile(p); setUnderstanding(u); setConcerns(c); setLoaded(true);
    })();
    return () => { alive = false; };
  }, [founderId]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/start" replace />;
  if (!loaded || !profile) return <AppShell><div style={{ color: 'var(--ink-3)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)' }}>Loading your business…</div></AppShell>;

  return profile.hasAnyContext
    ? <Returning profile={profile} understanding={understanding} concerns={concerns} navigate={navigate} />
    : <NewFounder navigate={navigate} />;
}

// ── New founder: help Business Brain understand the business (not a blank Clarity box) ────────────────────
function NewFounder({ navigate }: { navigate: (to: string) => void }) {
  return (
    <AppShell>
      <div style={{ padding: '2vh 0 0' }}>
        <p className="bb-rise" style={{ ['--i' as string]: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-4)' }}>Getting started</p>
        <h1 className="bb-rise" style={{ ['--i' as string]: 1, fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 'var(--lh-tight)', color: 'var(--ink)', margin: '0 0 var(--sp-4)', maxWidth: 620 }}>
          Let’s help Business Brain understand your business.
        </h1>
        <p className="bb-rise" style={{ ['--i' as string]: 2, fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-6)', maxWidth: 620 }}>
          The more I can see, the more useful I am. Start wherever is easiest — you can add the rest later.
          Nothing here is wasted, and nothing is shared.
        </p>
        <div className="bb-rise" style={{ ['--i' as string]: 3, display: 'grid', gap: 'var(--sp-4)', maxWidth: 620 }}>
          <ActionCard title="Add your website" body="I’ll read it from the outside and tell you what I actually understand." cta="Add website" onClick={() => navigate('/understand')} primary />
          <ActionCard title="Describe your business" body="Tell me in your own words what it is, who it’s for, and where you’re taking it." cta="Describe it" onClick={() => navigate('/declare')} />
          <ActionCard title="Add materials" body="Share documents or a calendar so I can ground my reading in what’s real." cta="Add materials" onClick={() => navigate('/connect')} />
        </div>
        <button type="button" onClick={() => navigate('/business')}
          style={{ marginTop: 'var(--sp-5)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>
          Continue later
        </button>
      </div>
    </AppShell>
  );
}

function ActionCard({ title, body, cta, onClick, primary }: { title: string; body: string; cta: string; onClick: () => void; primary?: boolean }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: primary ? 'var(--elev-1)' : 'none' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)', marginBottom: 6 }}>{title}</div>
      <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-body)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-4)' }}>{body}</p>
      <Button variant={primary ? 'primary' : 'secondary'} onClick={onClick}>{cta}</Button>
    </div>
  );
}

// ── Returning founder: what's understood, what's open, and the next move ──────────────────────────────────
function Returning({ profile, understanding, concerns, navigate }: {
  profile: BusinessProfile; understanding: EffectiveUnderstanding | null; concerns: ConcernSummary[]; navigate: (to: string) => void;
}) {
  const understood = understanding?.current ?? [];
  const unknowns = understanding?.unknowns ?? [];
  const disagreements = understanding?.disagreements ?? [];
  const openConcerns = concerns.filter((c) => c.status !== 'crystallized' && !c.crystallizedSessionId);
  const businessName = profile.name ?? 'your business';

  // The single most relevant next action, chosen from real state (most incomplete thing first).
  const next = understood.length === 0
    ? { label: 'Do an initial read of your business', to: '/understand' }
    : disagreements.length > 0
      ? { label: 'Resolve what we don’t yet agree on', to: '/understanding' }
      : unknowns.length > 0
        ? { label: 'Fill in what’s still unclear', to: '/clarity' }
        : { label: 'Decide a priority', to: '/strategy' };

  return (
    <AppShell max="var(--reading-wide, 760px)">
      <div style={{ padding: '2vh 0 0' }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' }}>Home</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 'var(--lh-tight)', color: 'var(--ink)', margin: '0 0 var(--sp-3)' }}>{businessName}</h1>

        {/* Most relevant next action — one clear move. */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)', margin: 'var(--sp-4) 0 var(--sp-6)', display: 'flex', gap: 'var(--sp-4)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 4 }}>Most useful next</div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)' }}>{next.label}</div>
          </div>
          <Button variant="primary" onClick={() => navigate(next.to)}>Continue →</Button>
        </div>

        <Section title="What I understand so far" empty={understood.length === 0 ? 'Nothing settled yet — an initial read will start this.' : undefined}>
          {understood.slice(0, 5).map((it) => (
            <li key={it.id} style={listItem}>
              <span style={{ color: 'var(--ink)' }}>{it.statement}</span>
              <span style={labelChip}>{TRUTH_LABEL_TEXT[it.label]}</span>
            </li>
          ))}
          {understood.length > 5 && <li style={{ ...listItem, color: 'var(--ink-3)' }}><button type="button" onClick={() => navigate('/understanding')} style={linkBtn}>See all {understood.length} →</button></li>}
        </Section>

        {unknowns.length > 0 && (
          <Section title="Still incomplete">
            {unknowns.slice(0, 5).map((u, i) => <li key={i} style={listItem}><span style={{ color: 'var(--ink-2)' }}>{u}</span></li>)}
          </Section>
        )}

        {disagreements.length > 0 && (
          <Section title="Unresolved questions">
            {disagreements.slice(0, 5).map((d) => (
              <li key={d.id} style={listItem}>
                <span style={{ color: 'var(--ink-2)' }}>{d.statement}</span>
                <button type="button" onClick={() => navigate('/understanding')} style={linkBtn}>Resolve →</button>
              </li>
            ))}
          </Section>
        )}

        {openConcerns.length > 0 && (
          <Section title="Unfinished work">
            {openConcerns.slice(0, 5).map((c) => (
              <li key={c.id} style={listItem}>
                <span style={{ color: 'var(--ink-2)' }}>{c.clarifiedConcern ?? c.originalInput}</span>
                <button type="button" onClick={() => navigate(`/clarity/${c.id}`)} style={linkBtn}>Continue →</button>
              </li>
            ))}
          </Section>
        )}

        {/* Bring a tension — always available, but never the only thing offered. */}
        <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', marginBottom: 'var(--sp-3)' }}>Something on your mind about the business?</div>
          <Button variant="secondary" onClick={() => navigate('/clarity')}><span data-testid="home-clarity-entry">Bring a tension →</span></Button>
        </div>
      </div>
    </AppShell>
  );
}

function Section({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section style={{ marginBottom: 'var(--sp-6)' }}>
      <h2 style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-3)', margin: '0 0 var(--sp-3)' }}>{title}</h2>
      {empty ? <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-body)', color: 'var(--ink-3)', margin: 0 }}>{empty}</p>
        : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>{children}</ul>}
    </section>
  );
}

const listItem: React.CSSProperties = { display: 'flex', gap: 'var(--sp-4)', alignItems: 'baseline', justifyContent: 'space-between', fontFamily: 'var(--serif)', fontSize: 'var(--fs-body)', lineHeight: 'var(--lh-body)' };
const labelChip: React.CSSProperties = { flexShrink: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', whiteSpace: 'nowrap' };
const linkBtn: React.CSSProperties = { flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--gold-ink, var(--ink-2))', whiteSpace: 'nowrap' };
