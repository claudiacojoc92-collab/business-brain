import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { clearToken, getFounderStatus, setToken, type FounderStatus } from '../api/client';

interface AuthState {
  founder: FounderStatus | null;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [founder, setFounder] = useState<FounderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadFounder = useCallback(async () => {
    try {
      const status = await getFounderStatus();
      setFounder(status);
    } catch {
      setFounder(null);
      clearToken();
    } finally {
      setIsLoading(false);
    }
  }, []);

  // On mount: try to load the founder using any stored token
  useEffect(() => {
    const token = localStorage.getItem('bb_access_token');
    if (token) {
      void loadFounder();
    } else {
      setIsLoading(false);
    }
  }, [loadFounder]);

  const login = useCallback(async (token: string) => {
    setToken(token);
    await loadFounder();
  }, [loadFounder]);

  const logout = useCallback(() => {
    clearToken();
    setFounder(null);
  }, []);

  const refreshStatus = useCallback(async () => {
    await loadFounder();
  }, [loadFounder]);

  return (
    <AuthContext.Provider value={{ founder, isLoading, login, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
