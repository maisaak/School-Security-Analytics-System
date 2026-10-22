import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, UNAUTHORIZED_EVENT, User } from "../api/client";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  demoLogin: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      setError("Сессия истекла — войдите заново");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const session = await api.login(username, password);
      setUser(session.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось войти";
      setError(message);
      throw err;
    }
  }, []);

  const demoLogin = useCallback(async (username: string) => {
    setError(null);
    try {
      const session = await api.demoLogin(username);
      setUser(session.user);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось выполнить быстрый вход";
      setError(message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, error, login, demoLogin, logout, can }),
    [user, loading, error, login, demoLogin, logout, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
