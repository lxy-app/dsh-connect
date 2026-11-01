import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { adminApi, getAuthToken, setAuthToken, setUnauthorizedHandler } from '../api/client';
import type { AdminUser } from '../api/client';

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(getAuthToken()));
  const [error, setError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
  }, [clearSession]);

  // A token from a previous visit must be validated before showing the shell.
  useEffect(() => {
    if (!getAuthToken()) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    adminApi
      .me(controller.signal)
      .then((resolved) => setUser(resolved))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        clearSession();
        setError(cause instanceof Error ? cause.message : '会话已失效');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [clearSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const response = await adminApi.login(email, password);
    setUser(response.user);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, error, signIn, signOut }),
    [user, loading, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}