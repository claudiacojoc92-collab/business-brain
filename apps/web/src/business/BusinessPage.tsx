import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getBusinessProfile, type BusinessProfile } from '../api/client';
import { AppShell, Button } from '../system/ui';

/**
 * Business (Phase 1) — one coherent profile of the business, composed from everything Business Brain has
 * gathered (synthesized understanding, the founder's own words, goals, constraints, resources, positioning).
 * It reads as a single portrait, not a set of disconnected subsystem screens. When little is known yet it
 * says so plainly and points to the ways to fill it in — it never invents a description.
 */
export function BusinessPage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!founderId) return;
    let alive = true;
    void getBusinessProfile().then((p) => { if (alive) { setProfile(p); setLoaded(true); } }).catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [founderId]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/start" replace />;
  if (!loaded || !profile) return <AppShell><div style={{ color: 'var(--ink-3)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)' }}>Loading…</div></AppShell>;

  if (!profile.hasAnyContext) {
    return (
      <AppShell>
        <div style={{ padding: '2vh 0 0', maxWidth: 620 }}>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, color: 'var(--ink)', margin: '0 0 var(--sp-4)' }}>Your business</h1>
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 0 var(--sp-5)' }}>
            I don’t understand your business yet. Once you add your website, describe it, or share materials,
            this page fills in with what I’ve learned — and how sure I am of each part.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => navigate('/understand')}>Add your website</Button>
            <Button variant="secondary" onClick={() => navigate('/declare')}>Describe your business</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const { name, stage, description, offer, customer, goals, constraints, resources, otherToldMe, positioningCount } = profile;

  return (
    <AppShell max="var(--reading-wide, 760px)">
      <div style={{ padding: '2vh 0 0' }}>
        <p style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-3)' }}>Your business</p>
        <h1 style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-1)', fontWeight: 500, lineHeight: 'var(--lh-tight)', color: 'var(--ink)', margin: '0 0 6px' }}>{name ?? 'Your business'}</h1>
        {stage && <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)', marginBottom: 'var(--sp-5)' }}>{stage}</div>}

        {description && (
          <p style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-5)', color: 'var(--ink)', lineHeight: 'var(--lh-body)', margin: 'var(--sp-4) 0 var(--sp-6)', maxWidth: '68ch' }}>{description}</p>
        )}

        <Row label="What it offers" value={offer} />
        <Row label="Who it’s for" value={customer} />

        <ListBlock label="Goals" items={goals} />
        <ListBlock label="Constraints we work within" items={constraints} />
        <ListBlock label="Resources" items={resources} />
        <ListBlock label="Other things you’ve told me" items={otherToldMe} />

        <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--line)', display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
          <Stat label="Positioning references" value={positioningCount} onClick={() => navigate('/market')} />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button variant="secondary" onClick={() => navigate('/understanding')}>See full understanding</Button>
            <Button variant="ghost" onClick={() => navigate('/declare')}>Add or correct something</Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', lineHeight: 'var(--lh-body)', maxWidth: '68ch' }}>{value}</div>
    </div>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 'var(--sp-5)' }}>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 8 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: '1.1em', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => <li key={i} style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink)', lineHeight: 'var(--lh-body)', maxWidth: '64ch' }}>{it}</li>)}
      </ul>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-2)', color: 'var(--ink)' }}>{value}</div>
      <div style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>{label} →</div>
    </button>
  );
}
