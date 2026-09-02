import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  setToken,
  clearToken,
  getMe,
  listBusinesses,
  type Account,
  type Business,
} from '../api/client';

interface SessionState {
  account: Account | null;
  businesses: Business[];
  isLoading: boolean;
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

  const load = useCallback(async () => {
    try {
      const [me, list] = await Promise.all([getMe(), listBusinesses()]);
      setAccount(me);
      setBusinesses(list.businesses);
    } catch {
      setAccount(null);
      setBusinesses([]);
      clearToken();
    } finally {
      setIsLoading(false);
    }
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
  }, []);

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  return (
    <SessionContext.Provider value={{ account, businesses, isLoading, login, logout, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
