import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppShell, Button } from '../system/ui';

/**
 * A–E Wave 1 — the landing (/start). The first screen must read as a credible, considered product, not a
 * utility page: a calm composition, one promise, two clear actions. A subtle staged rise gives a sense of
 * arrival. (New route; the current production flow at /login is untouched.)
 */
export function LandingPage() {
  const { founderId, isLoading } = useAuth();
  if (!isLoading && founderId) return <Navigate to="/welcome" replace />;

  return (
    <AppShell
      max="var(--reading)"
      actions={<Link to="/signin" style={{ fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', textDecoration: 'none' }}>Sign in</Link>}
    >
      <div style={{ textAlign: 'center', padding: '6vh 0 0' }}>
        <p className="bb-rise" style={{ ['--i' as string]: 0, fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gold)', margin: '0 0 var(--sp-5)' }}>
          Your AI marketing strategist
        </p>
        <h1 className="bb-rise" style={{ ['--i' as string]: 1, fontFamily: 'var(--serif)', fontSize: 'var(--fs-display)', fontWeight: 500, lineHeight: 'var(--lh-tight)', letterSpacing: '-0.02em', color: 'var(--ink)', margin: '0 auto var(--sp-5)', maxWidth: 620 }}>
          First I understand your business. Then I understand you. Then we build.
        </h1>
        <p className="bb-rise" style={{ ['--i' as string]: 2, fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', lineHeight: 'var(--lh-body)', margin: '0 auto var(--sp-7)', maxWidth: 520 }}>
          Not a report. Not a dashboard. A strategist that reads your real business, learns how you think,
          and works with you on positioning, content, and growth — and gets sharper every week.
        </p>
        <div className="bb-rise" style={{ ['--i' as string]: 3, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/signup" style={{ textDecoration: 'none' }}><Button variant="primary">Create your account</Button></Link>
          <Link to="/signin" style={{ textDecoration: 'none' }}><Button variant="secondary">Sign in</Button></Link>
        </div>
      </div>
    </AppShell>
  );
}
