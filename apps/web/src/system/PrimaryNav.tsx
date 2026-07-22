import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getBusinessProfile, getPreferences, setLanguage, logoutSession, type Language } from '../api/client';

/**
 * The one persistent application shell navigation (Phase 1). Founder-friendly names only — no internal subsystem terms.
 * Shown on every authenticated page (rendered by AppShell); renders nothing when signed out. Active state is clear, the
 * current business name appears when known, and a small language toggle keeps the founder's language coherent.
 */
const ITEMS: Array<{ to: string; label: string }> = [
  { to: '/home', label: 'Home' },
  { to: '/business', label: 'Business' },
  { to: '/understanding', label: 'Understanding' },
  { to: '/clarity', label: 'Clarity' },
  { to: '/strategy', label: 'Strategy' },
  { to: '/sources', label: 'Sources' },
];

export function PrimaryNav() {
  const { founderId, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>('en');

  useEffect(() => {
    if (!founderId) return;
    void getBusinessProfile().then((p) => setBusinessName(p.name)).catch(() => {});
    void getPreferences().then((p) => setLang(p.language)).catch(() => {});
  }, [founderId, location.pathname]);

  if (!founderId) return null; // signed out → no app nav

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  const toggleLang = async () => { const next: Language = lang === 'en' ? 'ro' : 'en'; setLang(next); try { await setLanguage(next); } catch { /* ignore */ } };
  const signOut = async () => { try { await logoutSession(); } catch { /* ignore */ } await refresh(); navigate('/start', { replace: true }); };

  return (
    <nav data-testid="primary-nav" aria-label="Business Brain" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-5)', flexWrap: 'wrap' }}>
      {businessName && <span data-testid="nav-business-name" style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{businessName}</span>}
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        {ITEMS.map((i) => (
          <Link key={i.to} to={i.to} data-testid={`nav-${i.label.toLowerCase()}`}
            aria-current={isActive(i.to) ? 'page' : undefined}
            style={{ textDecoration: 'none', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', fontWeight: isActive(i.to) ? 600 : 400, color: isActive(i.to) ? 'var(--ink)' : 'var(--ink-3)', borderBottom: isActive(i.to) ? '2px solid var(--gold)' : '2px solid transparent', paddingBottom: 2 }}>
            {i.label}
          </Link>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
        <button type="button" data-testid="lang-toggle" onClick={() => void toggleLang()} title="Language" style={pill}>{lang.toUpperCase()}</button>
        <Link to="/account" data-testid="nav-account" aria-current={isActive('/account') ? 'page' : undefined} style={{ textDecoration: 'none', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: isActive('/account') ? 'var(--ink)' : 'var(--ink-3)' }}>Account</Link>
        <button type="button" data-testid="nav-signout" onClick={() => void signOut()} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' }}>Sign out</button>
      </div>
    </nav>
  );
}
const pill = { background: 'transparent', border: '1px solid var(--line-2)', borderRadius: 'var(--r-1)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', color: 'var(--ink-2)', letterSpacing: '0.04em' } as const;
