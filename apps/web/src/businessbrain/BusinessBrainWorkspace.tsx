/**
 * The single Business Brain workspace. One stable surface whose regions change
 * with authoritative server state (no per-state pages). Owns bounded, non-
 * overlapping Refresh polling that runs only while the Refresh is in progress.
 */
import { useEffect } from 'react';
import { useBusinessBrain } from './useBusinessBrain';
import { CurrentBusinessBrain } from './CurrentBusinessBrain';
import { RefreshProgress } from './RefreshProgress';

const btn: React.CSSProperties = {
  font: '600 14px/1 var(--sans,system-ui)', padding: '10px 16px', borderRadius: 8,
  border: '1px solid var(--line,#e5e7eb)', background: 'var(--paper-2,#fff)', color: 'var(--ink,#111827)', cursor: 'pointer',
};
const primary: React.CSSProperties = { ...btn, background: 'var(--gold,#b45309)', borderColor: 'var(--gold,#b45309)', color: '#fff' };
const muted: React.CSSProperties = { ...btn, background: 'var(--paper-3,#f0eee9)', borderColor: 'var(--line,#e5e7eb)', color: 'var(--faint,#9ca3af)', cursor: 'not-allowed' };
const wrap: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '32px 20px', font: 'var(--sans,system-ui)' };

export function BusinessBrainWorkspace({ pollIntervalMs = 1500 }: { pollIntervalMs?: number }) {
  const bb = useBusinessBrain();

  // Bounded polling: only while the Refresh is in progress; cleared otherwise.
  const inProgress = bb.refresh?.refreshState === 'in_progress';
  useEffect(() => {
    if (!inProgress) return;
    const id = setInterval(() => { void bb.pollOnce(); }, pollIntervalMs);
    return () => clearInterval(id);
  }, [inProgress, pollIntervalMs, bb.pollOnce]);

  if (bb.phase === 'loading') {
    return <div style={wrap}><p role="status" aria-live="polite" style={{ color: 'var(--ink-3,#6b7280)' }}>Loading your Business Brain…</p></div>;
  }
  if (bb.phase === 'unauthenticated') {
    return (
      <div style={wrap}>
        <h1 style={{ font: '600 22px var(--serif,Georgia)' }}>Please sign in again</h1>
        <p style={{ color: 'var(--ink-2,#374151)' }}>Your session has ended.</p>
        <a href="/login" style={{ ...primary, display: 'inline-block', textDecoration: 'none' }}>Go to sign in</a>
      </div>
    );
  }

  const connected = bb.connection?.connectionState === 'connected';
  const current = bb.current;
  const hasVersion = current && !('state' in current);

  return (
    <div style={wrap}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ font: '600 26px/1.2 var(--serif,Georgia)', color: 'var(--ink,#111827)', margin: '0 0 4px' }}>Business Brain</h1>
        <p style={{ font: '400 14px var(--sans,system-ui)', color: 'var(--ink-3,#6b7280)', margin: 0 }}>
          Your business explained back to you — updated only when you choose.
        </p>
      </header>

      {/* Live region: only meaningful transitions are announced. */}
      <div role="status" aria-live="polite" data-testid="bb-announcement" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {bb.announcement}
      </div>

      {/* Connection + Refresh controls */}
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16, padding: 16, background: 'var(--paper-3,#f9fafb)', border: '1px solid var(--line,#e5e7eb)', borderRadius: 10 }}>
        <span data-testid="connection-status" style={{ font: '500 14px var(--sans,system-ui)', color: connected ? 'var(--ok-ink,#065f46)' : 'var(--ink-3,#6b7280)' }}>
          {connected ? 'Instagram connected' : 'Instagram not connected'}
        </span>
        {!connected ? (
          <button type="button" style={primary} onClick={() => void bb.connect()} disabled={bb.busy.connecting}>
            {bb.busy.connecting ? 'Connecting…' : 'Connect Instagram'}
          </button>
        ) : (
          <button type="button" style={btn} onClick={() => void bb.disconnect()} disabled={bb.busy.disconnecting}>
            {bb.busy.disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        )}
        <button
          type="button"
          style={!connected || bb.busy.starting || inProgress ? muted : primary}
          data-testid="start-refresh"
          onClick={() => void bb.startRefresh()}
          disabled={!connected || bb.busy.starting || inProgress}
          aria-describedby={!connected ? 'start-refresh-reason' : undefined}
        >
          {inProgress ? 'Refresh in progress…' : bb.busy.starting ? 'Starting…' : 'Start refresh'}
        </button>
        {inProgress && (
          <button type="button" style={btn} onClick={() => void bb.cancelRefresh()} disabled={bb.busy.cancelling}>
            {bb.busy.cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {!connected && (
          <span id="start-refresh-reason" style={{ font: '400 13px var(--sans,system-ui)', color: 'var(--ink-3,#6b7280)', width: '100%' }}>
            Connect before starting a refresh.
          </span>
        )}
      </section>

      {bb.refresh && bb.refresh.refreshState !== 'none' && (
        <div style={{ marginBottom: 16 }}><RefreshProgress snapshot={bb.refresh} /></div>
      )}

      {bb.commandError && (
        <p role="alert" data-testid="command-error" style={{ font: '400 14px var(--sans,system-ui)', color: 'var(--warn-ink,#92400e)', background: 'var(--warn-bg,#fffbeb)', border: '1px solid var(--warn-line,#fde68a)', borderRadius: 8, padding: '10px 12px' }}>
          {bb.commandError.message}
        </p>
      )}

      {/* Current Business Brain — stays visible during Refresh; replaced atomically. */}
      {bb.currentUnavailable && !hasVersion && (
        <p role="alert" style={{ color: 'var(--warn-ink,#92400e)' }}>Your Business Brain is temporarily unavailable. Please try again.</p>
      )}
      {hasVersion ? (
        <CurrentBusinessBrain version={current} />
      ) : (
        <section data-testid="no-current-version" style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--paper-2,#fff)', border: '1px dashed var(--line,#e5e7eb)', borderRadius: 10 }}>
          <h2 style={{ font: '600 20px var(--serif,Georgia)', color: 'var(--ink,#111827)', margin: '0 0 8px' }}>No version yet</h2>
          <p style={{ font: '400 15px/1.6 var(--sans,system-ui)', color: 'var(--ink-2,#374151)', margin: 0 }}>
            {connected
              ? 'Start a refresh to build your first Business Brain version from your available source information.'
              : 'Connect Instagram, then start a refresh to build your first Business Brain version.'}
          </p>
        </section>
      )}
    </div>
  );
}
