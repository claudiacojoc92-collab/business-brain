/**
 * Business Brain V1 — authoritative server-state reconciliation hook.
 *
 * Follows the frozen Frontend State Model:
 *  - Authoritative query state (Founder/Session/Connection/Current/Refresh) comes
 *    only from the API; no server truth lives in presentation state.
 *  - Refresh Progress is ONE coherent snapshot; phase booleans are never stored
 *    independently. Stale snapshots (older refresh_reference or lower
 *    transition_marker) never regress the UI.
 *  - Current is immutable per Version ID; a Refresh never mutates the visible
 *    Current; on completion we refetch and replace atomically only if the
 *    Version ID changed. Candidate is never represented.
 *  - Start Refresh uses one client idempotency token per intended command;
 *    network retries reuse it; a deliberate later Refresh uses a new token.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  bbCancelRefresh,
  bbConnect,
  bbDisconnect,
  bbStartRefresh,
  getBBConnection,
  getBBCurrent,
  getBBFounder,
  getBBRefresh,
  getBBSession,
  type BBConnectionStatus,
  type BBCurrent,
  type BBFounder,
  type BBRefreshSnapshot,
  type BBSession,
} from '../api/client';

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);
const PENDING_TOKEN_KEY = 'bb_pending_refresh_token';

/** Resilient session storage for the unresolved token (falls back to in-memory). */
const memoryStore = new Map<string, string>();
const safeSession = {
  get(k: string): string | null {
    try { return globalThis.sessionStorage?.getItem(k) ?? memoryStore.get(k) ?? null; }
    catch { return memoryStore.get(k) ?? null; }
  },
  set(k: string, v: string): void {
    memoryStore.set(k, v);
    try { globalThis.sessionStorage?.setItem(k, v); } catch { /* ignore */ }
  },
  remove(k: string): void {
    memoryStore.delete(k);
    try { globalThis.sessionStorage?.removeItem(k); } catch { /* ignore */ }
  },
};

export type BBPhase = 'loading' | 'unauthenticated' | 'ready';

export interface BBBusy {
  connecting: boolean;
  disconnecting: boolean;
  starting: boolean;
  cancelling: boolean;
}

export interface UseBusinessBrain {
  phase: BBPhase;
  founder: BBFounder | null;
  session: BBSession | null;
  connection: BBConnectionStatus | null;
  current: BBCurrent | null;
  refresh: BBRefreshSnapshot | null;
  currentUnavailable: boolean;
  announcement: string;
  commandError: { code: string; message: string } | null;
  busy: BBBusy;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  startRefresh: () => Promise<void>;
  cancelRefresh: () => Promise<void>;
  reload: () => Promise<void>;
  /** One polling iteration (the workspace drives this on an interval). */
  pollOnce: () => Promise<void>;
}

function newToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `tok-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** Chronological order of ULID refresh_references is lexical. */
function isOlderRef(candidate: string | undefined, expected: string | null): boolean {
  return !!candidate && !!expected && candidate < expected;
}

export function useBusinessBrain(): UseBusinessBrain {
  const [phase, setPhase] = useState<BBPhase>('loading');
  const [founder, setFounder] = useState<BBFounder | null>(null);
  const [session, setSession] = useState<BBSession | null>(null);
  const [connection, setConnection] = useState<BBConnectionStatus | null>(null);
  const [current, setCurrent] = useState<BBCurrent | null>(null);
  const [refresh, setRefresh] = useState<BBRefreshSnapshot | null>(null);
  const [currentUnavailable, setCurrentUnavailable] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [commandError, setCommandError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState<BBBusy>({ connecting: false, disconnecting: false, starting: false, cancelling: false });

  // Reconciliation guards (refs — never trigger renders, never regress the UI).
  const epochRef = useRef(0); // initial-load request identity
  const expectedRefRef = useRef<string | null>(null); // active refresh_reference
  const lastMarkerRef = useRef(-1); // last applied transition_marker for expectedRef
  const pollInFlightRef = useRef(false); // prevents overlapping polls

  const isUnauthorized = (e: unknown): boolean => e instanceof ApiError && e.status === 401;

  /** Apply a Refresh snapshot only if it is not stale (coherent-snapshot rule). */
  const applySnapshot = useCallback((s: BBRefreshSnapshot): boolean => {
    if (isOlderRef(s.refreshReference, expectedRefRef.current)) return false; // older refresh
    const sameRef = s.refreshReference === expectedRefRef.current;
    if (sameRef && s.transitionMarker < lastMarkerRef.current) return false; // stale marker
    if (!sameRef && s.refreshReference) {
      expectedRefRef.current = s.refreshReference; // adopt the newer refresh
      lastMarkerRef.current = -1;
    }
    lastMarkerRef.current = Math.max(lastMarkerRef.current, s.transitionMarker);
    setRefresh(s);
    return true;
  }, []);

  const refetchCurrent = useCallback(async (): Promise<void> => {
    try {
      const c = await getBBCurrent();
      setCurrentUnavailable(false);
      if ('state' in c) {
        setCurrent(c); // no_current_version is authoritative
        return;
      }
      // Replace only with a complete Version; atomic (whole object), never merged.
      const complete =
        c.versionId && c.businessReality && c.businessConsequences.length > 0 &&
        c.evidence.claims.length > 0 && c.cannotYetKnow && c.rootCauses.length > 0 &&
        c.recommendations.length > 0 && c.executionPlan.length > 0;
      if (!complete) {
        setCurrentUnavailable(true); // keep last valid Current; show availability notice
        return;
      }
      setCurrent(c);
    } catch (e) {
      if (isUnauthorized(e)) setPhase('unauthenticated');
      else setCurrentUnavailable(true); // preserve last valid Current
    }
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    const epoch = ++epochRef.current;
    setPhase((p) => (p === 'ready' ? p : 'loading'));
    const [f, s, conn, ref, cur] = await Promise.allSettled([
      getBBFounder(), getBBSession(), getBBConnection(), getBBRefresh(), getBBCurrent(),
    ]);
    if (epoch !== epochRef.current) return; // a newer reload superseded this one

    if ([f, s, conn, ref, cur].some((r) => r.status === 'rejected' && isUnauthorized((r as PromiseRejectedResult).reason))) {
      setPhase('unauthenticated');
      return;
    }
    if (f.status === 'fulfilled') setFounder(f.value);
    if (s.status === 'fulfilled') setSession(s.value);
    if (conn.status === 'fulfilled') setConnection(conn.value);
    if (ref.status === 'fulfilled') {
      // Reset guards from the authoritative snapshot on a full reload.
      expectedRefRef.current = ref.value.refreshReference ?? null;
      lastMarkerRef.current = ref.value.transitionMarker;
      setRefresh(ref.value);
    }
    if (cur.status === 'fulfilled') {
      if ('state' in cur.value) setCurrent(cur.value);
      else { setCurrent(cur.value); setCurrentUnavailable(false); }
    } else if (cur.status === 'rejected') {
      setCurrentUnavailable(true);
    }
    setPhase('ready');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onTerminal = useCallback(async (s: BBRefreshSnapshot): Promise<void> => {
    if (s.refreshState === 'completed') {
      await refetchCurrent();
      setAnnouncement('Your new Business Brain version is ready.');
    } else if (s.refreshState === 'failed') {
      setAnnouncement('The refresh could not be completed. Your current version has not changed.');
    } else if (s.refreshState === 'cancelled') {
      setAnnouncement('The refresh was cancelled. Your current version has not changed.');
    }
  }, [refetchCurrent]);

  const pollOnce = useCallback(async (): Promise<void> => {
    if (pollInFlightRef.current) return; // no overlapping polls
    // Only poll while non-terminal.
    if (refresh && TERMINAL.has(refresh.refreshState)) return;
    if (typeof document !== 'undefined' && document.hidden) return; // pause when hidden
    pollInFlightRef.current = true;
    try {
      const s = await getBBRefresh();
      const applied = applySnapshot(s);
      if (applied && TERMINAL.has(s.refreshState)) await onTerminal(s);
    } catch (e) {
      if (isUnauthorized(e)) setPhase('unauthenticated');
      // other transient poll errors: leave state; next tick retries
    } finally {
      pollInFlightRef.current = false;
    }
  }, [refresh, applySnapshot, onTerminal]);

  // ---- Commands ----

  const connect = useCallback(async () => {
    setCommandError(null);
    setBusy((b) => ({ ...b, connecting: true }));
    try {
      // Begin REAL Instagram Business Login: navigate the browser to the provider consent URL.
      // The callback stores the encrypted credential and returns the browser to /business-brain.
      const { authUrl } = await bbConnect();
      if (authUrl) {
        window.location.assign(authUrl);
        return; // navigating away; keep the connecting state until redirect
      }
      setCommandError({ code: 'NO_AUTH_URL', message: 'Could not start Instagram sign-in. Please try again.' });
      setBusy((b) => ({ ...b, connecting: false }));
    } catch (e) {
      if (isUnauthorized(e)) setPhase('unauthenticated');
      else if (e instanceof ApiError) setCommandError({ code: e.code, message: 'Could not connect. Please try again.' });
      setBusy((b) => ({ ...b, connecting: false }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    setCommandError(null);
    setBusy((b) => ({ ...b, disconnecting: true }));
    try {
      const c = await bbDisconnect();
      setConnection(c);
      await pollOnce(); // reconcile any active refresh (may have become failed/connection_lost)
    } catch (e) {
      if (isUnauthorized(e)) setPhase('unauthenticated');
      else if (e instanceof ApiError) setCommandError({ code: e.code, message: 'Could not disconnect. Please try again.' });
    } finally {
      setBusy((b) => ({ ...b, disconnecting: false }));
    }
  }, [pollOnce]);

  const startRefresh = useCallback(async () => {
    if (busy.starting) return; // guard duplicate intentional clicks
    setCommandError(null);
    setBusy((b) => ({ ...b, starting: true }));
    // One token per intended command; a network-uncertain retry reuses it.
    let token = safeSession.get(PENDING_TOKEN_KEY);
    if (!token) { token = newToken(); safeSession.set(PENDING_TOKEN_KEY, token); }
    try {
      const s = await bbStartRefresh({ idempotencyToken: token });
      safeSession.remove(PENDING_TOKEN_KEY); // command reconciled
      applySnapshot(s); // accepted (in_progress) — NOT completed, never a Version
      setAnnouncement('Refresh started.');
    } catch (e) {
      if (isUnauthorized(e)) { setPhase('unauthenticated'); return; }
      if (e instanceof ApiError && e.code === 'REFRESH_ALREADY_IN_PROGRESS') {
        safeSession.remove(PENDING_TOKEN_KEY);
        await pollOnce(); // reconcile toward the active refresh
      } else if (e instanceof ApiError && e.code === 'IDEMPOTENCY_CONFLICT') {
        safeSession.remove(PENDING_TOKEN_KEY); // a later refresh will use a new token
        setCommandError({ code: e.code, message: 'That request was already handled differently. Reloading the latest state.' });
        await pollOnce();
      } else if (e instanceof ApiError && e.code === 'INSTAGRAM_REQUIRED') {
        safeSession.remove(PENDING_TOKEN_KEY);
        setCommandError({ code: e.code, message: 'Connect before starting a refresh.' });
      } else if (e instanceof ApiError && (e.status === 429 || e.code === 'RATE_LIMIT_EXCEEDED')) {
        // Distinct from a pipeline failure: the request was throttled, not the refresh itself failing.
        // Keep the pending token so the retry is idempotent.
        setCommandError({ code: 'RATE_LIMITED', message: 'Too many requests just now. Please wait a moment, then start the refresh again.' });
      } else {
        // Network/uncertain: keep the pending token so a retry is idempotent.
        setCommandError({ code: 'TEMPORARY', message: 'Could not start the refresh. Please try again.' });
      }
    } finally {
      setBusy((b) => ({ ...b, starting: false }));
    }
  }, [busy.starting, applySnapshot, pollOnce]);

  const cancelRefresh = useCallback(async () => {
    setCommandError(null);
    setBusy((b) => ({ ...b, cancelling: true }));
    try {
      const s = await bbCancelRefresh();
      applySnapshot(s);
    } catch (e) {
      if (isUnauthorized(e)) setPhase('unauthenticated');
      else if (e instanceof ApiError) setCommandError({ code: e.code, message: 'Could not cancel. Please try again.' });
    } finally {
      setBusy((b) => ({ ...b, cancelling: false }));
    }
  }, [applySnapshot]);

  return {
    phase, founder, session, connection, current, refresh, currentUnavailable,
    announcement, commandError, busy,
    connect, disconnect, startRefresh, cancelRefresh, reload, pollOnce,
  };
}
