import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  setToken,
  clearToken,
  getMe,
  listBusinesses,
  ApiError,
  type Account,
  type Business,
} from '../api/client';

interface SessionState {
  account: Account | null;
  businesses: Business[];
  isLoading: boolean;
  /** The startup load couldn't reach us (network / 5xx / a failed business list) — NOT a sign-out. The entry
   *  gate shows a retry instead of bouncing to sign-in; the token is kept so a retry can recover. */
  loadError: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * Slice-0 session: the authenticated person (account) plus the businesses they belong to.
 * Independent of the legacy AuthContext (which the retired weekly-cycle pages still use).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true); setLoadError(false);
    // getMe is the AUTH check. A definitive 401/403 means the session is invalid → sign out. Anything else
    // (network TypeError, 5xx, timeout) means "couldn't reach us", NOT "logged out" → keep the token and let the
    // entry gate offer a retry. Clearing the token on a blip is what dropped paying founders to sign-in.
    let me: Account;
    try {
      me = await getMe();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { setAccount(null); setBusinesses([]); clearToken(); }
      else setLoadError(true);
      setIsLoading(false);
      return;
    }
    // The session is valid from here. A listBusinesses failure is a LOAD failure of one read, never an auth
    // failure — so it must not clear the token or sign out; it becomes a recoverable loadError (retry).
    setAccount(me);
    try {
      const list = await listBusinesses();
      setBusinesses(list.businesses);
    } catch {
      setBusinesses([]);
      setLoadError(true);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (token) void load();
    else setIsLoading(false);
  }, [load]);

  const login = useCallback(
    async (token: string) => {
      setToken(token);
      setIsLoading(true);
      await load();
    },
    [load],
  );

  const logout = useCallback(() => {
    clearToken();
    setAccount(null);
    setBusinesses([]);
    setLoadError(false);
  }, []);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return (
    <SessionContext.Provider value={{ account, businesses, isLoading, loadError, login, logout, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
