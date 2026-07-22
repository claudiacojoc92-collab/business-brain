import type { ReactNode, CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { PrimaryNav } from './PrimaryNav';

/**
 * A–E shared UI system (Wave 1). The premium substrate every A–E surface reuses: shell, buttons, fields,
 * a reusable thinking state, and the initial patterns for the future understanding-reveal, conversation,
 * and approval surfaces. Inline styles resolve design tokens (tokens.css + system.css). Motion classes
 * (.bb-rise / .bb-in) live in system.css and honor prefers-reduced-motion.
 */

// ── App shell — slim top bar (mark + actions) over a centered content column ──────────────────────────
export function AppShell({ children, actions, max = 'var(--reading)' }: { children: ReactNode; actions?: ReactNode; max?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--paper)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-5)', padding: '16px 24px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <Link to="/home" style={{ textDecoration: 'none', display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>Business Brain</span>
          <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', transform: 'translateY(-3px)' }} />
        </Link>
        {/* The one persistent app navigation (renders only when signed in). Page-specific actions sit to its right. */}
        <PrimaryNav />
        {actions && <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>{actions}</div>}
      </header>
      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '48px 20px 96px' }}>
        <div style={{ width: '100%', maxWidth: max }}>{children}</div>
      </main>
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost';
const btnBase: CSSProperties = {
  fontFamily: 'var(--sans)', fontSize: 'var(--fs-body)', fontWeight: 500, borderRadius: 'var(--r-pill)',
  padding: '12px 22px', cursor: 'pointer', border: '1px solid transparent', transition: 'transform var(--dur-1) var(--ease), opacity var(--dur-1) var(--ease), background var(--dur-1) var(--ease)',
};
const btnStyles: Record<BtnVariant, CSSProperties> = {
  primary: { ...btnBase, background: 'var(--ink)', color: 'var(--paper)' },
  secondary: { ...btnBase, background: 'transparent', color: 'var(--ink)', borderColor: 'var(--line-2)' },
  ghost: { ...btnBase, background: 'transparent', color: 'var(--ink-2)', padding: '10px 12px' },
};
export function Button({ children, variant = 'primary', onClick, type = 'button', disabled, loading, full }: {
  children: ReactNode; variant?: BtnVariant; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; loading?: boolean; full?: boolean;
}) {
  const off = disabled || loading;
  return (
    <button type={type} onClick={onClick} disabled={off} aria-busy={loading}
      style={{ ...btnStyles[variant], width: full ? '100%' : undefined, opacity: off ? 0.55 : 1, cursor: off ? 'default' : 'pointer' }}>
      {loading ? 'Working…' : children}
    </button>
  );
}

export function GoogleButton({ onClick, disabled }: { onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ ...btnStyles.secondary, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: disabled ? 0.55 : 1 }}>
      <span aria-hidden style={{ fontFamily: 'var(--sans)', fontWeight: 700, color: 'var(--gold)' }}>G</span>
      Continue with Google
    </button>
  );
}

// ── Fields ────────────────────────────────────────────────────────────────────────────────────────────
export function Field({ label, id, type = 'text', value, onChange, autoComplete, placeholder, autoFocus, error }: {
  label: string; id: string; type?: string; value: string; onChange: (v: string) => void;
  autoComplete?: string; placeholder?: string; autoFocus?: boolean; error?: boolean;
}) {
  return (
    <label htmlFor={id} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontFamily: 'var(--sans)', fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', marginBottom: 6 }}>{label}</span>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} autoFocus={autoFocus}
        style={{
          width: '100%', fontFamily: 'var(--sans)', fontSize: 'var(--fs-body)', color: 'var(--ink)', background: 'var(--surface)',
          border: `1px solid ${error ? 'var(--warn-line)' : 'var(--line-2)'}`, borderRadius: 'var(--r-1)', padding: '11px 13px', boxSizing: 'border-box',
        }} />
    </label>
  );
}

// ── Reusable thinking / loading state (Business Brain "is thinking, not lagging") ─────────────────────
export function Thinking({ message = 'Thinking…' }: { message?: string }) {
  return (
    <div className="bb-in" role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink-3)', fontFamily: 'var(--serif)', fontSize: 'var(--fs-4)' }}>
      <span aria-hidden style={{ display: 'inline-flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: `bb-pulse 1.1s var(--ease) ${i * 0.18}s infinite` }} />
        ))}
      </span>
      {message}
    </div>
  );
}

// ── Initial patterns (established now; wired into flows in later waves) ────────────────────────────────
/** Staged reveal block — the understanding/aha surfaces compose these with an increasing index. */
export function RevealBlock({ index = 0, children }: { index?: number; children: ReactNode }) {
  return <div className="bb-rise" style={{ ['--i' as string]: index, marginBottom: 'var(--sp-5)' }}>{children}</div>;
}

/** Conversation turn — the strategist-conversation pattern. */
export function ConversationBubble({ from, children }: { from: 'brain' | 'founder'; children: ReactNode }) {
  const brain = from === 'brain';
  return (
    <div style={{ display: 'flex', justifyContent: brain ? 'flex-start' : 'flex-end', marginBottom: 'var(--sp-3)' }}>
      <div style={{
        maxWidth: '82%', padding: '12px 16px', borderRadius: 'var(--r-3)', lineHeight: 'var(--lh-snug)',
        fontFamily: brain ? 'var(--serif)' : 'var(--sans)', fontSize: 'var(--fs-4)',
        background: brain ? 'var(--surface)' : 'var(--paper-2)', color: 'var(--ink)', boxShadow: brain ? 'var(--elev-1)' : 'none',
      }}>{children}</div>
    </div>
  );
}

/** Approval card — the content-approval pattern (approve / revise). */
export function ApprovalCard({ title, children, onApprove, onRevise }: { title: string; children: ReactNode; onApprove?: () => void; onRevise?: () => void }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-2)', padding: 'var(--sp-5)', boxShadow: 'var(--elev-1)', marginBottom: 'var(--sp-4)' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 'var(--fs-3)', color: 'var(--ink)', marginBottom: 'var(--sp-3)' }}>{title}</div>
      <div style={{ color: 'var(--ink-2)', marginBottom: 'var(--sp-4)' }}>{children}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="primary" onClick={onApprove}>Approve</Button>
        <Button variant="secondary" onClick={onRevise}>Revise</Button>
      </div>
    </div>
  );
}

export const authCard: CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-3)',
  padding: 'var(--sp-7)', boxShadow: 'var(--elev-2)', maxWidth: 420, margin: '0 auto',
};
