import { LegalFooter } from './LegalPages';

/**
 * Public, no-login landing at `/` on app.getbusinessbrain.com — the public shell of the real Business Brain
 * application, reviewer-readable for Meta Access Verification. Copy is truthful and consistent with the approved
 * Instagram use case: analysis + recommendations + content guidance from AUTHORIZED data only. No testimonials,
 * no customer counts, no growth guarantees, no unbuilt/unapproved capabilities (no publishing, DMs, or ads).
 */
export function LandingPage(): JSX.Element {
  const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 22px 8px', color: 'var(--ink,#251d15)', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', lineHeight: 1.55 };
  const kicker: React.CSSProperties = { fontSize: '0.82rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3,#8a8275)', marginBottom: 10 };
  const h1: React.CSSProperties = { fontSize: '1.9rem', fontWeight: 700, margin: '0 0 14px' };
  const p: React.CSSProperties = { fontSize: '1.05rem', margin: '0 0 16px' };
  const h2: React.CSSProperties = { fontSize: '1.15rem', fontWeight: 700, margin: '28px 0 8px' };
  const btn: React.CSSProperties = { display: 'inline-block', background: 'var(--accent,#bd7d54)', color: '#fff', padding: '11px 20px', borderRadius: 10, textDecoration: 'none', fontWeight: 600, marginTop: 6 };
  const link: React.CSSProperties = { color: 'var(--accent,#bd7d54)', textDecoration: 'none' };
  const li: React.CSSProperties = { margin: '0 0 6px' };

  return (
    <div style={{ background: 'var(--bg,#f3ecdf)', minHeight: '100vh' }}>
      <main style={wrap}>
        <div style={kicker}>Business Brain — by Blackline Solutions S.R.L.</div>
        <h1 style={h1}>Grounded business &amp; marketing intelligence for founders</h1>

        <p style={p}>
          <strong>Business Brain</strong> is a SaaS platform for founders and businesses that helps them
          understand their business and marketing, build strategy, and create marketing content.
        </p>

        <h2 style={h2}>Connect your Instagram business account</h2>
        <p style={p}>
          When you choose to connect your Instagram business account, Business Brain uses the authorized
          Instagram profile, content and insights data to analyze your existing marketing activity and provide
          business-specific observations, strategic recommendations, and content guidance. This Platform Data is
          used only to provide the service to you — the client who connected and authorized your own account — and
          it is never sold or shared. You can disconnect and delete it at any time.
        </p>

        <h2 style={h2}>What Business Brain does</h2>
        <ul>
          <li style={li}>Builds a grounded understanding of your business and marketing from sources you authorize.</li>
          <li style={li}>Helps you shape and refine a marketing strategy.</li>
          <li style={li}>Provides content guidance and helps you create marketing content.</li>
        </ul>

        <p style={{ ...p, marginTop: 22 }}>
          <a href="/signin" style={btn}>Open Business Brain</a>
        </p>

        <h2 style={h2}>About the provider</h2>
        <p style={p}>
          Business Brain is developed and operated by <strong>BLACKLINE SOLUTIONS S.R.L.</strong>, a company
          registered in Romania (Romanian Tax Identification Number 45154743).
        </p>

        <p style={{ ...p, fontSize: '0.98rem' }}>
          <a href="/privacy-policy" style={link}>Privacy Policy</a> ·{' '}
          <a href="/data-deletion" style={link}>Data Deletion</a> ·{' '}
          <a href="/terms" style={link}>Terms</a> ·{' '}
          <a href="/contact" style={link}>Contact</a>
        </p>
      </main>
      <LegalFooter />
    </div>
  );
}
