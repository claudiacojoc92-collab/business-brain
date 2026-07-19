import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getDeclareQuestions, submitDeclaration, ApiError, type DeclareQuestion } from '../api/client';
import { DECLARE_COPY } from './copy';

/**
 * The declaration surface (P1 · Slice 1) — minimal, functional, provisional infrastructure for the Value
 * Spine (NOT the final experience). On mount it GETs the six questions; the founder answers any subset and
 * submits ONCE (POST /declare persists `declared` evidence). No generation happens here. Session-guarded.
 */
const wrap: React.CSSProperties = { minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '48px 20px 96px' };
const inner: React.CSSProperties = { maxWidth: 'var(--reading)', margin: '0 auto' };
const title: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.9rem', fontWeight: 500, letterSpacing: '-0.01em', margin: '0 0 8px' };
const intro: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-2)', margin: '0 0 32px', lineHeight: 1.5 };
const quiet: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-3)' };
const label: React.CSSProperties = { display: 'block', fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', margin: '0 0 8px' };
const field: React.CSSProperties = { width: '100%', minHeight: 72, fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', background: 'var(--paper-2, #fff)', border: '1px solid var(--rule, #ddd)', borderRadius: 6, padding: '10px 12px', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box' };
const group: React.CSSProperties = { margin: '0 0 24px' };
const btn = (on: boolean): React.CSSProperties => ({ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: on ? 'var(--paper)' : 'var(--ink-3)', background: on ? 'var(--ink)' : 'var(--rule, #eee)', border: 'none', borderRadius: 6, padding: '11px 18px', cursor: on ? 'pointer' : 'default' });
const guidance: React.CSSProperties = { fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink-2)', lineHeight: 1.5, margin: '16px 0 0' };
const link: React.CSSProperties = { fontFamily: 'var(--sans)', fontSize: '0.78rem', color: 'var(--ink-3)', textDecoration: 'none' };
const MAX = 4000; // mirrors the server per-answer cap

export function DeclarePage() {
  const { founderId, isLoading } = useAuth();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState<DeclareQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const on401 = useCallback((e: unknown): boolean => {
    if (e instanceof ApiError && e.status === 401) { navigate('/login', { replace: true }); return true; }
    return false;
  }, [navigate]);

  useEffect(() => {
    if (!founderId) return;
    let live = true;
    getDeclareQuestions()
      .then((qs) => { if (live) { setQuestions(qs); setPhase('ready'); } })
      .catch((e) => { if (!on401(e) && live) setPhase('error'); });
    return () => { live = false; };
  }, [founderId, on401]);

  if (isLoading) return null;
  if (!founderId) return <Navigate to="/login" replace />;

  const filled = Object.values(answers).filter((t) => t.trim().length > 0);
  const canSubmit = filled.length > 0 && !saving;

  const submit = async () => {
    setSaved(false); setErr('');
    const payload = Object.entries(answers)
      .map(([f, t]) => ({ field: f, text: t.trim() }))
      .filter((a) => a.text.length > 0);
    if (payload.length === 0) { setErr(DECLARE_COPY.errorEmpty); return; }
    setSaving(true);
    try {
      await submitDeclaration(payload);
      setSaved(true);
    } catch (e) {
      if (on401(e)) return;
      setErr(DECLARE_COPY.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={inner}>
        <h1 style={title}>{DECLARE_COPY.title}</h1>
        <p style={intro}>{DECLARE_COPY.intro}</p>

        {phase === 'loading' && <p style={quiet}>{DECLARE_COPY.loading}</p>}
        {phase === 'error' && <p style={quiet}>{DECLARE_COPY.errorGeneric}</p>}

        {phase === 'ready' && questions && (
          <>
            {questions.map((q) => (
              <div key={q.key} style={group}>
                <label style={label} htmlFor={`declare-${q.key}`}>{q.question}</label>
                <textarea
                  id={`declare-${q.key}`}
                  style={field}
                  maxLength={MAX}
                  value={answers[q.key] ?? ''}
                  onChange={(e) => { setSaved(false); setAnswers((a) => ({ ...a, [q.key]: e.target.value })); }}
                  aria-label={q.label}
                />
              </div>
            ))}

            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void submit()} disabled={!canSubmit} aria-disabled={!canSubmit} aria-busy={saving} style={btn(canSubmit)}>
                {saving ? DECLARE_COPY.submitting : DECLARE_COPY.submit}
              </button>
              {saved && <p style={guidance} role="status">{DECLARE_COPY.success}</p>}
              {err && <p style={{ ...guidance, color: 'var(--warn-ink, #a33)' }} role="alert">{err}</p>}
            </div>

            <div style={{ marginTop: 40, display: 'flex', gap: 20 }}>
              <Link to="/reads" style={link}>{DECLARE_COPY.yourReads}</Link>
              <Link to="/account" style={link}>{DECLARE_COPY.account}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
