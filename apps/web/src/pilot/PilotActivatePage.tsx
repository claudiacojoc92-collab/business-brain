import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { pilotActivate, pilotSetup, pilotMe, ApiError } from '../api/client';
import { AppShell, Button, Field } from '../system/ui';

/**
 * Pilot activation + minimal setup. An invited founder enters their code, gives explicit pilot consent (and an optional,
 * separate opt-in for human review of conversations), then a SHORT setup — every field optional, "I'm not sure" is fine.
 * What they state becomes founder-governed Understanding, so the clarity flow can use it immediately. Reaches first value fast.
 */
export function PilotActivatePage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'activate' | 'setup'>('activate');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [reviewOptIn, setReviewOptIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ businessName: '', sells: '', primaryCustomer: '', stage: '', goal: '', constraint: '' });

  useEffect(() => { if (founderId) void pilotMe().then((p) => { if (p?.consentPilot) setPhase('setup'); }).catch(() => {}); }, [founderId]);
  if (isLoading) return null;
  if (!founderId) return <Navigate to="/signin" replace />;

  const activate = async () => {
    if (!code.trim() || !consent) { setError('An invite code and pilot consent are required.'); return; }
    setBusy(true); setError(null);
    try { await pilotActivate(code.trim(), true, reviewOptIn); setPhase('setup'); }
    catch (e) { setError(e instanceof ApiError && e.status === 409 ? 'That invite isn’t available.' : 'Could not activate just now.'); }
    finally { setBusy(false); }
  };
  const save = async (complete: boolean) => {
    setBusy(true); setError(null);
    try {
      await pilotSetup({ businessName: f.businessName || undefined, sells: f.sells || undefined, primaryCustomer: f.primaryCustomer || undefined, stage: f.stage || undefined, goals: f.goal ? [f.goal] : [], constraints: f.constraint ? [f.constraint] : [], complete });
      navigate('/welcome');
    } catch { setError('Could not save just now.'); } finally { setBusy(false); }
  };

  return (
    <AppShell>
      <div data-testid="pilot-activate">
        <p style={eyebrow}>Pilot</p>
        {phase === 'activate' ? (
          <>
            <h1 style={h1}>You’re invited to the pilot</h1>
            <p style={lede}>Business Brain is in a small founder pilot. Enter your invite code to begin. Your business data is yours — you can export or delete it at any time.</p>
            <div style={{ maxWidth: 420 }}>
              <Field label="Invite code" id="code" value={code} onChange={setCode} placeholder="BB-XXXXXXXX" />
              <label style={consentRow}><input type="checkbox" data-testid="consent-pilot" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I agree to take part in the pilot and understand my business context is stored to make Business Brain work.</label>
              <label style={consentRow}><input type="checkbox" data-testid="consent-review" checked={reviewOptIn} onChange={(e) => setReviewOptIn(e.target.checked)} /> <span>Optional: I allow the team to review my conversations to improve the product.</span></label>
              {error && <p style={errStyle}>{error}</p>}
              <div style={{ marginTop: 'var(--sp-3)' }}><Button variant="primary" loading={busy} disabled={!code.trim() || !consent} onClick={() => void activate()}><span data-testid="activate">Activate</span></Button></div>
            </div>
          </>
        ) : (
          <>
            <h1 style={h1}>Tell me a little about your business</h1>
            <p style={lede}>Just enough to be useful — every field is optional, and “I’m not sure” is completely fine. You can correct any of this later.</p>
            <div style={{ maxWidth: 480 }}>
              <Field label="Business name" id="bn" value={f.businessName} onChange={(v) => setF({ ...f, businessName: v })} />
              <Field label="What you offer" id="sells" value={f.sells} onChange={(v) => setF({ ...f, sells: v })} />
              <Field label="Your primary customer" id="cust" value={f.primaryCustomer} onChange={(v) => setF({ ...f, primaryCustomer: v })} />
              <Field label="Current stage" id="stage" value={f.stage} onChange={(v) => setF({ ...f, stage: v })} placeholder="e.g. pre-revenue, early customers, growing" />
              <Field label="A current goal (optional)" id="goal" value={f.goal} onChange={(v) => setF({ ...f, goal: v })} />
              <Field label="A constraint you work within (optional)" id="con" value={f.constraint} onChange={(v) => setF({ ...f, constraint: v })} />
              {error && <p style={errStyle}>{error}</p>}
              <div style={{ display: 'flex', gap: 12, marginTop: 'var(--sp-3)' }}>
                <Button variant="primary" loading={busy} onClick={() => void save(true)}><span data-testid="setup-save">Save & continue</span></Button>
                <button type="button" data-testid="setup-skip" onClick={() => void save(false)} style={skipBtn}>Skip for now</button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

const eyebrow = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--gold)', margin: '0 0 var(--sp-2)' };
const h1 = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-6)', color: 'var(--ink)', margin: '0 0 var(--sp-2)', lineHeight: 'var(--lh-tight)' } as const;
const lede = { fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)', color: 'var(--ink-2)', margin: '0 0 var(--sp-4)', lineHeight: 'var(--lh-body)' } as const;
const consentRow = { display: 'flex', gap: 8, alignItems: 'flex-start', fontFamily: 'var(--serif)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', margin: 'var(--sp-3) 0 0', lineHeight: 'var(--lh-body)' } as const;
const errStyle = { fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--err-ink, #a3423c)', marginTop: 'var(--sp-2)' } as const;
const skipBtn = { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-3)' } as const;
