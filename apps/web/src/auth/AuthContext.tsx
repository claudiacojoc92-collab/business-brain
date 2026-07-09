import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSession, logoutSession } from '../api/client';

/**
 * Magic-link SESSION auth (S0-T2). Identity is the HttpOnly `bb_session` cookie — the browser holds
 * it, JS never reads it. On mount we ask GET /auth/me who (if anyone) the session belongs to; a 401
 * simply means "signed out". There is no client token to store or clear.
 */
interface AuthState {
  founderId: string | null;
  isLoading: boolean;
  /** Re-read the session after the verify link lands (cookie already set server-side). */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [founderId, setFounderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSession = useCallback(async () => {
    try {
      const session = await getSession();
      setFounderId(session.founder_id);
    } catch {
      setFounderId(null); // 401 (or any error) → no active session
    } finally {
      setIsLoading(false);
    }
  }, []);

  // On mount: resolve whoever the bb_session cookie identifies (if anyone).
  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    await loadSession();
  }, [loadSession]);

  const logout = useCallback(async () => {
    try {
      await logoutSession(); // revoke server-side + clear cookie
    } catch {
      // best-effort; local state is cleared regardless
    }
    setFounderId(null);
  }, []);

  return (
    <AuthContext.Provider value={{ founderId, isLoading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
